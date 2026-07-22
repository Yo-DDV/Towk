import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAudioTrack, Track, type AudioProcessorOptions } from 'livekit-client';
import {
  BackgroundNoiseSuppressionProcessor,
  createAutomaticGainControlNode,
  createNoiseSuppressionNode,
  createVoiceAudioCaptureOptions,
  createVoiceAudioCaptureOptionsFor,
  ensureBackgroundNoiseSuppression
} from './backgroundNoiseSuppression';

const contexts: AudioContext[] = [];
const inputTracks: MediaStreamTrack[] = [];

afterEach(async () => {
  for (const track of inputTracks.splice(0)) track.stop();
  for (const context of contexts.splice(0)) {
    if (context.state !== 'closed') await context.close();
  }
  vi.restoreAllMocks();
});

describe('background noise suppression', () => {
  it('requests voice-safe native capture settings including automatic gain control', () => {
    const options = createVoiceAudioCaptureOptions();

    expect(options).toMatchObject({
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      voiceIsolation: true
    });
    expect(options).not.toHaveProperty('sampleRate');
    expect(options).not.toHaveProperty('processor');
  });

  it('honors per-call microphone processing preferences in capture constraints', () => {
    const options = createVoiceAudioCaptureOptionsFor({
      automaticGainControl: false,
      echoCancellation: true,
      enhancedNoiseSuppression: true,
      noiseSuppression: false
    });

    expect(options).toMatchObject({
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      voiceIsolation: false
    });
    expect(options).not.toHaveProperty('processor');
  });

  it('keeps a narrowband voice track out of the extra Web Audio clock', async () => {
    const { track } = createAudioTrack(48_000, {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16_000
    });
    const setProcessor = vi.fn();
    const localTrack = {
      getProcessor: () => undefined,
      getSourceTrackSettings: () => track.getSettings(),
      mediaStreamTrack: track,
      restartTrack: vi.fn(),
      setProcessor,
      stopProcessor: vi.fn()
    } as unknown as Pick<
      LocalAudioTrack,
      | 'getProcessor'
      | 'getSourceTrackSettings'
      | 'mediaStreamTrack'
      | 'restartTrack'
      | 'setProcessor'
      | 'stopProcessor'
    >;

    await expect(ensureBackgroundNoiseSuppression(localTrack)).resolves.toEqual({
      automaticGainControl: 'native',
      echoCancellation: true,
      noiseSuppression: 'native'
    });
    expect(setProcessor).not.toHaveBeenCalled();
  });

  it('stays native-first when a browser does not expose final voice settings', async () => {
    const { track } = createAudioTrack(48_000);
    vi.spyOn(track, 'getSettings').mockReturnValue({});
    const setProcessor = vi.fn();
    const localTrack = {
      getProcessor: () => undefined,
      getSourceTrackSettings: () => track.getSettings(),
      mediaStreamTrack: track,
      restartTrack: vi.fn(),
      setProcessor,
      stopProcessor: vi.fn()
    } as unknown as Pick<
      LocalAudioTrack,
      | 'getProcessor'
      | 'getSourceTrackSettings'
      | 'mediaStreamTrack'
      | 'restartTrack'
      | 'setProcessor'
      | 'stopProcessor'
    >;

    await expect(ensureBackgroundNoiseSuppression(localTrack)).resolves.toEqual({
      automaticGainControl: 'unknown',
      echoCancellation: null,
      noiseSuppression: 'unknown'
    });
    expect(setProcessor).not.toHaveBeenCalled();
  });

  it('does not attach enhanced processing when the user disables noise reduction', async () => {
    const settings: MediaTrackSettings = {
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      sampleRate: 48_000
    };
    const setProcessor = vi.fn();
    const localTrack = {
      getProcessor: () => undefined,
      getSourceTrackSettings: () => settings,
      mediaStreamTrack: { getSettings: () => settings },
      restartTrack: vi.fn(),
      setProcessor,
      stopProcessor: vi.fn()
    } as unknown as Pick<
      LocalAudioTrack,
      | 'getProcessor'
      | 'getSourceTrackSettings'
      | 'mediaStreamTrack'
      | 'restartTrack'
      | 'setProcessor'
      | 'stopProcessor'
    >;

    await expect(
      ensureBackgroundNoiseSuppression(localTrack, {
        automaticGainControl: true,
        echoCancellation: true,
        enhancedNoiseSuppression: true,
        noiseSuppression: false
      })
    ).resolves.toEqual({
      automaticGainControl: 'unavailable',
      echoCancellation: true,
      noiseSuppression: 'unavailable'
    });
    expect(setProcessor).not.toHaveBeenCalled();
  });

  it('attaches enhanced suppression on a compatible mobile built-in microphone', async () => {
    const settings: MediaTrackSettings = {
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      sampleRate: 48_000
    };
    const setProcessor = vi.fn();
    const localTrack = {
      getProcessor: () => undefined,
      getSourceTrackSettings: () => settings,
      mediaStreamTrack: { getSettings: () => settings },
      restartTrack: vi.fn(),
      setProcessor,
      stopProcessor: vi.fn()
    } as unknown as Pick<
      LocalAudioTrack,
      | 'getProcessor'
      | 'getSourceTrackSettings'
      | 'mediaStreamTrack'
      | 'restartTrack'
      | 'setProcessor'
      | 'stopProcessor'
    >;

    await ensureBackgroundNoiseSuppression(localTrack, undefined, {
      bluetoothRoute: false,
      documentVisible: true
    });
    expect(setProcessor).toHaveBeenCalledWith(expect.any(BackgroundNoiseSuppressionProcessor));
  });

  it('keeps Bluetooth communication routes on the native capture clock', async () => {
    const settings: MediaTrackSettings = {
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48_000
    };
    const setProcessor = vi.fn();
    const localTrack = {
      getProcessor: () => undefined,
      getSourceTrackSettings: () => settings,
      mediaStreamTrack: { getSettings: () => settings },
      restartTrack: vi.fn(),
      setProcessor,
      stopProcessor: vi.fn()
    } as unknown as Pick<
      LocalAudioTrack,
      | 'getProcessor'
      | 'getSourceTrackSettings'
      | 'mediaStreamTrack'
      | 'restartTrack'
      | 'setProcessor'
      | 'stopProcessor'
    >;

    await expect(
      ensureBackgroundNoiseSuppression(localTrack, undefined, {
        bluetoothRoute: true,
        documentVisible: true
      })
    ).resolves.toEqual({
      automaticGainControl: 'native',
      echoCancellation: true,
      noiseSuppression: 'native'
    });
    expect(setProcessor).not.toHaveBeenCalled();
  });

  it('detaches an existing enhanced processor when noise reduction is disabled', async () => {
    const { context, track } = createAudioTrack(48_000, {
      autoGainControl: false,
      echoCancellation: true,
      noiseSuppression: false
    });
    const localTrack = new LocalAudioTrack(track, track.getConstraints(), true, context);

    await ensureBackgroundNoiseSuppression(localTrack);
    expect(localTrack.getProcessor()).toBeInstanceOf(BackgroundNoiseSuppressionProcessor);

    await ensureBackgroundNoiseSuppression(localTrack, {
      automaticGainControl: false,
      echoCancellation: true,
      enhancedNoiseSuppression: true,
      noiseSuppression: false
    });

    expect(localTrack.getProcessor()).toBeUndefined();
    expect(localTrack.mediaStreamTrack).toBe(track);
  });

  it('loads the local RNNoise worklet at 48 kHz', async () => {
    const { context, track } = createAudioTrack(48_000);
    const processor = new BackgroundNoiseSuppressionProcessor();

    await processor.init(audioProcessorOptions(context, track));

    expect(processor.mode).toBe('rnnoise');
    expect(processor.processingStatus).toMatchObject({
      automaticGainControl: 'towk',
      noiseSuppression: 'rnnoise'
    });
    expect(processor.processedTrack).toMatchObject({
      kind: 'audio',
      readyState: 'live'
    });

    const processedTrack = processor.processedTrack;
    await processor.destroy();
    expect(processedTrack?.readyState).toBe('ended');
  });

  it('attenuates stationary background noise instead of only wiring a worklet', async () => {
    const frameCount = 48_000;
    const context = new OfflineAudioContext(1, frameCount, 48_000);
    const input = createStationaryNoiseBuffer(context, frameCount);
    const source = context.createBufferSource();
    source.buffer = input;
    const { mode, node } = await createNoiseSuppressionNode(context as unknown as AudioContext);
    source.connect(node).connect(context.destination);
    source.start();

    const rendered = await context.startRendering();
    const inputRms = readBufferRms(input.getChannelData(0));
    const outputRms = readBufferRms(rendered.getChannelData(0));

    expect(mode).toBe('rnnoise');
    expect(inputRms).toBeGreaterThan(0.15);
    // All three browser engines must remove at least half of the RMS level
    // from deterministic stationary noise after the RNNoise warm-up.
    expect(outputRms).toBeLessThan(inputRms * 0.5);
    node.destroy();
    node.port.close();
  });

  it('uses SpeexDSP when the browser audio context is not 48 kHz', async () => {
    const { context, track } = createAudioTrack(44_100);
    const processor = new BackgroundNoiseSuppressionProcessor();

    await processor.init(audioProcessorOptions(context, track));

    expect(context.sampleRate).toBe(44_100);
    expect(processor.mode).toBe('speex');
    expect(processor.processingStatus.automaticGainControl).toBe('towk');
    expect(processor.processedTrack?.readyState).toBe('live');
    await processor.destroy();
  });

  it('keeps suppression attached when LiveKit restarts a track without repeating AudioContext', async () => {
    const first = createAudioTrack(48_000);
    const second = createAudioTrackFromContext(first.context);
    const processor = new BackgroundNoiseSuppressionProcessor();

    await processor.init(audioProcessorOptions(first.context, first.track));
    const previousProcessedTrack = processor.processedTrack;

    await processor.restart({
      kind: Track.Kind.Audio,
      track: second
    } as AudioProcessorOptions);

    expect(previousProcessedTrack?.readyState).toBe('ended');
    expect(processor.mode).toBe('rnnoise');
    expect(processor.processedTrack).toMatchObject({
      kind: 'audio',
      readyState: 'live'
    });
    await processor.destroy();
  });

  it('bypasses Web Audio when a device restart changes the source clock', async () => {
    const first = createAudioTrack(48_000);
    const second = createAudioTrackFromContext(first.context, {
      autoGainControl: false,
      echoCancellation: true,
      noiseSuppression: false,
      sampleRate: 16_000
    });
    const processor = new BackgroundNoiseSuppressionProcessor();

    await processor.init(audioProcessorOptions(first.context, first.track));
    const previousProcessedTrack = processor.processedTrack;

    await processor.restart({
      kind: Track.Kind.Audio,
      track: second
    } as AudioProcessorOptions);

    expect(previousProcessedTrack?.readyState).toBe('ended');
    expect(processor.mode).toBe('passthrough');
    expect(processor.processedTrack).not.toBe(second);
    expect(processor.processedTrack?.readyState).toBe('live');

    const bypassTrack = processor.processedTrack;
    await processor.destroy();
    expect(bypassTrack?.readyState).toBe('ended');
    expect(second.readyState).toBe('live');
  });

  it('lets LiveKit detach a clock-mismatch bypass without stopping the microphone', async () => {
    const { context, track } = createAudioTrack(48_000, {
      sampleRate: 16_000
    });
    const localTrack = new LocalAudioTrack(track, track.getConstraints(), true, context);
    const processor = new BackgroundNoiseSuppressionProcessor();

    await localTrack.setProcessor(processor);

    expect(localTrack.mediaStreamTrack).not.toBe(track);
    expect(track.readyState).toBe('live');

    await localTrack.stopProcessor();

    expect(localTrack.mediaStreamTrack).toBe(track);
    expect(track.readyState).toBe('live');
  });

  it('detaches enhanced processing when an existing source changes to a Bluetooth clock', async () => {
    const { context, track } = createAudioTrack(48_000);
    const localTrack = new LocalAudioTrack(track, track.getConstraints(), true, context);

    await ensureBackgroundNoiseSuppression(localTrack);
    expect(localTrack.getProcessor()).toBeInstanceOf(BackgroundNoiseSuppressionProcessor);

    vi.mocked(track.getSettings).mockReturnValue({
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16_000
    });

    await expect(ensureBackgroundNoiseSuppression(localTrack)).resolves.toEqual({
      automaticGainControl: 'native',
      echoCancellation: true,
      noiseSuppression: 'native'
    });
    expect(localTrack.getProcessor()).toBeUndefined();
    expect(localTrack.mediaStreamTrack).toBe(track);
    expect(track.readyState).toBe('live');
  });

  it('reacquires native capture when processor detachment fails during a route change', async () => {
    const processor = new BackgroundNoiseSuppressionProcessor();
    const settings: MediaTrackSettings = {
      autoGainControl: true,
      channelCount: 1,
      deviceId: 'bluetooth-microphone',
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16_000
    };
    const restartTrack = vi.fn(async () => undefined);
    const localTrack = {
      getProcessor: () => processor,
      getSourceTrackSettings: () => settings,
      mediaStreamTrack: { getSettings: () => settings },
      restartTrack,
      setProcessor: vi.fn(),
      stopProcessor: vi.fn(async () => {
        throw new DOMException('route changed while detaching', 'OverconstrainedError');
      })
    } as unknown as Pick<
      LocalAudioTrack,
      | 'getProcessor'
      | 'getSourceTrackSettings'
      | 'mediaStreamTrack'
      | 'restartTrack'
      | 'setProcessor'
      | 'stopProcessor'
    >;

    await expect(ensureBackgroundNoiseSuppression(localTrack)).resolves.toEqual({
      automaticGainControl: 'native',
      echoCancellation: true,
      noiseSuppression: 'native'
    });
    expect(restartTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        autoGainControl: true,
        deviceId: { exact: 'bluetooth-microphone' },
        echoCancellation: true,
        noiseSuppression: true
      })
    );
  });

  it('ignores a late processor error from the track used before a device switch', async () => {
    const first = createAudioTrack(48_000);
    const second = createAudioTrackFromContext(first.context);
    const processor = new BackgroundNoiseSuppressionProcessor();

    await processor.init(audioProcessorOptions(first.context, first.track));
    const staleSuppressorNode = getSuppressorNode(processor);
    const staleErrorHandler = staleSuppressorNode?.onprocessorerror;
    expect(staleSuppressorNode).toBeDefined();
    expect(staleErrorHandler).toBeTypeOf('function');

    await processor.restart({
      kind: Track.Kind.Audio,
      track: second
    } as AudioProcessorOptions);
    staleErrorHandler?.call(staleSuppressorNode!, new ErrorEvent('processorerror'));

    expect(processor.mode).toBe('rnnoise');
    expect(processor.processedTrack?.readyState).toBe('live');
    await processor.destroy();
  });

  it('falls back to a live transparent track when the worklet cannot load', async () => {
    const { context, track } = createAudioTrack(48_000);
    vi.spyOn(context.audioWorklet, 'addModule').mockRejectedValueOnce(
      new Error('worklet unavailable')
    );
    const processor = new BackgroundNoiseSuppressionProcessor();

    await expect(processor.init(audioProcessorOptions(context, track))).resolves.toBeUndefined();

    expect(processor.mode).toBe('passthrough');
    expect(processor.processedTrack).toMatchObject({
      kind: 'audio',
      readyState: 'live'
    });
    await processor.destroy();
  });

  it('normalizes quiet speech without clipping loud input', async () => {
    const quiet = await renderGainControlledTone(0.02);
    const loud = await renderGainControlledTone(0.9);

    expect(readBufferRms(quiet.output)).toBeGreaterThan(readBufferRms(quiet.input) * 2);
    expect(readBufferPeak(loud.output)).toBeLessThanOrEqual(0.981);
  });
});

