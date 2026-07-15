/**
 * Voice call state — manages LiveKit connection for voice/video calls.
 *
 * Per-instance class that wraps livekit-client's Room instance.
 * Handles joining/leaving calls, mute toggle, camera toggle,
 * screen share toggle, and audio/video device selection.
 */

import {
  Room,
  RoomEvent,
  Track,
  AudioPresets,
  ConnectionState,
  ScreenSharePresets,
  VideoPresets,
  DisconnectReason,
  ExternalE2EEKeyProvider,
  RpcError,
  type LocalAudioTrack,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  type RpcInvocationData,
  type ReconnectContext,
  type ReconnectPolicy,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions
} from 'livekit-client';
import { Code, ConnectError } from '@connectrpc/connect';
import { SvelteMap } from 'svelte/reactivity';
import { toast } from '$lib/ui/toast';
import { playCallSound } from '$lib/audio/callSounds';
import {
  createVoiceAudioCaptureOptions,
  ensureBackgroundNoiseSuppression
} from '$lib/audio/backgroundNoiseSuppression';
import * as m from '$lib/i18n/messages';
import type {
  VoiceCallAPI,
  VoiceCallJoinMode,
  VoiceCallJoinResult,
  VoiceCallToken
} from '$lib/api-client/voiceCalls';

export type CallParticipantInfo = {
  identity: string;
  participantId: string;
  userId: string;
  deviceIndex: number;
  name: string;
  login: string;
  avatarUrl: string | null;
  isMuted: boolean;
  isLocal: boolean;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';
  isCameraEnabled: boolean;
  videoTrack: Track | null;
  isScreenShareEnabled: boolean;
  isScreenShareAudioEnabled: boolean;
  screenShareTrack: Track | null;
  isLocallyMuted: boolean;
  canControlAudio: boolean;
  siblingMicrophoneMuted: boolean | null;
  siblingOutputMuted: boolean | null;
  isSiblingMicrophoneControlPending: boolean;
  isSiblingOutputControlPending: boolean;
};

export type SiblingAudioTarget = 'microphone' | 'output';

/** Non-reactive audio level snapshot, read imperatively by the UI at ~60ms. */
export type AudioLevelInfo = {
  isSpeaking: boolean;
  audioLevel: number;
};

export type CallTransitionSoundDecision = 'play' | 'defer' | 'skip';

/** Metadata embedded in the LiveKit token by the backend. */
type ParticipantMetadata = {
  userId?: string;
  participantId?: string;
  deviceIndex?: number;
  login?: string;
  avatarUrl?: string;
};

const RECENTLY_DISCONNECTED_CALL_SOUND_MS = 5_000;
const MEDIA_DEVICE_TOAST_DEDUPLICATION_MS = 1_500;
const DEVICE_AUDIO_CONTROL_RPC_METHOD = 'towk.device-audio-control.v1';
const DEVICE_AUDIO_CONTROL_RPC_TIMEOUT_MS = 8_000;
const DEVICE_AUDIO_STATE_SYNC_RPC_TIMEOUT_MS = 2_000;
const DEVICE_AUDIO_STATE_SYNC_RETRY_DELAYS_MS = [0, 250, 750, 1_500] as const;
const DEVICE_AUDIO_CONTROL_RPC_UNAUTHORIZED = 2_001;
const DEVICE_AUDIO_CONTROL_RPC_INVALID_REQUEST = 2_002;
const DEVICE_AUDIO_CONTROL_RPC_OPERATION_FAILED = 2_003;

type SiblingAudioState = {
  version: 1;
  microphoneMuted: boolean;
  outputMuted: boolean;
  revision: number;
};

type SiblingAudioControlRequest =
  | { version: 1; action: 'get-state' }
  | {
      version: 1;
      action: 'set-state';
      target: SiblingAudioTarget;
      muted: boolean;
    }
  | {
      version: 1;
      action: 'state-changed';
      state: SiblingAudioState;
    };

const CALL_RECOVERY_RETRY_INTERVAL_MS = 2_500;

/**
 * Keep LiveKit's native resume/full-reconnect path alive for as long as the
 * participant intends to stay in the call. The first retry is immediate; all
 * later retries use a stable 2.5 second cadence.
 */
export class PersistentReconnectPolicy implements ReconnectPolicy {
  nextRetryDelayInMs(context: ReconnectContext): number {
    return context.retryCount === 0 ? 0 : CALL_RECOVERY_RETRY_INTERVAL_MS;
  }
}

type CallRecoveryTarget = {
  livekitUrl: string;
  roomId: string;
};

type CallRecoveryMediaState = {
  isMuted: boolean;
  isOutputMuted: boolean;
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  selectedDeviceId: string | null;
  selectedOutputDeviceId: string | null;
  selectedVideoDeviceId: string | null;
};

type VoiceCallMediaDeviceTarget = 'microphone' | 'camera' | 'screen' | 'speaker' | 'device';
type VoiceCallMediaDeviceContext = 'join' | 'enable' | 'switch' | 'event';
type MediaDeviceFailureKind =
  | 'permission-denied'
  | 'not-found'
  | 'in-use'
  | 'constraint'
  | 'aborted'
  | 'unsupported'
  | 'unknown';

export class VoiceCallJoinError extends Error {
  readonly userMessage: string;
  readonly cause?: unknown;

  constructor(message: string, userMessage: string, cause?: unknown) {
    super(message);
    this.name = 'VoiceCallJoinError';
    this.userMessage = userMessage;
    this.cause = cause;
  }
}

export function getVoiceCallJoinErrorMessage(err: unknown): string {
  if (err instanceof VoiceCallJoinError) return err.userMessage;

  const message = errorMessage(err);
  if (/signal connection|serverunreachable|websocket|web socket|abort handler/i.test(message)) {
    return m['voice.signaling_failed']();
  }
  if (/e2ee|cryptor|encoded transform|insertable stream/i.test(message)) {
    return m['voice.encrypted_unsupported']();
  }

  return m['voice.join_failed']();
}

export function getVoiceCallMediaDeviceErrorMessage(
  target: VoiceCallMediaDeviceTarget,
  err: unknown,
  context: VoiceCallMediaDeviceContext = 'event'
): string {
  const failure = classifyMediaDeviceFailure(err);

  if (target === 'microphone' && context === 'join') {
    switch (failure) {
      case 'permission-denied':
        return m['voice.microphone_join_denied']();
      case 'not-found':
        return m['voice.microphone_join_not_found']();
      case 'in-use':
        return m['voice.microphone_join_in_use']();
      default:
        return m['voice.microphone_join_failed']();
    }
  }

  if (target === 'microphone') {
    switch (failure) {
      case 'permission-denied':
        return m['voice.microphone_denied']();
      case 'not-found':
        return m['voice.microphone_not_found']();
      case 'in-use':
        return m['voice.microphone_in_use']();
      default:
        return m['voice.microphone_failed']();
    }
  }

  if (target === 'camera') {
    switch (failure) {
      case 'permission-denied':
        return m['voice.camera_denied']();
      case 'not-found':
        return m['voice.camera_not_found']();
      case 'in-use':
        return m['voice.camera_in_use']();
      default:
        return m['voice.camera_failed']();
    }
  }

  if (target === 'screen') {
    if (failure === 'unsupported') {
      return m['voice.screen_share_unsupported']();
    }
    if (failure === 'permission-denied' || failure === 'aborted') {
      return m['voice.screen_share_blocked']();
    }
    return m['voice.screen_share_failed']();
  }

  if (target === 'speaker') {
    return m['voice.speaker_switch_failed']();
  }

  if (context === 'switch') {
    return m['voice.device_switch_failed']();
  }

  return m['voice.media_device_failed']();
}

export class VoiceCallState {
  #api: VoiceCallAPI;

  // Current call context
  roomId = $state<string | null>(null);

  // Connection state
  connecting = $state(false);
  connected = $state(false);
  reconnecting = $state(false);

  // Audio state
  isMuted = $state(false);
  // Local playback state for all remote microphone and screen-share audio.
  isOutputMuted = $state(false);
  // True while LiveKit is applying local device enable/disable changes.
  isMicrophonePending = $state(false);

  // Video state — camera is always disabled by default
  isCameraEnabled = $state(false);
  // True while LiveKit is applying local camera enable/disable changes.
  isCameraPending = $state(false);
  isScreenShareEnabled = $state(false);
  // True while LiveKit is applying local screen-share enable/disable changes.
  isScreenSharePending = $state(false);

  /** Live capability probe; unsupported mobile PWAs get an explicit explanation. */
  get canShareScreen(): boolean {
    return isScreenShareSupported();
  }

  // Participants (including local)
  participants = $state<CallParticipantInfo[]>([]);

  // Remote participants locally muted by this browser session only.
  locallyMutedParticipantIds = $state<Record<string, boolean>>({});

  // Audio input devices
  audioDevices = $state<MediaDeviceInfo[]>([]);
  selectedDeviceId = $state<string | null>(null);

  // Audio output devices
  audioOutputDevices = $state<MediaDeviceInfo[]>([]);
  selectedOutputDeviceId = $state<string | null>(null);

  // Video input devices
  videoDevices = $state<MediaDeviceInfo[]>([]);
  selectedVideoDeviceId = $state<string | null>(null);

