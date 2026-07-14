import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceCallAPI } from '$lib/api-client/voiceCalls';

const { soundMocks, toastMocks } = vi.hoisted(() => ({
  soundMocks: {
    playCallSound: vi.fn(() => Promise.resolve())
  },
  toastMocks: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}));

vi.mock('$lib/audio/callSounds', () => ({
  playCallSound: soundMocks.playCallSound
}));

vi.mock('$lib/ui/toast', () => ({
  toast: toastMocks
}));

import {
  getVoiceCallMediaDeviceErrorMessage,
  getVoiceCallJoinErrorMessage,
  VoiceCallJoinError,
  VoiceCallState
} from './voiceCall.svelte';
import { AudioPresets, Room, ScreenSharePresets } from 'livekit-client';

const calls: string[] = [];
let lastRoomOptions: Record<string, unknown> | null = null;
let lastKeyProvider: { setKey: ReturnType<typeof vi.fn> } | null = null;
let lastRoom: {
  disconnect: ReturnType<typeof vi.fn>;
  startAudio: ReturnType<typeof vi.fn>;
  registerRpcMethod: ReturnType<typeof vi.fn>;
  unregisterRpcMethod: ReturnType<typeof vi.fn>;
  localParticipant: {
    setMicrophoneEnabled: ReturnType<typeof vi.fn>;
    setScreenShareEnabled: ReturnType<typeof vi.fn>;
    setCameraEnabled: ReturnType<typeof vi.fn>;
    performRpc: ReturnType<typeof vi.fn>;
  };
  switchActiveDevice: ReturnType<typeof vi.fn>;
} | null = null;
let connectFailure: Error | null = null;
let connectGate: { promise: Promise<void>; resolve: () => void } | null = null;
let connectObserver: (() => void) | null = null;
let microphoneGate: { promise: Promise<void>; resolve: () => void } | null = null;
let microphoneFailure: Error | null = null;
let microphoneProcessor: { name: string } | null = null;
let microphoneSetProcessor = vi.fn(async (processor: { name: string }) => {
  microphoneProcessor = processor;
});
let microphonePublication: {
  isMuted: boolean;
  track: {
    source: string;
    getProcessor: () => { name: string } | null;
    setProcessor: typeof microphoneSetProcessor;
  };
} | null = null;
let cameraGate: { promise: Promise<void>; resolve: () => void } | null = null;
let cameraFailure: Error | null = null;
let screenShareGate: { promise: Promise<void>; resolve: () => void } | null = null;
let screenShareFailure: Error | null = null;
let screenShareAudioAvailable = false;
let switchActiveDeviceFailure: Error | null = null;
let roomEventHandlers = new Map<string, (...args: unknown[]) => void>();
let roomRpcHandlers = new Map<
  string,
  (data: {
    requestId: string;
    callerIdentity: string;
    payload: string;
    responseTimeout: number;
  }) => Promise<string>
>();
let performRpcFailure: Error | null = null;
let performRpcResponder: (params: {
  destinationIdentity: string;
  method: string;
  payload: string;
  responseTimeout?: number;
}) => string = () =>
  JSON.stringify({ version: 1, microphoneMuted: false, outputMuted: false, revision: 0 });
let localTrackPublications: Array<{
  isMuted: boolean;
  track: {
    source: string;
    mediaStreamTrack?: MediaStreamTrack;
    getProcessor?: () => { name: string } | null;
    setProcessor?: typeof microphoneSetProcessor;
  };
}> = [];
let mockRemoteParticipants = new Map<string, unknown>();