function createAudioTrack(
  sampleRate: number,
  settings: Partial<MediaTrackSettings> = {}
): {
  context: AudioContext;
  track: MediaStreamTrack;
} {
  const context = new AudioContext({ sampleRate });
  contexts.push(context);
  return { context, track: createAudioTrackFromContext(context, settings) };
}

function createAudioTrackFromContext(
  context: AudioContext,
  settings: Partial<MediaTrackSettings> = {}
): MediaStreamTrack {
  const destination = context.createMediaStreamDestination();
  const track = destination.stream.getAudioTracks()[0];
  // Firefox rejects constraints copied from a synthetic Web Audio destination.
  // Live microphones accept their own constraints; this fixture isolates the
  // processor attach/detach lifecycle from that unrelated browser behavior.
  vi.spyOn(track, 'applyConstraints').mockResolvedValue();
  vi.spyOn(track, 'getSettings').mockReturnValue({
    autoGainControl: false,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: false,
    sampleRate: context.sampleRate,
    ...settings
  });
  inputTracks.push(track);
  return track;
}

function createStationaryNoiseBuffer(context: BaseAudioContext, frameCount: number): AudioBuffer {
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 0x5eed1234;
  for (let index = 0; index < samples.length; index += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    samples[index] = ((seed / 0xffffffff) * 2 - 1) * 0.5;
  }
  return buffer;
}