  // Internal LiveKit room instance
  private room: Room | null = null;
  private activeCallId: string | null = null;
  private activeParticipantId: string | null = null;
  private activeDeviceIndex: number | null = null;
  private readonly clientInstanceId = createVoiceCallClientInstanceId();
  private pendingOwnJoinSound: {
    roomId: string;
    callId: string;
  } | null = null;
  private recentlyDisconnectedCall: {
    roomId: string;
    callId: string;
    disconnectedAt: number;
  } | null = null;
  private joinInFlight: Promise<VoiceCallJoinResult> | null = null;
  private joinInFlightRoomId: string | null = null;
  private leaveInFlight: Promise<void> | null = null;
  private microphoneToggleInFlight: Promise<boolean> | null = null;
  private outputToggleInFlight: Promise<boolean> | null = null;
  private cameraToggleInFlight: Promise<void> | null = null;
  private screenShareToggleInFlight: Promise<void> | null = null;
  private e2eeWorker: Worker | null = null;
  private audioLevelInterval: ReturnType<typeof setInterval> | null = null;
  private suppressDisconnectToast = false;
  private intentionalDisconnect = false;
  private recoveryTarget: CallRecoveryTarget | null = null;
  private recoveryMediaState: CallRecoveryMediaState | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryGeneration = 0;
  private recoveryAttemptGeneration: number | null = null;
  private browserNetworkListenersAttached = false;
  private explicitMediaDeviceOperationDepth = 0;
  private lastMediaDeviceToast: {
    message: string;
    shownAt: number;
  } | null = null;
  private localAudioStateRevision = 0;
  private siblingAudioStates = $state<Record<string, SiblingAudioState>>({});
  private siblingAudioControlPending = $state<Record<string, boolean>>({});
  private siblingAudioControlInFlight = new SvelteMap<string, Promise<boolean>>();
  private siblingAudioStateRefreshInFlight = new SvelteMap<string, Promise<void>>();

  // Non-reactive audio level cache — updated at 60ms by the polling interval.
  // Deliberately NOT $state to avoid triggering Svelte reactivity at 60Hz.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- deliberately non-reactive, polled imperatively at 60Hz
  private audioLevelCache = new Map<string, AudioLevelInfo>();

  // Local microphone audio analysis (Web Audio API) for instant level feedback.
  // LiveKit's audioLevel for the local participant comes from the server
  // (round-trip latency), so we read the mic input directly instead.
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserSource: MediaStreamAudioSourceNode | null = null;
  private analyserData: Float32Array<ArrayBuffer> | null = null;

  constructor(api: VoiceCallAPI) {
    this.#api = api;
  }

  private readonly handleBrowserOffline = (): void => {
    if (!this.connected || this.intentionalDisconnect || !this.recoveryTarget) return;
    this.startRecoveryState();
  };

  private readonly handleBrowserOnline = (): void => {
    if (
      !this.reconnecting ||
      this.intentionalDisconnect ||
      !this.connected ||
      this.room?.state !== ConnectionState.Connected
    ) {
      return;
    }

    // A short browser-level outage can end before LiveKit needs to rebuild its
    // transport. In that case there is no Reconnected event to clear the
    // immediate offline notice, so the already-connected room is authoritative.
    this.reconnecting = false;
    this.recoveryMediaState = null;
    this.updateParticipants();
  };

  /**
   * Whether the user is currently in a call in the given room.
   */
  isInCall(roomId: string): boolean {
    return this.connected && this.roomId === roomId;
  }

  get participantId(): string | null {
    return this.activeParticipantId;
  }

  get deviceIndex(): number | null {
    return this.activeDeviceIndex;
  }

  matchesActiveCall(roomId: string, callId: string | null): boolean {
    return (
      this.connected && this.roomId === roomId && callId !== null && this.activeCallId === callId
    );
  }

  /**
   * Whether a durable call transition event should be audible to this client.
   *
   * Remote transitions only play while the viewer is actively connected to
   * the same call. The viewer's own join can arrive before LiveKit finishes
   * connecting, so it is deferred until connect succeeds. The viewer's own
   * leave can arrive just after local cleanup, so a short recently-left
   * window keeps that event audible without leaking sounds to bystanders.
   */
  callTransitionSoundDecision(
    kind: 'join' | 'leave',
    roomId: string,
    callId: string | null,
    actorIsCurrentUser: boolean
  ): CallTransitionSoundDecision {
    if (!callId) return 'skip';
    if (this.isOutputMuted) return 'skip';

    if (this.matchesActiveCall(roomId, callId)) return 'play';

    if (!actorIsCurrentUser) return 'skip';

    if (kind === 'join' && this.roomId === roomId && this.connecting) {
      this.pendingOwnJoinSound = { roomId, callId };
      return 'defer';
    }

    if (kind === 'leave' && this.matchesRecentlyDisconnectedCall(roomId, callId)) {
      return 'play';
    }

    return 'skip';
  }

  /**
   * Whether the user is currently in any call.
   */
  get isInAnyCall(): boolean {
    return this.connected;
  }

  /**
   * Read the current audio level for a participant. Non-reactive — intended
   * to be called from a manual polling loop (setInterval), not from Svelte
   * templates or $derived expressions.
   */
  getAudioLevel(identity: string): AudioLevelInfo {
    return this.audioLevelCache.get(identity) ?? { isSpeaking: false, audioLevel: 0 };
  }

  isParticipantLocallyMuted(identity: string): boolean {
    return !!this.locallyMutedParticipantIds[identity];
  }

  toggleParticipantLocalMute(identity: string): void {
    if (!this.room || identity === this.room.localParticipant.identity) return;

    const muted = !this.isParticipantLocallyMuted(identity);
    this.locallyMutedParticipantIds = {
      ...this.locallyMutedParticipantIds,
      [identity]: muted
    };
    if (!muted) {
      const { [identity]: _removed, ...remaining } = this.locallyMutedParticipantIds;
      void _removed;
      this.locallyMutedParticipantIds = remaining;
    }
    this.applyParticipantAudioVolume(identity);
    this.updateParticipants();
  }

  /** Set microphone or incoming call audio on another device for this account. */
  async setSiblingAudioMuted(
    identity: string,
    target: SiblingAudioTarget,
    muted: boolean
  ): Promise<boolean> {
    const key = siblingAudioControlKey(identity, target);
    const existing = this.siblingAudioControlInFlight.get(key);
    if (existing) {
      await existing;
      const current = this.siblingAudioStates[identity];
      if (current && siblingAudioTargetValue(current, target) === muted) return true;
    }

    const room = this.room;
    const participant = room?.remoteParticipants.get(identity);
    if (!room || !participant || !this.isControllableSibling(participant)) return false;

    const operation = this.performSiblingAudioControl(room, participant, target, muted);
    this.siblingAudioControlInFlight.set(key, operation);
    this.setSiblingAudioControlPending(key, true);
    try {
      return await operation;
    } finally {
      if (this.siblingAudioControlInFlight.get(key) === operation) {
        this.siblingAudioControlInFlight.delete(key);
        this.setSiblingAudioControlPending(key, false);
      }
    }
  }

  private async performSiblingAudioControl(
    room: Room,
    participant: RemoteParticipant,
    target: SiblingAudioTarget,
    muted: boolean
  ): Promise<boolean> {
    try {
      const response = await room.localParticipant.performRpc({
        destinationIdentity: participant.identity,
        method: DEVICE_AUDIO_CONTROL_RPC_METHOD,
        payload: JSON.stringify({
          version: 1,
          action: 'set-state',
          target,
          muted
        } satisfies SiblingAudioControlRequest),
        responseTimeout: DEVICE_AUDIO_CONTROL_RPC_TIMEOUT_MS
      });
      if (this.room !== room) return false;

      const state = parseSiblingAudioState(response);
      if (!state) throw new Error('invalid sibling audio state response');
      this.applySiblingAudioState(participant.identity, state);
      return siblingAudioTargetValue(state, target) === muted;
    } catch {
      if (this.room === room) {
        toast.error(m['voice.device_audio_control_failed']());
      }
      return false;
    }
  }

  private setSiblingAudioControlPending(key: string, pending: boolean): void {
    if (pending) {
      this.siblingAudioControlPending = { ...this.siblingAudioControlPending, [key]: true };
    } else {
      const { [key]: _removed, ...remaining } = this.siblingAudioControlPending;
      void _removed;
      this.siblingAudioControlPending = remaining;
    }
    this.updateParticipants();
  }

  /**
   * Join a voice call in a room.
   */
  async join(
    livekitUrl: string,
    roomId: string,
    mode: VoiceCallJoinMode = 'ask',
    expectedCallId?: string
  ): Promise<VoiceCallJoinResult> {
    // Already in this call
    if (this.isInCall(roomId) && this.activeParticipantId && this.activeDeviceIndex) {
      return {
        status: 'joined',
        participantId: this.activeParticipantId,
        deviceIndex: this.activeDeviceIndex
      };
    }

    if (this.joinInFlight) {
      if (this.joinInFlightRoomId === roomId) {
        return this.joinInFlight;
      }
      await this.joinInFlight;
      if (this.isInCall(roomId) && this.activeParticipantId && this.activeDeviceIndex) {
        return {
          status: 'joined',
          participantId: this.activeParticipantId,
          deviceIndex: this.activeDeviceIndex
        };
      }
    }

    const joinPromise = this.performJoin(livekitUrl, roomId, mode, expectedCallId);
    this.joinInFlight = joinPromise;
    this.joinInFlightRoomId = roomId;
    try {
      return await joinPromise;
    } finally {
      if (this.joinInFlight === joinPromise) {
        this.joinInFlight = null;
        this.joinInFlightRoomId = null;
      }
    }
  }

