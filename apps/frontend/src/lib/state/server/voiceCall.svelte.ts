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
  type AudioCaptureOptions,
  ConnectionState,
  ScreenSharePresets,
  VideoQuality,
  DisconnectReason,
  ExternalE2EEKeyProvider,
  RpcError,
  type LocalAudioTrack,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  type TrackPublication,
  type RpcInvocationData,
  type ReconnectContext,
  type ReconnectPolicy,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
  type VideoCaptureOptions
} from 'livekit-client';
import { Code, ConnectError } from '@connectrpc/connect';
import { SvelteDate, SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toast } from '$lib/ui/toast';
import { playCallSound } from '$lib/audio/callSounds';
import {
  DEFAULT_MICROPHONE_PROCESSING_PREFERENCES,
  createNativeProcessingStatus,
  createVoiceAudioCaptureOptionsFor,
  ensureBackgroundNoiseSuppression,
  type MicrophoneProcessingEnvironment,
  type MicrophoneProcessingPreferences,
  type MicrophoneProcessingStatus
} from '$lib/audio/backgroundNoiseSuppression';
import * as m from '$lib/i18n/messages';
import {
  collectParticipantNetworkQuality,
  PARTICIPANT_NETWORK_QUALITY_INTERVAL_MS,
  type ParticipantNetworkCounters,
  type ParticipantNetworkHealth,
  type ParticipantNetworkQuality,
  type ParticipantNetworkWarningMetric
} from '$lib/voice/participantNetworkQuality';
import type {
  VoiceCallAPI,
  VoiceCallJoinMode,
  VoiceCallJoinResult
} from '$lib/api-client/voiceCalls';
import type { CoordinateVoiceCallJoin, LeaveOtherVoiceCalls } from './voiceCallCoordinator';
import { nextCameraDeviceId } from '$lib/voice/cameraDevices';
import {
  audioDeviceMayUseBluetooth,
  audioDeviceRouteKind,
  preferredAudioDeviceId
} from '$lib/voice/audioDevices';

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
  networkHealth: ParticipantNetworkHealth;
  packetLossPercent: number | null;
  jitterMs: number | null;
  networkWarningMetric: ParticipantNetworkWarningMetric;
  connectionState: 'connected' | 'interrupted';
  interruptionDeadline: string | null;
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
const SCREEN_SHARE_UNAVAILABLE_TOAST_MS = 6_000;
const MICROPHONE_ROUTE_RECONCILE_INTERVAL_MS = 1_000;
const MICROPHONE_ROUTE_AUTO_RECOVERY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
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
  callId: string;
  participantId: string;
};

