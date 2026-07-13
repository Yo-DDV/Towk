import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { Track, type AudioProcessorOptions } from 'livekit-client';
import {
  BackgroundNoiseSuppressionProcessor,
  createVoiceAudioCaptureOptions
} from './backgroundNoiseSuppression';

const contexts: AudioContext[] = [];
const inputTracks: MediaStreamTrack[] = [];

afterEach(async () => {
  for (const track of inputTracks.splice(0)) track.stop();
  for (const context of contexts.splice(0)) {
    if (context.state !== 'closed') await context.close();
  }
});

describe('background noise suppression', () => {
  it('requests voice-safe native capture settings without automatic gain control', () => {
    const options = createVoiceAudioCaptureOptions();

    expect(options).toMatchObject({
      autoGainControl: false,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48_000
    });
    expect(options).not.toHaveProperty('processor');
  });

  it('loads the local RNNoise worklet at 48 kHz', async () => {
    const { context, track } = createAudioTrack(48_000);
    const processor = new BackgroundNoiseSuppressionProcessor();

    await processor.init(audioProcessorOptions(context, track));

    expect(processor.mode).toBe('rnnoise');
    expect(processor.processedTrack).toMatchObject({
      kind: 'audio',
      readyState: 'live'
    });

    const processedTrack = processor.processedTrack;
    await processor.destroy();
    expect(processedTrack?.readyState).toBe('ended');
  });

  it('attenuates stationary background noise instead of only wiring a worklet', async () => {
    await userEvent.click(document.body);
    const context = new AudioContext({ sampleRate: 48_000 });
    contexts.push(context);
    const input = createStationaryNoiseTrack(context);
    const processor = new BackgroundNoiseSuppressionProcessor();

    await processor.init(audioProcessorOptions(context, input.track));
    const processedTrack = processor.processedTrack;
    expect(processedTrack).toBeDefined();

    const outputSource = context.createMediaStreamSource(new MediaStream([processedTrack!]));
    const outputAnalyser = context.createAnalyser();
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    outputSource.connect(outputAnalyser).connect(silentOutput).connect(context.destination);
    input.source.start();
    await context.resume();

    await vi.waitFor(
      () => {
        const inputRms = readRms(input.analyser);
        const outputRms = readRms(outputAnalyser);
        expect(inputRms).toBeGreaterThan(0.15);
        // All three browser engines must remove at least half of the RMS level
        // from deterministic stationary noise after the RNNoise warm-up.
        expect(outputRms).toBeLessThan(inputRms * 0.5);
      },
      { timeout: 4_000, interval: 100 }
    );

    input.source.stop();
    outputSource.disconnect();
    await processor.destroy();
  });

  it('uses SpeexDSP when the browser audio context is not 48 kHz', async () => {
    const { context, track } = createAudioTrack(44_100);
    const processor = new BackgroundNoiseSuppressionProcessor();

    await processor.init(audioProcessorOptions(context, track));

    expect(context.sampleRate).toBe(44_100);
    expect(processor.mode).toBe('speex');
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
});

function createAudioTrack(sampleRate: number): {
  context: AudioContext;
  track: MediaStreamTrack;
} {
  const context = new AudioContext({ sampleRate });
  contexts.push(context);
  return { context, track: createAudioTrackFromContext(context) };
}

function createAudioTrackFromContext(context: AudioContext): MediaStreamTrack {
  const destination = context.createMediaStreamDestination();
  const track = destination.stream.getAudioTracks()[0];
  inputTracks.push(track);
  return track;
}

function createStationaryNoiseTrack(context: AudioContext): {
  analyser: AnalyserNode;
  source: AudioBufferSourceNode;
  track: MediaStreamTrack;
} {
  const frameCount = context.sampleRate;
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 0x5eed1234;
  for (let index = 0; index < samples.length; index += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    samples[index] = ((seed / 0xffffffff) * 2 - 1) * 0.5;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  const destination = context.createMediaStreamDestination();
  source.connect(analyser).connect(destination);
  const track = destination.stream.getAudioTracks()[0];
  inputTracks.push(track);
  return { analyser, source, track };
}

function readRms(analyser: AnalyserNode): number {
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
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