function readBufferRms(samples: Float32Array): number {
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

function readBufferPeak(samples: Float32Array): number {
  return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
}

async function renderGainControlledTone(amplitude: number): Promise<{
  input: Float32Array;
  output: Float32Array;
}> {
  const sampleRate = 48_000;
  const context = new OfflineAudioContext(1, sampleRate, sampleRate);
  const buffer = context.createBuffer(1, sampleRate, sampleRate);
  const input = buffer.getChannelData(0);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * amplitude;
  }

  const source = context.createBufferSource();
  const inputSnapshot = new Float32Array(input);
  source.buffer = buffer;
  const automaticGainControl = await createAutomaticGainControlNode(
    context as unknown as AudioContext
  );
  source.connect(automaticGainControl).connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  automaticGainControl.port.close();
  automaticGainControl.disconnect();
  return {
    input: inputSnapshot,
    output: new Float32Array(rendered.getChannelData(0))
  };
}

function getSuppressorNode(
  processor: BackgroundNoiseSuppressionProcessor
): AudioWorkletNode | undefined {
  return (
    processor as unknown as {
      suppressorNode?: AudioWorkletNode;
    }
  ).suppressorNode;
}

function audioProcessorOptions(
  audioContext: AudioContext,
  track: MediaStreamTrack
): AudioProcessorOptions {
  return {
    audioContext,
    kind: Track.Kind.Audio,
    track
  };
}