  private async performJoin(
    livekitUrl: string,
    roomId: string,
    mode: VoiceCallJoinMode,
    expectedCallId?: string
  ): Promise<VoiceCallJoinResult> {
    assertLiveKitE2EESupported();
    this.connecting = true;
    let joinIntentRecorded = false;

    try {
      let joinResult: VoiceCallJoinResult;
      let tokenResponse: VoiceCallToken | null;

      if (expectedCallId) {
        // Validate and record the exact advertised call before leaving another
        // active call. A stale notification must never disconnect the user
        // from a healthy conversation.
        joinResult = await this.#api.joinCall(
          roomId,
          this.clientInstanceId,
          mode,
          expectedCallId
        );
        if (joinResult.status === 'selection-required') {
          return joinResult;
        }
        joinIntentRecorded = true;
        tokenResponse = await this.#api.getCallToken(
          roomId,
          this.clientInstanceId,
          expectedCallId
        );
        if (!tokenResponse || tokenResponse.callId !== expectedCallId) {
          throw new VoiceCallJoinError(
            'voice call changed while joining from a notification',
            m['voice.call_no_longer_active']()
          );
        }
        if (this.connected) {
          await this.leave();
          this.connecting = true;
        }
      } else {
        // A normal room action keeps the historical switch behavior.
        if (this.connected) {
          await this.leave();
          this.connecting = true;
        }
        this.roomId = roomId;
        joinResult = await this.#api.joinCall(roomId, this.clientInstanceId, mode);
        if (joinResult.status === 'selection-required') {
          this.roomId = null;
          return joinResult;
        }
        joinIntentRecorded = true;
        tokenResponse = await this.#api.getCallToken(roomId, this.clientInstanceId);
      }

      this.cancelRecovery();
      this.intentionalDisconnect = false;
      this.connecting = true;
      this.roomId = roomId;

      this.activeParticipantId = joinResult.participantId;
      this.activeDeviceIndex = joinResult.deviceIndex;

      if (!tokenResponse) {
        throw new Error(m['voice.token_failed']());
      }
      const { token, e2eeKey, callId, participantId, deviceIndex } = tokenResponse;
      if (participantId !== joinResult.participantId || deviceIndex !== joinResult.deviceIndex) {
        throw new Error('call token connection identity does not match admitted participant');
      }
      this.activeCallId = callId;

      // Companion playback must be muted before LiveKit can subscribe and
      // attach remote audio tracks during connect. Setting this afterwards can
      // leak the first audio frames on fast connections.
      if (mode === 'companion') {
        this.isMuted = true;
        this.isOutputMuted = true;
      } else {
        this.isOutputMuted = false;
      }

      const { room } = await this.connectEncryptedRoom(livekitUrl, token, e2eeKey);

      if (mode === 'companion') {
        this.applyAllParticipantAudioVolumes();
      } else {
        // Try to enable microphone, but join muted if no device is available
        try {
          await this.runExplicitMediaDeviceOperation(() => this.enableMicrophone(room));
          this.isMuted = false;
          this.setupLocalAudioAnalyser();
        } catch (err) {
          this.isMuted = true;
          this.notifyMediaDeviceError(
            getVoiceCallMediaDeviceErrorMessage('microphone', err, 'join')
          );
        }
      }

