import type {
  AudioCaptureOptions,
  AudioProcessorOptions,
  LocalAudioTrack,
  Track,
  TrackProcessor
} from 'livekit-client';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseWasmSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import speexWasmUrl from '@sapphi-red/web-noise-suppressor/speex.wasm?url';
import speexWorkletUrl from '@sapphi-red/web-noise-suppressor/speexWorklet.js?url';
// Keep this worklet on the app origin. Firefox enforces script-src for
// AudioWorklet modules and correctly rejects Vite's small-asset data: inlining.
import automaticGainControlWorkletUrl from './automaticGainControlWorklet.js?url&no-inline';

type SuppressionMode = 'rnnoise' | 'speex' | 'passthrough';
export type NoiseSuppressorNode = AudioWorkletNode & { destroy(): void };

export type MicrophoneProcessingStatus = {
  automaticGainControl: 'native' | 'towk' | 'unknown' | 'unavailable';
  echoCancellation: boolean | null;
  noiseSuppression: 'rnnoise' | 'speex' | 'native' | 'unknown' | 'unavailable';
};

export type MicrophoneProcessingPreferences = {
  automaticGainControl: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  enhancedNoiseSuppression: boolean;
};

export type MicrophoneProcessingEnvironment = {
  bluetoothRoute: boolean;
  documentVisible: boolean;
  routeIdentityKnown?: boolean;
};

export const DEFAULT_MICROPHONE_PROCESSING_PREFERENCES: MicrophoneProcessingPreferences = {
  automaticGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
  enhancedNoiseSuppression: true
};

const RNNOISE_SAMPLE_RATE = 48_000;
const AUTOMATIC_GAIN_CONTROL_WORKLET_NAME = 'towk-automatic-gain-control';
const workletRegistrations = new WeakMap<AudioContext, Map<string, Promise<void>>>();
let rnnoiseBinaryPromise: Promise<ArrayBuffer> | undefined;
let speexBinaryPromise: Promise<ArrayBuffer> | undefined;

/**
 * Create the microphone policy used for every call.
 *
 * Boolean and numeric values are preferences rather than mandatory constraints:
 * browsers apply them when supported without rejecting the call on less capable
 * devices. The local processor adds a portable suppression layer on top of the
 * browser's echo and noise processing.
 */
export function createVoiceAudioCaptureOptions(): AudioCaptureOptions {
  return createVoiceAudioCaptureOptionsFor(DEFAULT_MICROPHONE_PROCESSING_PREFERENCES);
}

export function createVoiceAudioCaptureOptionsFor(
  preferences: MicrophoneProcessingPreferences
): AudioCaptureOptions {
  return {
    autoGainControl: preferences.automaticGainControl,
    channelCount: 1,
    echoCancellation: preferences.echoCancellation,
    noiseSuppression: preferences.noiseSuppression,
    // Prefer the browser/OS voice pipeline when it can offer stronger native
    // isolation. Unsupported ideal constraints are ignored by getUserMedia.
    voiceIsolation: preferences.noiseSuppression
  };
}

/**
 * Attach enhanced suppression after LiveKit has created the local audio track.
 *
 * LiveKit 2.x applies processors inside createLocalTracks() before it assigns
 * the Room AudioContext to LocalAudioTrack. Passing the processor as a capture
 * default therefore rejects microphone startup. At this point the track is
 * already owned by LocalParticipant and has the AudioContext required by the
 * processor. Device restarts remain managed by LiveKit through restart().
 */
