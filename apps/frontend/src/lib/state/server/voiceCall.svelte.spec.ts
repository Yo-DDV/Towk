import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  VoiceCallAPI,
  VoiceCallJoinMode,
  VoiceCallJoinResult
} from '$lib/api-client/voiceCalls';
import type { CoordinateVoiceCallJoin } from './voiceCallCoordinator';

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
  PersistentReconnectPolicy,
  VoiceCallJoinError,
  VoiceCallState
} from './voiceCall.svelte';
import { Code, ConnectError } from '@connectrpc/connect';
import {
  AudioPresets,
  DisconnectReason,
  Room,
  ScreenSharePresets,
  type RoomOptions
} from 'livekit-client';

const calls: string[] = [];
let lastRoomOptions: RoomOptions | null = null;
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
  getActiveDevice: ReturnType<typeof vi.fn>;
  switchActiveDevice: ReturnType<typeof vi.fn>;
} | null = null;
let connectFailure: Error | null = null;
let connectGate: { promise: Promise<void>; resolve: () => void } | null = null;
let connectObserver: (() => void) | null = null;
let microphoneGate: { promise: Promise<void>; resolve: () => void } | null = null;
let microphoneFailure: Error | null = null;
let microphoneFailuresRemaining: number | null = null;
let microphoneProcessor: { name: string } | null = null;
let microphoneTrackSettings: MediaTrackSettings;
let microphoneSetProcessor = vi.fn(async (processor: { name: string }) => {
  microphoneProcessor = processor;
  Object.assign(processor, {
    audioContext: { sampleRate: 48_000 },
    automaticGainControlMode: 'native',
    echoCancellation: true,
    nativeNoiseSuppression: true,
    suppressionMode: 'rnnoise'
  });
});
let microphoneStopProcessor = vi.fn(async () => {
  microphoneProcessor = null;
});
let microphoneRestartTrack = vi.fn(async () => undefined);
let microphoneApplyConstraints = vi.fn(async (constraints: MediaTrackConstraints) => {
  microphoneTrackSettings = {
    ...microphoneTrackSettings,
    autoGainControl: constraints.autoGainControl as boolean | undefined,
    echoCancellation: constraints.echoCancellation as boolean | undefined,
    noiseSuppression: constraints.noiseSuppression as boolean | undefined
  };
});
let microphonePublication: {
  isMuted: boolean;
  track: {
    source: string;
    getProcessor: () => { name: string } | null;
    getSourceTrackSettings: () => MediaTrackSettings;
    mediaStreamTrack: { getSettings: () => MediaTrackSettings };
    setProcessor: typeof microphoneSetProcessor;
    stopProcessor: typeof microphoneStopProcessor;
    restartTrack: typeof microphoneRestartTrack;
    applyConstraints: typeof microphoneApplyConstraints;
  };
} | null = null;
let cameraGate: { promise: Promise<void>; resolve: () => void } | null = null;
let cameraFailure: Error | null = null;
let screenShareGate: { promise: Promise<void>; resolve: () => void } | null = null;
let screenShareFailure: Error | null = null;
let screenShareAudioAvailable = false;
let switchActiveDeviceGate: { promise: Promise<void>; resolve: () => void } | null = null;
let switchActiveDeviceFailure: Error | null = null;
let activeDeviceIds = new Map<MediaDeviceKind, string>();
let mockAudioInputDevices: MediaDeviceInfo[] = [];
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
let originalSetSinkIdDescriptor: PropertyDescriptor | undefined;

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
        return mockAudioInputDevices;
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
        if (
          enabled &&
          microphoneFailure &&
          (microphoneFailuresRemaining === null || microphoneFailuresRemaining > 0)
        ) {
          if (microphoneFailuresRemaining !== null) microphoneFailuresRemaining -= 1;
          roomEventHandlers.get('MediaDevicesError')?.(microphoneFailure, 'audioinput');
          throw microphoneFailure;
        }
        if (enabled && !microphonePublication) {
          microphonePublication = {
            isMuted: false,
            track: {
              source: 'microphone',
              getProcessor: () => microphoneProcessor,
              getSourceTrackSettings: () => microphoneTrackSettings,
              mediaStreamTrack: {
                getSettings: () => microphoneTrackSettings
              },
              setProcessor: microphoneSetProcessor,
              stopProcessor: microphoneStopProcessor,
              restartTrack: microphoneRestartTrack,
              applyConstraints: microphoneApplyConstraints
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
      getTrackPublication: vi.fn((source: string) =>
        source === 'microphone' ? microphonePublication : undefined
      ),
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
    getActiveDevice = vi.fn((kind: MediaDeviceKind) => activeDeviceIds.get(kind));

    constructor(options: RoomOptions) {
      lastRoomOptions = options;
      lastRoom = {
        disconnect: this.disconnect,
        startAudio: this.startAudio,
        registerRpcMethod: this.registerRpcMethod,
        unregisterRpcMethod: this.unregisterRpcMethod,
        localParticipant: this.localParticipant,
        getActiveDevice: this.getActiveDevice,
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
      await switchActiveDeviceGate?.promise;
      if (switchActiveDeviceFailure) {
        roomEventHandlers.get('MediaDevicesError')?.(switchActiveDeviceFailure, kind);
        throw switchActiveDeviceFailure;
      }
      activeDeviceIds.set(kind, deviceId);
    });
    connect = vi.fn(async () => {
      calls.push('connect');
      connectObserver?.();
      await connectGate?.promise;
      if (connectFailure) {
        throw connectFailure;
      }
    });
    state = 'connected';
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
      ParticipantMetadataChanged: 'ParticipantMetadataChanged',
      ParticipantDisconnected: 'ParticipantDisconnected',
      TrackMuted: 'TrackMuted',
      TrackUnmuted: 'TrackUnmuted',
      Reconnecting: 'Reconnecting',
      SignalReconnecting: 'SignalReconnecting',
      Reconnected: 'Reconnected',
      Disconnected: 'Disconnected',
      MediaDevicesChanged: 'MediaDevicesChanged',
      ActiveDeviceChanged: 'ActiveDeviceChanged',
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
      musicStereo: { maxBitrate: 64_000 },
      musicHighQualityStereo: { maxBitrate: 128_000 }
    },
    ScreenSharePresets: {
      h360fps15: { encoding: { maxBitrate: 400_000, maxFramerate: 15 } },
      h720fps30: { encoding: { maxBitrate: 2_000_000, maxFramerate: 30 } },
      h1080fps30: { encoding: { maxBitrate: 5_000_000, maxFramerate: 30 } }
    },
    ConnectionState: {
      Disconnected: 'disconnected',
      Connecting: 'connecting',
      Connected: 'connected',
      Reconnecting: 'reconnecting',
      SignalReconnecting: 'signalReconnecting'
    },
    VideoQuality: { HIGH: 2 },
    VideoPresets: { h720: { resolution: { width: 1280, height: 720 } } },
    VideoPreset: class MockVideoPreset {
      encoding: { maxBitrate: number; maxFramerate: number; priority?: RTCPriorityType };

      constructor(
        public width: number,
        public height: number,
        maxBitrate: number,
        maxFramerate: number,
        priority?: RTCPriorityType
      ) {
        this.encoding = { maxBitrate, maxFramerate, priority };
      }
    },
    DisconnectReason: {
      UNKNOWN_REASON: 0,
      CLIENT_INITIATED: 1,
      DUPLICATE_IDENTITY: 2,
      SERVER_SHUTDOWN: 3,
      PARTICIPANT_REMOVED: 4,
      ROOM_DELETED: 5,
      STATE_MISMATCH: 6,
      JOIN_FAILURE: 7,
      MIGRATION: 8,
      SIGNAL_CLOSE: 9,
      ROOM_CLOSED: 10,
      CONNECTION_TIMEOUT: 14,
      MEDIA_FAILURE: 15
    }
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
    joinCall: vi.fn(async (_roomId, _clientInstanceId, _mode, expectedCallId) => ({
      status: 'joined' as const,
      callId: expectedCallId ?? 'call-1',
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

function deferredValue<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
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
    microphoneFailuresRemaining = null;
    microphoneProcessor = null;
    microphoneTrackSettings = {
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48_000
    };
    microphoneSetProcessor = vi.fn(async (processor: { name: string }) => {
      microphoneProcessor = processor;
      Object.assign(processor, {
        audioContext: { sampleRate: 48_000 },
        automaticGainControlMode:
          microphoneTrackSettings.autoGainControl === true ? 'native' : 'towk',
        echoCancellation: microphoneTrackSettings.echoCancellation,
        nativeNoiseSuppression: microphoneTrackSettings.noiseSuppression === true,
        suppressionMode: 'rnnoise'
      });
    });
    microphoneStopProcessor = vi.fn(async () => {
      microphoneProcessor = null;
    });
    microphoneRestartTrack = vi.fn(async () => undefined);
    microphoneApplyConstraints = vi.fn(async (constraints: MediaTrackConstraints) => {
      microphoneTrackSettings = {
        ...microphoneTrackSettings,
        autoGainControl: constraints.autoGainControl as boolean | undefined,
        echoCancellation: constraints.echoCancellation as boolean | undefined,
        noiseSuppression: constraints.noiseSuppression as boolean | undefined
      };
    });
    microphonePublication = null;
    cameraGate = null;
    cameraFailure = null;
    screenShareGate = null;
    screenShareFailure = null;
    screenShareAudioAvailable = false;
    switchActiveDeviceGate = null;
    switchActiveDeviceFailure = null;
    activeDeviceIds = new Map([
      ['audioinput', 'audio-input-1'],
      ['audiooutput', 'audio-output-1'],
      ['videoinput', 'video-input-1']
    ]);
    mockAudioInputDevices = [
      { deviceId: 'audio-input-1', kind: 'audioinput', label: 'Microphone' } as MediaDeviceInfo
    ];
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
    originalSetSinkIdDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'setSinkId'
    );
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      configurable: true,
      value: vi.fn(async () => undefined)
    });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getDisplayMedia: vi.fn(),
        getSupportedConstraints: vi.fn(() => ({ resizeMode: true }))
      }
    });
    soundMocks.playCallSound.mockClear();
    toastMocks.error.mockClear();
    toastMocks.info.mockClear();
    toastMocks.success.mockClear();
    toastMocks.warning.mockClear();
    vi.mocked(Room.getLocalDevices)
      .mockReset()
      .mockImplementation(async (kind?: MediaDeviceKind) => {
        if (kind === 'audioinput') {
          return [{ deviceId: 'audio-input-1', kind, label: 'Microphone' } as MediaDeviceInfo];
        }
        if (kind === 'audiooutput') {
          return [{ deviceId: 'audio-output-1', kind, label: 'Speaker' } as MediaDeviceInfo];
        }
        if (kind === 'videoinput') {
          return [{ deviceId: 'video-input-1', kind, label: 'Camera' } as MediaDeviceInfo];
        }
        return [];
      });
  });

  afterEach(() => {
    if (originalSetSinkIdDescriptor) {
      Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', originalSetSinkIdDescriptor);
    } else {
      delete (HTMLMediaElement.prototype as Partial<HTMLMediaElement>).setSinkId;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries LiveKit immediately once and then every 2.5 seconds without a limit', () => {
    const policy = new PersistentReconnectPolicy();

    expect(policy.nextRetryDelayInMs({ retryCount: 0, elapsedMs: 0 })).toBe(0);
    expect(policy.nextRetryDelayInMs({ retryCount: 1, elapsedMs: 100 })).toBe(2_500);
    expect(policy.nextRetryDelayInMs({ retryCount: 10_000, elapsedMs: 86_400_000 })).toBe(2_500);
  });

  it('sets up LiveKit E2EE before connecting', async () => {
    const client = createVoiceCallClient();

    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    expect(client.joinCall).toHaveBeenCalledWith('R1', expect.any(String), 'ask', undefined);
    expect(client.getCallToken).toHaveBeenCalledWith('R1', expect.any(String), 'call-1');
    expect(lastKeyProvider?.setKey).toHaveBeenCalledWith('shared-e2ee-key');
    expect(lastRoomOptions?.encryption).toMatchObject({
      keyProvider: lastKeyProvider
    });
    expect(calls.indexOf('setKey:shared-e2ee-key')).toBeLessThan(
      calls.indexOf('setE2EEEnabled:true')
    );
    expect(calls.indexOf('setE2EEEnabled:true')).toBeLessThan(calls.indexOf('connect'));
  });

  it('binds a notification join action to the advertised call ID', async () => {
    const client = createVoiceCallClient({
      getCallToken: vi.fn(async () => ({
        token: 'livekit-token',
        e2eeKey: 'shared-e2ee-key',
        callId: 'C-advertised',
        participantId: 'device-1',
        deviceIndex: 1
      }))
    });
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1', 'ask', 'C-advertised');

    expect(client.joinCall).toHaveBeenCalledWith('R1', expect.any(String), 'ask', 'C-advertised');
    expect(client.getCallToken).toHaveBeenCalledWith('R1', expect.any(String), 'C-advertised');
  });

  it('rejects a replacement call returned between the join intent and token response', async () => {
    const client = createVoiceCallClient({
      getCallToken: vi.fn(async () => ({
        token: 'test-token',
        e2eeKey: 'replacement-key',
        callId: 'C-replacement',
        participantId: 'device-1',
        deviceIndex: 1
      }))
    });
    const state = new VoiceCallState(client);

    await expect(
      state.join('wss://livekit.example.test', 'R1', 'ask', 'C-advertised')
    ).rejects.toMatchObject({ userMessage: 'This call has ended.' });
    expect(lastRoom).toBeNull();
    expect(client.leaveCall).toHaveBeenCalledWith('R1', expect.any(String), 'C-advertised');
  });

  it('keeps the current call connected when a notification action is already stale', async () => {
    const joinCall = vi.fn(
      async (
        _roomId: string,
        _clientInstanceId: string,
        _mode: VoiceCallJoinMode,
        expectedCallId?: string
      ) => {
        if (expectedCallId) throw new Error('advertised call no longer active');
        return {
          status: 'joined' as const,
          callId: expectedCallId ?? 'call-1',
          participantId: 'device-1',
          deviceIndex: 1
        };
      }
    );
    const client = createVoiceCallClient({ joinCall });
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R-current');

    await expect(
      state.join('wss://livekit.example.test', 'R-target', 'ask', 'C-expired')
    ).rejects.toThrow('advertised call no longer active');

    expect(state.isInCall('R-current')).toBe(true);
    expect(lastRoom).not.toBeNull();
    expect(client.leaveCall).not.toHaveBeenCalled();
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

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        voiceIsolation: true
      })
    );
    expect(lastRoom?.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(Room.getLocalDevices).toHaveBeenCalledWith('audioinput');
    expect(Room.getLocalDevices).toHaveBeenCalledWith('audiooutput', false);
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

  it('does not release another server call when device selection is required', async () => {
    const leaveOtherVoiceCalls = vi.fn(async () => undefined);
    const coordinate: CoordinateVoiceCallJoin = (join) => join(leaveOtherVoiceCalls);
    const client = createVoiceCallClient({
      joinCall: vi.fn(async () => ({
        status: 'selection-required' as const,
        activeDeviceCount: 1,
        companionAllowed: true
      }))
    });
    const state = new VoiceCallState(client, coordinate);

    await state.join('wss://livekit.example.test', 'R1');

    expect(leaveOtherVoiceCalls).not.toHaveBeenCalled();
    expect(calls).not.toContain('connect');
  });

  it('releases other server calls only after admission and token validation', async () => {
    const leaveOtherVoiceCalls = vi.fn(async () => {
      calls.push('leave-other-server');
    });
    const coordinate: CoordinateVoiceCallJoin = (join) => join(leaveOtherVoiceCalls);
    const state = new VoiceCallState(createVoiceCallClient(), coordinate);

    await state.join('wss://livekit.example.test', 'R1');

    expect(leaveOtherVoiceCalls).toHaveBeenCalledOnce();
    expect(calls.indexOf('leave-other-server')).toBeLessThan(calls.indexOf('connect'));
  });

  it('keeps the current call when switching rooms still requires a device choice', async () => {
    const joinCall = vi
      .fn<VoiceCallAPI['joinCall']>()
      .mockResolvedValueOnce({
        status: 'joined',
        callId: 'call-1',
        participantId: 'device-1',
        deviceIndex: 1
      })
      .mockResolvedValueOnce({
        status: 'selection-required',
        activeDeviceCount: 1,
        companionAllowed: true
      });
    const client = createVoiceCallClient({ joinCall });
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R-current');
    const currentRoom = lastRoom;

    await expect(state.join('wss://livekit.example.test', 'R-target')).resolves.toMatchObject({
      status: 'selection-required'
    });

    expect(state.isInCall('R-current')).toBe(true);
    expect(currentRoom?.disconnect).not.toHaveBeenCalled();
    expect(client.getCallToken).toHaveBeenCalledTimes(1);
  });

  it('keeps the current call when a normal room switch returns an invalid token', async () => {
    const getCallToken = vi
      .fn<VoiceCallAPI['getCallToken']>()
      .mockResolvedValueOnce({
        token: 'livekit-token',
        e2eeKey: 'shared-e2ee-key',
        callId: 'call-1',
        participantId: 'device-1',
        deviceIndex: 1
      })
      .mockResolvedValueOnce(null);
    const client = createVoiceCallClient({ getCallToken });
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R-current');
    const currentRoom = lastRoom;

    await expect(state.join('wss://livekit.example.test', 'R-target')).rejects.toThrow(
      'Failed to get voice call token'
    );

    expect(state.isInCall('R-current')).toBe(true);
    expect(currentRoom?.disconnect).not.toHaveBeenCalled();
    expect(client.leaveCall).toHaveBeenCalledWith('R-target', expect.any(String), 'call-1');
  });

  it('keeps PWA call ownership while a validated room switch confirms the previous leave', async () => {
    const leaveGate = deferredVoid();
    const client = createVoiceCallClient({
      leaveCall: vi.fn(async () => {
        await leaveGate.promise;
        return true;
      })
    });
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R-current');

    const switching = state.join('wss://livekit.example.test', 'R-target');
    await flushPromises();

    expect(state.roomId).toBeNull();
    expect(state.connected).toBe(false);
    expect(state.connecting).toBe(true);
    expect(state.isInAnyCall).toBe(true);

    leaveGate.resolve();
    await switching;
    expect(state.isInCall('R-target')).toBe(true);

    const targetClientInstanceId = vi.mocked(client.joinCall).mock.calls[1]?.[1];
    expect(vi.mocked(client.leaveCall).mock.calls[0]?.[1]).toBe(targetClientInstanceId);
    await state.leave();
    expect(vi.mocked(client.leaveCall).mock.calls[1]?.[1]).toBe(targetClientInstanceId);
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
        callId: 'call-1',
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

  it('retries sibling state sync when the peer has not observed the caller yet', async () => {
    const sibling = {
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
    };
    let syncAttempts = 0;
    performRpcResponder = ({ payload }) => {
      const request = JSON.parse(payload) as { action: string };
      if (request.action === 'get-state') {
        syncAttempts += 1;
        if (syncAttempts === 1) throw new Error('caller not visible yet');
      }
      return JSON.stringify({
        version: 1,
        microphoneMuted: true,
        outputMuted: false,
        revision: 1
      });
    };

    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    mockRemoteParticipants.set('device-2', sibling);
    roomEventHandlers.get('ParticipantConnected')?.(sibling);
    await flushPromises();

    expect(syncAttempts).toBe(1);
    expect(
      state.participants.find((participant) => participant.identity === 'device-2')
    ).toMatchObject({
      canControlAudio: true,
      siblingMicrophoneMuted: null,
      siblingOutputMuted: null
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();

    expect(syncAttempts).toBe(2);
    expect(
      state.participants.find((participant) => participant.identity === 'device-2')
    ).toMatchObject({
      siblingMicrophoneMuted: true,
      siblingOutputMuted: false
    });
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

  it('combines native voice processing, enhanced suppression and a coherent DTX profile', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(lastRoomOptions).toMatchObject({
      audioCaptureDefaults: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
        voiceIsolation: true
      }
    });
    expect(lastRoomOptions?.audioCaptureDefaults).not.toHaveProperty('sampleRate');
    expect(lastRoomOptions?.audioCaptureDefaults).not.toHaveProperty('processor');
    expect(lastRoomOptions?.publishDefaults).toMatchObject({
      audioPreset: AudioPresets.speech,
      backupCodec: false,
      degradationPreference: 'maintain-framerate',
      dtx: true,
      forceStereo: false,
      red: true,
      videoCodec: 'h264',
      videoEncoding: { maxBitrate: 3_500_000, maxFramerate: 30, priority: 'high' },
      videoSimulcastLayers: [
        {
          encoding: { maxBitrate: 500_000, maxFramerate: 30, priority: 'medium' },
          width: 480,
          height: 360
        },
        {
          encoding: { maxBitrate: 1_800_000, maxFramerate: 30, priority: 'medium' },
          width: 960,
          height: 720
        }
      ]
    });
    expect(lastRoomOptions?.adaptiveStream).toEqual({ pixelDensity: 'screen' });
    expect(lastRoomOptions?.publishDefaults?.audioPreset?.maxBitrate).toBe(24_000);
    expect(microphoneSetProcessor).toHaveBeenCalledOnce();
    expect(state.microphoneProcessing).toEqual({
      automaticGainControl: 'native',
      echoCancellation: true,
      noiseSuppression: 'rnnoise'
    });
  });

  it('attaches enhanced suppression to a logical default route when no Bluetooth input exists', async () => {
    microphoneTrackSettings = {
      ...microphoneTrackSettings,
      deviceId: 'default'
    };
    vi.mocked(Room.getLocalDevices).mockImplementation(async (kind?: MediaDeviceKind) => {
      if (kind !== 'audioinput') return [];
      return [
        {
          deviceId: 'default',
          kind: 'audioinput',
          label: 'System default microphone'
        } as MediaDeviceInfo
      ];
    });
    activeDeviceIds.set('audioinput', 'default');
    const state = new VoiceCallState(createVoiceCallClient());

    await state.join('wss://livekit.example.test', 'R1');

    expect(microphoneSetProcessor).toHaveBeenCalledOnce();
    expect(state.microphoneProcessing.noiseSuppression).toBe('rnnoise');
  });

  it('keeps a logical default route native when a Bluetooth input is available', async () => {
    microphoneTrackSettings = {
      ...microphoneTrackSettings,
      deviceId: 'default'
    };
    vi.mocked(Room.getLocalDevices).mockImplementation(async (kind?: MediaDeviceKind) => {
      if (kind !== 'audioinput') return [];
      return [
        {
          deviceId: 'default',
          kind: 'audioinput',
          label: 'System default microphone'
        } as MediaDeviceInfo,
        {
          deviceId: 'bluetooth-input',
          kind: 'audioinput',
          label: 'Bluetooth headset'
        } as MediaDeviceInfo
      ];
    });
    activeDeviceIds.set('audioinput', 'default');
    const state = new VoiceCallState(createVoiceCallClient());

    await state.join('wss://livekit.example.test', 'R1');

    expect(microphoneSetProcessor).not.toHaveBeenCalled();
    expect(state.microphoneProcessing.noiseSuppression).toBe('native');
  });

  it('keeps a logical default route native when wireless earbuds omit the Bluetooth label', async () => {
    microphoneTrackSettings = {
      ...microphoneTrackSettings,
      deviceId: 'default'
    };
    vi.mocked(Room.getLocalDevices).mockImplementation(async (kind?: MediaDeviceKind) => {
      if (kind !== 'audioinput') return [];
      return [
        {
          deviceId: 'default',
          kind: 'audioinput',
          label: 'Default'
        } as MediaDeviceInfo,
        {
          deviceId: 'freebuds-input',
          kind: 'audioinput',
          label: 'HUAWEI FreeBuds 5'
        } as MediaDeviceInfo
      ];
    });
    activeDeviceIds.set('audioinput', 'default');
    const state = new VoiceCallState(createVoiceCallClient());

    await state.join('wss://livekit.example.test', 'R1');

    expect(microphoneSetProcessor).not.toHaveBeenCalled();
    expect(state.microphoneProcessing.noiseSuppression).toBe('native');
  });

  it('removes enhanced Web Audio when the active route becomes Bluetooth', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');
    microphoneTrackSettings = {
      ...microphoneTrackSettings,
      deviceId: 'bluetooth-input'
    };
    state.audioDevices = [
      {
        deviceId: 'bluetooth-input',
        kind: 'audioinput',
        label: 'Bluetooth headset'
      } as MediaDeviceInfo
    ];
    state.selectedDeviceId = 'bluetooth-input';
    await state.handleDocumentVisibilityChange('visible');

    expect(microphoneSetProcessor).toHaveBeenCalledOnce();
    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(state.microphoneProcessing).toEqual({
      automaticGainControl: 'native',
      echoCancellation: true,
      noiseSuppression: 'native'
    });
  });

  it('keeps a selected Bluetooth route native when Android reports an opaque source id', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');
    microphoneTrackSettings = {
      ...microphoneTrackSettings,
      deviceId: 'opaque-source-id'
    };
    state.audioDevices = [
      {
        deviceId: 'bluetooth-input',
        kind: 'audioinput',
        label: 'Bluetooth headset'
      } as MediaDeviceInfo
    ];
    state.selectedDeviceId = 'bluetooth-input';
    activeDeviceIds.set('audioinput', 'bluetooth-input');

    await state.handleDocumentVisibilityChange('visible');

    expect(microphoneSetProcessor).toHaveBeenCalledOnce();
    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(state.microphoneProcessing).toEqual({
      automaticGainControl: 'native',
      echoCancellation: true,
      noiseSuppression: 'native'
    });
  });

  it('preserves the enumerated Bluetooth selection after Android starts capture', async () => {
    microphoneTrackSettings = {
      autoGainControl: true,
      channelCount: 1,
      deviceId: 'opaque-source-id',
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48_000
    };
    vi.mocked(Room.getLocalDevices).mockImplementation(async (kind?: MediaDeviceKind) => {
      if (kind !== 'audioinput') return [];
      return [
        {
          deviceId: 'bluetooth-input',
          kind: 'audioinput',
          label: 'Bluetooth headset'
        } as MediaDeviceInfo
      ];
    });
    activeDeviceIds.set('audioinput', 'bluetooth-input');
    const state = new VoiceCallState(createVoiceCallClient());

    await state.join('wss://livekit.example.test', 'R1');

    expect(state.selectedDeviceId).toBe('bluetooth-input');
    expect(microphoneSetProcessor).not.toHaveBeenCalled();
    expect(state.microphoneProcessing.noiseSuppression).toBe('native');
  });

  it('keeps an Android system-default Bluetooth route on the native clock', async () => {
    microphoneTrackSettings = {
      autoGainControl: true,
      channelCount: 1,
      deviceId: 'opaque-source-id',
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48_000
    };
    vi.mocked(Room.getLocalDevices).mockImplementation(async (kind?: MediaDeviceKind) => {
      if (kind !== 'audioinput') return [];
      return [
        {
          deviceId: 'default',
          kind: 'audioinput',
          label: 'Default - Pixel Bluetooth headset'
        } as MediaDeviceInfo
      ];
    });
    activeDeviceIds.set('audioinput', 'default');
    const state = new VoiceCallState(createVoiceCallClient());

    await state.join('wss://livekit.example.test', 'R1');

    expect(state.selectedDeviceId).toBe('default');
    expect(microphoneSetProcessor).not.toHaveBeenCalled();
    expect(state.microphoneProcessing.noiseSuppression).toBe('native');
  });

  it('restarts the active microphone with updated processing preferences', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.localParticipant.setMicrophoneEnabled.mockClear();

    await state.setMicrophoneProcessingPreference('noiseSuppression', false);

    expect(state.microphoneProcessingPreferences.noiseSuppression).toBe(false);
    expect(microphoneApplyConstraints).toHaveBeenCalledWith({
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: false,
      voiceIsolation: false
    });
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(lastRoom?.localParticipant.setCameraEnabled).not.toHaveBeenCalledWith(true);
    expect(lastRoom?.localParticipant.setScreenShareEnabled).not.toHaveBeenCalledWith(true);
  });

  it('rebuilds enhanced processing when echo cancellation changes on the live source', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');
    microphoneSetProcessor.mockClear();
    microphoneStopProcessor.mockClear();

    await state.setMicrophoneProcessingPreference('echoCancellation', false);

    expect(microphoneApplyConstraints).toHaveBeenCalledWith({
      autoGainControl: true,
      echoCancellation: false,
      noiseSuppression: true,
      voiceIsolation: true
    });
    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(microphoneSetProcessor).toHaveBeenCalledOnce();
    expect(state.microphoneProcessing.echoCancellation).toBe(false);
  });

  it('keeps the microphone live if enhanced fallback processing cannot attach', async () => {
    microphoneTrackSettings = {
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      sampleRate: 48_000
    };
    microphoneSetProcessor.mockRejectedValueOnce(new Error('processor unavailable'));
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenNthCalledWith(
      1,
      true,
      expect.objectContaining({
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        voiceIsolation: true
      })
    );
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
    expect(state.isMuted).toBe(false);
    expect(state.microphoneProcessing).toEqual({
      automaticGainControl: 'unavailable',
      echoCancellation: true,
      noiseSuppression: 'unavailable'
    });
    expect(toastMocks.warning).toHaveBeenCalledWith(
      'Enhanced microphone processing is unavailable. The call continues with browser audio processing.'
    );

    await state.handleDocumentVisibilityChange('visible');

    expect(state.microphoneProcessing).toEqual({
      automaticGainControl: 'native',
      echoCancellation: true,
      noiseSuppression: 'rnnoise'
    });
  });

  it('joins muted when microphone enable fails without enabling the camera', async () => {
    microphoneFailure = new Error('microphone unavailable');
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        voiceIsolation: true
      })
    );
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

  it('continues a queued join for another room after the first admission fails', async () => {
    let rejectFirstAdmission!: (reason?: unknown) => void;
    const firstAdmission = new Promise<VoiceCallJoinResult>((_resolve, reject) => {
      rejectFirstAdmission = reject;
    });
    const joinCall = vi
      .fn<VoiceCallAPI['joinCall']>()
      .mockReturnValueOnce(firstAdmission)
      .mockResolvedValueOnce({
        status: 'joined',
        callId: 'call-2',
        participantId: 'device-1',
        deviceIndex: 1
      });
    const client = createVoiceCallClient({
      joinCall,
      getCallToken: vi.fn(async () => ({
        token: 'test',
        e2eeKey: 'shared-e2ee-key',
        callId: 'call-2',
        participantId: 'device-1',
        deviceIndex: 1
      }))
    });
    const state = new VoiceCallState(client);

    const firstJoin = state.join('wss://livekit.example.test', 'R1');
    const firstFailure = expect(firstJoin).rejects.toThrow('first admission failed');
    await flushPromises();
    const secondJoin = state.join('wss://livekit.example.test', 'R2');
    const repeatedSecondJoin = state.join('wss://livekit.example.test', 'R2');
    rejectFirstAdmission(new Error('first admission failed'));

    await firstFailure;
    await expect(Promise.all([secondJoin, repeatedSecondJoin])).resolves.toEqual([
      expect.objectContaining({ status: 'joined', callId: 'call-2' }),
      expect.objectContaining({ status: 'joined', callId: 'call-2' })
    ]);
    expect(joinCall.mock.calls.map((call) => call[0])).toEqual(['R1', 'R2']);
    expect(state.isInCall('R2')).toBe(true);
  });

  it('exposes the target room while admission is still in flight', async () => {
    const admission = deferredValue<VoiceCallJoinResult>();
    const client = createVoiceCallClient({ joinCall: vi.fn(() => admission.promise) });
    const state = new VoiceCallState(client);

    const joining = state.join('wss://livekit.example.test', 'R-target');
    await flushPromises();

    expect(state.isJoiningRoom('R-target')).toBe(true);
    expect(state.isJoiningRoom('R-other')).toBe(false);
    expect(state.roomId).toBeNull();

    admission.resolve({
      status: 'joined',
      callId: 'call-1',
      participantId: 'device-1',
      deviceIndex: 1
    });
    await joining;

    expect(state.isJoiningRoom('R-target')).toBe(false);
    expect(state.isInCall('R-target')).toBe(true);
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

  it('isolates a fast same-call rejoin from the previous delayed leave', async () => {
    const firstLeaveGate = deferredVoid();
    let leaveCount = 0;
    const leaveCall = vi.fn<VoiceCallAPI['leaveCall']>(async () => {
      leaveCount += 1;
      if (leaveCount === 1) await firstLeaveGate.promise;
      return true;
    });
    const client = createVoiceCallClient({ leaveCall });
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    const firstLeave = state.leave();
    await flushPromises();
    await state.join('wss://livekit.example.test', 'R1');

    const firstJoinClientId = vi.mocked(client.joinCall).mock.calls[0]?.[1];
    const secondJoinClientId = vi.mocked(client.joinCall).mock.calls[1]?.[1];
    expect(secondJoinClientId).not.toBe(firstJoinClientId);
    expect(client.joinCall).toHaveBeenNthCalledWith(
      2,
      'R1',
      secondJoinClientId,
      'transfer',
      'call-1'
    );

    const secondLeave = state.leave();
    await flushPromises();
    expect(client.leaveCall).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.leaveCall).mock.calls[1]?.[1]).toBe(secondJoinClientId);
    expect(state.isInAnyCall).toBe(false);

    firstLeaveGate.resolve();
    await Promise.all([firstLeave, secondLeave]);
  });

  it('does not transfer a companion device during a fast same-call rejoin', async () => {
    mockRemoteParticipants.set('device-2', {
      identity: 'device-2',
      name: 'Local companion',
      metadata:
        '{"userId":"local-user","participantId":"device-2","deviceIndex":2,"login":"local-user"}',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume: vi.fn(),
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [])
    });
    const firstLeaveGate = deferredVoid();
    const joinCall = vi
      .fn<VoiceCallAPI['joinCall']>()
      .mockResolvedValueOnce({
        status: 'joined',
        callId: 'call-1',
        participantId: 'device-1',
        deviceIndex: 1
      })
      .mockResolvedValueOnce({
        status: 'selection-required',
        activeDeviceCount: 2,
        companionAllowed: false
      });
    const client = createVoiceCallClient({
      joinCall,
      leaveCall: vi.fn(async () => {
        await firstLeaveGate.promise;
        return true;
      })
    });
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    const leaving = state.leave();
    await flushPromises();
    await expect(state.join('wss://livekit.example.test', 'R1')).resolves.toMatchObject({
      status: 'selection-required'
    });

    const firstJoinClientId = joinCall.mock.calls[0]?.[1];
    const secondJoinClientId = joinCall.mock.calls[1]?.[1];
    expect(secondJoinClientId).not.toBe(firstJoinClientId);
    expect(joinCall).toHaveBeenNthCalledWith(2, 'R1', secondJoinClientId, 'ask', undefined);

    firstLeaveGate.resolve();
    await leaving;
  });

  it('cleans up the local call immediately while the leave intent is still in flight', async () => {
    const leaveGate = deferredVoid();
    const leaveCall = vi.fn<VoiceCallAPI['leaveCall']>(async () => {
      await leaveGate.promise;
      return true;
    });
    const client = createVoiceCallClient({ leaveCall });
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    const leaving = state.leave();
    await flushPromises();

    expect(state.isInAnyCall).toBe(false);
    expect(state.roomId).toBeNull();

    leaveGate.resolve();
    await leaving;
  });

  it('disconnects local media and records leave when disposed', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    const room = lastRoom;

    state.dispose();
    await flushPromises();

    expect(room?.disconnect).toHaveBeenCalledOnce();
    expect(client.leaveCall).toHaveBeenCalledWith('R1', expect.any(String), 'call-1');
    expect(state.isInAnyCall).toBe(false);
    expect(state.roomId).toBeNull();
  });

  it('keeps the call active while LiveKit reconnects and clears the state after recovery', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    roomEventHandlers.get('Reconnecting')?.();

    expect(state.reconnecting).toBe(true);
    expect(state.isInAnyCall).toBe(true);
    expect(state.roomId).toBe('R1');

    roomEventHandlers.get('Reconnected')?.();

    expect(state.reconnecting).toBe(false);
    expect(state.isInAnyCall).toBe(true);
  });

  it('shows recovery immediately for a browser offline signal and clears it after a short outage', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    window.dispatchEvent(new Event('offline'));

    expect(state.reconnecting).toBe(true);
    expect(state.isInAnyCall).toBe(true);
    expect(state.roomId).toBe('R1');

    window.dispatchEvent(new Event('online'));

    expect(state.reconnecting).toBe(false);
    expect(state.isInAnyCall).toBe(true);
    await state.leave();
  });

  it('continues application recovery after a terminal network timeout until it succeeds', async () => {
    vi.useFakeTimers();
    const joinCall = vi
      .fn<VoiceCallAPI['joinCall']>()
      .mockResolvedValueOnce({
        status: 'joined',
        callId: 'call-1',
        participantId: 'device-1',
        deviceIndex: 1
      })
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValue({
        status: 'joined',
        callId: 'call-1',
        participantId: 'device-1',
        deviceIndex: 1
      });
    const client = createVoiceCallClient({ joinCall });
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);

    expect(state.reconnecting).toBe(true);
    expect(state.isInAnyCall).toBe(true);
    expect(state.roomId).toBe('R1');

    await vi.advanceTimersByTimeAsync(2_500);
    await flushPromises();
    expect(joinCall).toHaveBeenCalledTimes(2);
    expect(state.reconnecting).toBe(true);

    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(30);

    expect(joinCall).toHaveBeenCalledTimes(3);
    expect(joinCall.mock.calls[1]).toEqual([
      'R1',
      joinCall.mock.calls[0][1],
      'companion',
      'call-1'
    ]);
    expect(joinCall.mock.calls[2]).toEqual([
      'R1',
      joinCall.mock.calls[0][1],
      'companion',
      'call-1'
    ]);
    expect(client.getCallToken).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.getCallToken).mock.calls[1]).toEqual([
      'R1',
      joinCall.mock.calls[0][1],
      'call-1'
    ]);
    expect(calls.filter((call) => call === 'connect')).toHaveLength(2);
    expect(client.leaveCall).not.toHaveBeenCalled();
    expect(state.reconnecting).toBe(false);
    expect(state.isInAnyCall).toBe(true);
  });

  it('rejoins the room with a fresh call generation after the interrupted call expires', async () => {
    vi.useFakeTimers();
    const joinCall = vi
      .fn<VoiceCallAPI['joinCall']>()
      .mockResolvedValueOnce({
        status: 'joined',
        callId: 'call-1',
        participantId: 'device-1',
        deviceIndex: 1
      })
      .mockRejectedValueOnce(
        new ConnectError('voice call is no longer active', Code.FailedPrecondition)
      )
      .mockResolvedValue({
        status: 'joined',
        callId: 'call-2',
        participantId: 'device-1',
        deviceIndex: 1
      });
    const getCallToken = vi
      .fn<VoiceCallAPI['getCallToken']>()
      .mockResolvedValueOnce({
        token: 'livekit-token-1',
        e2eeKey: 'shared-e2ee-key-1',
        callId: 'call-1',
        participantId: 'device-1',
        deviceIndex: 1
      })
      .mockResolvedValue({
        token: 'livekit-token-2',
        e2eeKey: 'shared-e2ee-key-2',
        callId: 'call-2',
        participantId: 'device-1',
        deviceIndex: 1
      });
    const client = createVoiceCallClient({ joinCall, getCallToken });
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(30);

    expect(joinCall.mock.calls).toEqual([
      ['R1', expect.any(String), 'ask', undefined],
      ['R1', expect.any(String), 'companion', 'call-1'],
      ['R1', expect.any(String), 'companion']
    ]);
    expect(getCallToken).toHaveBeenLastCalledWith('R1', expect.any(String), 'call-2');
    expect(state.reconnecting).toBe(false);
    expect(state.isInAnyCall).toBe(true);

    state.handleCallEndedEvent('R1', 'call-1');
    expect(state.isInAnyCall).toBe(true);

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(30);

    expect(joinCall).toHaveBeenLastCalledWith('R1', expect.any(String), 'companion', 'call-2');
    expect(state.reconnecting).toBe(false);
    expect(state.isInAnyCall).toBe(true);

    await state.leave();
    expect(client.leaveCall).toHaveBeenLastCalledWith('R1', expect.any(String), 'call-2');
  });

  it('survives repeated terminal network handoffs and rotates only an expired call generation', async () => {
    vi.useFakeTimers();
    const joined = (callId: string) => ({
      status: 'joined' as const,
      callId,
      participantId: 'device-1',
      deviceIndex: 1
    });
    const joinCall = vi
      .fn<VoiceCallAPI['joinCall']>()
      .mockResolvedValueOnce(joined('call-1'))
      .mockResolvedValueOnce(joined('call-1'))
      .mockResolvedValueOnce(joined('call-1'))
      .mockRejectedValueOnce(
        new ConnectError('voice call is no longer active', Code.FailedPrecondition)
      )
      .mockResolvedValueOnce(joined('call-2'));
    const getCallToken = vi
      .fn<VoiceCallAPI['getCallToken']>()
      .mockResolvedValueOnce({
        token: 'livekit-token-1',
        e2eeKey: 'shared-e2ee-key-1',
        callId: 'call-1',
        participantId: 'device-1',
        deviceIndex: 1
      })
      .mockResolvedValueOnce({
        token: 'test',
        e2eeKey: 'shared-e2ee-key-1',
        callId: 'call-1',
        participantId: 'device-1',
        deviceIndex: 1
      })
      .mockResolvedValueOnce({
        token: 'test',
        e2eeKey: 'shared-e2ee-key-1',
        callId: 'call-1',
        participantId: 'device-1',
        deviceIndex: 1
      })
      .mockResolvedValueOnce({
        token: 'livekit-token-2',
        e2eeKey: 'shared-e2ee-key-2',
        callId: 'call-2',
        participantId: 'device-1',
        deviceIndex: 1
      });
    const client = createVoiceCallClient({ joinCall, getCallToken });
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    for (let cycle = 0; cycle < 3; cycle += 1) {
      roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
      expect(state.reconnecting).toBe(true);
      expect(state.roomId).toBe('R1');

      await vi.advanceTimersByTimeAsync(2_500);
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises(30);

      expect(state.reconnecting).toBe(false);
      expect(state.isInAnyCall).toBe(true);
      expect(state.roomId).toBe('R1');
    }

    const clientInstanceIds = new Set(joinCall.mock.calls.map((call) => call[1]));
    expect(clientInstanceIds.size).toBe(1);
    expect(joinCall.mock.calls.map((call) => call[3])).toEqual([
      undefined,
      'call-1',
      'call-1',
      'call-1',
      undefined
    ]);
    expect(getCallToken.mock.calls.map((call) => call[2])).toEqual([
      'call-1',
      'call-1',
      'call-1',
      'call-2'
    ]);

    state.handleCallEndedEvent('R1', 'call-1');
    expect(state.isInAnyCall).toBe(true);
    await state.leave();
    expect(client.leaveCall).toHaveBeenLastCalledWith('R1', expect.any(String), 'call-2');
  });

  it('restores selected capture devices directly without opening system defaults', async () => {
    vi.useFakeTimers();
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    await state.setAudioDevice('preferred-microphone');
    await state.setAudioOutputDevice('preferred-speaker');
    await state.setVideoDevice('preferred-camera');
    vi.mocked(Room.getLocalDevices).mockImplementation(async (kind?: MediaDeviceKind) => {
      if (kind === 'videoinput') {
        return [
          {
            deviceId: 'preferred-camera',
            groupId: 'preferred-video',
            kind,
            label: 'Preferred camera',
            toJSON: () => ({})
          } as MediaDeviceInfo
        ];
      }
      if (kind === 'audiooutput') {
        return [
          {
            deviceId: 'preferred-speaker',
            groupId: 'preferred-output',
            kind,
            label: 'Preferred speaker',
            toJSON: () => ({})
          } as MediaDeviceInfo
        ];
      }
      return [
        {
          deviceId: 'preferred-microphone',
          groupId: 'preferred-input',
          kind: 'audioinput',
          label: 'Preferred microphone',
          toJSON: () => ({})
        } as MediaDeviceInfo
      ];
    });
    await state.toggleCamera();
    calls.length = 0;

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
    expect(state.isOutputMuted).toBe(true);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(30);

    expect(lastRoom?.switchActiveDevice).toHaveBeenCalledOnce();
    expect(lastRoom?.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'preferred-speaker');
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
        deviceId: { exact: 'preferred-microphone' }
      })
    );
    expect(lastRoom?.localParticipant.setCameraEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        aspectRatio: { ideal: 4 / 3 },
        deviceId: { exact: 'preferred-camera' },
        resizeMode: { exact: 'none' },
        resolution: expect.not.objectContaining({ aspectRatio: expect.anything() })
      })
    );
    expect(calls.indexOf('switchActiveDevice:audiooutput:preferred-speaker')).toBeLessThan(
      calls.indexOf('setMicrophoneEnabled')
    );
    expect(calls.indexOf('setMicrophoneEnabled')).toBeLessThan(
      calls.indexOf('setCameraEnabled:true')
    );
    expect(state.isOutputMuted).toBe(false);
    expect(state.isMuted).toBe(false);
    expect(state.isCameraEnabled).toBe(true);
  });

  it('falls back from a disappeared microphone while recovering the call', async () => {
    vi.useFakeTimers();
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    await state.setAudioDevice('removed-bluetooth-microphone');
    microphoneFailure = Object.assign(new Error('selected microphone disappeared'), {
      name: 'NotFoundError'
    });
    microphoneFailuresRemaining = 1;
    vi.mocked(Room.getLocalDevices).mockImplementation(async (kind?: MediaDeviceKind) => {
      if (kind !== 'audioinput') return [];
      return [
        {
          deviceId: 'built-in-microphone',
          groupId: 'built-in-audio',
          kind,
          label: 'Built-in microphone',
          toJSON: () => ({})
        } as MediaDeviceInfo
      ];
    });

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(30);

    expect(lastRoom?.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'built-in-microphone');
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ deviceId: { exact: 'built-in-microphone' } })
    );
    expect(state.reconnecting).toBe(false);
    expect(state.isMuted).toBe(false);
    expect(state.selectedDeviceId).toBe('built-in-microphone');
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it('reacquires the system microphone during recovery when enumeration is empty', async () => {
    vi.useFakeTimers();
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    await state.setAudioDevice('removed-bluetooth-microphone');
    microphoneFailure = Object.assign(new Error('selected microphone disappeared'), {
      name: 'OverconstrainedError'
    });
    microphoneFailuresRemaining = 1;
    vi.mocked(Room.getLocalDevices).mockResolvedValue([]);

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
    // A recovered LiveKit Room starts without the publication owned by the
    // disconnected Room.
    microphonePublication = null;
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(30);

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenNthCalledWith(
      1,
      true,
      expect.objectContaining({ deviceId: { exact: 'removed-bluetooth-microphone' } })
    );
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        voiceIsolation: true
      })
    );
    expect(microphoneRestartTrack).not.toHaveBeenCalled();
    expect(state.reconnecting).toBe(false);
    expect(state.isMuted).toBe(false);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it('keeps recovered output muted when the selected speaker cannot be restored', async () => {
    vi.useFakeTimers();
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    await state.setAudioOutputDevice('preferred-speaker');
    toastMocks.error.mockClear();
    switchActiveDeviceFailure = Object.assign(new Error('speaker disappeared'), {
      name: 'NotFoundError'
    });

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(30);

    expect(state.reconnecting).toBe(false);
    expect(state.isInAnyCall).toBe(true);
    expect(state.isOutputMuted).toBe(true);
    expect(toastMocks.error).toHaveBeenCalledWith(
      'Could not switch speakers. This browser or device may not support speaker selection.'
    );
  });

  it('lets the user leave during recovery and cancels all later attempts', async () => {
    vi.useFakeTimers();
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
    await state.leave();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(client.joinCall).toHaveBeenCalledTimes(1);
    expect(client.leaveCall).toHaveBeenCalledWith('R1', expect.any(String), 'call-1');
    expect(state.reconnecting).toBe(false);
    expect(state.isInAnyCall).toBe(false);
  });

  it('does not let a cancelled recovery disconnect a newer call when its connect resolves late', async () => {
    vi.useFakeTimers();
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    const recoveryConnectGate = deferredVoid();
    connectGate = recoveryConnectGate;
    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(50);
    expect(calls.filter((call) => call === 'connect')).toHaveLength(2);
    const recoveringRoom = lastRoom;

    await state.leave();
    connectGate = null;
    await state.join('wss://livekit.example.test', 'R2');
    const newerRoom = lastRoom;

    expect(calls.filter((call) => call === 'connect')).toHaveLength(3);
    expect(state.roomId).toBe('R2');
    expect(state.isInAnyCall).toBe(true);

    expect(recoveringRoom).not.toBeNull();
    expect(recoveringRoom).not.toBe(newerRoom);

    recoveryConnectGate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(20);

    expect(state.roomId).toBe('R2');
    expect(state.isInAnyCall).toBe(true);
    expect(newerRoom?.disconnect).not.toHaveBeenCalled();
  });

  it('does not let cancelled media restoration mutate a newer call', async () => {
    vi.useFakeTimers();
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    const recoveryMicrophoneGate = deferredVoid();
    microphoneGate = recoveryMicrophoneGate;
    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(50);

    expect(calls.filter((call) => call === 'connect')).toHaveLength(2);
    expect(calls.filter((call) => call === 'setMicrophoneEnabled')).toHaveLength(2);

    await state.leave();
    microphoneGate = null;
    await state.join('wss://livekit.example.test', 'R2');
    const newerRoom = lastRoom;

    recoveryMicrophoneGate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(20);

    expect(state.roomId).toBe('R2');
    expect(state.isInAnyCall).toBe(true);
    expect(state.isMuted).toBe(false);
    expect(newerRoom?.disconnect).not.toHaveBeenCalled();
  });

  it('does not recover after a duplicate identity disconnect', async () => {
    vi.useFakeTimers();
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    toastMocks.error.mockClear();

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.DUPLICATE_IDENTITY);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(client.joinCall).toHaveBeenCalledTimes(1);
    expect(state.reconnecting).toBe(false);
    expect(state.isInAnyCall).toBe(false);
    expect(toastMocks.error).toHaveBeenCalledWith('Voice call disconnected');
  });

  it('does not recover after LiveKit closes the room', async () => {
    vi.useFakeTimers();
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.ROOM_CLOSED);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(client.joinCall).toHaveBeenCalledTimes(1);
    expect(state.reconnecting).toBe(false);
    expect(state.isInAnyCall).toBe(false);
  });

  it('ignores projected leave and call-end events caused by a connection interruption', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    roomEventHandlers.get('Reconnecting')?.();
    state.handleParticipantLeftEvent('R1', 'call-1', 'device-1', 'local-user', 'local-user');
    state.handleCallEndedEvent('R1', 'call-1');

    expect(lastRoom?.disconnect).not.toHaveBeenCalled();
    expect(state.reconnecting).toBe(true);
    expect(state.isInAnyCall).toBe(true);
  });

  it('records a compensating leave when LiveKit connect fails after join intent', async () => {
    connectFailure = new Error('connect failed');
    const client = createVoiceCallClient();

    const state = new VoiceCallState(client);

    await expect(state.join('wss://livekit.example.test', 'R1')).rejects.toThrow('connect failed');

    expect(client.joinCall).toHaveBeenCalledTimes(1);
    expect(client.leaveCall).toHaveBeenCalledWith('R1', expect.any(String), 'call-1');
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

  it('publishes adaptive H.264 screen sharing at 30 FPS and requests browser-tab audio', async () => {
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
        resolution: { width: 1920, height: 1080, frameRate: 30 },
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: 'exclude'
      },
      {
        audioPreset: AudioPresets.musicHighQualityStereo,
        backupCodec: false,
        degradationPreference: 'maintain-resolution',
        dtx: true,
        forceStereo: true,
        red: true,
        screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 30, priority: 'high' },
        screenShareSimulcastLayers: [
          {
            encoding: { maxBitrate: 600_000, maxFramerate: 30, priority: 'medium' },
            width: 640,
            height: 360
          },
          ScreenSharePresets.h720fps30
        ],
        simulcast: true,
        videoCodec: 'h264'
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

  it('uses the opt-in 60 FPS screen-share profile without changing the stable default', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    state.setScreenShareHighFrameRate(true);

    await state.toggleScreenShare();

    expect(lastRoom?.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        resolution: { width: 1920, height: 1080, frameRate: 60 }
      }),
      expect.objectContaining({
        screenShareEncoding: { maxBitrate: 12_000_000, maxFramerate: 60, priority: 'high' }
      })
    );
  });

  it('falls back to VP8 only when the sender explicitly reports no H.264 encoder', async () => {
    vi.stubGlobal(
      'RTCRtpSender',
      class MockRTCRtpSender {
        static getCapabilities(): RTCRtpCapabilities {
          return {
            codecs: [{ mimeType: 'video/VP8', clockRate: 90_000 }],
            headerExtensions: []
          };
        }
      }
    );
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(lastRoomOptions?.publishDefaults?.videoCodec).toBe('vp8');
  });

  it('limits mobile camera publication to two 30 FPS spatial layers', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: navigator.mediaDevices,
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Mobile)',
      userAgentData: { mobile: true }
    });
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');

    expect(lastRoomOptions?.publishDefaults?.videoSimulcastLayers).toEqual([
      {
        encoding: { maxBitrate: 500_000, maxFramerate: 30, priority: 'medium' },
        width: 480,
        height: 360
      }
    ]);
    expect(lastRoomOptions?.publishDefaults?.videoEncoding?.maxFramerate).toBe(30);
  });

  it('does not constrain Safari screen capture while keeping the H.264 publish profile', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: navigator.mediaDevices,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.1 Safari/605.1.15'
    });
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    await state.toggleScreenShare();

    const call = vi.mocked(lastRoom!.localParticipant.setScreenShareEnabled).mock.calls[0];
    expect(call?.[1]).not.toHaveProperty('resolution');
    expect(call?.[2]).toMatchObject({ videoCodec: 'h264', backupCodec: false, simulcast: false });
    state.setScreenShareHighFrameRate(true);
    expect(state.screenShareHighFrameRate).toBe(false);
    expect(lastRoomOptions?.publishDefaults).toMatchObject({
      simulcast: false,
      videoSimulcastLayers: []
    });
  });

  it('applies the WebKit capture and simulcast safeguards to Chrome on iOS', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: navigator.mediaDevices,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1'
    });
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    await state.toggleScreenShare();

    const call = vi.mocked(lastRoom!.localParticipant.setScreenShareEnabled).mock.calls[0];
    expect(call?.[1]).not.toHaveProperty('resolution');
    expect(call?.[2]).toMatchObject({ simulcast: false });
    expect(lastRoomOptions?.publishDefaults?.simulcast).toBe(false);
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

    roomEventHandlers.get('TrackSubscribed')?.(screenAudioTrack, {}, { identity: 'remote-device' });
    expect(screenAudioTrack.attach).toHaveBeenCalledOnce();
    expect(screenAudioTrack.attach.mock.calls[0]?.[0]).toBeInstanceOf(HTMLAudioElement);
    expect(screenAudioTrack.attach.mock.calls[0]?.[0].muted).toBe(false);

    roomEventHandlers.get('TrackUnsubscribed')?.(screenAudioTrack, {});
    expect(screenAudioTrack.detach).toHaveBeenCalledOnce();
  });

  it('pre-mutes newly subscribed audio while call output is muted', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    await state.toggleOutputMute();
    const remoteAudioTrack = {
      kind: 'audio',
      source: 'microphone',
      attach: vi.fn(),
      detach: vi.fn()
    };

    roomEventHandlers.get('TrackSubscribed')?.(remoteAudioTrack, {}, { identity: 'remote-device' });

    const attachedElement = remoteAudioTrack.attach.mock.calls[0]?.[0];
    expect(attachedElement).toBeInstanceOf(HTMLAudioElement);
    expect(attachedElement.muted).toBe(true);
  });

  it('explains unsupported mobile or browser capture without calling LiveKit', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    vi.stubGlobal('navigator', { mediaDevices: {} });

    expect(state.canShareScreen).toBe(false);
    await state.toggleScreenShare();
    await state.toggleScreenShare();

    expect(lastRoom?.localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
    expect(state.isScreenShareEnabled).toBe(false);
    expect(toastMocks.warning).toHaveBeenCalledTimes(1);
    expect(toastMocks.warning).toHaveBeenCalledWith(
      'This browser or web app cannot share the screen. Screen sharing remains available on supported desktop browsers.',
      6_000
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

  it('keeps the same enhanced processor across mute and unmute', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');

    await state.toggleMute();
    await state.toggleMute();

    expect(state.isMuted).toBe(false);
    expect(microphoneSetProcessor).toHaveBeenCalledOnce();
  });

  it('falls back to native capture while hidden and restores enhanced processing on return', async () => {
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);

    await state.join('wss://livekit.example.test', 'R1');
    expect(microphoneSetProcessor).toHaveBeenCalledOnce();

    await state.handleDocumentVisibilityChange('hidden');
    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(microphoneProcessor).toBeNull();

    await state.handleDocumentVisibilityChange('visible');
    expect(microphoneApplyConstraints).toHaveBeenCalledWith({
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
      voiceIsolation: true
    });
    expect(microphoneSetProcessor).toHaveBeenCalledTimes(2);
  });

  it('serializes mute with a simultaneous microphone switch', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.switchActiveDevice.mockClear();
    microphoneGate = deferredVoid();

    const muting = state.toggleMute();
    await flushPromises();
    const switching = state.setAudioDevice('bluetooth-microphone');
    await flushPromises();

    expect(lastRoom?.switchActiveDevice).not.toHaveBeenCalled();
    microphoneGate.resolve();
    await Promise.all([muting, switching]);

    expect(lastRoom?.switchActiveDevice).toHaveBeenCalledOnce();
    expect(lastRoom?.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'bluetooth-microphone');
    expect(state.isMuted).toBe(true);
    expect(state.selectedDeviceId).toBe('bluetooth-microphone');
  });

  it('falls back to an available microphone when a muted route disappeared', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    await state.toggleMute();
    activeDeviceIds.set('audioinput', 'removed-bluetooth-microphone');
    state.selectedDeviceId = 'removed-bluetooth-microphone';
    lastRoom?.switchActiveDevice.mockClear();
    microphoneFailure = Object.assign(new Error('selected microphone constraint failed'), {
      name: 'OverconstrainedError'
    });
    microphoneFailuresRemaining = 1;
    vi.mocked(Room.getLocalDevices)
      .mockResolvedValueOnce([
        {
          deviceId: 'built-in-microphone',
          groupId: 'built-in-audio',
          kind: 'audioinput',
          label: 'Built-in microphone',
          toJSON: () => ({})
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await state.toggleMute();

    expect(lastRoom?.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'built-in-microphone');
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({ deviceId: { exact: 'built-in-microphone' } })
    );
    expect(state.isMuted).toBe(false);
    expect(state.selectedDeviceId).toBe('built-in-microphone');
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it('reacquires the system microphone when its logical device ID stays stable', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    await state.toggleMute();
    activeDeviceIds.set('audioinput', 'default');
    state.selectedDeviceId = 'default';
    microphoneFailure = Object.assign(new Error('system microphone route changed'), {
      name: 'OverconstrainedError'
    });
    microphoneFailuresRemaining = 1;
    vi.mocked(Room.getLocalDevices)
      .mockResolvedValueOnce([
        {
          deviceId: 'default',
          groupId: 'system-audio',
          kind: 'audioinput',
          label: 'System microphone',
          toJSON: () => ({})
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await state.toggleMute();

    expect(microphoneRestartTrack).toHaveBeenCalledWith({
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      voiceIsolation: true
    });
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({
        autoGainControl: true,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        voiceIsolation: true
      })
    );
    expect(state.isMuted).toBe(false);
    expect(state.selectedDeviceId).toBe('default');
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it('uses LiveKit local speaking levels without an auxiliary microphone graph', async () => {
    vi.useFakeTimers();
    const client = createVoiceCallClient();
    const state = new VoiceCallState(client);
    await state.join('wss://livekit.example.test', 'R1');
    const localParticipant = lastRoom?.localParticipant as unknown as {
      audioLevel: number;
      identity: string;
      isSpeaking: boolean;
    };
    localParticipant.audioLevel = 0.42;
    localParticipant.isSpeaking = true;

    vi.advanceTimersByTime(60);

    expect(state.getAudioLevel(localParticipant.identity)).toEqual({
      audioLevel: 0.42,
      isSpeaking: true
    });
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
    expect(lastRoom?.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({
        deviceId: { exact: 'video-input-1' },
        aspectRatio: { ideal: 4 / 3 },
        resizeMode: { exact: 'none' },
        resolution: {
          width: { ideal: 1280 },
          height: { ideal: 960 },
          frameRate: { ideal: 30, max: 30 }
        }
      })
    );

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

    expect(lastRoom?.localParticipant.setCameraEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        aspectRatio: { ideal: 4 / 3 },
        deviceId: { exact: 'video-input-1' },
        resizeMode: { exact: 'none' },
        resolution: expect.not.objectContaining({ aspectRatio: expect.anything() })
      })
    );
    expect(Room.getLocalDevices).toHaveBeenCalledWith('videoinput', true);
  });

  it('reconciles enhanced processing when a hot device change activates native Bluetooth DSP', async () => {
    microphoneTrackSettings = {
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      sampleRate: 48_000
    };
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    expect(microphoneSetProcessor).toHaveBeenCalledOnce();

    microphoneTrackSettings = {
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16_000
    };
    roomEventHandlers.get('MediaDevicesChanged')?.();
    await flushPromises(20);

    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(state.microphoneProcessing).toEqual({
      automaticGainControl: 'native',
      echoCancellation: true,
      noiseSuppression: 'native'
    });
  });

  it('reconciles enhanced processing from LiveKit active-device changes without devicechange', async () => {
    microphoneTrackSettings = {
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      sampleRate: 48_000
    };
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    expect(microphoneSetProcessor).toHaveBeenCalledOnce();

    microphoneTrackSettings = {
      autoGainControl: true,
      channelCount: 1,
      deviceId: 'bluetooth-microphone',
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16_000
    };
    roomEventHandlers.get('ActiveDeviceChanged')?.('audioinput', 'bluetooth-microphone');
    await flushPromises();

    expect(state.selectedDeviceId).toBe('bluetooth-microphone');
    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(state.microphoneProcessing).toEqual({
      automaticGainControl: 'native',
      echoCancellation: true,
      noiseSuppression: 'native'
    });
  });

  it('detects a route-clock change even when the browser emits no device event', async () => {
    vi.useFakeTimers();
    microphoneTrackSettings = {
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      sampleRate: 48_000
    };
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    expect(microphoneSetProcessor).toHaveBeenCalledOnce();

    microphoneTrackSettings = {
      autoGainControl: true,
      channelCount: 1,
      deviceId: 'system-routed-bluetooth-microphone',
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16_000
    };
    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(state.selectedDeviceId).toBe('system-routed-bluetooth-microphone');
  });

  it('keeps available mobile capture devices when speaker enumeration is unavailable', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    expect(state.audioOutputDevices.map((device) => device.deviceId)).toEqual(['audio-output-1']);

    vi.mocked(Room.getLocalDevices)
      .mockResolvedValueOnce([
        {
          deviceId: 'mobile-microphone',
          groupId: 'mobile-audio',
          kind: 'audioinput',
          label: 'Phone microphone',
          toJSON: () => ({})
        }
      ])
      .mockRejectedValueOnce(
        new DOMException('Audio output selection is unavailable', 'NotSupportedError')
      )
      .mockResolvedValueOnce([
        {
          deviceId: 'mobile-camera',
          groupId: 'mobile-video',
          kind: 'videoinput',
          label: 'Front camera',
          toJSON: () => ({})
        }
      ]);

    await state.refreshDevices();

    expect(Room.getLocalDevices).toHaveBeenCalledWith('audiooutput', false);
    expect(state.audioDevices.map((device) => device.deviceId)).toEqual(['mobile-microphone']);
    expect(state.videoDevices.map((device) => device.deviceId)).toEqual(['mobile-camera']);
    expect(state.audioOutputDevices).toEqual([]);
    expect(state.isAudioOutputSelectionSupported).toBe(false);
    expect(state.selectedDeviceId).toBe('mobile-microphone');
    expect(state.selectedVideoDeviceId).toBe('mobile-camera');
    expect(state.selectedOutputDeviceId).toBeNull();
  });

  it('prefers a newly available Bluetooth microphone when the user has not chosen another route', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.localParticipant.setMicrophoneEnabled.mockClear();
    microphoneStopProcessor.mockClear();
    microphoneTrackSettings = {
      ...microphoneTrackSettings,
      deviceId: 'bluetooth-microphone',
      sampleRate: 16_000
    };
    activeDeviceIds.set('audioinput', 'speakerphone');
    vi.mocked(Room.getLocalDevices)
      .mockResolvedValueOnce([
        {
          deviceId: 'speakerphone',
          groupId: 'mobile-audio',
          kind: 'audioinput',
          label: 'Speakerphone',
          toJSON: () => ({})
        },
        {
          deviceId: 'bluetooth-microphone',
          groupId: 'mobile-audio',
          kind: 'audioinput',
          label: 'Bluetooth headset',
          toJSON: () => ({})
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await state.refreshDevices();

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ deviceId: { exact: 'bluetooth-microphone' } })
    );
    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(microphoneStopProcessor.mock.invocationCallOrder[0]).toBeLessThan(
      lastRoom!.localParticipant.setMicrophoneEnabled.mock.invocationCallOrder[0]
    );
    expect(state.selectedDeviceId).toBe('bluetooth-microphone');
  });

  it('does not override an explicit speakerphone choice when Bluetooth is present', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    await state.setAudioDevice('speakerphone');
    lastRoom?.localParticipant.setMicrophoneEnabled.mockClear();
    activeDeviceIds.set('audioinput', 'bluetooth-microphone');
    vi.mocked(Room.getLocalDevices)
      .mockResolvedValueOnce([
        {
          deviceId: 'speakerphone',
          groupId: 'mobile-audio',
          kind: 'audioinput',
          label: 'Speakerphone',
          toJSON: () => ({})
        },
        {
          deviceId: 'bluetooth-microphone',
          groupId: 'mobile-audio',
          kind: 'audioinput',
          label: 'Bluetooth headset',
          toJSON: () => ({})
        }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await state.refreshDevices();

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(state.selectedDeviceId).toBe('speakerphone');
  });

  it('replaces stale audio selections with the active or first available route', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    activeDeviceIds.set('audioinput', 'replacement-microphone');
    activeDeviceIds.set('audiooutput', 'replacement-speaker');
    vi.mocked(Room.getLocalDevices)
      .mockResolvedValueOnce([
        {
          deviceId: 'replacement-microphone',
          groupId: 'replacement-input',
          kind: 'audioinput',
          label: 'Replacement microphone',
          toJSON: () => ({})
        }
      ])
      .mockResolvedValueOnce([
        {
          deviceId: 'replacement-speaker',
          groupId: 'replacement-output',
          kind: 'audiooutput',
          label: 'Replacement speaker',
          toJSON: () => ({})
        }
      ])
      .mockResolvedValueOnce([]);

    await state.refreshDevices();

    expect(state.selectedDeviceId).toBe('replacement-microphone');
    expect(state.selectedOutputDeviceId).toBe('replacement-speaker');
  });

  it('ignores an older device enumeration that resolves after a newer refresh', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    const oldInput = deferredValue<MediaDeviceInfo[]>();
    let inputRefresh = 0;
    vi.mocked(Room.getLocalDevices).mockImplementation(async (kind?: MediaDeviceKind) => {
      if (kind === 'audioinput') {
        inputRefresh += 1;
        if (inputRefresh === 1) return oldInput.promise;
        return [
          {
            deviceId: 'new-microphone',
            groupId: 'new-input',
            kind,
            label: 'New microphone',
            toJSON: () => ({})
          } as MediaDeviceInfo
        ];
      }
      return [];
    });

    const oldRefresh = state.refreshDevices();
    await flushPromises();
    await state.refreshDevices();
    oldInput.resolve([
      {
        deviceId: 'old-microphone',
        groupId: 'old-input',
        kind: 'audioinput',
        label: 'Old microphone',
        toJSON: () => ({})
      } as MediaDeviceInfo
    ]);
    await oldRefresh;

    expect(state.audioDevices.map((device) => device.deviceId)).toEqual(['new-microphone']);
    expect(state.selectedDeviceId).toBe('new-microphone');
  });

  it('replaces a stale selected camera when the device list changes', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    expect(state.selectedVideoDeviceId).toBe('video-input-1');

    vi.mocked(Room.getLocalDevices)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          deviceId: 'replacement-camera',
          groupId: 'replacement-video',
          kind: 'videoinput',
          label: 'Rear camera',
          toJSON: () => ({})
        }
      ]);

    await state.refreshDevices();

    expect(state.selectedVideoDeviceId).toBe('replacement-camera');
  });

  it('retries without resizeMode when a camera driver rejects only that constraint', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    const error = new DOMException('resize mode rejected', 'OverconstrainedError');
    Object.defineProperty(error, 'constraint', { value: 'resizeMode' });
    lastRoom?.localParticipant.setCameraEnabled.mockRejectedValueOnce(error);

    await state.toggleCamera();

    expect(lastRoom?.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(2);
    expect(lastRoom?.localParticipant.setCameraEnabled).toHaveBeenNthCalledWith(
      1,
      true,
      expect.objectContaining({ resizeMode: { exact: 'none' } })
    );
    expect(lastRoom?.localParticipant.setCameraEnabled).toHaveBeenNthCalledWith(
      2,
      true,
      expect.not.objectContaining({ resizeMode: expect.anything() })
    );
    expect(state.isCameraEnabled).toBe(true);
  });

  it('cycles through available phone lenses with one serialized switch', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    state.videoDevices = [
      {
        deviceId: 'front-camera',
        groupId: 'phone-cameras',
        kind: 'videoinput',
        label: 'Front camera',
        toJSON: () => ({})
      } as MediaDeviceInfo,
      {
        deviceId: 'rear-camera',
        groupId: 'phone-cameras',
        kind: 'videoinput',
        label: 'Rear camera',
        toJSON: () => ({})
      } as MediaDeviceInfo
    ];
    state.selectedVideoDeviceId = 'front-camera';

    await state.switchToNextVideoDevice();

    expect(lastRoom?.switchActiveDevice).toHaveBeenLastCalledWith('videoinput', 'rear-camera');
    expect(state.selectedVideoDeviceId).toBe('rear-camera');
  });

  it('serializes rapid microphone switches so capture restarts cannot overlap', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.switchActiveDevice.mockClear();
    switchActiveDeviceGate = deferredVoid();

    const firstSwitch = state.setAudioDevice('usb-microphone');
    await flushPromises();
    const secondSwitch = state.setAudioDevice('bluetooth-microphone');
    await flushPromises();

    expect(lastRoom?.switchActiveDevice).toHaveBeenCalledTimes(1);
    switchActiveDeviceGate.resolve();
    await Promise.all([firstSwitch, secondSwitch]);

    expect(lastRoom?.switchActiveDevice).toHaveBeenNthCalledWith(1, 'audioinput', 'usb-microphone');
    expect(lastRoom?.switchActiveDevice).toHaveBeenNthCalledWith(
      2,
      'audioinput',
      'bluetooth-microphone'
    );
    expect(state.selectedDeviceId).toBe('bluetooth-microphone');
  });

  it('detaches enhanced processing before switching to a Bluetooth microphone', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    state.audioDevices = [
      {
        deviceId: 'audio-input-1',
        groupId: 'built-in-audio',
        kind: 'audioinput',
        label: 'Built-in microphone',
        toJSON: () => ({})
      } as MediaDeviceInfo,
      {
        deviceId: 'bluetooth-microphone',
        groupId: 'wireless-audio',
        kind: 'audioinput',
        label: 'Bluetooth headset',
        toJSON: () => ({})
      } as MediaDeviceInfo
    ];
    lastRoom?.switchActiveDevice.mockClear();
    microphoneStopProcessor.mockClear();

    await state.setAudioDevice('bluetooth-microphone');

    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(lastRoom?.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'bluetooth-microphone');
    expect(microphoneStopProcessor.mock.invocationCallOrder[0]).toBeLessThan(
      lastRoom!.switchActiveDevice.mock.invocationCallOrder[0]
    );
    expect(microphoneSetProcessor).toHaveBeenCalledOnce();
    expect(state.microphoneProcessing.noiseSuppression).toBe('native');
  });

  it('detaches enhanced processing before a logical route can select Bluetooth', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    state.audioDevices = [
      {
        deviceId: 'default',
        groupId: 'system-audio',
        kind: 'audioinput',
        label: 'System default microphone',
        toJSON: () => ({})
      } as MediaDeviceInfo,
      {
        deviceId: 'bluetooth-microphone',
        groupId: 'wireless-audio',
        kind: 'audioinput',
        label: 'Bluetooth headset',
        toJSON: () => ({})
      } as MediaDeviceInfo
    ];
    lastRoom?.switchActiveDevice.mockClear();
    microphoneStopProcessor.mockClear();

    await state.setAudioDevice('default');

    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(microphoneStopProcessor.mock.invocationCallOrder[0]).toBeLessThan(
      lastRoom!.switchActiveDevice.mock.invocationCallOrder[0]
    );
    expect(microphoneSetProcessor).toHaveBeenCalledOnce();
  });

  it('restores enhanced processing when a Bluetooth microphone switch fails', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    state.audioDevices = [
      {
        deviceId: 'audio-input-1',
        groupId: 'built-in-audio',
        kind: 'audioinput',
        label: 'Built-in microphone',
        toJSON: () => ({})
      } as MediaDeviceInfo,
      {
        deviceId: 'bluetooth-microphone',
        groupId: 'wireless-audio',
        kind: 'audioinput',
        label: 'Bluetooth headset',
        toJSON: () => ({})
      } as MediaDeviceInfo
    ];
    switchActiveDeviceFailure = Object.assign(new Error('Bluetooth route disappeared'), {
      name: 'NotFoundError'
    });

    await state.setAudioDevice('bluetooth-microphone');

    expect(microphoneStopProcessor).toHaveBeenCalledOnce();
    expect(microphoneSetProcessor).toHaveBeenCalledTimes(2);
    expect(state.selectedDeviceId).toBe('audio-input-1');
    expect(state.microphoneProcessing.noiseSuppression).toBe('rnnoise');
  });

  it('does not restart the already active microphone when its selected row is pressed again', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.switchActiveDevice.mockClear();

    await state.setAudioDevice('audio-input-1');

    expect(lastRoom?.switchActiveDevice).not.toHaveBeenCalled();
    expect(microphoneStopProcessor).not.toHaveBeenCalled();
  });

  it('serializes speaker switching before resuming audio output', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    await state.toggleOutputMute();
    lastRoom?.startAudio.mockClear();
    switchActiveDeviceGate = deferredVoid();

    const switching = state.setAudioOutputDevice('bluetooth-speaker');
    await flushPromises();
    const unmuting = state.toggleOutputMute();
    await flushPromises();

    expect(lastRoom?.startAudio).not.toHaveBeenCalled();
    switchActiveDeviceGate.resolve();
    await Promise.all([switching, unmuting]);

    expect(lastRoom?.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'bluetooth-speaker');
    expect(lastRoom?.startAudio).toHaveBeenCalledOnce();
    expect(state.isOutputMuted).toBe(false);
    expect(state.selectedOutputDeviceId).toBe('bluetooth-speaker');
  });

  it('mutes attached remote audio elements as well as SDK volume controls', async () => {
    const microphoneElement = document.createElement('audio');
    const screenShareElement = document.createElement('audio');
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
      getTrackPublications: vi.fn(() => [
        {
          isMuted: false,
          track: {
            source: 'microphone',
            attachedElements: [microphoneElement]
          }
        },
        {
          isMuted: false,
          track: {
            source: 'screen_share_audio',
            attachedElements: [screenShareElement]
          }
        }
      ])
    });
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');

    await state.toggleOutputMute();

    expect(state.isOutputMuted).toBe(true);
    expect(microphoneElement.muted).toBe(true);
    expect(screenShareElement.muted).toBe(true);
    expect(setVolume).toHaveBeenCalledWith(0, 'microphone');
    expect(setVolume).toHaveBeenCalledWith(0, 'screen_share_audio');

    await state.toggleOutputMute();

    expect(state.isOutputMuted).toBe(false);
    expect(microphoneElement.muted).toBe(false);
    expect(screenShareElement.muted).toBe(false);
  });

  it('does not report a stale microphone switch failure after the call has left', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    toastMocks.error.mockClear();
    switchActiveDeviceGate = deferredVoid();
    switchActiveDeviceFailure = Object.assign(new Error('device disappeared'), {
      name: 'NotFoundError'
    });

    const switching = state.setAudioDevice('removed-microphone');
    await flushPromises();
    await state.leave();
    switchActiveDeviceGate.resolve();
    await switching;

    expect(toastMocks.error).not.toHaveBeenCalled();
    expect(state.selectedDeviceId).toBeNull();
  });

  it('drops a queued microphone toggle after its room has been left', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.localParticipant.setMicrophoneEnabled.mockClear();
    switchActiveDeviceGate = deferredVoid();

    const switching = state.setAudioDevice('usb-microphone');
    await flushPromises();
    const muting = state.toggleMute();
    await flushPromises();
    await state.leave();
    switchActiveDeviceGate.resolve();
    await Promise.all([switching, muting]);

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(state.isMuted).toBe(false);
  });

  it('uses the standards speaker picker directly from the user action when available', async () => {
    const selectAudioOutput = vi.fn(async () => ({
      deviceId: 'approved-speaker',
      groupId: 'approved-output',
      kind: 'audiooutput' as const,
      label: 'Approved speaker',
      toJSON: () => ({})
    }));
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getDisplayMedia: vi.fn(),
        getSupportedConstraints: vi.fn(() => ({ resizeMode: true })),
        selectAudioOutput
      }
    });
    vi.mocked(Room.getLocalDevices).mockImplementation(async (kind?: MediaDeviceKind) => {
      if (kind === 'audiooutput') {
        return [
          {
            deviceId: 'approved-speaker',
            groupId: 'approved-output',
            kind,
            label: 'Approved speaker',
            toJSON: () => ({})
          } as MediaDeviceInfo
        ];
      }
      return [];
    });
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.switchActiveDevice.mockClear();

    await expect(state.requestAudioOutputDevice()).resolves.toBe(true);

    expect(selectAudioOutput).toHaveBeenCalledOnce();
    expect(lastRoom?.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'approved-speaker');
    expect(state.selectedOutputDeviceId).toBe('approved-speaker');
  });

  it('mirrors automatic LiveKit microphone mute and recovery in the local controls', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');

    roomEventHandlers.get('TrackMuted')?.({ source: 'microphone' }, lastRoom?.localParticipant);
    expect(state.isMuted).toBe(true);
    expect(state.microphoneRouteRecovering).toBe(true);

    roomEventHandlers.get('TrackUnmuted')?.({ source: 'microphone' }, lastRoom?.localParticipant);
    expect(state.isMuted).toBe(false);
    expect(state.microphoneRouteRecovering).toBe(false);
  });

  it('recovers an automatically muted microphone immediately when the route inventory changes', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.localParticipant.setMicrophoneEnabled.mockClear();
    vi.mocked(Room.getLocalDevices)
      .mockResolvedValueOnce([
        {
          deviceId: 'replacement-microphone',
          groupId: 'replacement-input',
          kind: 'audioinput',
          label: 'Replacement microphone',
          toJSON: () => ({})
        } as MediaDeviceInfo
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    roomEventHandlers.get('TrackMuted')?.({ source: 'microphone' }, lastRoom?.localParticipant);
    roomEventHandlers.get('MediaDevicesChanged')?.();
    await flushPromises(20);

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ deviceId: { exact: 'replacement-microphone' } })
    );
    expect(state.selectedDeviceId).toBe('replacement-microphone');
    expect(state.isMuted).toBe(false);
    expect(state.microphoneRouteRecovering).toBe(false);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it('recovers a mobile system microphone without relying on devicechange', async () => {
    vi.useFakeTimers();
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.localParticipant.setMicrophoneEnabled.mockClear();

    roomEventHandlers.get('TrackMuted')?.({ source: 'microphone' }, lastRoom?.localParticipant);
    await vi.advanceTimersByTimeAsync(999);
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flushPromises(20);

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledOnce();
    expect(state.isMuted).toBe(false);
    expect(state.microphoneRouteRecovering).toBe(false);
  });

  it('preserves the intent to stay audible when network recovery follows an automatic route loss', async () => {
    vi.useFakeTimers();
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');

    roomEventHandlers.get('TrackMuted')?.({ source: 'microphone' }, lastRoom?.localParticipant);
    expect(state.isMuted).toBe(true);
    expect(state.microphoneRouteRecovering).toBe(true);

    roomEventHandlers.get('Disconnected')?.(DisconnectReason.CONNECTION_TIMEOUT);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises(30);

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      })
    );
    expect(state.reconnecting).toBe(false);
    expect(state.isMuted).toBe(false);
    expect(state.microphoneRouteRecovering).toBe(false);
  });

  it('bounds automatic microphone retries when permission remains unavailable', async () => {
    vi.useFakeTimers();
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.localParticipant.setMicrophoneEnabled.mockClear();
    microphoneFailure = new DOMException('Microphone permission denied', 'NotAllowedError');

    roomEventHandlers.get('TrackMuted')?.({ source: 'microphone' }, lastRoom?.localParticipant);
    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromises(20);

    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(3);
    expect(state.isMuted).toBe(true);
    expect(state.microphoneRouteRecovering).toBe(true);
    expect(state.isMicrophonePending).toBe(false);
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it('recovers in one action when a user selects a microphone after automatic retries stop', async () => {
    vi.useFakeTimers();
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    lastRoom?.localParticipant.setMicrophoneEnabled.mockClear();
    microphoneFailure = new DOMException('Microphone permission denied', 'NotAllowedError');

    roomEventHandlers.get('TrackMuted')?.({ source: 'microphone' }, lastRoom?.localParticipant);
    await vi.advanceTimersByTimeAsync(10_000);
    await flushPromises(20);
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(3);

    microphoneFailure = null;
    lastRoom?.localParticipant.setMicrophoneEnabled.mockClear();
    await state.setAudioDevice('usb-microphone');

    expect(lastRoom?.switchActiveDevice).toHaveBeenLastCalledWith('audioinput', 'usb-microphone');
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ deviceId: { exact: 'usb-microphone' } })
    );
    expect(state.selectedDeviceId).toBe('usb-microphone');
    expect(state.isMuted).toBe(false);
    expect(state.microphoneRouteRecovering).toBe(false);
  });

  it('never auto-unmutes after an explicit microphone mute', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    await state.toggleMute();
    lastRoom?.localParticipant.setMicrophoneEnabled.mockClear();

    roomEventHandlers.get('MediaDevicesChanged')?.();
    await flushPromises(20);

    expect(state.isMuted).toBe(true);
    expect(state.microphoneRouteRecovering).toBe(false);
    expect(lastRoom?.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('does not apply a camera switch that finishes after leaving the call', async () => {
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');
    switchActiveDeviceGate = deferredVoid();

    const switching = state.setVideoDevice('rear-camera');
    await flushPromises();
    expect(state.isCameraPending).toBe(true);

    await state.leave();
    expect(state.isInAnyCall).toBe(false);
    expect(state.isCameraPending).toBe(false);
    expect(state.selectedVideoDeviceId).toBeNull();

    switchActiveDeviceGate.resolve();
    await switching;

    expect(state.selectedVideoDeviceId).toBeNull();
    expect(toastMocks.error).not.toHaveBeenCalled();
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
        new DOMException('Unavailable', 'NotSupportedError'),
        'enable'
      )
    ).toBe(
      'This browser or web app cannot share the screen. Screen sharing remains available on supported desktop browsers.'
    );
    expect(
      getVoiceCallMediaDeviceErrorMessage(
        'screen',
        new Error('getDisplayMedia not supported'),
        'enable'
      )
    ).toBe(
      'This browser or web app cannot share the screen. Screen sharing remains available on supported desktop browsers.'
    );
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

  it('sets a high receiver ceiling for expanded camera media without disabling adaptation', async () => {
    const setVideoQuality = vi.fn();
    const cameraPublication = {
      isMuted: false,
      track: { source: 'camera' },
      setVideoQuality
    };
    const remoteTrackPublications = new Map([['camera', cameraPublication]]);
    mockRemoteParticipants = new Map([
      [
        'remote-device',
        {
          identity: 'remote-device',
          name: 'Remote User',
          metadata:
            '{"userId":"remote-user","participantId":"remote-device","deviceIndex":1,"login":"remote-user"}',
          connectionQuality: 'excellent',
          isSpeaking: false,
          audioLevel: 0,
          setVolume: vi.fn(),
          trackPublications: remoteTrackPublications,
          getTrackPublications: () => Array.from(remoteTrackPublications.values())
        }
      ]
    ]);
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');

    state.setParticipantMediaExpanded('remote-device', 'camera', true);
    state.setParticipantMediaExpanded('remote-device', 'camera', false);

    expect(setVideoQuality).toHaveBeenCalledOnce();
    expect(setVideoQuality).toHaveBeenCalledWith(2);
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

  it('retains a disconnected remote participant as interrupted until the same connection returns', async () => {
    const remoteParticipant = {
      identity: 'remote-user',
      name: 'Remote User',
      metadata:
        '{"userId":"remote-user","participantId":"remote-user","deviceIndex":1,"login":"remote-user"}',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume: vi.fn(),
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [{ isMuted: false, track: { source: 'microphone' } }])
    };
    mockRemoteParticipants.set('remote-user', remoteParticipant);
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');

    mockRemoteParticipants.delete('remote-user');
    roomEventHandlers.get('ParticipantDisconnected')?.(remoteParticipant);

    expect(
      state.participants.find((participant) => participant.identity === 'remote-user')
    ).toMatchObject({
      participantId: 'remote-user',
      connectionState: 'interrupted',
      connectionQuality: 'lost',
      isCameraEnabled: false,
      videoTrack: null
    });

    mockRemoteParticipants.set('remote-user', remoteParticipant);
    roomEventHandlers.get('ParticipantConnected')?.(remoteParticipant);

    expect(
      state.participants.find((participant) => participant.identity === 'remote-user')
    ).toMatchObject({
      participantId: 'remote-user',
      connectionState: 'connected',
      interruptionDeadline: null
    });

    await state.leave();
  });

  it('does not let an old network-quality poll unlock a poll for the recovered room', async () => {
    const firstPoll = deferredValue<RTCStatsReport>();
    const recoveredPoll = deferredValue<RTCStatsReport>();
    const emptyReport = new Map() as unknown as RTCStatsReport;
    const getRTCStatsReport = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockReturnValueOnce(firstPoll.promise)
      .mockReturnValueOnce(recoveredPoll.promise)
      .mockResolvedValue(emptyReport);
    mockRemoteParticipants.set('remote-user', {
      identity: 'remote-user',
      name: 'Remote User',
      metadata: '',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume: vi.fn(),
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [
        {
          isMuted: false,
          track: { source: 'microphone', getRTCStatsReport }
        }
      ])
    });
    const state = new VoiceCallState(createVoiceCallClient());

    await state.join('wss://livekit.example.test', 'R1');
    expect(getRTCStatsReport).toHaveBeenCalledTimes(1);
    await state.leave();
    await state.join('wss://livekit.example.test', 'R1');
    expect(getRTCStatsReport).toHaveBeenCalledTimes(2);

    firstPoll.resolve(emptyReport);
    await flushPromises();
    await (
      state as unknown as { refreshParticipantNetworkQuality: () => Promise<void> }
    ).refreshParticipantNetworkQuality();

    expect(getRTCStatsReport).toHaveBeenCalledTimes(2);

    recoveredPoll.resolve(emptyReport);
    await flushPromises();
    await state.leave();
  });

  it('does not remove an interrupted participant only because its recovery deadline elapsed', async () => {
    const remoteParticipant = {
      identity: 'remote-user',
      name: 'Remote User',
      metadata:
        '{"userId":"remote-user","participantId":"remote-user","deviceIndex":1,"login":"remote-user"}',
      connectionQuality: 'good',
      isSpeaking: false,
      audioLevel: 0,
      setVolume: vi.fn(),
      trackPublications: new Map(),
      getTrackPublications: vi.fn(() => [])
    };
    mockRemoteParticipants.set('remote-user', remoteParticipant);
    const state = new VoiceCallState(createVoiceCallClient());
    await state.join('wss://livekit.example.test', 'R1');

    mockRemoteParticipants.delete('remote-user');
    state.handleParticipantConnectionChangedEvent(
      'R1',
      'call-1',
      'remote-user',
      'interrupted',
      new Date(Date.now() - 1_000).toISOString()
    );

    expect(
      state.participants.find((participant) => participant.identity === 'remote-user')
    ).toMatchObject({ connectionState: 'interrupted' });

    await state.leave();
  });
});