vi.mock('livekit-client', () => {
  class MockExternalE2EEKeyProvider {
    setKey: ReturnType<typeof vi.fn>;

    constructor() {
      const setKey = vi.fn(async (key: string) => {
        calls.push(`setKey:${key}`);
      });
      this.setKey = setKey;
      lastKeyProvider = { setKey };
    }
  }

  class MockRoom {
    static getLocalDevices = vi.fn(async (kind?: MediaDeviceKind) => {
      if (kind === 'audioinput') {
        return [{ deviceId: 'audio-input-1', kind, label: 'Microphone' }];
      }
      if (kind === 'audiooutput') {
        return [{ deviceId: 'audio-output-1', kind, label: 'Speaker' }];
      }
      if (kind === 'videoinput') {
        return [{ deviceId: 'video-input-1', kind, label: 'Camera' }];
      }
      return [];
    });

    localParticipant = {
      setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
        calls.push('setMicrophoneEnabled');
        await microphoneGate?.promise;
        if (enabled && microphoneFailure) {
          roomEventHandlers.get('MediaDevicesError')?.(microphoneFailure, 'audioinput');
          throw microphoneFailure;
        }
        if (enabled && !microphonePublication) {
          microphonePublication = {
            isMuted: false,
            track: {
              source: 'microphone',
              getProcessor: () => microphoneProcessor,
              setProcessor: microphoneSetProcessor
            }
          };
        } else if (microphonePublication) {
          microphonePublication.isMuted = !enabled;
        }
        return microphonePublication;
      }),
      setCameraEnabled: vi.fn(async (enabled: boolean) => {
        calls.push(`setCameraEnabled:${enabled}`);
        await cameraGate?.promise;
        if (enabled && cameraFailure) {
          roomEventHandlers.get('MediaDevicesError')?.(cameraFailure, 'videoinput');
          throw cameraFailure;
        }
        localTrackPublications = localTrackPublications.filter(
          (pub) => pub.track.source !== 'camera'
        );
        if (enabled) {
          localTrackPublications.push({
            isMuted: false,
            track: { source: 'camera' }
          });
        }
      }),
      setScreenShareEnabled: vi.fn(async (enabled: boolean) => {
        calls.push(`setScreenShareEnabled:${enabled}`);
        await screenShareGate?.promise;
        if (screenShareFailure) {
          roomEventHandlers.get('MediaDevicesError')?.(screenShareFailure, 'videoinput');
          throw screenShareFailure;
        }
        localTrackPublications = localTrackPublications.filter(
          (pub) => pub.track.source !== 'screen_share' && pub.track.source !== 'screen_share_audio'
        );
        if (enabled) {
          localTrackPublications.push({
            isMuted: false,
            track: {
              source: 'screen_share',
              mediaStreamTrack: { contentHint: '' } as MediaStreamTrack
            }
          });
          if (screenShareAudioAvailable) {
            localTrackPublications.push({
              isMuted: false,
              track: { source: 'screen_share_audio' }
            });
          }
        }
      }),
      performRpc: vi.fn(
        async (params: {
          destinationIdentity: string;
          method: string;
          payload: string;
          responseTimeout?: number;
        }) => {
          if (performRpcFailure) throw performRpcFailure;
          return performRpcResponder(params);
        }
      ),
      getTrackPublication: vi.fn(),
      identity: 'device-1',
      name: 'Local User',
      metadata:
        '{"userId":"local-user","participantId":"device-1","deviceIndex":1,"login":"local-user"}',
      connectionQuality: 'excellent',
      isSpeaking: false,
      audioLevel: 0,
      getTrackPublications: vi.fn(() => localTrackPublications)
    };
    remoteParticipants = mockRemoteParticipants;

    constructor(options: Record<string, unknown>) {
      lastRoomOptions = options;
      lastRoom = {
        disconnect: this.disconnect,
        startAudio: this.startAudio,
        registerRpcMethod: this.registerRpcMethod,
        unregisterRpcMethod: this.unregisterRpcMethod,
        localParticipant: this.localParticipant,
        switchActiveDevice: this.switchActiveDevice
      };
    }

    on = vi.fn((event: string, handler: () => void) => {
      roomEventHandlers.set(event, handler);
      return this;
    });
    registerRpcMethod = vi.fn(
      (
        method: string,
        handler: (data: {
          requestId: string;
          callerIdentity: string;
          payload: string;
          responseTimeout: number;
        }) => Promise<string>
      ) => {
        roomRpcHandlers.set(method, handler);
      }
    );
    unregisterRpcMethod = vi.fn((method: string) => {
      roomRpcHandlers.delete(method);
    });
    switchActiveDevice = vi.fn(async (kind: MediaDeviceKind, deviceId: string) => {
      calls.push(`switchActiveDevice:${kind}:${deviceId}`);
      if (switchActiveDeviceFailure) {
        roomEventHandlers.get('MediaDevicesError')?.(switchActiveDeviceFailure, kind);
        throw switchActiveDeviceFailure;
      }
    });
    connect = vi.fn(async () => {
      calls.push('connect');
      connectObserver?.();
      await connectGate?.promise;
      if (connectFailure) {
        throw connectFailure;
      }
    });
    setE2EEEnabled = vi.fn(async (enabled: boolean) => {
      calls.push(`setE2EEEnabled:${enabled}`);
    });
    disconnect = vi.fn();
    startAudio = vi.fn(async () => undefined);
    removeAllListeners = vi.fn();
  }

  return {
    Room: MockRoom,
    ExternalE2EEKeyProvider: MockExternalE2EEKeyProvider,
    RpcError: class MockRpcError extends Error {
      constructor(
        readonly code: number,
        message: string,
        readonly data?: string
      ) {
        super(message);
      }
    },
    RoomEvent: {
      ParticipantConnected: 'ParticipantConnected',
      ParticipantDisconnected: 'ParticipantDisconnected',
      TrackMuted: 'TrackMuted',
      TrackUnmuted: 'TrackUnmuted',
      Disconnected: 'Disconnected',
      MediaDevicesChanged: 'MediaDevicesChanged',
      MediaDevicesError: 'MediaDevicesError',
      ConnectionQualityChanged: 'ConnectionQualityChanged',
      TrackSubscribed: 'TrackSubscribed',
      TrackUnsubscribed: 'TrackUnsubscribed',
      TrackPublished: 'TrackPublished',
      TrackUnpublished: 'TrackUnpublished',
      LocalTrackPublished: 'LocalTrackPublished',
      LocalTrackUnpublished: 'LocalTrackUnpublished'
    },
    Track: {
      Kind: { Audio: 'audio' },
      Source: {
        Microphone: 'microphone',
        Camera: 'camera',
        ScreenShare: 'screen_share',
        ScreenShareAudio: 'screen_share_audio'
      }
    },
    AudioPresets: {
      speech: { maxBitrate: 24_000 },
      musicHighQualityStereo: { maxBitrate: 128_000 }
    },
    ScreenSharePresets: {
      h360fps15: { encoding: { maxBitrate: 400_000, maxFramerate: 15 } },
      h720fps30: { encoding: { maxBitrate: 2_000_000, maxFramerate: 30 } },
      h1080fps30: { encoding: { maxBitrate: 5_000_000, maxFramerate: 30 } }
    },
    VideoPresets: { h720: { resolution: {} } }
  };
});

vi.mock('livekit-client/e2ee-worker?worker', () => ({
  default: class MockE2EEWorker {
    terminate = vi.fn();
  }
}));

