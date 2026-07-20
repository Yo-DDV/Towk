import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import VoiceMessageRecorder from './VoiceMessageRecorder.svelte';

const trackStop = vi.fn();
const getUserMedia = vi.fn();
let analyserReadCount = 0;
let nextAnimationFrameID = 1;
let animationFrames = new Map<number, FrameRequestCallback>();

function runNextAnimationFrame(timestamp: number) {
  const next = animationFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
  expect(next).toBeDefined();
  animationFrames.delete(next![0]);
  next![1](timestamp);
}

class FakeMediaRecorder {
  static isTypeSupported(mimeType: string) {
    return mimeType === 'audio/webm;codecs=opus';
  }

  state: RecordingState = 'inactive';
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])])
    } as BlobEvent);
    this.onstop?.(new Event('stop'));
  }
}

class FakeAudioContext {
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }

  createAnalyser() {
    return {
      fftSize: 256,
      smoothingTimeConstant: 0,
      getByteTimeDomainData: (samples: Uint8Array) => {
        analyserReadCount += 1;
        samples.fill(analyserReadCount % 2 === 0 ? 224 : 160);
      }
    };
  }

  close() {
    return Promise.resolve();
  }
}

describe('VoiceMessageRecorder', () => {
  beforeEach(() => {
    trackStop.mockReset();
    getUserMedia.mockReset();
    analyserReadCount = 0;
    nextAnimationFrameID = 1;
    animationFrames = new Map();
    getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: trackStop }]
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextAnimationFrameID++;
      animationFrames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      animationFrames.delete(id);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voice-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('records, previews, and sends a voice draft with one action per transition', async () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValue(2_500);
    const onSend = vi.fn(async () => true);
    const onActiveChange = vi.fn();
    const { container } = render(VoiceMessageRecorder, {
      props: { onSend, onActiveChange, maxUploadSize: 1024 }
    });
    const recordButton = container.querySelector('button[aria-label="Record a voice message"]');
    expect(recordButton?.classList).toContain('h-[44px]');
    expect(recordButton?.classList).toContain('w-[44px]');

    await userEvent.click(recordButton!);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    });
    const liveWaveform = container.querySelector('[data-testid="voice-message-live-waveform"]');
    expect(liveWaveform).not.toBeNull();
    expect(liveWaveform?.classList).toContain('h-[44px]');
    expect(liveWaveform?.querySelectorAll('span[style*="height"]').length).toBe(42);

    await userEvent.click(container.querySelector('button[aria-label="Stop recording"]')!);
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="voice-message-preview"]')).not.toBeNull()
    );

    await userEvent.click(container.querySelector('button[aria-label="Send voice message"]')!);
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: 1_500,
        objectUrl: 'blob:voice-preview',
        waveformPeaks: expect.any(Array),
        file: expect.any(File)
      })
    );
    await vi.waitFor(() =>
      expect(container.querySelector('button[aria-label="Record a voice message"]')).not.toBeNull()
    );
    expect(trackStop).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-preview');
  });

  it('keeps the preview when delivery is not accepted', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(1_000).mockReturnValue(2_000);
    const onSend = vi.fn(async () => false);
    const { container } = render(VoiceMessageRecorder, { props: { onSend } });

    await userEvent.click(container.querySelector('button[aria-label="Record a voice message"]')!);
    await userEvent.click(container.querySelector('button[aria-label="Stop recording"]')!);
    await userEvent.click(container.querySelector('button[aria-label="Send voice message"]')!);

    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="voice-message-preview"]')).not.toBeNull()
    );
  });

  it('samples a stable multi-second waveform window independently of display frame rate', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const { container } = render(VoiceMessageRecorder, {
      props: { onSend: vi.fn(async () => true) }
    });

    await userEvent.click(container.querySelector('button[aria-label="Record a voice message"]')!);
    expect(analyserReadCount).toBe(1);

    runNextAnimationFrame(1_016);
    runNextAnimationFrame(1_050);
    runNextAnimationFrame(1_099);
    expect(analyserReadCount).toBe(1);

    runNextAnimationFrame(1_100);
    expect(analyserReadCount).toBe(2);
    expect(
      container.querySelectorAll(
        '[data-testid="voice-message-live-waveform"] span[style*="height"]'
      )
    ).toHaveLength(42);
  });
});