export async function ensureBackgroundNoiseSuppression(
  track: Pick<
    LocalAudioTrack,
    | 'getProcessor'
    | 'getSourceTrackSettings'
    | 'mediaStreamTrack'
    | 'restartTrack'
    | 'setProcessor'
    | 'stopProcessor'
  >,
  preferences: MicrophoneProcessingPreferences = DEFAULT_MICROPHONE_PROCESSING_PREFERENCES,
  environment: MicrophoneProcessingEnvironment = currentMicrophoneProcessingEnvironment()
): Promise<MicrophoneProcessingStatus> {
  let settings = track.getSourceTrackSettings();
  const currentProcessor = track.getProcessor();
  if (currentProcessor instanceof BackgroundNoiseSuppressionProcessor) {
    if (
      !shouldAttachEnhancedProcessing(settings, preferences, environment) ||
      !currentProcessor.isCompatibleWith(settings, preferences)
    ) {
      try {
        await track.stopProcessor();
        settings = track.getSourceTrackSettings();
        if (!shouldAttachEnhancedProcessing(settings, preferences, environment)) {
          return createNativeProcessingStatus(settings);
        }
      } catch {
        // LiveKit stops the processed output before it reapplies the source
        // constraints while detaching. If that reapply fails during a route
        // transition, the RTP sender can otherwise remain on a stopped track.
        // Reacquire native capture to restore an audible sender.
        await restartNativeMicrophoneCapture(track, settings, preferences);
        settings = track.getSourceTrackSettings();
        if (!shouldAttachEnhancedProcessing(settings, preferences, environment)) {
          return createNativeProcessingStatus(settings);
        }
      }
    } else {
      return currentProcessor.processingStatus;
    }
  }
  if (!shouldAttachEnhancedProcessing(settings, preferences, environment)) {
    return createNativeProcessingStatus(settings);
  }
  if (!BackgroundNoiseSuppressionProcessor.isSupported) {
    return createNativeProcessingStatus(settings);
  }

  const processor = new BackgroundNoiseSuppressionProcessor(preferences);
  await track.setProcessor(processor);
  return processor.processingStatus;
}

async function restartNativeMicrophoneCapture(
  track: Pick<LocalAudioTrack, 'restartTrack'>,
  settings: MediaTrackSettings,
  preferences: MicrophoneProcessingPreferences
): Promise<void> {
  const options = createVoiceAudioCaptureOptionsFor(preferences);
  if (!settings.deviceId) {
    await track.restartTrack(options);
    return;
  }

  try {
    await track.restartTrack({
      ...options,
      deviceId: { exact: settings.deviceId }
    });
  } catch {
    // The previous device may have disappeared entirely. A second attempt on
    // the system route is safer than leaving the sender attached to silence.
    await track.restartTrack(options);
  }
}

export function createNativeProcessingStatus(
  settings: MediaTrackSettings
): MicrophoneProcessingStatus {
  return {
    automaticGainControl:
      settings.autoGainControl === true
        ? 'native'
        : settings.autoGainControl === false
          ? 'unavailable'
          : 'unknown',
    echoCancellation:
      typeof settings.echoCancellation === 'boolean' ? settings.echoCancellation : null,
    noiseSuppression:
      settings.noiseSuppression === true
        ? 'native'
        : settings.noiseSuppression === false
          ? 'unavailable'
          : 'unknown'
  };
}

export async function createAutomaticGainControlNode(
  audioContext: AudioContext
): Promise<AudioWorkletNode> {
  await registerWorklet(audioContext, automaticGainControlWorkletUrl);
  return new AudioWorkletNode(audioContext, AUTOMATIC_GAIN_CONTROL_WORKLET_NAME, {
    channelCount: 1,
    channelCountMode: 'explicit',
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1]
  });
}

export async function createNoiseSuppressionNode(audioContext: AudioContext): Promise<{
  mode: Exclude<SuppressionMode, 'passthrough'>;
  node: NoiseSuppressorNode;
}> {
  const mode: Exclude<SuppressionMode, 'passthrough'> =
    audioContext.sampleRate === RNNOISE_SAMPLE_RATE ? 'rnnoise' : 'speex';
  const { node, workletUrl } = await createSuppressorNode(mode, audioContext);
  await registerWorklet(audioContext, workletUrl);
  return { mode, node: node() };
}