function createVoiceCallClient(overrides: Partial<VoiceCallAPI> = {}): VoiceCallAPI {
  return {
    listActiveCalls: vi.fn(async () => []),
    getActiveCall: vi.fn(async () => null),
    batchGetActiveCalls: vi.fn(async () => []),
    listCallParticipants: vi.fn(async () => []),
    joinCall: vi.fn(async () => ({
      status: 'joined' as const,
      participantId: 'device-1',
      deviceIndex: 1
    })),
    getCallToken: vi.fn(async () => ({
      token: 'livekit-token',
      e2eeKey: 'shared-e2ee-key',
      callId: 'call-1',
      participantId: 'device-1',
      deviceIndex: 1
    })),
    leaveCall: vi.fn(async () => true),
    ...overrides
  };
}

function deferredVoid(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushPromises(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('VoiceCallState', () => {
  beforeEach(() => {
    calls.length = 0;
    lastRoomOptions = null;
    lastKeyProvider = null;
    lastRoom = null;
    connectFailure = null;
    connectGate = null;
    connectObserver = null;
    microphoneGate = null;
    microphoneFailure = null;
    microphoneProcessor = null;
    microphoneSetProcessor = vi.fn(async (processor: { name: string }) => {
      microphoneProcessor = processor;
    });
    microphonePublication = null;
    cameraGate = null;
    cameraFailure = null;
    screenShareGate = null;
    screenShareFailure = null;
    screenShareAudioAvailable = false;
    switchActiveDeviceFailure = null;
    roomEventHandlers = new Map();
    roomRpcHandlers = new Map();
    performRpcFailure = null;
    performRpcResponder = () =>
      JSON.stringify({ version: 1, microphoneMuted: false, outputMuted: false, revision: 0 });
    localTrackPublications = [];
    mockRemoteParticipants = new Map();
    vi.stubGlobal('Worker', class MockWorker {});
    vi.stubGlobal('TransformStream', class MockTransformStream {});
    vi.stubGlobal('ReadableStream', class MockReadableStream {});
    vi.stubGlobal('WritableStream', class MockWritableStream {});
    vi.stubGlobal('RTCRtpScriptTransform', class MockRTCRtpScriptTransform {});
    vi.stubGlobal('crypto', { subtle: {} });
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia: vi.fn() }
    });
    soundMocks.playCallSound.mockClear();
    toastMocks.error.mockClear();
    toastMocks.info.mockClear();
    toastMocks.success.mockClear();
    toastMocks.warning.mockClear();
    vi.mocked(Room.getLocalDevices).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets up LiveKit E2EE before connecting', async () => {
    const client = createVoiceCallClient();

    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    expect(client.joinCall).toHaveBeenCalledWith('R1', expect.any(String), 'ask');
    expect(lastKeyProvider?.setKey).toHaveBeenCalledWith('shared-e2ee-key');
    expect(lastRoomOptions?.encryption).toMatchObject({
      keyProvider: lastKeyProvider
    });
    expect(calls.indexOf('setKey:shared-e2ee-key')).toBeLessThan(
      calls.indexOf('setE2EEEnabled:true')
    );
    expect(calls.indexOf('setE2EEEnabled:true')).toBeLessThan(calls.indexOf('connect'));
  });

  it('rotates a client identity copied from another active tab', async () => {
    const copiedClientInstanceId = 'session_copied_from_another_tab';
    const leaseKey = `towk.voice-call.client-instance-owner:${copiedClientInstanceId}`;
    sessionStorage.setItem('towk.voice-call.client-instance-id', copiedClientInstanceId);
    localStorage.setItem(leaseKey, 'page_other_active_tab');
    const client = createVoiceCallClient();

    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    const usedClientInstanceId = vi.mocked(client.joinCall).mock.calls[0]?.[1];
    expect(usedClientInstanceId).toEqual(expect.any(String));
    expect(usedClientInstanceId).not.toBe(copiedClientInstanceId);
    expect(sessionStorage.getItem('towk.voice-call.client-instance-id')).toBe(usedClientInstanceId);

    localStorage.removeItem(leaseKey);
  });

  it('does not play a join sound without the participant join event', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(soundMocks.playCallSound).not.toHaveBeenCalled();
  });

  it('joins with microphone enabled but does not request camera permission while refreshing devices', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(lastRoom?.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(Room.getLocalDevices).toHaveBeenCalledWith('audioinput');
    expect(Room.getLocalDevices).toHaveBeenCalledWith('audiooutput');
    expect(Room.getLocalDevices).toHaveBeenCalledWith('videoinput', false);
    expect(Room.getLocalDevices).not.toHaveBeenCalledWith('videoinput');
    expect(Room.getLocalDevices).not.toHaveBeenCalledWith('videoinput', true);
  });

  it('returns a device choice without creating a LiveKit connection', async () => {
    const client = createVoiceCallClient({
      joinCall: vi.fn(async () => ({
        status: 'selection-required' as const,
        activeDeviceCount: 1,
        companionAllowed: true
      }))
    });
    const state = new VoiceCallState(client);

    await expect(state.join('wss://livekit.example.test', 'R1')).resolves.toEqual({
      status: 'selection-required',
      activeDeviceCount: 1,
      companionAllowed: true
    });

    expect(client.getCallToken).not.toHaveBeenCalled();
    expect(calls).not.toContain('connect');
    expect(state.connected).toBe(false);
    expect(state.connecting).toBe(false);
    expect(state.roomId).toBeNull();
  });

  it('joins a companion with microphone and all incoming call audio muted', async () => {
    const setVolume = vi.fn();
    mockRemoteParticipants.set('remote-device', {
      identity: 'remote-device',
      name: 'Remote User',
      metadata:
        '{"userId":"remote-user","participantId":"remote-device","deviceIndex":1,"login":"remote"}',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume,
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [{ isMuted: false, track: { source: 'microphone' } }])
    });
    const client = createVoiceCallClient({
      joinCall: vi.fn(async () => ({
        status: 'joined' as const,
        participantId: 'device-2',
        deviceIndex: 2
      })),
      getCallToken: vi.fn(async () => ({
        token: 'livekit-token',
        e2eeKey: 'shared-e2ee-key',
        callId: 'call-1',
        participantId: 'device-2',
        deviceIndex: 2
      }))
    });
    const state = new VoiceCallState(client);
    const observedAtConnect = vi.fn(() => {
      expect(state.isMuted).toBe(true);
      expect(state.isOutputMuted).toBe(true);
    });
    connectObserver = observedAtConnect;

    await state.join('wss://livekit.example.test', 'R1', 'companion');

    expect(observedAtConnect).toHaveBeenCalledOnce();
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true);
    expect(state.isMuted).toBe(true);
    expect(state.isOutputMuted).toBe(true);
    expect(setVolume).toHaveBeenCalledWith(0, 'microphone');
    expect(setVolume).toHaveBeenCalledWith(0, 'screen_share_audio');
    expect(state.callTransitionSoundDecision('join', 'R1', 'call-1', false)).toBe('skip');

    await state.toggleOutputMute();

    expect(lastRoom?.startAudio).toHaveBeenCalledOnce();
    expect(state.isOutputMuted).toBe(false);
    expect(setVolume).toHaveBeenCalledWith(1, 'microphone');
    expect(setVolume).toHaveBeenCalledWith(1, 'screen_share_audio');
  });

  it('keeps account identity separate from the LiveKit connection identity', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(state.participants[0]).toMatchObject({
      identity: 'device-1',
      participantId: 'device-1',
      userId: 'local-user',
      deviceIndex: 1,
      login: 'local-user'
    });
  });

  it('accepts idempotent microphone and output commands only from a sibling device', async () => {
    mockRemoteParticipants.set('device-2', {
      identity: 'device-2',
      name: 'Local User',
      metadata:
        '{"userId":"local-user","participantId":"device-2","deviceIndex":2,"login":"local-user"}',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume: vi.fn(),
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [])
    });
    mockRemoteParticipants.set('other-user-device', {
      identity: 'other-user-device',
      name: 'Other User',
      metadata:
        '{"userId":"other-user","participantId":"other-user-device","deviceIndex":1,"login":"other-user"}',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume: vi.fn(),
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [])
    });
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    const handler = roomRpcHandlers.get('towk.device-audio-control.v1');

    expect(handler).toBeDefined();
    await expect(
      handler?.({
        requestId: 'unauthorized',
        callerIdentity: 'other-user-device',
        payload: JSON.stringify({
          version: 1,
          action: 'set-state',
          target: 'microphone',
          muted: true
        }),
        responseTimeout: 8_000
      })
    ).rejects.toThrow('Not authorized');

    const firstResponse = await handler?.({
      requestId: 'mute-microphone',
      callerIdentity: 'device-2',
      payload: JSON.stringify({
        version: 1,
        action: 'set-state',
        target: 'microphone',
        muted: true
      }),
      responseTimeout: 8_000
    });
    const secondResponse = await handler?.({
      requestId: 'mute-microphone-again',
      callerIdentity: 'device-2',
      payload: JSON.stringify({
        version: 1,
        action: 'set-state',
        target: 'microphone',
        muted: true
      }),
      responseTimeout: 8_000
    });

    expect(JSON.parse(firstResponse ?? '{}')).toMatchObject({
      microphoneMuted: true,
      outputMuted: false
    });
    expect(secondResponse).toBe(firstResponse);
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(2);
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    await handler?.({
      requestId: 'mute-output',
      callerIdentity: 'device-2',
      payload: JSON.stringify({
        version: 1,
        action: 'set-state',
        target: 'output',
        muted: true
      }),
      responseTimeout: 8_000
    });
    const outputResponse = await handler?.({
      requestId: 'unmute-output',
      callerIdentity: 'device-2',
      payload: JSON.stringify({
        version: 1,
        action: 'set-state',
        target: 'output',
        muted: false
      }),
      responseTimeout: 8_000
    });

    expect(lastRoom?.startAudio).toHaveBeenCalledOnce();
    expect(JSON.parse(outputResponse ?? '{}')).toMatchObject({ outputMuted: false });
  });

  it('controls sibling audio through targeted RPC and fails closed for other accounts', async () => {
    mockRemoteParticipants.set('device-2', {
      identity: 'device-2',
      name: 'Local User',
      metadata:
        '{"userId":"local-user","participantId":"device-2","deviceIndex":2,"login":"local-user"}',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume: vi.fn(),
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [])
    });
    mockRemoteParticipants.set('other-user-device', {
      identity: 'other-user-device',
      name: 'Other User',
      metadata:
        '{"userId":"other-user","participantId":"other-user-device","deviceIndex":1,"login":"other-user"}',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume: vi.fn(),
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [])
    });
    performRpcResponder = ({ payload }) => {
      const request = JSON.parse(payload) as { action: string; target?: string; muted?: boolean };
      if (request.action === 'get-state') {
        return JSON.stringify({
          version: 1,
          microphoneMuted: true,
          outputMuted: true,
          revision: 4
        });
      }
      return JSON.stringify({
        version: 1,
        microphoneMuted: request.target === 'microphone' ? request.muted : true,
        outputMuted: request.target === 'output' ? request.muted : true,
        revision: 5
      });
    };
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    await flushPromises();
    vi.mocked(lastRoom!.localParticipant.performRpc).mockClear();

    await expect(
      state.setSiblingAudioMuted('other-user-device', 'microphone', false)
    ).resolves.toBe(false);
    expect(lastRoom?.localParticipant.performRpc).not.toHaveBeenCalled();

    await expect(state.setSiblingAudioMuted('device-2', 'microphone', false)).resolves.toBe(true);
    expect(lastRoom?.localParticipant.performRpc).toHaveBeenCalledWith({
      destinationIdentity: 'device-2',
      method: 'towk.device-audio-control.v1',
      payload: JSON.stringify({
        version: 1,
        action: 'set-state',
        target: 'microphone',
        muted: false
      }),
      responseTimeout: 8_000
    });
    expect(
      state.participants.find((participant) => participant.identity === 'device-2')
    ).toMatchObject({
      canControlAudio: true,
      siblingMicrophoneMuted: false,
      siblingOutputMuted: true
    });

    performRpcFailure = new Error('recipient disconnected');
    await expect(state.setSiblingAudioMuted('device-2', 'output', false)).resolves.toBe(false);
    expect(toastMocks.error).toHaveBeenCalledWith('Could not update the other device audio.');
  });

  it('ignores stale sibling state notifications that arrive out of order', async () => {
    mockRemoteParticipants.set('device-2', {
      identity: 'device-2',
      name: 'Local User',
      metadata:
        '{"userId":"local-user","participantId":"device-2","deviceIndex":2,"login":"local-user"}',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume: vi.fn(),
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [])
    });
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    const handler = roomRpcHandlers.get('towk.device-audio-control.v1');

    await handler?.({
      requestId: 'new-state',
      callerIdentity: 'device-2',
      payload: JSON.stringify({
        version: 1,
        action: 'state-changed',
        state: { version: 1, microphoneMuted: false, outputMuted: false, revision: 8 }
      }),
      responseTimeout: 8_000
    });
    await handler?.({
      requestId: 'stale-state',
      callerIdentity: 'device-2',
      payload: JSON.stringify({
        version: 1,
        action: 'state-changed',
        state: { version: 1, microphoneMuted: true, outputMuted: true, revision: 7 }
      }),
      responseTimeout: 8_000
    });

    expect(
      state.participants.find((participant) => participant.identity === 'device-2')
    ).toMatchObject({
      siblingMicrophoneMuted: false,
      siblingOutputMuted: false
    });
  });

  it('configures portable background noise suppression without automatic gain control', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(lastRoomOptions).toMatchObject({
      audioCaptureDefaults: {
        autoGainControl: false,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    expect(lastRoomOptions?.audioCaptureDefaults).not.toHaveProperty('processor');
    expect(microphoneSetProcessor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'towk-background-noise-suppression' })
    );
  });

  it('mutes the microphone if enhanced suppression cannot be attached', async () => {
    microphoneSetProcessor.mockRejectedValueOnce(new Error('processor unavailable'));
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenNthCalledWith(1, true);
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenNthCalledWith(2, false);
    expect(state.isMuted).toBe(true);
    expect(toastMocks.error).toHaveBeenCalledWith(
      'Could not start your microphone. You joined muted.'
    );
  });

  it('joins muted when microphone enable fails without enabling the camera', async () => {
    microphoneFailure = new Error('microphone unavailable');
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(lastRoom?.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(state.isMuted).toBe(true);
    expect(state.isInAnyCall).toBe(true);
    expect(Room.getLocalDevices).toHaveBeenCalledWith('videoinput', false);
    expect(toastMocks.error).toHaveBeenCalledWith(
      'Could not start your microphone. You joined muted.'
    );
    expect(toastMocks.error).toHaveBeenCalledOnce();
  });

  it('plays a deferred current-user join event after connecting successfully', async () => {
    connectGate = deferredVoid();
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    const join = state.join('wss://livekit.example.test', 'R1');
    await flushPromises();

    expect(state.callTransitionSoundDecision('join', 'R1', 'call-1', true)).toBe('defer');
    expect(soundMocks.playCallSound).not.toHaveBeenCalled();

    connectGate.resolve();
    await join;

    expect(soundMocks.playCallSound).toHaveBeenCalledOnce();
    expect(soundMocks.playCallSound).toHaveBeenCalledWith('join');
  });

  it('fails before recording join intent when encrypted calls are unsupported', async () => {
    vi.stubGlobal('RTCRtpScriptTransform', undefined);
    vi.stubGlobal('RTCRtpSender', class MockRTCRtpSender {});

    const client = createVoiceCallClient();

    const state = new VoiceCallState(client);

    await expect(state.join('wss://livekit.example.test', 'R1')).rejects.toThrow(
      VoiceCallJoinError
    );

    expect(client.joinCall).not.toHaveBeenCalled();
    expect(client.getCallToken).not.toHaveBeenCalled();
    expect(state.isInAnyCall).toBe(false);
    expect(soundMocks.playCallSound).not.toHaveBeenCalled();
  });

  it('maps signaling failures to an actionable join error message', () => {
    const error = new Error('could not establish signal connection: Abort handler called');

    expect(getVoiceCallJoinErrorMessage(error)).toBe(
      'Could not reach the voice server. Check your network and try again.'
    );
  });

  it('coalesces duplicate joins for the same room while connecting', async () => {
    const client = createVoiceCallClient();

    const state = new VoiceCallState(client);
    await Promise.all([
      state.join('wss://livekit.example.test', 'R1'),
      state.join('wss://livekit.example.test', 'R1')
    ]);

    expect(client.joinCall).toHaveBeenCalledTimes(1);
    expect(client.getCallToken).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call === 'connect')).toHaveLength(1);
  });

  it('coalesces duplicate leave actions while the leave intent is in flight', async () => {
    const client = createVoiceCallClient();

    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    soundMocks.playCallSound.mockClear();

    await Promise.all([state.leave(), state.leave()]);

    expect(client.joinCall).toHaveBeenCalledTimes(1);
    expect(client.leaveCall).toHaveBeenCalledTimes(1);
    expect(lastRoom?.disconnect).toHaveBeenCalledOnce();
    expect(state.isInAnyCall).toBe(false);
    expect(soundMocks.playCallSound).not.toHaveBeenCalled();
  });

  it('records a compensating leave when LiveKit connect fails after join intent', async () => {
    connectFailure = new Error('connect failed');
    const client = createVoiceCallClient();

    const state = new VoiceCallState(client);

    await expect(state.join('wss://livekit.example.test', 'R1')).rejects.toThrow('connect failed');

    expect(client.joinCall).toHaveBeenCalledTimes(1);
    expect(client.leaveCall).toHaveBeenCalledWith('R1', expect.any(String));
    expect(state.isInAnyCall).toBe(false);
    expect(soundMocks.playCallSound).not.toHaveBeenCalled();
  });

  it('disconnects without recording leave when the backend ends the current call', async () => {
    const client = createVoiceCallClient();

    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    soundMocks.playCallSound.mockClear();

    state.handleCallEndedEvent('R1', 'old-call');
    expect(lastRoom?.disconnect).not.toHaveBeenCalled();
    expect(state.isInAnyCall).toBe(true);
    expect(soundMocks.playCallSound).not.toHaveBeenCalled();

    state.handleCallEndedEvent('R1', 'call-1');

    expect(lastRoom?.disconnect).toHaveBeenCalledOnce();
    expect(client.joinCall).toHaveBeenCalledTimes(1);
    expect(client.leaveCall).not.toHaveBeenCalled();
    expect(state.isInAnyCall).toBe(false);
    expect(soundMocks.playCallSound).not.toHaveBeenCalled();
  });

  it('disconnects only for the current user participant leave event', async () => {
    const client = createVoiceCallClient();

    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    soundMocks.playCallSound.mockClear();

    state.handleParticipantLeftEvent('R1', 'call-1', 'remote-device', 'remote-user', 'local-user');
    expect(lastRoom?.disconnect).not.toHaveBeenCalled();
    expect(state.isInAnyCall).toBe(true);
    expect(soundMocks.playCallSound).not.toHaveBeenCalled();

    state.handleParticipantLeftEvent('R1', 'old-call', 'device-1', 'local-user', 'local-user');
    expect(lastRoom?.disconnect).not.toHaveBeenCalled();
    expect(state.isInAnyCall).toBe(true);
    expect(soundMocks.playCallSound).not.toHaveBeenCalled();

    state.handleParticipantLeftEvent('R1', 'call-1', 'device-2', 'local-user', 'local-user');
    expect(lastRoom?.disconnect).not.toHaveBeenCalled();
    expect(state.isInAnyCall).toBe(true);

    state.handleParticipantLeftEvent('R1', 'call-1', 'device-1', 'local-user', 'local-user');
    expect(lastRoom?.disconnect).toHaveBeenCalledOnce();
    expect(client.joinCall).toHaveBeenCalledTimes(1);
    expect(client.leaveCall).not.toHaveBeenCalled();
    expect(state.isInAnyCall).toBe(false);
    expect(soundMocks.playCallSound).not.toHaveBeenCalled();
    expect(state.callTransitionSoundDecision('leave', 'R1', 'call-1', true)).toBe('play');
  });

  it('matches only the currently connected call', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    expect(state.matchesActiveCall('R1', 'call-1')).toBe(true);
    expect(state.matchesActiveCall('R1', 'old-call')).toBe(false);
    expect(state.matchesActiveCall('R2', 'call-1')).toBe(false);
    expect(state.matchesActiveCall('R1', null)).toBe(false);
  });

  it('publishes adaptive 30 FPS screen sharing and requests browser-tab audio', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    await state.toggleScreenShare();

    expect(lastRoom?.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      {
        audio: true,
        video: { displaySurface: 'browser' },
        contentHint: 'motion',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: 'exclude'
      },
      {
        audioPreset: AudioPresets.musicHighQualityStereo,
        degradationPreference: 'maintain-framerate',
        dtx: false,
        forceStereo: true,
        red: true,
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
        screenShareSimulcastLayers: [ScreenSharePresets.h360fps15, ScreenSharePresets.h720fps30],
        simulcast: true
      }
    );
    expect(state.isScreenShareEnabled).toBe(true);
    expect(state.participants[0]).toMatchObject({
      identity: 'device-1',
      isCameraEnabled: false,
      isScreenShareEnabled: true
    });
    expect(state.participants[0].videoTrack).toBeNull();
    expect(state.participants[0].screenShareTrack).toMatchObject(localTrackPublications[0].track);
    expect(state.participants[0].isScreenShareAudioEnabled).toBe(false);
    expect(toastMocks.info).toHaveBeenCalledWith(
      'Screen sharing started without audio. To share tab audio, use Chrome or Edge on desktop, choose a browser tab, and enable “Share tab audio”.'
    );

    await state.toggleScreenShare();

    expect(lastRoom?.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
    expect(state.isScreenShareEnabled).toBe(false);
    expect(state.participants[0].screenShareTrack).toBeNull();
  });

  it('marks and confirms shared browser-tab audio when the browser supplies it', async () => {
    screenShareAudioAvailable = true;
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    await state.toggleScreenShare();

    expect(state.participants[0].isScreenShareAudioEnabled).toBe(true);
    expect(toastMocks.success).toHaveBeenCalledWith('Tab audio is being shared.');
    expect(toastMocks.info).not.toHaveBeenCalled();

    await state.toggleScreenShare();

    expect(state.participants[0].isScreenShareAudioEnabled).toBe(false);
    expect(lastRoom?.localParticipant.setScreenShareEnabled).toHaveBeenLastCalledWith(false);
  });

  it('attaches and detaches remote screen-share audio tracks', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    const screenAudioTrack = {
      kind: 'audio',
      source: 'screen_share_audio',
      attach: vi.fn(),
      detach: vi.fn()
    };

    roomEventHandlers.get('TrackSubscribed')?.(screenAudioTrack, {});
    expect(screenAudioTrack.attach).toHaveBeenCalledOnce();

    roomEventHandlers.get('TrackUnsubscribed')?.(screenAudioTrack, {});
    expect(screenAudioTrack.detach).toHaveBeenCalledOnce();
  });

  it('explains unsupported mobile or browser capture without calling LiveKit', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    vi.stubGlobal('navigator', { mediaDevices: {} });

    expect(state.canShareScreen).toBe(false);
    await state.toggleScreenShare();

    expect(lastRoom?.localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
    expect(state.isScreenShareEnabled).toBe(false);
    expect(toastMocks.warning).toHaveBeenCalledWith(
      'This browser or device does not expose screen sharing to web apps.'
    );
  });

  it('still stops an active share if the browser capability disappears', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    await state.toggleScreenShare();
    vi.stubGlobal('navigator', { mediaDevices: {} });
    toastMocks.warning.mockClear();

    await state.toggleScreenShare();

    expect(lastRoom?.localParticipant.setScreenShareEnabled).toHaveBeenLastCalledWith(false);
    expect(state.isScreenShareEnabled).toBe(false);
    expect(toastMocks.warning).not.toHaveBeenCalled();
  });

  it('keeps microphone pending until LiveKit applies the toggle', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    microphoneGate = deferredVoid();

    const toggle = state.toggleMute();
    await flushPromises();

    expect(state.isMicrophonePending).toBe(true);
    expect(state.isMuted).toBe(false);
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);

    microphoneGate.resolve();
    await toggle;

    expect(state.isMicrophonePending).toBe(false);
    expect(state.isMuted).toBe(true);
  });

  it('keeps the same noise processor across microphone mute and unmute', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    await state.toggleMute();
    await state.toggleMute();

    expect(state.isMuted).toBe(false);
    expect(microphoneSetProcessor).toHaveBeenCalledOnce();
  });

  it('keeps camera pending until LiveKit applies the toggle', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    cameraGate = deferredVoid();

    const toggle = state.toggleCamera();
    await flushPromises();

    expect(state.isCameraPending).toBe(true);
    expect(state.isCameraEnabled).toBe(false);
    expect(lastRoom?.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(true);

    cameraGate.resolve();
    await toggle;

    expect(state.isCameraPending).toBe(false);
    expect(state.isCameraEnabled).toBe(true);
  });

  it('refreshes devices without camera permission until camera is explicitly enabled', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    vi.mocked(Room.getLocalDevices).mockClear();

    await state.refreshDevices();
    roomEventHandlers.get('MediaDevicesChanged')?.();
    await flushPromises();

    expect(Room.getLocalDevices).toHaveBeenCalledWith('videoinput', false);
    expect(Room.getLocalDevices).not.toHaveBeenCalledWith('videoinput', true);

    vi.mocked(Room.getLocalDevices).mockClear();
    await state.toggleCamera();

    expect(lastRoom?.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(Room.getLocalDevices).toHaveBeenCalledWith('videoinput', true);
  });

  it('keeps screen share pending until LiveKit applies the toggle', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    screenShareGate = deferredVoid();

    const toggle = state.toggleScreenShare();
    const duplicateToggle = state.toggleScreenShare();
    await flushPromises();

    expect(state.isScreenSharePending).toBe(true);
    expect(state.isScreenShareEnabled).toBe(false);
    expect(lastRoom?.localParticipant.setScreenShareEnabled).toHaveBeenCalledOnce();
    expect(lastRoom?.localParticipant.setScreenShareEnabled).toHaveBeenLastCalledWith(
      true,
      expect.any(Object),
      expect.any(Object)
    );

    screenShareGate.resolve();
    await Promise.all([toggle, duplicateToggle]);

    expect(state.isScreenSharePending).toBe(false);
    expect(state.isScreenShareEnabled).toBe(true);
  });

  it('keeps the call connected when screen capture fails', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    screenShareFailure = new Error('permission denied');

    await state.toggleScreenShare();

    expect(lastRoom?.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.any(Object),
      expect.any(Object)
    );
    expect(state.isScreenShareEnabled).toBe(false);
    expect(state.isInAnyCall).toBe(true);
    expect(state.roomId).toBe('R1');
    expect(toastMocks.error).toHaveBeenCalledWith('Screen sharing was canceled or blocked.');
    expect(toastMocks.error).toHaveBeenCalledOnce();
  });

  it('reports permission failures when enabling media devices', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    toastMocks.error.mockClear();

    microphoneFailure = Object.assign(new Error('Permission denied'), {
      name: 'NotAllowedError'
    });
    await state.toggleMute();
    expect(state.isMuted).toBe(true);
    expect(toastMocks.error).not.toHaveBeenCalled();

    await state.toggleMute();
    expect(state.isMuted).toBe(true);
    expect(toastMocks.error).toHaveBeenCalledWith(
      'Microphone access was denied. Check your browser permissions and try again.'
    );
    expect(toastMocks.error).toHaveBeenCalledOnce();

    cameraFailure = Object.assign(new Error('Device unavailable'), {
      name: 'NotReadableError'
    });
    toastMocks.error.mockClear();
    await state.toggleCamera();
    expect(state.isCameraEnabled).toBe(false);
    expect(toastMocks.error).toHaveBeenCalledWith('Your camera is already in use by another app.');
    expect(toastMocks.error).toHaveBeenCalledOnce();
  });

  it('reports LiveKit media device errors without disconnecting', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    toastMocks.error.mockClear();

    roomEventHandlers.get('MediaDevicesError')?.();

    expect(toastMocks.error).toHaveBeenCalledWith('Could not access a media device.');
    expect(toastMocks.error).toHaveBeenCalledOnce();
    expect(state.isInAnyCall).toBe(true);
  });

  it('keeps selected devices unchanged when device switching fails', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    toastMocks.error.mockClear();
    switchActiveDeviceFailure = Object.assign(new Error('device not found'), {
      name: 'NotFoundError'
    });

    await state.setAudioDevice('missing-mic');
    await state.setAudioOutputDevice('missing-speaker');
    await state.setVideoDevice('missing-camera');

    expect(state.selectedDeviceId).toBe('audio-input-1');
    expect(state.selectedOutputDeviceId).toBe('audio-output-1');
    expect(state.selectedVideoDeviceId).toBe('video-input-1');
    expect(toastMocks.error).toHaveBeenCalledWith(
      'No microphone was found. Choose another input device and try again.'
    );
    expect(toastMocks.error).toHaveBeenCalledWith(
      'Could not switch speakers. This browser or device may not support speaker selection.'
    );
    expect(toastMocks.error).toHaveBeenCalledWith(
      'No camera was found. Choose another camera and try again.'
    );
    expect(toastMocks.error).toHaveBeenCalledTimes(3);
    expect(toastMocks.error).not.toHaveBeenCalledWith('Could not access a media device.');
  });

  it('maps media device failures to specific user-facing messages', () => {
    expect(
      getVoiceCallMediaDeviceErrorMessage(
        'screen',
        new Error('getDisplayMedia not supported'),
        'enable'
      )
    ).toBe('This browser or device does not expose screen sharing to web apps.');
    expect(
      getVoiceCallMediaDeviceErrorMessage(
        'screen',
        Object.assign(new Error('permission denied'), { name: 'NotAllowedError' }),
        'enable'
      )
    ).toBe('Screen sharing was canceled or blocked.');
    expect(
      getVoiceCallMediaDeviceErrorMessage(
        'microphone',
        Object.assign(new Error('already in use'), { name: 'NotReadableError' }),
        'join'
      )
    ).toBe('Your microphone is already in use by another app. You joined muted.');
  });

  it('keeps camera and screen-share tracks separate', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    await state.toggleCamera();
    const cameraTrack = localTrackPublications.find((pub) => pub.track.source === 'camera')!.track;
    await state.toggleScreenShare();
    const screenShareTrack = localTrackPublications.find(
      (pub) => pub.track.source === 'screen_share'
    )!.track;

    expect(state.participants[0]).toMatchObject({
      isCameraEnabled: true,
      isScreenShareEnabled: true
    });
    expect(state.participants[0].videoTrack).toMatchObject(cameraTrack);
    expect(state.participants[0].screenShareTrack).toMatchObject(screenShareTrack);
    expect(cameraTrack).not.toBe(screenShareTrack);
  });

  it('clears screen-share state on leave', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    await state.toggleScreenShare();

    await state.leave();

    expect(state.isScreenShareEnabled).toBe(false);
    expect(state.participants).toEqual([]);
  });

  it('updates screen-share state when LiveKit reports local unpublish', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    await state.toggleScreenShare();
    expect(state.isScreenShareEnabled).toBe(true);

    localTrackPublications = [];
    roomEventHandlers.get('LocalTrackUnpublished')?.();

    expect(state.isScreenShareEnabled).toBe(false);
    expect(state.participants[0].screenShareTrack).toBeNull();
  });

  it('locally mutes and unmutes remote participant audio for the current session only', async () => {
    const setVolume = vi.fn();
    mockRemoteParticipants.set('remote-user', {
      identity: 'remote-user',
      name: 'Remote User',
      metadata: '',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume,
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [{ isMuted: false, track: { source: 'microphone' } }])
    });
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');
    setVolume.mockClear();

    state.toggleParticipantLocalMute('remote-user');

    expect(state.isParticipantLocallyMuted('remote-user')).toBe(true);
    expect(setVolume).toHaveBeenCalledWith(0, 'microphone');
    expect(setVolume).toHaveBeenCalledWith(0, 'screen_share_audio');
    expect(state.participants.find((p) => p.identity === 'remote-user')).toMatchObject({
      isLocallyMuted: true
    });

    state.toggleParticipantLocalMute('remote-user');

    expect(state.isParticipantLocallyMuted('remote-user')).toBe(false);
    expect(setVolume).toHaveBeenCalledWith(1, 'microphone');
    expect(setVolume).toHaveBeenCalledWith(1, 'screen_share_audio');

    state.toggleParticipantLocalMute('device-1');
    expect(state.isParticipantLocallyMuted('device-1')).toBe(false);

    state.toggleParticipantLocalMute('remote-user');
    expect(state.isParticipantLocallyMuted('remote-user')).toBe(true);

    await state.leave();

    expect(state.isParticipantLocallyMuted('remote-user')).toBe(false);
    expect(state.locallyMutedParticipantIds).toEqual({});
  });
});