      this.connected = true;
      this.reconnecting = false;
      this.recoveryTarget = { livekitUrl, roomId };
      this.recoveryGeneration += 1;
      this.attachBrowserNetworkListeners();
      this.updateParticipants();
      void this.refreshSiblingAudioStates();
      await this.refreshDevices();
      if (this.consumePendingOwnJoinSound()) {
        void playCallSound('join');
      }
      return joinResult;
    } catch (err) {
      console.error('Failed to join voice call:', summarizeJoinError(err));
      if (joinIntentRecorded) {
        await this.recordLeaveIntent(roomId);
      }
      // Until the targeted call has been fully validated, a connected room is
      // the user's previous call and must remain intact.
      if (!expectedCallId || !this.connected) {
        this.cleanup();
      }
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Leave the current voice call.
   */
  async leave(): Promise<void> {
    if (this.leaveInFlight) return this.leaveInFlight;
    if (!this.room && !this.roomId && !this.recoveryTarget) return;

    const leavePromise = this.performLeave();
    this.leaveInFlight = leavePromise;
    try {
      await leavePromise;
    } finally {
      if (this.leaveInFlight === leavePromise) {
        this.leaveInFlight = null;
      }
    }
  }

  private async performLeave(): Promise<void> {
    const roomId = this.roomId;
    this.intentionalDisconnect = true;
    this.cancelRecovery();
    const leaveIntent = roomId ? this.recordLeaveIntent(roomId) : Promise.resolve();
    void this.room?.disconnect();
    this.cleanup();
    await leaveIntent;
  }

  /**
   * Apply a backend-authored participant leave. Used for reconciliation and
   * moderation paths where the server has already committed the leave fact.
   */
  handleParticipantLeftEvent(
    roomId: string,
    callId: string | null,
    participantId: string | null,
    actorId: string | null,
    currentUserId: string | null
  ): void {
    if (!actorId || !currentUserId || actorId !== currentUserId) return;
    if (participantId && participantId !== this.activeParticipantId) return;
    if (this.reconnecting && this.roomId === roomId && this.activeCallId === callId) return;
    this.disconnectFromServerEvent(roomId, callId);
  }

  /**
   * Apply a backend-authored call end. Does not record another leave intent.
   */
  handleCallEndedEvent(roomId: string, callId: string | null): void {
    if (this.reconnecting && this.roomId === roomId && this.activeCallId === callId) return;
    this.disconnectFromServerEvent(roomId, callId);
  }

  private disconnectFromServerEvent(roomId: string, callId: string | null): void {
    if (this.roomId !== roomId) return;
    if (!callId || this.activeCallId !== callId) return;

    const room = this.room;
    if (room) {
      this.suppressDisconnectToast = true;
      this.intentionalDisconnect = true;
      void room.disconnect();
    }
    this.cleanup();
    this.suppressDisconnectToast = false;
  }

  private async recordLeaveIntent(roomId: string): Promise<void> {
    try {
      await this.#api.leaveCall(roomId, this.clientInstanceId);
    } catch {
      // LiveKit disconnect/cleanup should still proceed if the intent write fails.
    }
  }

  private async handleSiblingAudioControl(data: RpcInvocationData): Promise<string> {
    const caller = this.room?.remoteParticipants.get(data.callerIdentity);
    if (!caller || !this.isControllableSibling(caller)) {
      throw new RpcError(
        DEVICE_AUDIO_CONTROL_RPC_UNAUTHORIZED,
        'Not authorized to control this device'
      );
    }

    const request = parseSiblingAudioControlRequest(data.payload);
    if (!request) {
      throw new RpcError(DEVICE_AUDIO_CONTROL_RPC_INVALID_REQUEST, 'Invalid audio control request');
    }

    if (request.action === 'get-state') {
      return JSON.stringify(this.currentLocalAudioState());
    }

    if (request.action === 'state-changed') {
      this.applySiblingAudioState(caller.identity, request.state);
      return JSON.stringify(this.currentLocalAudioState());
    }

    const succeeded =
      request.target === 'microphone'
        ? await this.setMicrophoneMuted(request.muted, false)
        : await this.setOutputMuted(request.muted, false);
    if (!succeeded) {
      throw new RpcError(
        DEVICE_AUDIO_CONTROL_RPC_OPERATION_FAILED,
        'Could not update device audio'
      );
    }

    return JSON.stringify(this.currentLocalAudioState());
  }

  private currentLocalAudioState(): SiblingAudioState {
    return {
      version: 1,
      microphoneMuted: this.isMuted,
      outputMuted: this.isOutputMuted,
      revision: this.localAudioStateRevision
    };
  }

  private async refreshSiblingAudioStates(): Promise<void> {
    const room = this.room;
    if (!room) return;
    await Promise.allSettled(
      Array.from(room.remoteParticipants.values())
        .filter((participant) => this.isControllableSibling(participant))
        .map((participant) => this.refreshSiblingAudioState(room, participant))
    );
  }

  private refreshSiblingAudioState(room: Room, participant: RemoteParticipant): Promise<void> {
    const identity = participant.identity;
    const existing = this.siblingAudioStateRefreshInFlight.get(identity);
    if (existing) return existing;

    const operation = this.performSiblingAudioStateRefresh(room, participant);
    this.siblingAudioStateRefreshInFlight.set(identity, operation);
    void operation.finally(() => {
      if (this.siblingAudioStateRefreshInFlight.get(identity) === operation) {
        this.siblingAudioStateRefreshInFlight.delete(identity);
      }
    });
    return operation;
  }

  private async performSiblingAudioStateRefresh(
    room: Room,
    participant: RemoteParticipant
  ): Promise<void> {
    for (const delayMs of DEVICE_AUDIO_STATE_SYNC_RETRY_DELAYS_MS) {
      if (delayMs > 0) await delay(delayMs);
      if (
        this.room !== room ||
        room.remoteParticipants.get(participant.identity) !== participant ||
        !this.isControllableSibling(participant)
      ) {
        return;
      }

      try {
        const response = await room.localParticipant.performRpc({
          destinationIdentity: participant.identity,
          method: DEVICE_AUDIO_CONTROL_RPC_METHOD,
          payload: JSON.stringify({
            version: 1,
            action: 'get-state'
          } satisfies SiblingAudioControlRequest),
          responseTimeout: DEVICE_AUDIO_STATE_SYNC_RPC_TIMEOUT_MS
        });
        if (this.room !== room) return;
        const state = parseSiblingAudioState(response);
        if (state) {
          this.applySiblingAudioState(participant.identity, state);
          return;
        }
      } catch {
        // A newly connected peer can receive this request before it has observed
        // the caller in its own room. Retry briefly; older clients remain usable
        // with only the cross-device controls unavailable.
      }
    }
  }

  private applySiblingAudioState(identity: string, state: SiblingAudioState): void {
    const current = this.siblingAudioStates[identity];
    if (current && state.revision < current.revision) return;
    this.siblingAudioStates = { ...this.siblingAudioStates, [identity]: state };
    this.updateParticipants();
  }

  private isControllableSibling(participant: Participant): participant is RemoteParticipant {
    if (!this.room || participant === this.room.localParticipant) return false;
    const localAccountId = participantAccountId(this.room.localParticipant);
    return localAccountId !== null && participantAccountId(participant) === localAccountId;
  }

  private broadcastLocalAudioState(): void {
    const room = this.room;
    if (!room) return;
    const payload = JSON.stringify({
      version: 1,
      action: 'state-changed',
      state: this.currentLocalAudioState()
    } satisfies SiblingAudioControlRequest);

    for (const participant of room.remoteParticipants.values()) {
      if (!this.isControllableSibling(participant)) continue;
      void room.localParticipant
        .performRpc({
          destinationIdentity: participant.identity,
          method: DEVICE_AUDIO_CONTROL_RPC_METHOD,
          payload,
          responseTimeout: DEVICE_AUDIO_CONTROL_RPC_TIMEOUT_MS
        })
        .catch(() => undefined);
    }
  }

  /**
   * Toggle microphone mute.
   */
  async toggleMute(): Promise<void> {
    await this.setMicrophoneMuted(!this.isMuted);
  }

  private async setMicrophoneMuted(muted: boolean, broadcast = true): Promise<boolean> {
    if (this.microphoneToggleInFlight) {
      await this.microphoneToggleInFlight;
      if (this.isMuted === muted) return true;
    }

    const room = this.room;
    if (!room) return false;

    const togglePromise = this.performSetMicrophoneMuted(room, muted);
    this.microphoneToggleInFlight = togglePromise;
    this.isMicrophonePending = true;
    try {
      const succeeded = await togglePromise;
      if (succeeded && broadcast) this.broadcastLocalAudioState();
      return succeeded;
    } finally {
      if (this.microphoneToggleInFlight === togglePromise) {
        this.microphoneToggleInFlight = null;
        this.isMicrophonePending = false;
      }
    }
  }

  private async performSetMicrophoneMuted(room: Room, newMuted: boolean): Promise<boolean> {
    if (this.isMuted === newMuted) return true;
    try {
      await this.runExplicitMediaDeviceOperation(async () => {
        if (newMuted) {
          await room.localParticipant.setMicrophoneEnabled(false);
          return;
        }
        await this.enableMicrophone(room);
      });
      if (this.room !== room) return false;
    } catch (err) {
      if (this.room === room && !newMuted) {
        this.notifyMediaDeviceError(
          getVoiceCallMediaDeviceErrorMessage('microphone', err, 'enable')
        );
      }
      return false;
    }

    this.isMuted = newMuted;

    if (!newMuted) {
      this.setupLocalAudioAnalyser();
    } else {
      this.teardownLocalAudioAnalyser();
    }

    this.updateParticipants();
    this.localAudioStateRevision += 1;
    return true;
  }

  /** Toggle all incoming microphone and screen-share audio for this client. */
  async toggleOutputMute(): Promise<void> {
    await this.setOutputMuted(!this.isOutputMuted);
  }

  private async setOutputMuted(muted: boolean, broadcast = true): Promise<boolean> {
    if (this.outputToggleInFlight) {
      await this.outputToggleInFlight;
      if (this.isOutputMuted === muted) return true;
    }

    const room = this.room;
    if (!room) return false;
    const operation = this.performSetOutputMuted(room, muted);
    this.outputToggleInFlight = operation;
    try {
      const succeeded = await operation;
      if (succeeded && broadcast) this.broadcastLocalAudioState();
      return succeeded;
    } finally {
      if (this.outputToggleInFlight === operation) this.outputToggleInFlight = null;
    }
  }

  private async performSetOutputMuted(room: Room, newMuted: boolean): Promise<boolean> {
    if (this.isOutputMuted === newMuted) return true;
    if (!newMuted) {
      try {
        await room.startAudio();
      } catch {
        this.notifyMediaDeviceError(m['voice.audio_playback_failed']());
        return false;
      }
      if (this.room !== room) return false;
    }

    this.isOutputMuted = newMuted;
    this.applyAllParticipantAudioVolumes();
    this.updateParticipants();
    this.localAudioStateRevision += 1;
    return true;
  }

  private async enableMicrophone(room: Room): Promise<void> {
    const publication = await room.localParticipant.setMicrophoneEnabled(true);
    const track = publication?.track as LocalAudioTrack | undefined;
    if (!track) return;

    try {
      await ensureBackgroundNoiseSuppression(track);
    } catch (error) {
      // Never leave an unprocessed microphone live when enhanced suppression
      // was expected but could not be attached.
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Toggle camera on/off. Camera is always off by default.
   */
  async toggleCamera(): Promise<void> {
    if (this.cameraToggleInFlight) return this.cameraToggleInFlight;

    const room = this.room;
    if (!room) return;

    const togglePromise = this.performToggleCamera(room);
    this.cameraToggleInFlight = togglePromise;
    this.isCameraPending = true;
    try {
      await togglePromise;
    } finally {
      if (this.cameraToggleInFlight === togglePromise) {
        this.cameraToggleInFlight = null;
        this.isCameraPending = false;
      }
    }
  }

  private async performToggleCamera(room: Room): Promise<void> {
    const newEnabled = !this.isCameraEnabled;
    try {
      await this.runExplicitMediaDeviceOperation(() =>
        room.localParticipant.setCameraEnabled(newEnabled)
      );
      if (this.room !== room) return;

      this.isCameraEnabled = newEnabled;
      if (newEnabled) {
        await this.refreshDevices({ requestVideoPermissions: true });
      }
    } catch (err) {
      // Permission denied or no camera available — keep current state
      if (this.room !== room) return;
      if (newEnabled) {
        this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('camera', err, 'enable'));
      }
      this.isCameraEnabled = false;
    }
    this.updateParticipants();
  }

  /** Toggle screen/window/tab video and browser-tab audio when available. */
  async toggleScreenShare(): Promise<void> {
    if (this.screenShareToggleInFlight) return this.screenShareToggleInFlight;

    const room = this.room;
    if (!room) return;

    if (!this.isScreenShareEnabled && !this.canShareScreen) {
      toast.warning(m['voice.screen_share_unsupported']());
      return;
    }

    const togglePromise = this.performToggleScreenShare(room);
    this.screenShareToggleInFlight = togglePromise;
    this.isScreenSharePending = true;
    try {
      await togglePromise;
    } finally {
      if (this.screenShareToggleInFlight === togglePromise) {
        this.screenShareToggleInFlight = null;
        this.isScreenSharePending = false;
      }
    }
  }

  private async performToggleScreenShare(room: Room): Promise<void> {
    const newEnabled = !this.isScreenShareEnabled;
    try {
      await this.runExplicitMediaDeviceOperation(() => {
        if (!newEnabled) return room.localParticipant.setScreenShareEnabled(false);
        return room.localParticipant.setScreenShareEnabled(
          true,
          createScreenShareCaptureOptions(),
          createScreenSharePublishOptions()
        );
      });
      if (this.room !== room) return;

      this.isScreenShareEnabled = newEnabled;
    } catch (err) {
      if (this.room !== room) return;
      if (newEnabled) {
        this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('screen', err, 'enable'));
      }
      this.isScreenShareEnabled = newEnabled ? false : this.isScreenShareEnabled;
    }
    this.updateParticipants();
    if (newEnabled && this.isScreenShareEnabled) {
      if (isParticipantScreenShareAudioEnabled(room.localParticipant)) {
        toast.success(m['voice.screen_share_audio_active']());
      } else {
        toast.info(m['voice.screen_share_no_audio']());
      }
    }
  }

  /**
   * Refresh available audio and video devices.
   */
  async refreshDevices(options: { requestVideoPermissions?: boolean } = {}): Promise<void> {
    try {
      const requestVideoPermissions = options.requestVideoPermissions ?? this.isCameraEnabled;
      const [inputDevices, outputDevices, videoInputDevices] = await Promise.all([
        Room.getLocalDevices('audioinput'),
        Room.getLocalDevices('audiooutput'),
        Room.getLocalDevices('videoinput', requestVideoPermissions)
      ]);

      this.audioDevices = inputDevices;
      this.audioOutputDevices = outputDevices;
      this.videoDevices = videoInputDevices;

      // Set default selections if not already set
      if (!this.selectedDeviceId && inputDevices.length > 0) {
        this.selectedDeviceId = inputDevices[0].deviceId;
      }
      if (!this.selectedOutputDeviceId && outputDevices.length > 0) {
        this.selectedOutputDeviceId = outputDevices[0].deviceId;
      }
      if (!this.selectedVideoDeviceId && videoInputDevices.length > 0) {
        this.selectedVideoDeviceId = videoInputDevices[0].deviceId;
      }
    } catch {
      this.audioDevices = [];
      this.audioOutputDevices = [];
      this.videoDevices = [];
    }
  }

  /** @deprecated Use refreshDevices() instead */
  async refreshAudioDevices(): Promise<void> {
    return this.refreshDevices();
  }

  /**
   * Switch to a different audio input device.
   */
  async setAudioDevice(deviceId: string): Promise<void> {
    if (!this.room) return;

    try {
      await this.runExplicitMediaDeviceOperation(() =>
        this.room!.switchActiveDevice('audioinput', deviceId)
      );
      this.selectedDeviceId = deviceId;
    } catch (err) {
      this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('microphone', err, 'switch'));
      return;
    }

    // Reconnect analyser to the new mic track
    if (!this.isMuted) {
      this.setupLocalAudioAnalyser();
    }
  }

  /**
   * Switch to a different audio output device.
   */
  async setAudioOutputDevice(deviceId: string): Promise<void> {
    if (!this.room) return;

    try {
      await this.runExplicitMediaDeviceOperation(() =>
        this.room!.switchActiveDevice('audiooutput', deviceId)
      );
      this.selectedOutputDeviceId = deviceId;
    } catch (err) {
      this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('speaker', err, 'switch'));
    }
  }

  /**
   * Switch to a different video input device.
   */
  async setVideoDevice(deviceId: string): Promise<void> {
    if (!this.room) return;

    try {
      await this.runExplicitMediaDeviceOperation(() =>
        this.room!.switchActiveDevice('videoinput', deviceId)
      );
      this.selectedVideoDeviceId = deviceId;
    } catch (err) {
      this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('camera', err, 'switch'));
    }
  }

  private async connectEncryptedRoom(
    livekitUrl: string,
    token: string,
    e2eeKey: string,
    shouldContinue: () => boolean = () => true
  ): Promise<{ room: Room; worker: Worker }> {
    const keyProvider = new ExternalE2EEKeyProvider();
    const { default: E2EEWorker } = await import('livekit-client/e2ee-worker?worker');
    const worker = new E2EEWorker();
    if (!shouldContinue()) {
      worker.terminate();
      throw new Error('Voice call connection was cancelled');
    }
    const room = new Room({
      encryption: {
        keyProvider,
        worker
      },
      audioCaptureDefaults: createVoiceAudioCaptureOptions(),
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution
      },
      publishDefaults: {
        audioPreset: AudioPresets.speech,
        dtx: true,
        red: true,
        simulcast: true
      },
      adaptiveStream: true,
      dynacast: true,
      disconnectOnPageLeave: true,
      reconnectPolicy: new PersistentReconnectPolicy()
    });

    this.room = room;
    this.e2eeWorker = worker;
    room.registerRpcMethod(DEVICE_AUDIO_CONTROL_RPC_METHOD, (data) =>
      this.handleSiblingAudioControl(data)
    );
    this.setupRoomEventListeners(room);

    try {
      await keyProvider.setKey(e2eeKey);
      if (!shouldContinue()) {
        throw new Error('Voice call connection was cancelled');
      }
      await room.setE2EEEnabled(true);
      await room.connect(livekitUrl, token);
      if (!shouldContinue()) {
        throw new Error('Voice call connection was cancelled');
      }
      return { room, worker };
    } catch (error) {
      this.disposeRoomConnection(room, worker);
      throw error;
    }
  }

  private setupRoomEventListeners(room: Room): void {
    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      if (this.room !== room) return;
      this.updateParticipants();
      if (this.isControllableSibling(participant)) {
        void this.refreshSiblingAudioState(room, participant);
      }
    });

    room.on(
      RoomEvent.ParticipantMetadataChanged,
      (_metadata: string | undefined, participant: Participant) => {
        if (this.room !== room) return;
        this.updateParticipants();
        if (this.isControllableSibling(participant)) {
          void this.refreshSiblingAudioState(room, participant);
        }
      }
    );

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      if (this.room !== room) return;
      this.removeSiblingAudioState(participant.identity);
      this.updateParticipants();
    });

    room.on(RoomEvent.TrackMuted, () => {
      this.updateParticipants();
    });

    room.on(RoomEvent.TrackUnmuted, () => {
      this.updateParticipants();
    });

    room.on(RoomEvent.Reconnecting, () => {
      if (this.room !== room || !this.connected || this.intentionalDisconnect) return;
      this.startRecoveryState();
    });

    room.on(RoomEvent.Reconnected, () => {
      if (this.room !== room || this.intentionalDisconnect) return;
      this.reconnecting = false;
      this.recoveryMediaState = null;
      this.updateParticipants();
      void this.refreshSiblingAudioStates();
      if (!this.isMuted) this.setupLocalAudioAnalyser();
    });

    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (this.room !== room) return;
      if (
        this.connected &&
        !this.intentionalDisconnect &&
        this.recoveryTarget &&
        isRecoverableDisconnectReason(reason)
      ) {
        this.startRecoveryState();
        this.releaseCurrentRoom();
        this.scheduleRecovery();
        return;
      }

      // Only show toast if we were in an active call (not a failed join attempt)
      if (this.connected && !this.suppressDisconnectToast) {
        toast.error(m['voice.disconnected']());
      }
      this.cleanup();
    });

    room.on(RoomEvent.MediaDevicesChanged, () => {
      this.refreshDevices();
    });

    room.on(RoomEvent.MediaDevicesError, (err: Error) => {
      if (this.explicitMediaDeviceOperationDepth > 0) return;
      this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('device', err, 'event'));
    });

    room.on(RoomEvent.ConnectionQualityChanged, () => {
      this.updateParticipants();
    });

    // Attach remote audio tracks so we actually hear other participants.
    // LiveKit delivers audio data over WebRTC, but the browser won't play it
    // until the track is attached to an <audio> element.
    // Video tracks are NOT attached here — VideoThumbnail manages its own lifecycle.
    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          track.attach();
          this.applyAllParticipantAudioVolumes();
        }
        this.updateParticipants();
      }
    );

    room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication) => {
        track.detach();
        this.updateParticipants();
      }
    );

    // Track published/unpublished — catches camera enable/disable by remote participants
    room.on(RoomEvent.TrackPublished, () => {
      this.updateParticipants();
    });

    room.on(RoomEvent.TrackUnpublished, () => {
      this.updateParticipants();
    });

    room.on(RoomEvent.LocalTrackPublished, () => {
      this.updateParticipants();
    });

    room.on(RoomEvent.LocalTrackUnpublished, () => {
      this.updateParticipants();
    });

    // Keep audio level snapshots fresh for call UI consumers without pushing
    // 60Hz updates through Svelte's reactive graph.
    this.audioLevelInterval = setInterval(() => {
      this.updateAudioLevels();
    }, 60);
  }

  private updateParticipants(): void {
    if (!this.room) {
      this.participants = [];
      return;
    }

    const allParticipants: Participant[] = [
      this.room.localParticipant,
      ...Array.from(this.room.remoteParticipants.values())
    ];
    this.isCameraEnabled = isParticipantCameraEnabled(this.room.localParticipant);
    this.isScreenShareEnabled = isParticipantScreenShareEnabled(this.room.localParticipant);
    this.applyAllParticipantAudioVolumes();

    this.participants = allParticipants.map((p) => {
      const md = parseParticipantMetadata(p.metadata);
      const isLocal = p === this.room!.localParticipant;
      const participantId = md.participantId ?? p.identity;
      const userId = md.userId ?? p.identity;
      const canControlAudio = this.isControllableSibling(p);
      const siblingAudioState = canControlAudio ? this.siblingAudioStates[p.identity] : undefined;
      return {
        identity: p.identity,
        participantId,
        userId,
        deviceIndex: md.deviceIndex && md.deviceIndex > 0 ? md.deviceIndex : 1,
        name: p.name ?? p.identity,
        login: md.login ?? userId,
        avatarUrl: md.avatarUrl ?? null,
        isMuted: isParticipantMuted(p),
        isLocal,
        connectionQuality: p.connectionQuality as CallParticipantInfo['connectionQuality'],
        isCameraEnabled: isParticipantCameraEnabled(p),
        videoTrack: getParticipantCameraTrack(p),
        isScreenShareEnabled: isParticipantScreenShareEnabled(p),
        isScreenShareAudioEnabled: isParticipantScreenShareAudioEnabled(p),
        screenShareTrack: getParticipantScreenShareTrack(p),
        isLocallyMuted: !isLocal && this.isParticipantLocallyMuted(p.identity),
        canControlAudio,
        siblingMicrophoneMuted: siblingAudioState?.microphoneMuted ?? null,
        siblingOutputMuted: siblingAudioState?.outputMuted ?? null,
        isSiblingMicrophoneControlPending:
          canControlAudio &&
          Boolean(
            this.siblingAudioControlPending[siblingAudioControlKey(p.identity, 'microphone')]
          ),
        isSiblingOutputControlPending:
          canControlAudio &&
          Boolean(this.siblingAudioControlPending[siblingAudioControlKey(p.identity, 'output')])
      };
    });
  }

  private removeSiblingAudioState(identity: string): void {
    const { [identity]: _removedState, ...remainingStates } = this.siblingAudioStates;
    void _removedState;
    this.siblingAudioStates = remainingStates;

    for (const target of ['microphone', 'output'] as const) {
      const key = siblingAudioControlKey(identity, target);
      this.siblingAudioControlInFlight.delete(key);
      const { [key]: _removedPending, ...remainingPending } = this.siblingAudioControlPending;
      void _removedPending;
      this.siblingAudioControlPending = remainingPending;
    }
  }

  private applyAllParticipantAudioVolumes(): void {
    if (!this.room) return;
    for (const participant of this.room.remoteParticipants.values()) {
      this.applyRemoteParticipantAudioVolume(participant);
    }
  }

  private applyParticipantAudioVolume(identity: string): void {
    const participant = this.room?.remoteParticipants.get(identity);
    if (participant) this.applyRemoteParticipantAudioVolume(participant);
  }

  private applyRemoteParticipantAudioVolume(participant: RemoteParticipant): void {
    const volume =
      this.isOutputMuted || this.isParticipantLocallyMuted(participant.identity) ? 0 : 1;
    participant.setVolume(volume, Track.Source.Microphone);
    participant.setVolume(volume, Track.Source.ScreenShareAudio);
  }

  /**
   * Update the non-reactive audio level cache. Called at ~60ms.
   * Writes to a plain Map (not $state) so Svelte's reactive graph is
   * completely untouched.
   */
  private updateAudioLevels(): void {
    if (!this.room) return;

    const localAudioLevel = this.getLocalAudioLevel();

    const allParticipants: Participant[] = [
      this.room.localParticipant,
      ...Array.from(this.room.remoteParticipants.values())
    ];

    for (const p of allParticipants) {
      const isLocal = p === this.room!.localParticipant;
      this.audioLevelCache.set(p.identity, {
        isSpeaking: p.isSpeaking,
        audioLevel: isLocal ? localAudioLevel : p.audioLevel
      });
    }
  }

  /**
   * Set up a Web Audio API analyser connected to the local microphone track.
   * This gives us instant audio level readings without server round-trip.
   */
  private setupLocalAudioAnalyser(): void {
    this.teardownLocalAudioAnalyser();
    if (!this.room) return;

    const micPub = this.room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const mediaStreamTrack = micPub?.track?.mediaStreamTrack;
    if (!mediaStreamTrack) return;

    try {
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyserData = new Float32Array(this.analyser.fftSize) as Float32Array<ArrayBuffer>;

      const stream = new MediaStream([mediaStreamTrack]);
      this.analyserSource = this.audioContext.createMediaStreamSource(stream);
      this.analyserSource.connect(this.analyser);
      // Don't connect analyser to destination — we don't want to hear ourselves
    } catch {
      this.teardownLocalAudioAnalyser();
    }
  }

  private teardownLocalAudioAnalyser(): void {
    this.analyserSource?.disconnect();
    this.analyserSource = null;
    this.analyser?.disconnect();
    this.analyser = null;
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    this.analyserData = null;
  }

  /**
   * Read the current local microphone audio level (0–1) from the Web Audio
   * API analyser. Returns 0 if the analyser is not set up.
   */
  private getLocalAudioLevel(): number {
    if (!this.analyser || !this.analyserData) return 0;

    this.analyser.getFloatTimeDomainData(this.analyserData);

    // Compute RMS of the waveform samples
    let sumSq = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      sumSq += this.analyserData[i] * this.analyserData[i];
    }
    const rms = Math.sqrt(sumSq / this.analyserData.length);

    // Normalize: RMS of ~0.5 is very loud speech, scale so it maps to ~1.0
    return Math.min(rms * 2, 1);
  }

  private cleanup(): void {
    const disconnectedRoomId = this.roomId;
    const disconnectedCallId = this.activeCallId;
    const wasConnected = this.connected;

    this.cancelRecovery();
    this.detachBrowserNetworkListeners();
    this.releaseCurrentRoom();
    if (wasConnected && disconnectedRoomId && disconnectedCallId) {
      this.recentlyDisconnectedCall = {
        roomId: disconnectedRoomId,
        callId: disconnectedCallId,
        disconnectedAt: Date.now()
      };
    }
    this.activeCallId = null;
    this.activeParticipantId = null;
    this.activeDeviceIndex = null;
    this.pendingOwnJoinSound = null;
    this.joinInFlight = null;
    this.joinInFlightRoomId = null;
    this.microphoneToggleInFlight = null;
    this.outputToggleInFlight = null;
    this.cameraToggleInFlight = null;
    this.screenShareToggleInFlight = null;
    this.suppressDisconnectToast = false;
    this.intentionalDisconnect = false;
    this.connected = false;
    this.connecting = false;
    this.reconnecting = false;
    this.roomId = null;
    this.isMuted = false;
    this.isOutputMuted = false;
    this.isMicrophonePending = false;
    this.isCameraEnabled = false;
    this.isCameraPending = false;
    this.isScreenShareEnabled = false;
    this.isScreenSharePending = false;
    this.participants = [];
    this.locallyMutedParticipantIds = {};
    this.localAudioStateRevision = 0;
    this.siblingAudioStates = {};
    this.siblingAudioControlPending = {};
    this.siblingAudioControlInFlight.clear();
    this.siblingAudioStateRefreshInFlight.clear();
    this.audioDevices = [];
    this.selectedDeviceId = null;
    this.audioOutputDevices = [];
    this.selectedOutputDeviceId = null;
    this.videoDevices = [];
    this.selectedVideoDeviceId = null;
    this.audioLevelCache.clear();
    this.explicitMediaDeviceOperationDepth = 0;
    this.lastMediaDeviceToast = null;
  }

  private startRecoveryState(): void {
    if (!this.recoveryMediaState) {
      this.recoveryMediaState = {
        isMuted: this.isMuted,
        isOutputMuted: this.isOutputMuted,
        isCameraEnabled: this.isCameraEnabled,
        isScreenShareEnabled: this.isScreenShareEnabled,
        selectedDeviceId: this.selectedDeviceId,
        selectedOutputDeviceId: this.selectedOutputDeviceId,
        selectedVideoDeviceId: this.selectedVideoDeviceId
      };
    }
    this.reconnecting = true;
    this.connecting = false;
    this.isMicrophonePending = false;
    this.isCameraPending = false;
    this.isScreenSharePending = false;
  }

  private attachBrowserNetworkListeners(): void {
    if (this.browserNetworkListenersAttached || typeof window === 'undefined') return;
    window.addEventListener('offline', this.handleBrowserOffline);
    window.addEventListener('online', this.handleBrowserOnline);
    this.browserNetworkListenersAttached = true;
  }

  private detachBrowserNetworkListeners(): void {
    if (!this.browserNetworkListenersAttached || typeof window === 'undefined') return;
    window.removeEventListener('offline', this.handleBrowserOffline);
    window.removeEventListener('online', this.handleBrowserOnline);
    this.browserNetworkListenersAttached = false;
  }

  private releaseCurrentRoom(): void {
    if (this.audioLevelInterval) {
      clearInterval(this.audioLevelInterval);
      this.audioLevelInterval = null;
    }
    this.teardownLocalAudioAnalyser();
    if (this.room) {
      for (const p of this.room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          pub.track?.detach();
        }
      }
      this.room.unregisterRpcMethod(DEVICE_AUDIO_CONTROL_RPC_METHOD);
      this.room.removeAllListeners();
      this.room = null;
    }
    this.e2eeWorker?.terminate();
    this.e2eeWorker = null;
    this.participants = [];
    this.audioLevelCache.clear();
  }

  private scheduleRecovery(): void {
    if (
      this.recoveryTimer ||
      this.recoveryAttemptGeneration !== null ||
      !this.reconnecting ||
      !this.recoveryTarget
    ) {
      return;
    }

    const generation = this.recoveryGeneration;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.attemptRecovery(generation);
    }, CALL_RECOVERY_RETRY_INTERVAL_MS);
  }

  private async attemptRecovery(generation: number): Promise<void> {
    const target = this.recoveryTarget;
    if (
      !target ||
      generation !== this.recoveryGeneration ||
      !this.reconnecting ||
      this.recoveryAttemptGeneration !== null
    ) {
      return;
    }

    this.recoveryAttemptGeneration = generation;
    let retry = false;
    try {
      const joinResult = await this.#api.joinCall(
        target.roomId,
        this.clientInstanceId,
        'companion'
      );
      if (!this.isCurrentRecovery(generation)) return;
      if (joinResult.status !== 'joined') {
        throw new Error('call recovery was not admitted');
      }
      this.activeParticipantId = joinResult.participantId;
      this.activeDeviceIndex = joinResult.deviceIndex;

      const tokenResponse = await this.#api.getCallToken(target.roomId, this.clientInstanceId);
      if (!tokenResponse) throw new Error(m['voice.token_failed']());
      if (!this.isCurrentRecovery(generation)) return;
      if (
        tokenResponse.participantId !== joinResult.participantId ||
        tokenResponse.deviceIndex !== joinResult.deviceIndex
      ) {
        throw new Error('call recovery token identity does not match admitted participant');
      }

      this.activeCallId = tokenResponse.callId;
      const { room, worker } = await this.connectEncryptedRoom(
        target.livekitUrl,
        tokenResponse.token,
        tokenResponse.e2eeKey,
        () => this.isCurrentRecovery(generation)
      );
      if (!this.isCurrentRecovery(generation)) {
        this.disposeRoomConnection(room, worker);
        return;
      }

      await this.restoreMediaAfterRecovery(room, () => {
        return this.isCurrentRecovery(generation) && this.room === room;
      });
      if (!this.isCurrentRecovery(generation)) return;

      this.connected = true;
      this.reconnecting = false;
      this.recoveryMediaState = null;
      this.updateParticipants();
      void this.refreshSiblingAudioStates();
      await this.refreshDevices();
    } catch (error) {
      if (!this.isCurrentRecovery(generation)) return;
      console.warn('Voice call recovery attempt failed:', summarizeJoinError(error));
      this.releaseCurrentRoom();
      if (isTerminalRecoveryError(error)) {
        toast.error(m['voice.disconnected']());
        this.cleanup();
      } else {
        retry = true;
      }
    } finally {
      if (this.recoveryAttemptGeneration === generation) {
        this.recoveryAttemptGeneration = null;
        if (retry && this.isCurrentRecovery(generation)) this.scheduleRecovery();
      }
    }
  }

  private async restoreMediaAfterRecovery(
    room: Room,
    shouldContinue: () => boolean
  ): Promise<void> {
    const media = this.recoveryMediaState;
    if (!media || !shouldContinue()) return;

    this.isMuted = media.isMuted;
    this.isOutputMuted = media.isOutputMuted;
    this.isCameraEnabled = false;
    this.isScreenShareEnabled = false;

    if (!media.isMuted) {
      try {
        await this.runExplicitMediaDeviceOperation(() => this.enableMicrophone(room));
        if (!shouldContinue()) return;
        this.isMuted = false;
        this.setupLocalAudioAnalyser();
      } catch (error) {
        if (!shouldContinue()) return;
        this.isMuted = true;
        this.notifyMediaDeviceError(
          getVoiceCallMediaDeviceErrorMessage('microphone', error, 'enable')
        );
      }
    }

    if (media.isCameraEnabled) {
      try {
        await this.runExplicitMediaDeviceOperation(() =>
          room.localParticipant.setCameraEnabled(true)
        );
        if (!shouldContinue()) return;
        this.isCameraEnabled = true;
      } catch (error) {
        if (!shouldContinue()) return;
        this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('camera', error, 'enable'));
      }
    }

    if (media.isScreenShareEnabled && this.canShareScreen) {
      try {
        await this.runExplicitMediaDeviceOperation(() =>
          room.localParticipant.setScreenShareEnabled(
            true,
            createScreenShareCaptureOptions(),
            createScreenSharePublishOptions()
          )
        );
        if (!shouldContinue()) return;
        this.isScreenShareEnabled = true;
      } catch (error) {
        if (!shouldContinue()) return;
        this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('screen', error, 'enable'));
      }
    }

    await Promise.all([
      media.selectedDeviceId
        ? room.switchActiveDevice('audioinput', media.selectedDeviceId).catch(() => undefined)
        : undefined,
      media.selectedOutputDeviceId
        ? room
            .switchActiveDevice('audiooutput', media.selectedOutputDeviceId)
            .catch(() => undefined)
        : undefined,
      media.selectedVideoDeviceId && media.isCameraEnabled
        ? room.switchActiveDevice('videoinput', media.selectedVideoDeviceId).catch(() => undefined)
        : undefined
    ]);
    if (!shouldContinue()) return;
    this.applyAllParticipantAudioVolumes();
  }

  private isCurrentRecovery(generation: number): boolean {
    return (
      generation === this.recoveryGeneration &&
      this.reconnecting &&
      this.recoveryTarget !== null &&
      !this.intentionalDisconnect
    );
  }

  private disposeRoomConnection(room: Room, worker: Worker): void {
    if (this.room === room) {
      this.releaseCurrentRoom();
      void room.disconnect();
      return;
    }
    room.unregisterRpcMethod(DEVICE_AUDIO_CONTROL_RPC_METHOD);
    room.removeAllListeners();
    void room.disconnect();
    worker.terminate();
  }

  private cancelRecovery(): void {
    this.recoveryGeneration += 1;
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.recoveryTarget = null;
    this.recoveryMediaState = null;
    this.recoveryAttemptGeneration = null;
    this.reconnecting = false;
  }

  private async runExplicitMediaDeviceOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.explicitMediaDeviceOperationDepth += 1;
    try {
      return await operation();
    } finally {
      this.explicitMediaDeviceOperationDepth = Math.max(
        0,
        this.explicitMediaDeviceOperationDepth - 1
      );
    }
  }

  private notifyMediaDeviceError(message: string): void {
    const now = Date.now();
    if (
      this.lastMediaDeviceToast &&
      this.lastMediaDeviceToast.message === message &&
      now - this.lastMediaDeviceToast.shownAt < MEDIA_DEVICE_TOAST_DEDUPLICATION_MS
    ) {
      return;
    }

    this.lastMediaDeviceToast = { message, shownAt: now };
    toast.error(message);
  }

  private consumePendingOwnJoinSound(): boolean {
    const pending = this.pendingOwnJoinSound;
    if (!pending) return false;
    this.pendingOwnJoinSound = null;
    return this.matchesActiveCall(pending.roomId, pending.callId);
  }

  private matchesRecentlyDisconnectedCall(roomId: string, callId: string): boolean {
    const recentlyDisconnectedCall = this.recentlyDisconnectedCall;
    if (!recentlyDisconnectedCall) return false;
    if (
      Date.now() - recentlyDisconnectedCall.disconnectedAt >
      RECENTLY_DISCONNECTED_CALL_SOUND_MS
    ) {
      this.recentlyDisconnectedCall = null;
      return false;
    }
    return recentlyDisconnectedCall.roomId === roomId && recentlyDisconnectedCall.callId === callId;
  }
}

