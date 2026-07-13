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

type SuppressionMode = 'rnnoise' | 'speex' | 'passthrough';
type NoiseSuppressorNode = AudioWorkletNode & { destroy(): void };

const RNNOISE_SAMPLE_RATE = 48_000;
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
  return {
    autoGainControl: false,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    sampleRate: RNNOISE_SAMPLE_RATE
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
  track: Pick<LocalAudioTrack, 'getProcessor' | 'setProcessor'>
): Promise<void> {
  if (track.getProcessor()?.name === 'towk-background-noise-suppression') return;
  if (!BackgroundNoiseSuppressionProcessor.isSupported) return;

  await track.setProcessor(new BackgroundNoiseSuppressionProcessor());
}

/**
 * Self-hosted, client-side background noise suppression for LiveKit audio.
 *
 * RNNoise is preferred at its native 48 kHz rate. SpeexDSP is used when the
 * browser provides a different AudioContext rate. If either worklet cannot be
 * loaded, a transparent Web Audio path keeps the microphone usable while the
 * browser-native suppression requested above remains active.
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
  private destinationNode?: MediaStreamAudioDestinationNode;
  private suppressionMode: SuppressionMode = 'passthrough';

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
    this.sourceNode = audioContext.createMediaStreamSource(new MediaStream([track]));
    this.destinationNode = audioContext.createMediaStreamDestination();

    try {
      const mode: Exclude<SuppressionMode, 'passthrough'> =
        audioContext.sampleRate === RNNOISE_SAMPLE_RATE ? 'rnnoise' : 'speex';
      const { node, workletUrl } = await createSuppressorNode(mode, audioContext);

      await registerWorklet(audioContext, workletUrl);
      const suppressorNode = node();
      this.suppressorNode = suppressorNode;
      suppressorNode.onprocessorerror = () => {
        if (this.suppressorNode === suppressorNode) this.enablePassthrough();
      };
      this.sourceNode.connect(suppressorNode);
      suppressorNode.connect(this.destinationNode);
      this.suppressionMode = mode;
    } catch {
      this.enablePassthrough();
    }

    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  private enablePassthrough(): void {
    if (!this.sourceNode || !this.destinationNode) return;

    this.sourceNode.disconnect();
    if (this.suppressorNode) this.suppressorNode.onprocessorerror = null;
    this.suppressorNode?.destroy();
    this.suppressorNode?.port.close();
    this.suppressorNode?.disconnect();
    this.suppressorNode = undefined;
    this.sourceNode.connect(this.destinationNode);
    this.suppressionMode = 'passthrough';
  }

  private async teardown(clearContext: boolean): Promise<void> {
    this.sourceNode?.disconnect();
    if (this.suppressorNode) this.suppressorNode.onprocessorerror = null;
    this.suppressorNode?.destroy();
    this.suppressorNode?.port.close();
    this.suppressorNode?.disconnect();
    this.destinationNode?.disconnect();
    this.processedTrack?.stop();

    this.sourceNode = undefined;
    this.suppressorNode = undefined;
    this.destinationNode = undefined;
    this.processedTrack = undefined;
    this.suppressionMode = 'passthrough';
    if (clearContext) this.audioContext = undefined;
  }
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