type CallLeaveOperation = {
  roomId: string;
  callId: string | null;
  clientInstanceId: string;
  hadSiblingDevices: boolean;
  promise: Promise<void>;
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
  #coordinateVoiceCallJoin: CoordinateVoiceCallJoin;

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
  // The selected/system microphone route disappeared while the user intended
  // to stay audible. This is distinct from an explicit user mute.
  microphoneRouteRecovering = $state(false);
  microphoneProcessing = $state<MicrophoneProcessingStatus>({
    automaticGainControl: 'unavailable',
    echoCancellation: null,
    noiseSuppression: 'unavailable'
  });
  microphoneProcessingPreferences = $state<MicrophoneProcessingPreferences>({
    ...DEFAULT_MICROPHONE_PROCESSING_PREFERENCES
  });

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

  /** Firefox exposes an explicit, user-activation-gated speaker picker. */
  get canRequestAudioOutputDevice(): boolean {
    return supportsAudioOutputPicker();
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
  isAudioOutputSelectionSupported = $state(supportsAudioOutputSelection());

  // Video input devices
  videoDevices = $state<MediaDeviceInfo[]>([]);
  selectedVideoDeviceId = $state<string | null>(null);

  // Internal LiveKit room instance
  private room: Room | null = null;
  private activeCallId: string | null = null;
  private activeParticipantId: string | null = null;
  private activeDeviceIndex: number | null = null;
  private clientInstanceId = createVoiceCallClientInstanceId();
  private explicitAudioInputDeviceId: string | null = null;
  private explicitAudioOutputDeviceId: string | null = null;
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
  private joinInFlightRoomId = $state<string | null>(null);
  private leaveInFlight: CallLeaveOperation | null = null;
  private microphoneToggleInFlight: Promise<boolean> | null = null;
  private outputToggleInFlight: Promise<boolean> | null = null;
  private cameraToggleInFlight: Promise<void> | null = null;
  private cameraDeviceSwitchInFlight: Promise<void> | null = null;
  private screenShareToggleInFlight: Promise<void> | null = null;
  private audioInputOperationQueue: Promise<void> = Promise.resolve();
  private audioOutputOperationQueue: Promise<void> = Promise.resolve();
  private e2eeWorker: Worker | null = null;
  private audioLevelInterval: ReturnType<typeof setInterval> | null = null;
  private participantNetworkQualityInterval: ReturnType<typeof setInterval> | null = null;
  private microphoneRouteReconcileInterval: ReturnType<typeof setInterval> | null = null;
  private microphoneRouteFingerprint: string | null = null;
  private microphoneRouteRecoveryAttempts = 0;
  private nextMicrophoneRouteRecoveryAt = 0;
  private participantNetworkQualityPollRoom: Room | null = null;
  private participantNetworkQuality = $state<Record<string, ParticipantNetworkQuality>>({});
  private participantNetworkCounters = new SvelteMap<string, ParticipantNetworkCounters>();
  private suppressDisconnectToast = false;
  private intentionalDisconnect = false;
  private recoveryTarget: CallRecoveryTarget | null = null;
  private recoveryMediaState: CallRecoveryMediaState | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryGeneration = 0;
  private recoveryAttemptGeneration: number | null = null;
  private browserNetworkListenersAttached = false;
  private explicitMediaDeviceOperationDepth = 0;
  private mediaDeviceRefreshGeneration = 0;
  private lastMediaDeviceToast: {
    message: string;
    shownAt: number;
  } | null = null;
  private lastScreenShareUnavailableToastAt = -SCREEN_SHARE_UNAVAILABLE_TOAST_MS;
  private microphoneProcessingWarningShown = false;
  private localAudioStateRevision = 0;
  private siblingAudioStates = $state<Record<string, SiblingAudioState>>({});
  private siblingAudioControlPending = $state<Record<string, boolean>>({});
  private siblingAudioControlInFlight = new SvelteMap<string, Promise<boolean>>();
  private siblingAudioStateRefreshInFlight = new SvelteMap<string, Promise<void>>();
  private interruptedParticipants = new SvelteMap<string, CallParticipantInfo>();

  // Non-reactive audio level cache — updated at 60ms by the polling interval.
  // Deliberately NOT $state to avoid triggering Svelte reactivity at 60Hz.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- deliberately non-reactive, polled imperatively at 60Hz
  private audioLevelCache = new Map<string, AudioLevelInfo>();

  constructor(
    api: VoiceCallAPI,
    coordinateVoiceCallJoin: CoordinateVoiceCallJoin = (join) => join(async () => undefined)
  ) {
    this.#api = api;
    this.#coordinateVoiceCallJoin = coordinateVoiceCallJoin;
  }

  /** Stop every local call resource when the owning server store is removed. */
  dispose(): void {
    if (this.room || this.roomId || this.recoveryTarget) {
      void this.leave();
      return;
    }
    this.cleanup();
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
    return this.isInAnyCall && this.roomId === roomId;
  }

  /** Whether admission or media setup is currently targeting this room. */
  isJoiningRoom(roomId: string): boolean {
    return this.connecting && this.joinInFlightRoomId === roomId;
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
    return (
      this.connected ||
      this.connecting ||
      this.reconnecting ||
      this.roomId !== null ||
      this.recoveryTarget !== null
    );
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

  /**
   * Raises the receiver target while a remote feed occupies the screen, then
   * returns control to adaptive streaming when the expanded view closes.
   * LiveKit can still select a lower layer when receiver bandwidth requires it.
   */
  setParticipantMediaExpanded(
    identity: string,
    kind: 'camera' | 'screen',
    expanded: boolean
  ): void {
    const participant = this.room?.remoteParticipants.get(identity);
    if (!participant) return;

    const source = kind === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera;
    const publication = participant
      .getTrackPublications()
      .find((candidate): candidate is RemoteTrackPublication => candidate.track?.source === source);
    if (!publication?.track || !expanded) return;

    // An explicit HIGH ceiling makes LiveKit request the top simulcast layer
    // for the expanded element. It remains a ceiling, not a fixed bitrate:
    // the SFU may still downgrade for congestion, while adaptiveStream resumes
    // smaller dimension updates as soon as the element contracts.
    publication.setVideoQuality(VideoQuality.HIGH);
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
    if (
      this.isInCall(roomId) &&
      this.activeCallId &&
      this.activeParticipantId &&
      this.activeDeviceIndex
    ) {
      return {
        status: 'joined',
        callId: this.activeCallId,
        participantId: this.activeParticipantId,
        deviceIndex: this.activeDeviceIndex
      };
    }

    if (this.joinInFlight) {
      if (this.joinInFlightRoomId === roomId) {
        return this.joinInFlight;
      }
      try {
        await this.joinInFlight;
      } catch {
        // A navigation-triggered join targets a distinct room. Failure of the
        // older target must not cancel this newer user intent; performJoin will
        // independently revalidate browser support and server admission.
      }
      // Re-enter the gate after settlement. Another queued request may already
      // own it now; this also coalesces repeated clicks for the newer room.
      return this.join(livekitUrl, roomId, mode, expectedCallId);
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
    return this.#coordinateVoiceCallJoin((leaveOtherVoiceCalls) =>
      this.performCoordinatedJoin(livekitUrl, roomId, mode, expectedCallId, leaveOtherVoiceCalls)
    );
  }

  private async performCoordinatedJoin(
    livekitUrl: string,
    roomId: string,
    mode: VoiceCallJoinMode,
    expectedCallId: string | undefined,
    leaveOtherVoiceCalls: LeaveOtherVoiceCalls
  ): Promise<VoiceCallJoinResult> {
    assertLiveKitE2EESupported();
    this.connecting = true;
    let joinIntentRecorded = false;
    let mediaConnectionStarted = false;
    let admittedCallId: string | undefined;
    const joiningClientInstanceId = this.clientInstanceId;

    try {
      const pendingSameCallLeave =
        mode === 'ask' &&
        !expectedCallId &&
        this.leaveInFlight?.roomId === roomId &&
        this.leaveInFlight.callId &&
        !this.leaveInFlight.hadSiblingDevices
          ? this.leaveInFlight
          : null;
      const effectiveMode = pendingSameCallLeave ? 'transfer' : mode;
      const effectiveExpectedCallId = pendingSameCallLeave?.callId ?? expectedCallId;
      // JoinCall returns the authoritative call generation. Fence every later
      // token/leave command with it so a replacement call cannot be joined or
      // left by a delayed request from an earlier generation.
      const joinResult = await this.#api.joinCall(
        roomId,
        joiningClientInstanceId,
        effectiveMode,
        effectiveExpectedCallId
      );
      if (joinResult.status === 'selection-required') {
        return joinResult;
      }
      admittedCallId = joinResult.callId;
      joinIntentRecorded = true;
      const tokenResponse = await this.#api.getCallToken(
        roomId,
        joiningClientInstanceId,
        admittedCallId
      );

      if (!tokenResponse) {
        throw new Error(m['voice.token_failed']());
      }
      const { token, e2eeKey, callId, participantId, deviceIndex } = tokenResponse;
      if (callId !== admittedCallId) {
        throw new VoiceCallJoinError(
          'voice call changed between admission and token issuance',
          m['voice.call_no_longer_active']()
        );
      }
      if (participantId !== joinResult.participantId || deviceIndex !== joinResult.deviceIndex) {
        throw new Error('call token connection identity does not match admitted participant');
      }

      // The admission and token identity are authoritative now. Only at this
      // point may a cross-server coordinator release another healthy call.
      await leaveOtherVoiceCalls();
      if (this.connected || this.room || this.roomId || this.recoveryTarget) {
        const leaveCurrentCall = this.leave(false);
        // performLeave releases the previous room synchronously. Preserve the
        // global active-call intent while its backend leave confirmation is in
        // flight so PWA wake lock and OS media controls do not flicker off.
        this.connecting = true;
        await leaveCurrentCall;
      }

      this.cancelRecovery();
      this.intentionalDisconnect = false;
      this.connecting = true;
      this.roomId = roomId;
      this.activeParticipantId = joinResult.participantId;
      this.activeDeviceIndex = joinResult.deviceIndex;
      this.activeCallId = callId;
      mediaConnectionStarted = true;

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
        } catch (err) {
          this.isMuted = true;
          this.notifyMediaDeviceError(
            getVoiceCallMediaDeviceErrorMessage('microphone', err, 'join')
          );
        }
      }

      this.connected = true;
      this.reconnecting = false;
      this.recoveryTarget = { livekitUrl, roomId, callId, participantId };
      this.recoveryGeneration += 1;
      this.attachBrowserNetworkListeners();
      this.updateParticipants();
      void this.refreshSiblingAudioStates();
      await this.refreshDevices();
      await this.reconcileMicrophoneProcessing(room);
      if (this.consumePendingOwnJoinSound()) {
        void playCallSound('join');
      }
      return joinResult;
    } catch (err) {
      console.error('Failed to join voice call:', summarizeJoinError(err));
      if (joinIntentRecorded) {
        await this.recordLeaveIntent(roomId, joiningClientInstanceId, admittedCallId);
      }
      // Until the target has been validated and its media connection starts,
      // a connected room is the user's previous call and must remain intact.
      if (mediaConnectionStarted || !this.connected) {
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
  async leave(rotateClientInstanceId = true): Promise<void> {
    if (!this.room && !this.roomId && !this.recoveryTarget) {
      if (this.leaveInFlight) return this.leaveInFlight.promise;
      return;
    }

    const clientInstanceId = this.clientInstanceId;
    if (this.leaveInFlight?.clientInstanceId === clientInstanceId) {
      return this.leaveInFlight.promise;
    }
    const roomId = this.roomId ?? this.recoveryTarget?.roomId;
    if (!roomId) return;
    const callId = this.activeCallId ?? this.recoveryTarget?.callId ?? null;
    const hadSiblingDevices = this.participants.some((participant) => participant.canControlAudio);
    const leavePromise = this.performLeave(
      roomId,
      callId,
      clientInstanceId,
      rotateClientInstanceId
    );
    const operation: CallLeaveOperation = {
      roomId,
      callId,
      clientInstanceId,
      hadSiblingDevices,
      promise: leavePromise
    };
    this.leaveInFlight = operation;
    try {
      await leavePromise;
    } finally {
      if (this.leaveInFlight === operation) {
        this.leaveInFlight = null;
      }
    }
  }

  private async performLeave(
    roomId: string,
    callId: string | null,
    clientInstanceId: string,
    rotateClientInstanceId: boolean
  ): Promise<void> {
    this.intentionalDisconnect = true;
    this.cancelRecovery();
    const leaveIntent = this.recordLeaveIntent(roomId, clientInstanceId, callId);
    void this.room?.disconnect();
    if (rotateClientInstanceId && this.clientInstanceId === clientInstanceId) {
      this.clientInstanceId = createFreshVoiceCallClientInstanceId();
    }
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
    if (participantId) {
      this.clearInterruptedParticipant(participantId);
      this.updateParticipants();
    }
    if (!actorId || !currentUserId || actorId !== currentUserId) return;
    if (participantId && participantId !== this.activeParticipantId) return;
    if (this.reconnecting && this.roomId === roomId && this.activeCallId === callId) return;
    this.disconnectFromServerEvent(roomId, callId);
  }

  handleParticipantConnectionChangedEvent(
    roomId: string,
    callId: string,
    participantId: string,
    connectionState: 'connected' | 'interrupted',
    interruptionDeadline: string | null
  ): void {
    if (this.roomId !== roomId || this.activeCallId !== callId || !participantId) return;
    if (connectionState === 'interrupted') {
      this.markParticipantInterrupted(participantId, interruptionDeadline);
    } else {
      this.clearInterruptedParticipant(participantId);
    }
    this.updateParticipants();
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

  private async recordLeaveIntent(
    roomId: string,
    clientInstanceId: string,
    expectedCallId?: string | null
  ): Promise<void> {
    try {
      await this.#api.leaveCall(roomId, clientInstanceId, expectedCallId ?? undefined);
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

    const togglePromise = this.serializeAudioInputOperation(() =>
      this.room === room ? this.performSetMicrophoneMuted(room, muted) : Promise.resolve(false)
    );
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
    if (this.isMuted === newMuted) {
      if (newMuted) this.clearMicrophoneRouteRecovery();
      return true;
    }
    try {
      await this.runExplicitMediaDeviceOperation(async () => {
        if (newMuted) {
          await room.localParticipant.setMicrophoneEnabled(false);
          return;
        }
        await this.enableMicrophoneWithRouteFallback(room);
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
    this.clearMicrophoneRouteRecovery();

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
    const operation = this.serializeAudioOutputOperation(() =>
      this.room === room ? this.performSetOutputMuted(room, muted) : Promise.resolve(false)
    );
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

  private async enableMicrophone(
    room: Room,
    deviceId: string | null = this.selectedDeviceId
  ): Promise<void> {
    const previousProcessingEnvironment = await this.prepareBluetoothMicrophoneTransition(
      room,
      deviceId
    );
    const options = createVoiceAudioCaptureOptionsFor(this.microphoneProcessingPreferences);
    const publication = await room.localParticipant
      .setMicrophoneEnabled(
        true,
        deviceId
          ? {
              ...options,
              deviceId: { exact: deviceId }
            }
          : options
      )
      .catch(async (error: unknown) => {
        await this.restoreMicrophoneProcessingAfterFailedTransition(
          room,
          previousProcessingEnvironment
        );
        throw error;
      });
    const track = publication?.track as LocalAudioTrack | undefined;
    if (!track) return;

    setMicrophoneContentHint(track);

    const activeDeviceId = track.getSourceTrackSettings().deviceId;
    if (activeDeviceId) this.selectedDeviceId = activeDeviceId;
    await this.updateMicrophoneProcessing(track);
  }

  private async enableMicrophoneWithRouteFallback(
    room: Room,
    preferredDeviceId: string | null = this.selectedDeviceId,
    shouldContinue: () => boolean = () => this.room === room
  ): Promise<void> {
    try {
      await this.enableMicrophone(room, preferredDeviceId);
      return;
    } catch (initialError) {
      if (!shouldRetryMicrophoneWithAvailableRoute(initialError) || !shouldContinue()) {
        throw initialError;
      }

      const unavailableDeviceId =
        room.getActiveDevice('audioinput') ?? preferredDeviceId ?? this.selectedDeviceId;
      await this.refreshDevices();
      if (!shouldContinue()) throw initialError;

      const fallbackDeviceId = this.selectedDeviceId;
      if (fallbackDeviceId && fallbackDeviceId !== unavailableDeviceId) {
        // A named Bluetooth route disappeared. Move the muted publication to a
        // route that is present in the refreshed inventory before unmuting it.
        await this.switchAudioInputDevice(room, fallbackDeviceId);
        if (!shouldContinue()) throw initialError;
        await this.enableMicrophone(room, fallbackDeviceId);
        return;
      }

      // Mobile browsers can keep exposing the logical `default` device while
      // Android/iOS moved between Bluetooth and the built-in microphone, or
      // return an empty inventory during the transition. Drop the stale exact
      // constraint and reacquire the OS-selected route. Restart an existing
      // muted track first because LiveKit otherwise retains its pending device
      // constraint across unmute.
      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const track = publication?.track as LocalAudioTrack | undefined;
      if (track) {
        await track.restartTrack(
          createVoiceAudioCaptureOptionsFor(this.microphoneProcessingPreferences)
        );
        if (!shouldContinue()) throw initialError;
      }
      await this.enableMicrophone(room, null);
    }
  }

  private async updateMicrophoneProcessing(
    track: LocalAudioTrack,
    environment: MicrophoneProcessingEnvironment = this.microphoneProcessingEnvironment(track)
  ): Promise<void> {
    this.microphoneRouteFingerprint = microphoneTrackSettingsFingerprint(
      track.getSourceTrackSettings()
    );
    try {
      this.microphoneProcessing = await ensureBackgroundNoiseSuppression(
        track,
        this.microphoneProcessingPreferences,
        environment
      );
    } catch {
      // Browser-native processing is still useful when the portable processor
      // cannot attach. Keep the user audible and expose the reduced capability.
      this.microphoneProcessing = createNativeProcessingStatus(
        track.mediaStreamTrack.getSettings()
      );
      if (!this.microphoneProcessingWarningShown) {
        this.microphoneProcessingWarningShown = true;
        toast.warning(m['voice.microphone_processing_degraded']());
      }
    }
  }

  async setMicrophoneProcessingPreference(
    key: keyof MicrophoneProcessingPreferences,
    enabled: boolean
  ): Promise<void> {
    if (this.microphoneProcessingPreferences[key] === enabled) return;
    const previousPreferences = this.microphoneProcessingPreferences;
    this.microphoneProcessingPreferences = {
      ...previousPreferences,
      [key]: enabled
    };

    const room = this.room;
    if (!room || this.isMuted) return;

    try {
      await this.serializeAudioInputOperation(async () => {
        if (this.room !== room || this.isMuted) return;
        const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        const track = publication?.track as LocalAudioTrack | undefined;
        if (!track) throw new Error('Active microphone track is unavailable');
        await track.applyConstraints(
          microphoneProcessingConstraints(this.microphoneProcessingPreferences)
        );
        await this.updateMicrophoneProcessing(track);
        if (this.room !== room) return;
        this.clearMicrophoneRouteRecovery();
        this.updateParticipants();
        this.localAudioStateRevision += 1;
        this.broadcastLocalAudioState();
      });
    } catch {
      if (this.room !== room) return;
      this.microphoneProcessingPreferences = previousPreferences;
      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const track = publication?.track as LocalAudioTrack | undefined;
      if (track && !this.isMuted) {
        await this.serializeAudioInputOperation(async () => {
          if (this.room !== room || this.isMuted) return;
          await track
            .applyConstraints(microphoneProcessingConstraints(previousPreferences))
            .catch(() => undefined);
          await this.updateMicrophoneProcessing(track).catch(() => undefined);
        });
      }
      this.notifyMediaDeviceError(m['voice.microphone_processing_update_failed']());
    }
  }

  private async reconcileMicrophoneProcessing(room: Room): Promise<void> {
    if (this.room !== room || this.isMuted) return;
    const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = publication?.track as LocalAudioTrack | undefined;
    if (!track) return;
    await this.updateMicrophoneProcessing(track);
  }

  private async prepareBluetoothMicrophoneTransition(
    room: Room,
    deviceId: string | null
  ): Promise<MicrophoneProcessingEnvironment | null> {
    if (!deviceId) return null;
    const device = this.audioDevices.find((candidate) => candidate.deviceId === deviceId);
    if (!device || !audioDeviceMayUseBluetooth(device, this.audioDevices)) return null;

    const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = publication?.track as LocalAudioTrack | undefined;
    if (!track?.getProcessor()) return null;

    const previousEnvironment = this.microphoneProcessingEnvironment(track, deviceId);

    // Detach Web Audio while the source still uses its current stable clock.
    // If LiveKit switches first, an HFP/BLE route can briefly feed the old
    // AudioContext and turn clock drift into audible gaps before reconciliation.
    await this.updateMicrophoneProcessing(track, {
      bluetoothRoute: true,
      documentVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
      routeIdentityKnown: true
    });
    return previousEnvironment;
  }

  private async restoreMicrophoneProcessingAfterFailedTransition(
    room: Room,
    environment: MicrophoneProcessingEnvironment | null
  ): Promise<void> {
    if (!environment || this.room !== room) return;
    const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = publication?.track as LocalAudioTrack | undefined;
    if (!track) return;
    await this.updateMicrophoneProcessing(track, environment).catch(() => undefined);
  }

  private async switchAudioInputDevice(room: Room, deviceId: string): Promise<void> {
    const previousProcessingEnvironment = await this.prepareBluetoothMicrophoneTransition(
      room,
      deviceId
    );
    try {
      await room.switchActiveDevice('audioinput', deviceId);
    } catch (error) {
      await this.restoreMicrophoneProcessingAfterFailedTransition(
        room,
        previousProcessingEnvironment
      );
      throw error;
    }
  }

  /** Keep enhanced Web Audio off while the document is suspended, then restore it on return. */
  async handleDocumentVisibilityChange(visibilityState: DocumentVisibilityState): Promise<void> {
    const room = this.room;
    if (!room || this.isMuted) return;
    await this.serializeAudioInputOperation(async () => {
      if (this.room !== room || this.isMuted) return;
      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const track = publication?.track as LocalAudioTrack | undefined;
      if (!track) return;
      if (visibilityState !== 'hidden') {
        await track.applyConstraints(
          microphoneProcessingConstraints(this.microphoneProcessingPreferences)
        );
      }
      await this.updateMicrophoneProcessing(track, {
        ...this.microphoneProcessingEnvironment(track),
        documentVisible: visibilityState !== 'hidden'
      });
    });
  }

  private microphoneProcessingEnvironment(
    track: LocalAudioTrack,
    pendingDeviceId: string | null = null
  ): MicrophoneProcessingEnvironment {
    const routeDeviceIds = [
      track.getSourceTrackSettings().deviceId,
      this.room?.getActiveDevice('audioinput'),
      this.selectedDeviceId === pendingDeviceId ? null : this.selectedDeviceId
    ].filter((deviceId): deviceId is string => Boolean(deviceId));
    const routeDevices = this.audioDevices.filter((device) =>
      routeDeviceIds.includes(device.deviceId)
    );
    const routeKinds = routeDevices.map((device) => audioDeviceRouteKind(device));
    const availableRouteKinds = this.audioDevices.map((device) => audioDeviceRouteKind(device));
    const usesLogicalRoute = routeKinds.some(
      (kind) => kind === 'default' || kind === 'communications'
    );
    const hasAvailableBluetoothInput = availableRouteKinds.includes('bluetooth');
    return {
      // Android can expose a fresh or opaque source-track id after switching
      // to Bluetooth while LiveKit and the device inventory still retain the
      // logical route id. A logical route is also treated as Bluetooth while
      // any enumerated Bluetooth input could be hidden behind it.
      bluetoothRoute:
        routeDevices.some((device) => audioDeviceMayUseBluetooth(device, this.audioDevices)),
      documentVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
      // A logical route is safe for enhanced processing only when the current
      // inventory contains no Bluetooth input that could replace its clock.
      routeIdentityKnown:
        routeKinds.some((kind) => kind !== 'default' && kind !== 'communications') ||
        (usesLogicalRoute && !hasAvailableBluetoothInput)
    };
  }

  /**
   * Toggle camera on/off. Camera is always off by default.
   */
  async toggleCamera(): Promise<void> {
    if (this.cameraToggleInFlight) return this.cameraToggleInFlight;
    if (this.cameraDeviceSwitchInFlight) await this.cameraDeviceSwitchInFlight;

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
        newEnabled
          ? enableUncroppedCamera(room, this.selectedVideoDeviceId)
          : room.localParticipant.setCameraEnabled(newEnabled).then(() => undefined)
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
      const now = Date.now();
      if (now - this.lastScreenShareUnavailableToastAt >= SCREEN_SHARE_UNAVAILABLE_TOAST_MS) {
        this.lastScreenShareUnavailableToastAt = now;
        toast.warning(
          m['voice.screen_share_capability_unavailable'](),
          SCREEN_SHARE_UNAVAILABLE_TOAST_MS
        );
      }
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
    const refreshGeneration = ++this.mediaDeviceRefreshGeneration;
    const requestVideoPermissions = options.requestVideoPermissions ?? this.isCameraEnabled;
    const [inputResult, outputResult, videoInputResult] = await Promise.allSettled([
      Room.getLocalDevices('audioinput'),
      // Output routing is system-managed on several mobile browsers. Never let
      // an empty output list trigger an unrelated microphone permission request.
      Room.getLocalDevices('audiooutput', false),
      Room.getLocalDevices('videoinput', requestVideoPermissions)
    ]);
    if (refreshGeneration !== this.mediaDeviceRefreshGeneration) return;

    // Device families fail independently across browsers. Keep the last known
    // list for a failed family without discarding successful microphone or
    // camera enumeration from the same refresh.
    if (inputResult.status === 'fulfilled') {
      const inputDevices = inputResult.value;
      if (
        this.explicitAudioInputDeviceId &&
        !inputDevices.some((device) => device.deviceId === this.explicitAudioInputDeviceId)
      ) {
        this.explicitAudioInputDeviceId = null;
      }
      this.audioDevices = inputDevices;
      this.selectedDeviceId = preferredAudioDeviceId(inputDevices, {
        activeDeviceId: this.room?.getActiveDevice('audioinput'),
        explicitDeviceId: this.explicitAudioInputDeviceId,
        selectedDeviceId: this.selectedDeviceId
      });
      await this.applyAutomaticPreferredAudioInput(inputDevices, this.selectedDeviceId);
    }

    if (outputResult.status === 'fulfilled') {
      const outputDevices = outputResult.value;
      if (
        this.explicitAudioOutputDeviceId &&
        !outputDevices.some((device) => device.deviceId === this.explicitAudioOutputDeviceId)
      ) {
        this.explicitAudioOutputDeviceId = null;
      }
      this.isAudioOutputSelectionSupported =
        supportsAudioOutputSelection() && outputDevices.length > 0;
      this.audioOutputDevices = this.isAudioOutputSelectionSupported ? outputDevices : [];
      if (!this.isAudioOutputSelectionSupported) {
        this.selectedOutputDeviceId = null;
      } else {
        this.selectedOutputDeviceId = preferredAudioDeviceId(outputDevices, {
          activeDeviceId: this.room?.getActiveDevice('audiooutput'),
          explicitDeviceId: this.explicitAudioOutputDeviceId,
          selectedDeviceId: this.selectedOutputDeviceId
        });
        await this.applyAutomaticPreferredAudioOutput(outputDevices, this.selectedOutputDeviceId);
      }
    } else if (classifyMediaDeviceFailure(outputResult.reason) === 'unsupported') {
      // Mobile browsers commonly expose capture devices while keeping speaker
      // routing under OS control. Drop any stale desktop output instead of
      // presenting an unusable or misleading device after that transition.
      this.audioOutputDevices = [];
      this.selectedOutputDeviceId = null;
      this.explicitAudioOutputDeviceId = null;
      this.isAudioOutputSelectionSupported = false;
    }

    if (videoInputResult.status === 'fulfilled') {
      const videoInputDevices = videoInputResult.value;
      this.videoDevices = videoInputDevices;
      if (
        !this.selectedVideoDeviceId ||
        !videoInputDevices.some((device) => device.deviceId === this.selectedVideoDeviceId)
      ) {
        this.selectedVideoDeviceId = videoInputDevices[0]?.deviceId ?? null;
      }
    }
  }

  private async applyAutomaticPreferredAudioInput(
    devices: MediaDeviceInfo[],
    deviceId: string | null
  ): Promise<void> {
    const room = this.room;
    if (
      !room ||
      this.isMuted ||
      this.explicitAudioInputDeviceId ||
      this.explicitMediaDeviceOperationDepth > 0 ||
      !deviceId ||
      room.getActiveDevice('audioinput') === deviceId
    ) {
      return;
    }

    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device || audioDeviceRouteKind(device) !== 'bluetooth') return;

    try {
      await this.serializeAudioInputOperation(async () => {
        if (
          this.room !== room ||
          this.isMuted ||
          this.explicitAudioInputDeviceId ||
          this.explicitMediaDeviceOperationDepth > 0
        ) {
          return;
        }
        await this.runExplicitMediaDeviceOperation(() =>
          this.enableMicrophoneWithRouteFallback(room, deviceId)
        );
        if (this.room !== room) return;
        if (
          !this.selectedDeviceId ||
          !devices.some((device) => device.deviceId === this.selectedDeviceId)
        ) {
          this.selectedDeviceId = room.getActiveDevice('audioinput') ?? deviceId;
        }
        this.clearMicrophoneRouteRecovery();
        this.updateParticipants();
        this.localAudioStateRevision += 1;
        this.broadcastLocalAudioState();
      });
    } catch {
      if (this.room === room) {
        this.selectedDeviceId = availableDeviceId(
          devices,
          this.selectedDeviceId,
          room.getActiveDevice('audioinput')
        );
      }
    }
  }

  private async applyAutomaticPreferredAudioOutput(
    devices: MediaDeviceInfo[],
    deviceId: string | null
  ): Promise<void> {
    const room = this.room;
    if (
      !room ||
      this.explicitAudioOutputDeviceId ||
      this.explicitMediaDeviceOperationDepth > 0 ||
      !deviceId ||
      room.getActiveDevice('audiooutput') === deviceId
    ) {
      return;
    }

    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device || audioDeviceRouteKind(device) !== 'bluetooth') return;

    try {
      await this.serializeAudioOutputOperation(async () => {
        if (
          this.room !== room ||
          this.explicitAudioOutputDeviceId ||
          this.explicitMediaDeviceOperationDepth > 0
        ) {
          return;
        }
        await this.runExplicitMediaDeviceOperation(() =>
          room.switchActiveDevice('audiooutput', deviceId)
        );
        if (this.room !== room) return;
        this.selectedOutputDeviceId = room.getActiveDevice('audiooutput') ?? deviceId;
      });
    } catch {
      if (this.room === room) {
        this.selectedOutputDeviceId = availableDeviceId(
          devices,
          this.selectedOutputDeviceId,
          room.getActiveDevice('audiooutput')
        );
      }
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
    const room = this.room;
    if (!room) return;
    const previousExplicitDeviceId = this.explicitAudioInputDeviceId;
    this.explicitAudioInputDeviceId = deviceId;
    if (
      !this.microphoneRouteRecovering &&
      deviceId === this.selectedDeviceId &&
      room.getActiveDevice('audioinput') === deviceId
    ) {
      return;
    }

    try {
      await this.serializeAudioInputOperation(async () => {
        if (this.room !== room) return;
        const shouldRecoverMicrophone = this.microphoneRouteRecovering && this.isMuted;
        await this.runExplicitMediaDeviceOperation(() =>
          this.switchAudioInputDevice(room, deviceId)
        );
        if (this.room !== room) return;
        this.selectedDeviceId = room.getActiveDevice('audioinput') ?? deviceId;
        if (shouldRecoverMicrophone) {
          await this.runExplicitMediaDeviceOperation(() =>
            this.enableMicrophoneWithRouteFallback(room, this.selectedDeviceId)
          );
          if (this.room !== room) return;
          this.isMuted = false;
          this.clearMicrophoneRouteRecovery();
          this.updateParticipants();
          this.localAudioStateRevision += 1;
          this.broadcastLocalAudioState();
          return;
        }
        await this.reconcileMicrophoneProcessing(room);
      });
    } catch (err) {
      if (this.room !== room) return;
      this.explicitAudioInputDeviceId = previousExplicitDeviceId;
      this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('microphone', err, 'switch'));
      return;
    }
  }

  /**
   * Switch to a different audio output device.
   */
  async setAudioOutputDevice(deviceId: string): Promise<void> {
    const room = this.room;
    if (!room) return;
    const previousExplicitDeviceId = this.explicitAudioOutputDeviceId;
    this.explicitAudioOutputDeviceId = deviceId;
    if (
      deviceId === this.selectedOutputDeviceId &&
      room.getActiveDevice('audiooutput') === deviceId
    ) {
      return;
    }

    try {
      await this.serializeAudioOutputOperation(async () => {
        if (this.room !== room) return;
        await this.runExplicitMediaDeviceOperation(() =>
          room.switchActiveDevice('audiooutput', deviceId)
        );
        if (this.room !== room) return;
        this.selectedOutputDeviceId = room.getActiveDevice('audiooutput') ?? deviceId;
      });
    } catch (err) {
      if (this.room !== room) return;
      this.explicitAudioOutputDeviceId = previousExplicitDeviceId;
      this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('speaker', err, 'switch'));
    }
  }

  /**
   * Ask browsers implementing the Media Capture Output specification to grant
   * and return a speaker. The picker call must remain the first async action so
   * it retains the click's transient user activation.
   */
  async requestAudioOutputDevice(): Promise<boolean> {
    const room = this.room;
    const selectAudioOutput = getAudioOutputPicker();
    if (!room || !selectAudioOutput) return false;

    try {
      const device = await selectAudioOutput();
      if (this.room !== room || device.kind !== 'audiooutput' || !device.deviceId) return false;
      await this.refreshDevices();
      if (this.room !== room) return false;
      await this.setAudioOutputDevice(device.deviceId);
      return this.room === room && this.selectedOutputDeviceId === device.deviceId;
    } catch (error) {
      if (this.room === room) {
        this.notifyMediaDeviceError(
          getVoiceCallMediaDeviceErrorMessage('speaker', error, 'switch')
        );
      }
      return false;
    }
  }

  /**
   * Switch to a different video input device.
   */
  async setVideoDevice(deviceId: string): Promise<void> {
    if (!this.room) return;
    if (deviceId === this.selectedVideoDeviceId) return;
    if (this.cameraDeviceSwitchInFlight) return this.cameraDeviceSwitchInFlight;
    if (this.cameraToggleInFlight) await this.cameraToggleInFlight;

    const room = this.room;
    if (!room) return;
    const switchPromise = this.performVideoDeviceSwitch(room, deviceId);
    this.cameraDeviceSwitchInFlight = switchPromise;
    this.isCameraPending = true;
    try {
      await switchPromise;
    } finally {
      if (this.cameraDeviceSwitchInFlight === switchPromise) {
        this.cameraDeviceSwitchInFlight = null;
        this.isCameraPending = false;
      }
    }
  }

  private async performVideoDeviceSwitch(room: Room, deviceId: string): Promise<void> {
    try {
      await this.runExplicitMediaDeviceOperation(() =>
        room.switchActiveDevice('videoinput', deviceId)
      );
      if (this.room !== room) return;
      this.selectedVideoDeviceId = deviceId;
    } catch (err) {
      if (this.room !== room) return;
      this.notifyMediaDeviceError(getVoiceCallMediaDeviceErrorMessage('camera', err, 'switch'));
    }
  }

  /** Switch front/rear/auxiliary lenses with one touch on mobile. */
  async switchToNextVideoDevice(): Promise<void> {
    const nextDeviceId = nextCameraDeviceId(this.videoDevices, this.selectedVideoDeviceId);
    if (!nextDeviceId || nextDeviceId === this.selectedVideoDeviceId) return;
    await this.setVideoDevice(nextDeviceId);
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
      // Incoming audio is attached directly to media elements below. Keeping
      // the SDK Web Audio mixer disabled lets the element `muted` flag provide
      // a portable hard mute on iOS as well as volume control elsewhere.
      webAudioMix: false,
      audioCaptureDefaults: createVoiceAudioCaptureOptionsFor(this.microphoneProcessingPreferences),
      videoCaptureDefaults: createUncroppedCameraCaptureOptions(),
      publishDefaults: {
        audioPreset: AudioPresets.speech,
        degradationPreference: 'maintain-framerate',
        dtx: true,
        // Voice capture is deliberately mono. Forcing a stereo Opus stream
        // doubles the channel payload without adding useful speech detail and
        // wastes bandwidth precisely when DTX/RED resilience matters most.
        forceStereo: false,
        red: true,
        simulcast: true,
        videoCodec: 'vp8'
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
      this.clearInterruptedParticipant(participant.identity);
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
      this.markParticipantInterrupted(
        participant.identity,
        new SvelteDate(Date.now() + 60_000).toISOString()
      );
      this.removeSiblingAudioState(participant.identity);
      this.updateParticipants();
    });

    room.on(RoomEvent.TrackMuted, (publication: TrackPublication, participant: Participant) => {
      this.synchronizeAutomaticMicrophoneMute(room, publication, participant, true);
      this.updateParticipants();
    });

    room.on(RoomEvent.TrackUnmuted, (publication: TrackPublication, participant: Participant) => {
      this.synchronizeAutomaticMicrophoneMute(room, publication, participant, false);
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
        // Full reconnect creates a new Room. Keep incoming audio fail-closed
        // until the previously selected output has been applied to that Room.
        this.isOutputMuted = true;
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
      void this.handleMediaDevicesChanged(room);
    });

    room.on(RoomEvent.ActiveDeviceChanged, (kind: MediaDeviceKind, deviceId: string) => {
      if (this.room !== room) return;
      if (kind === 'audioinput') {
        this.selectedDeviceId = deviceId;
        if (this.explicitMediaDeviceOperationDepth === 0) {
          void this.serializeAudioInputOperation(() => this.reconcileMicrophoneProcessing(room));
        }
      } else if (kind === 'audiooutput') {
        this.selectedOutputDeviceId = deviceId;
      } else if (kind === 'videoinput') {
        this.selectedVideoDeviceId = deviceId;
      }
    });

    room.on(RoomEvent.MediaDevicesError, (err: Error) => {
      if (this.room !== room) return;
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
      (
        track: RemoteTrack,
        _publication: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        if (track.kind === Track.Kind.Audio) {
          // Apply the hard mute before play() so a late subscription cannot
          // leak its first frames while global or per-participant output is muted.
          const element = document.createElement('audio');
          element.muted =
            this.isOutputMuted || this.isParticipantLocallyMuted(participant.identity);
          track.attach(element);
          this.applyAllParticipantAudioVolumes();
        }
        this.updateParticipants();
        void this.refreshParticipantNetworkQuality();
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
    this.microphoneRouteReconcileInterval = setInterval(() => {
      void this.observeMicrophoneRoute(room);
    }, MICROPHONE_ROUTE_RECONCILE_INTERVAL_MS);
    void this.refreshParticipantNetworkQuality();
    this.participantNetworkQualityInterval = setInterval(() => {
      void this.refreshParticipantNetworkQuality();
    }, PARTICIPANT_NETWORK_QUALITY_INTERVAL_MS);
  }

  private async handleMediaDevicesChanged(room: Room): Promise<void> {
    if (this.room !== room) return;
    await this.refreshDevices();
    if (this.room !== room) return;
    if (this.microphoneRouteRecovering) {
      await this.attemptAutomaticMicrophoneRouteRecovery(room, true);
      return;
    }
    await this.serializeAudioInputOperation(() => this.reconcileMicrophoneProcessing(room));
  }

  private async observeMicrophoneRoute(room: Room): Promise<void> {
    if (this.room !== room) return;
    if (this.microphoneRouteRecovering) {
      await this.attemptAutomaticMicrophoneRouteRecovery(room);
      return;
    }
    if (this.isMuted) return;
    const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = publication?.track as LocalAudioTrack | undefined;
    if (!track) return;

    const settings = track.getSourceTrackSettings();
    const fingerprint = microphoneTrackSettingsFingerprint(settings);
    if (fingerprint === this.microphoneRouteFingerprint) return;
    this.microphoneRouteFingerprint = fingerprint;
    if (settings.deviceId) this.selectedDeviceId = settings.deviceId;
    await this.serializeAudioInputOperation(() => this.reconcileMicrophoneProcessing(room));
  }

  private beginMicrophoneRouteRecovery(): void {
    if (this.microphoneRouteRecovering) return;
    this.microphoneRouteRecovering = true;
    this.microphoneRouteRecoveryAttempts = 0;
    this.nextMicrophoneRouteRecoveryAt = Date.now() + MICROPHONE_ROUTE_AUTO_RECOVERY_DELAYS_MS[0];
  }

  private clearMicrophoneRouteRecovery(): void {
    this.microphoneRouteRecovering = false;
    this.microphoneRouteRecoveryAttempts = 0;
    this.nextMicrophoneRouteRecoveryAt = 0;
  }

  private async attemptAutomaticMicrophoneRouteRecovery(room: Room, force = false): Promise<void> {
    if (
      this.room !== room ||
      !this.microphoneRouteRecovering ||
      !this.isMuted ||
      (!force &&
        (this.microphoneRouteRecoveryAttempts >= MICROPHONE_ROUTE_AUTO_RECOVERY_DELAYS_MS.length ||
          Date.now() < this.nextMicrophoneRouteRecoveryAt))
    ) {
      return;
    }

    this.microphoneRouteRecoveryAttempts += 1;
    const nextDelayIndex = Math.min(
      this.microphoneRouteRecoveryAttempts,
      MICROPHONE_ROUTE_AUTO_RECOVERY_DELAYS_MS.length - 1
    );
    this.nextMicrophoneRouteRecoveryAt =
      Date.now() + MICROPHONE_ROUTE_AUTO_RECOVERY_DELAYS_MS[nextDelayIndex];
    this.isMicrophonePending = true;

    try {
      await this.serializeAudioInputOperation(async () => {
        if (this.room !== room || !this.microphoneRouteRecovering || !this.isMuted) return;
        await this.runExplicitMediaDeviceOperation(() =>
          this.enableMicrophoneWithRouteFallback(room)
        );
        if (this.room !== room) return;
        this.isMuted = false;
        this.clearMicrophoneRouteRecovery();
        this.updateParticipants();
        this.localAudioStateRevision += 1;
        this.broadcastLocalAudioState();
      });
    } catch {
      // Keep the explicit recovery notice visible. A devicechange signal may
      // force another attempt immediately; the interval otherwise stops after
      // the bounded schedule so revoked permissions cannot create a loop.
    } finally {
      if (this.room === room) this.isMicrophonePending = false;
    }
  }

  private synchronizeAutomaticMicrophoneMute(
    room: Room,
    publication: TrackPublication,
    participant: Participant,
    muted: boolean
  ): void {
    if (
      this.room !== room ||
      participant !== room.localParticipant ||
      publication.source !== Track.Source.Microphone ||
      this.explicitMediaDeviceOperationDepth > 0 ||
      this.isMuted === muted
    ) {
      return;
    }

    this.isMuted = muted;
    if (muted) {
      this.beginMicrophoneRouteRecovery();
    } else {
      this.clearMicrophoneRouteRecovery();
    }
    this.localAudioStateRevision += 1;
    this.broadcastLocalAudioState();
  }

  private async refreshParticipantNetworkQuality(): Promise<void> {
    const room = this.room;
    if (!room || this.participantNetworkQualityPollRoom === room) return;
    this.participantNetworkQualityPollRoom = room;

    try {
      const participants = Array.from(room.remoteParticipants.values());
      const activeIdentities = new SvelteSet(
        participants.map((participant) => participant.identity)
      );
      const samples = await Promise.all(
        participants.map(async (participant) => {
          const track = getParticipantNetworkTrack(participant);
          if (!track) return { identity: participant.identity, result: null };
          const result = await collectParticipantNetworkQuality(
            track,
            this.participantNetworkCounters.get(participant.identity) ?? null
          ).catch(() => null);
          return { identity: participant.identity, result };
        })
      );
      if (this.room !== room) return;

      const next = { ...this.participantNetworkQuality };
      for (const identity of Object.keys(next)) {
        if (!activeIdentities.has(identity)) delete next[identity];
      }
      for (const { identity, result } of samples) {
        if (!result) {
          const currentParticipant = room.remoteParticipants.get(identity);
          if (!currentParticipant || !getParticipantNetworkTrack(currentParticipant)) {
            delete next[identity];
            this.participantNetworkCounters.delete(identity);
          }
          continue;
        }
        next[identity] = result.quality;
        this.participantNetworkCounters.set(identity, result.counters);
      }
      this.participantNetworkQuality = next;
      this.updateParticipants();
    } finally {
      if (this.participantNetworkQualityPollRoom === room) {
        this.participantNetworkQualityPollRoom = null;
      }
    }
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

    const connectedParticipants = allParticipants.map((p) => {
      const md = parseParticipantMetadata(p.metadata);
      const isLocal = p === this.room!.localParticipant;
      const participantId = md.participantId ?? p.identity;
      const userId = md.userId ?? p.identity;
      const canControlAudio = this.isControllableSibling(p);
      const siblingAudioState = canControlAudio ? this.siblingAudioStates[p.identity] : undefined;
      const networkQuality = this.participantNetworkQuality[p.identity];
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
        networkHealth: networkQuality?.health ?? 'unknown',
        packetLossPercent: networkQuality?.packetLossPercent ?? null,
        jitterMs: networkQuality?.jitterMs ?? null,
        networkWarningMetric: networkQuality?.warningMetric ?? null,
        connectionState: 'connected' as const,
        interruptionDeadline: null,
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
    const connectedIdentities = new SvelteSet(
      connectedParticipants.map((participant) => participant.identity)
    );
    this.participants = [
      ...connectedParticipants,
      ...Array.from(this.interruptedParticipants.values()).filter(
        (participant) => !connectedIdentities.has(participant.identity)
      )
    ];
  }

  private markParticipantInterrupted(
    participantId: string,
    interruptionDeadline: string | null
  ): void {
    const existing =
      this.participants.find((participant) => participant.participantId === participantId) ??
      this.interruptedParticipants.get(participantId);
    if (!existing || existing.isLocal) return;
    const deadlineMillis = interruptionDeadline ? Date.parse(interruptionDeadline) : NaN;
    const effectiveDeadline = Number.isFinite(deadlineMillis)
      ? new SvelteDate(deadlineMillis).toISOString()
      : new SvelteDate(Date.now() + 60_000).toISOString();
    this.interruptedParticipants.set(existing.identity, {
      ...existing,
      connectionQuality: 'lost',
      networkHealth: 'poor',
      connectionState: 'interrupted',
      interruptionDeadline: effectiveDeadline,
      isCameraEnabled: false,
      videoTrack: null,
      isScreenShareEnabled: false,
      isScreenShareAudioEnabled: false,
      screenShareTrack: null,
      isMuted: true
    });
  }

  private clearInterruptedParticipant(participantId: string): void {
    let identity = participantId;
    for (const participant of this.interruptedParticipants.values()) {
      if (participant.participantId === participantId) {
        identity = participant.identity;
        break;
      }
    }
    this.interruptedParticipants.delete(identity);
  }

  private clearInterruptedParticipants(): void {
    this.interruptedParticipants.clear();
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
    const muted = this.isOutputMuted || this.isParticipantLocallyMuted(participant.identity);
    const volume = muted ? 0 : 1;
    const publications = participant.getTrackPublications();
    for (const source of [Track.Source.Microphone, Track.Source.ScreenShareAudio] as const) {
      // Safari on iOS does not provide reliable script-driven element volume.
      // Synchronize the actual media-element mute state before using the SDK's
      // volume control so the call output button is a hard mute on every OS.
      const track = publications.find((publication) => publication.track?.source === source)?.track;
      for (const element of track?.attachedElements ?? []) element.muted = muted;
      participant.setVolume(volume, source);
    }
  }

  /**
   * Update the non-reactive audio level cache. Called at ~60ms.
   * Writes to a plain Map (not $state) so Svelte's reactive graph is
   * completely untouched.
   */
  private updateAudioLevels(): void {
    if (!this.room) return;

    const allParticipants: Participant[] = [
      this.room.localParticipant,
      ...Array.from(this.room.remoteParticipants.values())
    ];

    for (const p of allParticipants) {
      this.audioLevelCache.set(p.identity, {
        isSpeaking: p.isSpeaking,
        audioLevel: p.audioLevel
      });
    }
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
    this.cameraDeviceSwitchInFlight = null;
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
    this.clearMicrophoneRouteRecovery();
    this.microphoneProcessing = {
      automaticGainControl: 'unavailable',
      echoCancellation: null,
      noiseSuppression: 'unavailable'
    };
    this.microphoneProcessingWarningShown = false;
    this.isCameraEnabled = false;
    this.isCameraPending = false;
    this.isScreenShareEnabled = false;
    this.isScreenSharePending = false;
    this.participants = [];
    this.clearInterruptedParticipants();
    this.locallyMutedParticipantIds = {};
    this.localAudioStateRevision = 0;
    this.siblingAudioStates = {};
    this.siblingAudioControlPending = {};
    this.siblingAudioControlInFlight.clear();
    this.siblingAudioStateRefreshInFlight.clear();
    this.explicitAudioInputDeviceId = null;
    this.explicitAudioOutputDeviceId = null;
    this.audioDevices = [];
    this.selectedDeviceId = null;
    this.lastScreenShareUnavailableToastAt = -SCREEN_SHARE_UNAVAILABLE_TOAST_MS;
    this.audioOutputDevices = [];
    this.selectedOutputDeviceId = null;
    this.isAudioOutputSelectionSupported = supportsAudioOutputSelection();
    this.videoDevices = [];
    this.selectedVideoDeviceId = null;
    this.audioLevelCache.clear();
    this.explicitMediaDeviceOperationDepth = 0;
    this.lastMediaDeviceToast = null;
  }

  private startRecoveryState(): void {
    if (!this.recoveryMediaState) {
      this.recoveryMediaState = {
        // Automatic route loss is not user intent. A full network reconnect
        // must still try to restore the microphone in that case.
        isMuted: this.microphoneRouteRecovering ? false : this.isMuted,
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
    this.mediaDeviceRefreshGeneration += 1;
    if (this.audioLevelInterval) {
      clearInterval(this.audioLevelInterval);
      this.audioLevelInterval = null;
    }
    if (this.participantNetworkQualityInterval) {
      clearInterval(this.participantNetworkQualityInterval);
      this.participantNetworkQualityInterval = null;
    }
    if (this.microphoneRouteReconcileInterval) {
      clearInterval(this.microphoneRouteReconcileInterval);
      this.microphoneRouteReconcileInterval = null;
    }
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
    this.participantNetworkQuality = {};
    this.participantNetworkCounters.clear();
    this.participantNetworkQualityPollRoom = null;
    this.microphoneRouteFingerprint = null;
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
    let target = this.recoveryTarget;
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
      let joinResult: VoiceCallJoinResult;
      try {
        joinResult = await this.#api.joinCall(
          target.roomId,
          this.clientInstanceId,
          'companion',
          target.callId
        );
      } catch (error) {
        if (!isExpiredCallRecoveryError(error) || !this.isCurrentRecovery(generation)) {
          throw error;
        }

        // The server eventually expires interrupted participants so abandoned
        // calls and their E2EE keys do not live forever. Preserve the user's
        // room-level call intent across that boundary by asking for a fresh,
        // server-authorized generation. Membership and device limits are still
        // enforced by JoinCall; the old call ID is never accepted or replayed.
        joinResult = await this.#api.joinCall(target.roomId, this.clientInstanceId, 'companion');
      }
      if (!this.isCurrentRecovery(generation)) return;
      if (joinResult.status !== 'joined') {
        throw new Error('call recovery was not admitted');
      }
      if (joinResult.participantId !== target.participantId) {
        throw new Error('call recovery participant does not match interrupted connection');
      }
      if (joinResult.callId !== target.callId) {
        target = { ...target, callId: joinResult.callId };
        this.recoveryTarget = target;
      }
      this.activeCallId = target.callId;
      this.activeParticipantId = joinResult.participantId;
      this.activeDeviceIndex = joinResult.deviceIndex;

      const tokenResponse = await this.#api.getCallToken(
        target.roomId,
        this.clientInstanceId,
        target.callId
      );
      if (!tokenResponse) throw new Error(m['voice.token_failed']());
      if (!this.isCurrentRecovery(generation)) return;
      if (
        tokenResponse.participantId !== joinResult.participantId ||
        tokenResponse.deviceIndex !== joinResult.deviceIndex ||
        tokenResponse.callId !== target.callId
      ) {
        throw new Error('call recovery token does not match interrupted call connection');
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
    this.isCameraEnabled = false;
    this.isScreenShareEnabled = false;

    // Apply the output choice before restoring audible playback. If the
    // selected sink disappeared, remain muted instead of leaking remote audio
    // through the system default device.
    if (media.selectedOutputDeviceId) {
      try {
        await this.runExplicitMediaDeviceOperation(() =>
          room.switchActiveDevice('audiooutput', media.selectedOutputDeviceId!)
        );
        if (!shouldContinue()) return;
        this.isOutputMuted = media.isOutputMuted;
      } catch (error) {
        if (!shouldContinue()) return;
        this.isOutputMuted = true;
        this.notifyMediaDeviceError(
          getVoiceCallMediaDeviceErrorMessage('speaker', error, 'switch')
        );
      }
    } else {
      this.isOutputMuted = media.isOutputMuted;
    }

    if (!media.isMuted) {
      try {
        await this.runExplicitMediaDeviceOperation(() =>
          this.enableMicrophoneWithRouteFallback(room, media.selectedDeviceId, shouldContinue)
        );
        if (!shouldContinue()) return;
        this.isMuted = false;
        this.clearMicrophoneRouteRecovery();
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
          enableUncroppedCamera(room, media.selectedVideoDeviceId)
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

  private serializeAudioInputOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.audioInputOperationQueue.then(operation, operation);
    this.audioInputOperationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private serializeAudioOutputOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.audioOutputOperationQueue.then(operation, operation);
    this.audioOutputOperationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
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

  return createFreshVoiceCallClientInstanceId();
}

function createFreshVoiceCallClientInstanceId(): string {
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

function getParticipantNetworkTrack(participant: Participant): Track | null {
  const preferredSources = [
    Track.Source.Microphone,
    Track.Source.Camera,
    Track.Source.ScreenShareAudio,
    Track.Source.ScreenShare
  ];
  for (const source of preferredSources) {
    for (const publication of participant.getTrackPublications()) {
      if (publication.track?.source === source && !publication.isMuted) return publication.track;
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

function isExpiredCallRecoveryError(error: unknown): boolean {
  return error instanceof ConnectError && error.code === Code.FailedPrecondition;
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
    degradationPreference: 'maintain-resolution',
    dtx: true,
    forceStereo: true,
    red: true,
    screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
    screenShareSimulcastLayers: [ScreenSharePresets.h360fps15, ScreenSharePresets.h720fps30],
    simulcast: true
  };
}

type BrowserVideoCaptureOptions = Omit<VideoCaptureOptions, 'resolution'> & {
  aspectRatio?: ConstrainDouble;
  resolution: {
    width: ConstrainULong;
    height: ConstrainULong;
    frameRate: ConstrainDouble;
  };
  resizeMode?: ConstrainDOMString;
};

function supportsUncroppedCameraCapture(): boolean {
  try {
    if (typeof navigator === 'undefined') return false;
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() as
      (MediaTrackSupportedConstraints & { resizeMode?: boolean }) | undefined;
    return supported?.resizeMode === true;
  } catch {
    return false;
  }
}

/**
 * Request a 4:3 720p-class stream instead of a 16:9 crop. Phone front cameras
 * commonly expose a wider natural field of view in 4:3; asking for 1280×720 can
 * make the browser/driver pick a tighter 16:9 mode. Exact `resizeMode: none`
 * prevents compliant browsers from cropping before LiveKit receives frames.
 */
function createUncroppedCameraCaptureOptions(
  deviceId: string | null = null,
  allowResizeMode = true
): VideoCaptureOptions {
  const options: BrowserVideoCaptureOptions = {
    aspectRatio: { ideal: 4 / 3 },
    resolution: {
      width: { ideal: 1280 },
      height: { ideal: 960 },
      frameRate: { ideal: 30, max: 30 }
    }
  };
  if (deviceId) options.deviceId = { exact: deviceId };
  if (allowResizeMode && supportsUncroppedCameraCapture()) {
    options.resizeMode = { exact: 'none' };
  }
  return options as unknown as VideoCaptureOptions;
}

function isResizeModeConstraintFailure(error: unknown): boolean {
  if (!(error instanceof DOMException) && !(error instanceof Error)) return false;
  const constraint = (error as Error & { constraint?: string }).constraint;
  return error.name === 'OverconstrainedError' && constraint === 'resizeMode';
}

function availableDeviceId(
  devices: MediaDeviceInfo[],
  selectedDeviceId: string | null,
  activeDeviceId?: string
): string | null {
  if (selectedDeviceId && devices.some((device) => device.deviceId === selectedDeviceId)) {
    return selectedDeviceId;
  }
  if (activeDeviceId && devices.some((device) => device.deviceId === activeDeviceId)) {
    return activeDeviceId;
  }
  return devices[0]?.deviceId ?? null;
}

function microphoneProcessingConstraints(
  preferences: MicrophoneProcessingPreferences
): Pick<
  AudioCaptureOptions,
  'autoGainControl' | 'echoCancellation' | 'noiseSuppression' | 'voiceIsolation'
> {
  return {
    autoGainControl: preferences.automaticGainControl,
    echoCancellation: preferences.echoCancellation,
    noiseSuppression: preferences.noiseSuppression,
    voiceIsolation: preferences.noiseSuppression
  };
}

function setMicrophoneContentHint(track: LocalAudioTrack): void {
  try {
    track.mediaStreamTrack.contentHint = 'speech';
  } catch {
    // Some older engines expose contentHint as a read-only compatibility stub.
  }
}

function microphoneTrackSettingsFingerprint(settings: MediaTrackSettings): string {
  return JSON.stringify([
    settings.deviceId ?? null,
    settings.groupId ?? null,
    settings.sampleRate ?? null,
    settings.channelCount ?? null,
    settings.autoGainControl ?? null,
    settings.echoCancellation ?? null,
    settings.noiseSuppression ?? null
  ]);
}

async function enableUncroppedCamera(room: Room, deviceId: string | null): Promise<void> {
  const options = createUncroppedCameraCaptureOptions(deviceId);
  try {
    await room.localParticipant.setCameraEnabled(true, options);
  } catch (error) {
    if (
      !('resizeMode' in (options as BrowserVideoCaptureOptions)) ||
      !isResizeModeConstraintFailure(error)
    ) {
      throw error;
    }
    // A browser can advertise the constraint while a particular camera driver
    // rejects it. Retry once with the same flexible resolution and no crop hint.
    await room.localParticipant.setCameraEnabled(
      true,
      createUncroppedCameraCaptureOptions(deviceId, false)
    );
  }
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

function supportsAudioOutputSelection(): boolean {
  return (
    typeof HTMLMediaElement !== 'undefined' &&
    typeof HTMLMediaElement.prototype.setSinkId === 'function'
  );
}

type MediaDevicesWithAudioOutputPicker = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};

function getAudioOutputPicker(): (() => Promise<MediaDeviceInfo>) | null {
  if (typeof navigator === 'undefined') return null;
  const mediaDevices = navigator.mediaDevices as MediaDevicesWithAudioOutputPicker | undefined;
  return typeof mediaDevices?.selectAudioOutput === 'function'
    ? mediaDevices.selectAudioOutput.bind(mediaDevices)
    : null;
}

function supportsAudioOutputPicker(): boolean {
  return getAudioOutputPicker() !== null;
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
    signal.includes('notsupported') ||
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

function shouldRetryMicrophoneWithAvailableRoute(error: unknown): boolean {
  const failure = classifyMediaDeviceFailure(error);
  return failure === 'not-found' || failure === 'constraint';
}

function redactSensitiveUrlParts(message: string): string {
  return message
    .replace(/access_token=([^&\s]+)/gi, 'access_token=<redacted>')
    .replace(/join_request=([^&\s]+)/gi, 'join_request=<redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<jwt-redacted>');
}