/** Parse the JSON metadata string from a LiveKit participant. */
function parseParticipantMetadata(metadata: string | undefined): ParticipantMetadata {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata) as ParticipantMetadata;
  } catch {
    return {};
  }
}

/** Return the server-authored account id only when the participant id is bound to this identity. */
function participantAccountId(participant: Participant): string | null {
  const metadata = parseParticipantMetadata(participant.metadata);
  if (
    typeof metadata.userId !== 'string' ||
    metadata.userId.length === 0 ||
    typeof metadata.participantId !== 'string' ||
    metadata.participantId !== participant.identity
  ) {
    return null;
  }
  return metadata.userId;
}

function parseSiblingAudioControlRequest(payload: string): SiblingAudioControlRequest | null {
  if (payload.length > 2_048) return null;

  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isPlainRecord(value) || value.version !== 1 || typeof value.action !== 'string') {
    return null;
  }

  if (value.action === 'get-state') {
    return { version: 1, action: 'get-state' };
  }
  if (value.action === 'set-state') {
    if (
      (value.target !== 'microphone' && value.target !== 'output') ||
      typeof value.muted !== 'boolean'
    ) {
      return null;
    }
    return { version: 1, action: 'set-state', target: value.target, muted: value.muted };
  }
  if (value.action === 'state-changed') {
    const state = parseSiblingAudioStateValue(value.state);
    return state ? { version: 1, action: 'state-changed', state } : null;
  }
  return null;
}