/**
 * Native-first, self-hosted background noise suppression for LiveKit audio.
 *
 * RNNoise is preferred at its native 48 kHz rate and SpeexDSP at other rates,
 * but only when the captured source and AudioContext share a proven clock and
 * the browser explicitly reports native suppression unavailable. Native voice
 * DSP or a clock mismatch bypasses the graph through a direct track clone. If
 * a worklet cannot load, the browser-processed microphone remains usable.
 */
export class BackgroundNoiseSuppressionProcessor implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  readonly name = 'towk-background-noise-suppression';
  processedTrack?: MediaStreamTrack;

  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private suppressorNode?: NoiseSuppressorNode;
  private automaticGainControlNode?: AudioWorkletNode;
  private destinationNode?: MediaStreamAudioDestinationNode;
  private suppressionMode: SuppressionMode = 'passthrough';
  private automaticGainControlMode: 'native' | 'towk' | 'unavailable' = 'unavailable';
  private echoCancellation: boolean | null = null;
  private nativeNoiseSuppression = false;

  constructor(
    private readonly preferences: MicrophoneProcessingPreferences = DEFAULT_MICROPHONE_PROCESSING_PREFERENCES
  ) {}

  static get isSupported(): boolean {
    return (
      typeof AudioContext !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined' &&
      typeof MediaStream !== 'undefined' &&
      typeof WebAssembly !== 'undefined'
    );
  }

  get mode(): SuppressionMode {
    return this.suppressionMode;
  }

  get processingStatus(): MicrophoneProcessingStatus {
    return {
      automaticGainControl: this.automaticGainControlMode,
      echoCancellation: this.echoCancellation,
      noiseSuppression:
        this.suppressionMode === 'rnnoise' || this.suppressionMode === 'speex'
          ? this.suppressionMode
          : this.nativeNoiseSuppression
            ? 'native'
            : 'unavailable'
    };
  }

  isCompatibleWith(
    settings: MediaTrackSettings,
    preferences: MicrophoneProcessingPreferences = this.preferences
  ): boolean {
    const expectedAutomaticGainControlMode =
      settings.autoGainControl === true
        ? 'native'
        : preferences.automaticGainControl
          ? 'towk'
          : 'unavailable';
    return (
      preferences.automaticGainControl === this.preferences.automaticGainControl &&
      preferences.echoCancellation === this.preferences.echoCancellation &&
      settings.echoCancellation === this.echoCancellation &&
      (settings.noiseSuppression === true) === this.nativeNoiseSuppression &&
      expectedAutomaticGainControlMode === this.automaticGainControlMode &&
      canProcessAtContextRate(settings, this.audioContext?.sampleRate ?? Number.NaN)
    );
  }

  async init(options: AudioProcessorOptions): Promise<void> {
    await this.teardown(false);
    this.audioContext = options.audioContext;
    await this.buildGraph(options.track, options.audioContext);
  }

  async restart(options: AudioProcessorOptions): Promise<void> {
    // LiveKit 2.x may omit audioContext when restarting after a device switch.
    // Reuse the context received during init so processing remains attached.
    const audioContext = options.audioContext ?? this.audioContext;
    if (!audioContext) {
      throw new Error('AudioContext is required to restart background noise suppression');
    }

    await this.teardown(false);
    this.audioContext = audioContext;
    await this.buildGraph(options.track, audioContext);
  }

  async destroy(): Promise<void> {
    await this.teardown(true);
  }

  private async buildGraph(track: MediaStreamTrack, audioContext: AudioContext): Promise<void> {
    const settings = track.getSettings();
    this.echoCancellation =
      typeof settings.echoCancellation === 'boolean' ? settings.echoCancellation : null;
    this.nativeNoiseSuppression = settings.noiseSuppression === true;
    this.automaticGainControlMode = settings.autoGainControl === true ? 'native' : 'unavailable';

    // Communication routes such as Bluetooth HFP/BLE can expose a source
    // clock different from the Room AudioContext. Passing that route through a
    // MediaStreamAudioSource/Destination pair adds resampling and an unrelated
    // clock, which can turn drift into audible gaps. A clone keeps LiveKit's
    // processor lifecycle safe without altering the original capture clock.
    if (!canProcessAtContextRate(settings, audioContext.sampleRate)) {
      this.processedTrack = track.clone();
      return;
    }

    this.sourceNode = audioContext.createMediaStreamSource(new MediaStream([track]));
    this.destinationNode = audioContext.createMediaStreamDestination();

    try {
      const { mode, node: suppressorNode } = await createNoiseSuppressionNode(audioContext);
      this.suppressorNode = suppressorNode;
      suppressorNode.onprocessorerror = () => {
        if (this.suppressorNode === suppressorNode) this.enablePassthrough();
      };
      this.suppressionMode = mode;
    } catch {
      this.suppressionMode = 'passthrough';
    }

    if (this.preferences.automaticGainControl && this.automaticGainControlMode !== 'native') {
      try {
        const automaticGainControlNode = await createAutomaticGainControlNode(audioContext);
        this.automaticGainControlNode = automaticGainControlNode;
        automaticGainControlNode.onprocessorerror = () => {
          if (this.automaticGainControlNode === automaticGainControlNode) {
            this.disableTowkAutomaticGainControl();
          }
        };
        this.automaticGainControlMode = 'towk';
      } catch {
        this.automaticGainControlMode = 'unavailable';
      }
    }

    this.connectProcessingGraph();
    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  private connectProcessingGraph(): void {
    if (!this.sourceNode || !this.destinationNode) return;
    this.sourceNode.connect(
      this.suppressorNode ?? this.automaticGainControlNode ?? this.destinationNode
    );
    if (this.suppressorNode) {
      this.suppressorNode.connect(this.automaticGainControlNode ?? this.destinationNode);
    }
    if (this.automaticGainControlNode) {
      this.automaticGainControlNode.connect(this.destinationNode);
    }
  }

  private enablePassthrough(): void {
    if (!this.sourceNode || !this.destinationNode) return;

    this.sourceNode.disconnect();
    if (this.suppressorNode) this.suppressorNode.onprocessorerror = null;
    this.suppressorNode?.destroy();
    this.suppressorNode?.port.close();
    this.suppressorNode?.disconnect();
    this.suppressorNode = undefined;
    this.sourceNode.connect(this.automaticGainControlNode ?? this.destinationNode);
    this.suppressionMode = 'passthrough';
  }

  private disableTowkAutomaticGainControl(): void {
    if (!this.destinationNode || !this.automaticGainControlNode) return;
    const processedInput: AudioNode | undefined = this.suppressorNode ?? this.sourceNode;
    processedInput?.disconnect();
    this.automaticGainControlNode.onprocessorerror = null;
    this.automaticGainControlNode.port.close();
    this.automaticGainControlNode.disconnect();
    this.automaticGainControlNode = undefined;
    processedInput?.connect(this.destinationNode);
    this.automaticGainControlMode = 'unavailable';
  }

  private async teardown(clearContext: boolean): Promise<void> {
    this.sourceNode?.disconnect();
    if (this.suppressorNode) this.suppressorNode.onprocessorerror = null;
    this.suppressorNode?.destroy();
    this.suppressorNode?.port.close();
    this.suppressorNode?.disconnect();
    if (this.automaticGainControlNode) this.automaticGainControlNode.onprocessorerror = null;
    this.automaticGainControlNode?.port.close();
    this.automaticGainControlNode?.disconnect();
    this.destinationNode?.disconnect();
    this.processedTrack?.stop();

    this.sourceNode = undefined;
    this.suppressorNode = undefined;
    this.automaticGainControlNode = undefined;
    this.destinationNode = undefined;
    this.processedTrack = undefined;
    this.suppressionMode = 'passthrough';
    this.automaticGainControlMode = 'unavailable';
    this.echoCancellation = null;
    this.nativeNoiseSuppression = false;
    if (clearContext) this.audioContext = undefined;
  }
}

function shouldAttachEnhancedProcessing(
  settings: MediaTrackSettings,
  preferences: MicrophoneProcessingPreferences,
  environment: MicrophoneProcessingEnvironment
): boolean {
  const channelLayoutCompatible =
    settings.channelCount === undefined || settings.channelCount === 1;
  const sourceClockCompatible =
    settings.sampleRate === undefined ||
    (Number.isFinite(settings.sampleRate) && settings.sampleRate >= 32_000);
  return (
    preferences.enhancedNoiseSuppression &&
    preferences.noiseSuppression &&
    environment.documentVisible &&
    !environment.bluetoothRoute &&
    environment.routeIdentityKnown !== false &&
    channelLayoutCompatible &&
    sourceClockCompatible
  );
}

function canProcessAtContextRate(settings: MediaTrackSettings, contextSampleRate: number): boolean {
  const channelLayoutCompatible =
    settings.channelCount === undefined || settings.channelCount === 1;
  const sourceClockCompatible =
    settings.sampleRate === undefined ||
    (Number.isFinite(settings.sampleRate) &&
      settings.sampleRate >= 32_000 &&
      settings.sampleRate === contextSampleRate);
  return (
    channelLayoutCompatible &&
    Number.isFinite(contextSampleRate) &&
    contextSampleRate >= 32_000 &&
    sourceClockCompatible
  );
}