function parseSiblingAudioState(payload: string): SiblingAudioState | null {
  if (payload.length > 2_048) return null;
  try {
    return parseSiblingAudioStateValue(JSON.parse(payload));
  } catch {
    return null;
  }
}

function parseSiblingAudioStateValue(value: unknown): SiblingAudioState | null {
  if (
    !isPlainRecord(value) ||
    value.version !== 1 ||
    typeof value.microphoneMuted !== 'boolean' ||
    typeof value.outputMuted !== 'boolean' ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  ) {
    return null;
  }
  return {
    version: 1,
    microphoneMuted: value.microphoneMuted,
    outputMuted: value.outputMuted,
    revision: value.revision as number
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function siblingAudioControlKey(identity: string, target: SiblingAudioTarget): string {
  return `${identity}:${target}`;
}

function siblingAudioTargetValue(state: SiblingAudioState, target: SiblingAudioTarget): boolean {
  return target === 'microphone' ? state.microphoneMuted : state.outputMuted;
}

const VOICE_CALL_CLIENT_INSTANCE_STORAGE_KEY = 'towk.voice-call.client-instance-id';
const VOICE_CALL_CLIENT_INSTANCE_OWNER_PREFIX = 'towk.voice-call.client-instance-owner:';
const ownedVoiceCallClientInstanceIds: string[] = [];
const voiceCallPageOwnerId = randomVoiceCallIdentifier('page');
let voiceCallClientInstanceCleanupRegistered = false;

function createVoiceCallClientInstanceId(): string {
  if (typeof sessionStorage !== 'undefined') {
    try {
      const existing = sessionStorage.getItem(VOICE_CALL_CLIENT_INSTANCE_STORAGE_KEY);
      if (
        existing &&
        /^[A-Za-z0-9_-]{16,128}$/.test(existing) &&
        claimVoiceCallClientInstanceId(existing)
      ) {
        return existing;
      }
    } catch {
      // Storage can be unavailable in hardened private-browser contexts.
    }
  }

  let clientInstanceId = randomVoiceCallIdentifier('session');
  while (!claimVoiceCallClientInstanceId(clientInstanceId)) {
    clientInstanceId = randomVoiceCallIdentifier('session');
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(VOICE_CALL_CLIENT_INSTANCE_STORAGE_KEY, clientInstanceId);
    } catch {
      // The in-memory value still keeps retries idempotent for this page.
    }
  }
  return clientInstanceId;
}

function randomVoiceCallIdentifier(prefix: 'page' | 'session'): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return randomUUID
    ? `${prefix}_${randomUUID()}`
    : `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

// sessionStorage is normally tab-scoped, but browsers copy it when a tab or
// PWA window is duplicated. A small same-origin lease prevents that clone from
// reusing the LiveKit identity and silently replacing the source connection.
function claimVoiceCallClientInstanceId(clientInstanceId: string): boolean {
  if (typeof localStorage === 'undefined') return true;

  try {
    const leaseKey = `${VOICE_CALL_CLIENT_INSTANCE_OWNER_PREFIX}${clientInstanceId}`;
    const owner = localStorage.getItem(leaseKey);
    if (owner && owner !== voiceCallPageOwnerId) return false;

    localStorage.setItem(leaseKey, voiceCallPageOwnerId);
    if (!ownedVoiceCallClientInstanceIds.includes(clientInstanceId)) {
      ownedVoiceCallClientInstanceIds.push(clientInstanceId);
    }
    registerVoiceCallClientInstanceCleanup();
    return true;
  } catch {
    // Keep a page-local identity when shared storage is unavailable.
    return true;
  }
}

function registerVoiceCallClientInstanceCleanup(): void {
  if (voiceCallClientInstanceCleanupRegistered || typeof window === 'undefined') return;
  voiceCallClientInstanceCleanupRegistered = true;
  window.addEventListener('pagehide', (event) => {
    if (event.persisted || typeof localStorage === 'undefined') return;
    for (const clientInstanceId of ownedVoiceCallClientInstanceIds) {
      const leaseKey = `${VOICE_CALL_CLIENT_INSTANCE_OWNER_PREFIX}${clientInstanceId}`;
      try {
        if (localStorage.getItem(leaseKey) === voiceCallPageOwnerId) {
          localStorage.removeItem(leaseKey);
        }
      } catch {
        // The browser may revoke storage access while the page is closing.
      }
    }
    ownedVoiceCallClientInstanceIds.length = 0;
  });
}

function isParticipantMuted(participant: Participant): boolean {
  for (const pub of participant.getTrackPublications()) {
    if (pub.track?.source === Track.Source.Microphone) {
      return pub.isMuted;
    }
  }
  // No audio track = effectively muted
  return true;
}

function isParticipantCameraEnabled(participant: Participant): boolean {
  for (const pub of participant.getTrackPublications()) {
    if (pub.track?.source === Track.Source.Camera) {
      return !pub.isMuted;
    }
  }
  return false;
}

function getParticipantCameraTrack(participant: Participant): Track | null {
  for (const pub of participant.getTrackPublications()) {
    if (pub.track?.source === Track.Source.Camera && !pub.isMuted) {
      return pub.track;
    }
  }
  return null;
}

function isParticipantScreenShareEnabled(participant: Participant): boolean {
  for (const pub of participant.getTrackPublications()) {
    if (pub.track?.source === Track.Source.ScreenShare) {
      return !pub.isMuted;
    }
  }
  return false;
}

function isParticipantScreenShareAudioEnabled(participant: Participant): boolean {
  for (const pub of participant.getTrackPublications()) {
    if (pub.track?.source === Track.Source.ScreenShareAudio) {
      return !pub.isMuted;
    }
  }
  return false;
}

function getParticipantScreenShareTrack(participant: Participant): Track | null {
  for (const pub of participant.getTrackPublications()) {
    if (pub.track?.source === Track.Source.ScreenShare && !pub.isMuted) {
      return pub.track;
    }
  }
  return null;
}

function isRecoverableDisconnectReason(reason?: DisconnectReason): boolean {
  if (reason === undefined) return true;
  return [
    DisconnectReason.UNKNOWN_REASON,
    DisconnectReason.SERVER_SHUTDOWN,
    DisconnectReason.STATE_MISMATCH,
    DisconnectReason.JOIN_FAILURE,
    DisconnectReason.MIGRATION,
    DisconnectReason.SIGNAL_CLOSE,
    DisconnectReason.CONNECTION_TIMEOUT,
    DisconnectReason.MEDIA_FAILURE
  ].includes(reason);
}

function isTerminalRecoveryError(error: unknown): boolean {
  if (!(error instanceof ConnectError)) return false;
  return [
    Code.InvalidArgument,
    Code.NotFound,
    Code.PermissionDenied,
    Code.Unauthenticated
  ].includes(error.code);
}

function isScreenShareSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  );
}

function createScreenShareCaptureOptions(): ScreenShareCaptureOptions {
  return {
    audio: true,
    video: { displaySurface: 'browser' },
    contentHint: 'motion',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: 'exclude'
  };
}

function createScreenSharePublishOptions(): TrackPublishOptions {
  return {
    audioPreset: AudioPresets.musicHighQualityStereo,
    degradationPreference: 'maintain-framerate',
    dtx: false,
    forceStereo: true,
    red: true,
    screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
    screenShareSimulcastLayers: [ScreenSharePresets.h360fps15, ScreenSharePresets.h720fps30],
    simulcast: true
  };
}

function assertLiveKitE2EESupported(): void {
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const senderCtor = globals.RTCRtpSender as { prototype?: object } | undefined;
  const senderProto = senderCtor?.prototype as Record<string, unknown> | undefined;
  const hasEncodedTransform =
    typeof globals.RTCRtpScriptTransform === 'function' ||
    typeof senderProto?.createEncodedStreams === 'function';

  if (
    typeof globals.Worker !== 'function' ||
    typeof globals.TransformStream !== 'function' ||
    typeof globals.ReadableStream !== 'function' ||
    typeof globals.WritableStream !== 'function' ||
    !globals.crypto ||
    typeof globals.crypto !== 'object' ||
    !('subtle' in globals.crypto) ||
    !hasEncodedTransform
  ) {
    throw new VoiceCallJoinError(
      'LiveKit E2EE is not supported by this browser',
      m['voice.encrypted_unsupported']()
    );
  }
}

function summarizeJoinError(err: unknown): string {
  return redactSensitiveUrlParts(errorMessage(err));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function errorName(err: unknown): string {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) return err.name;
  if (err instanceof Error) return err.name;
  return '';
}

function classifyMediaDeviceFailure(err: unknown): MediaDeviceFailureKind {
  const name = errorName(err).toLowerCase();
  const message = errorMessage(err).toLowerCase();
  const signal = `${name} ${message}`;

  if (
    signal.includes('unsupported') ||
    signal.includes('not supported') ||
    signal.includes('getdisplaymedia')
  ) {
    return 'unsupported';
  }

  if (
    signal.includes('notallowed') ||
    signal.includes('permissiondenied') ||
    signal.includes('permission denied') ||
    signal.includes('securityerror')
  ) {
    return 'permission-denied';
  }

  if (
    signal.includes('notfound') ||
    signal.includes('devicesnotfound') ||
    signal.includes('device not found') ||
    signal.includes('no device')
  ) {
    return 'not-found';
  }

  if (
    signal.includes('notreadable') ||
    signal.includes('trackstarterror') ||
    signal.includes('deviceinuse') ||
    signal.includes('device in use') ||
    signal.includes('already in use')
  ) {
    return 'in-use';
  }

  if (signal.includes('overconstrained') || signal.includes('constraint')) {
    return 'constraint';
  }

  if (signal.includes('abort')) {
    return 'aborted';
  }

  return 'unknown';
}

function redactSensitiveUrlParts(message: string): string {
  return message
    .replace(/access_token=([^&\s]+)/gi, 'access_token=<redacted>')
    .replace(/join_request=([^&\s]+)/gi, 'join_request=<redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<jwt-redacted>');
}