function currentMicrophoneProcessingEnvironment(): MicrophoneProcessingEnvironment {
  return {
    bluetoothRoute: false,
    documentVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
    routeIdentityKnown: true
  };
}

async function createSuppressorNode(
  mode: Exclude<SuppressionMode, 'passthrough'>,
  audioContext: AudioContext
): Promise<{ node: () => NoiseSuppressorNode; workletUrl: string }> {
  const suppressor = await import('@sapphi-red/web-noise-suppressor');

  if (mode === 'rnnoise') {
    const wasmBinary = await loadRnnoiseBinary(suppressor.loadRnnoise);
    return {
      workletUrl: rnnoiseWorkletUrl,
      node: () =>
        new suppressor.RnnoiseWorkletNode(audioContext, {
          maxChannels: 1,
          wasmBinary
        })
    };
  }

  const wasmBinary = await loadSpeexBinary(suppressor.loadSpeex);
  return {
    workletUrl: speexWorkletUrl,
    node: () =>
      new suppressor.SpeexWorkletNode(audioContext, {
        maxChannels: 1,
        wasmBinary
      })
  };
}

async function registerWorklet(audioContext: AudioContext, workletUrl: string): Promise<void> {
  let registrations = workletRegistrations.get(audioContext);
  if (!registrations) {
    registrations = new Map();
    workletRegistrations.set(audioContext, registrations);
  }

  let registration = registrations.get(workletUrl);
  if (!registration) {
    registration = audioContext.audioWorklet.addModule(workletUrl);
    registrations.set(workletUrl, registration);
    registration.catch(() => registrations?.delete(workletUrl));
  }

  await registration;
}

function loadRnnoiseBinary(
  loadRnnoise: (options: { url: string; simdUrl: string }) => Promise<ArrayBuffer>
): Promise<ArrayBuffer> {
  rnnoiseBinaryPromise ??= loadRnnoise({
    url: rnnoiseWasmUrl,
    simdUrl: rnnoiseWasmSimdUrl
  }).catch((error: unknown) => {
    rnnoiseBinaryPromise = undefined;
    throw error;
  });
  return rnnoiseBinaryPromise;
}

function loadSpeexBinary(
  loadSpeex: (options: { url: string }) => Promise<ArrayBuffer>
): Promise<ArrayBuffer> {
  speexBinaryPromise ??= loadSpeex({ url: speexWasmUrl }).catch((error: unknown) => {
    speexBinaryPromise = undefined;
    throw error;
  });
  return speexBinaryPromise;
}
