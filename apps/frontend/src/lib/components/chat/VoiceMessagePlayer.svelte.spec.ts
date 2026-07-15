import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import VoiceMessagePlayer from './VoiceMessagePlayer.svelte';
import { getToasts, toast } from '$lib/ui/toast';

describe('VoiceMessagePlayer', () => {
  afterEach(() => {
    toast.clear();
    vi.restoreAllMocks();
  });

  it('renders a seekable waveform and cycles playback speed', async () => {
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/webm;base64,GkXfo0AgQoaBAULygQFC8oEEQvKB',
        durationMs: 12_000,
        waveformPeaks: [0.1, 0.6, 0.3, 0.9],
        filename: 'voice-message.webm'
      }
    });
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 12 });
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 });
    audio.dispatchEvent(new Event('loadedmetadata'));
    await tick();

    expect(container.querySelectorAll('[data-testid="voice-message-waveform"] span')).toHaveLength(
      4
    );
    expect(container.textContent).toContain('0:12');

    const seek = container.querySelector('input[type="range"]') as HTMLInputElement;
    seek.value = '5';
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(audio.currentTime).toBe(5);
    expect(container.textContent).toContain('−0:07');

    const speed = container.querySelector('button[aria-label^="Playback speed"]')!;
    await userEvent.click(speed);
    expect(audio.playbackRate).toBe(1.5);
    expect(speed.textContent).toContain('1.5×');
  });

  it('uses an accessible play/pause action', async () => {
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/webm;base64,GkXfo0AgQoaBAULygQFC8oEEQvKB',
        durationMs: 1_000,
        waveformPeaks: [0.2, 0.4],
        filename: 'voice-message.webm'
      }
    });
    const audio = container.querySelector('audio')!;
    const play = vi.spyOn(audio, 'play').mockImplementation(async () => {
      Object.defineProperty(audio, 'paused', { configurable: true, value: false });
      audio.dispatchEvent(new Event('play'));
    });

    await userEvent.click(container.querySelector('button[aria-label="Play voice message"]')!);
    expect(play).toHaveBeenCalledOnce();
    await expect
      .element(container.querySelector<HTMLButtonElement>('button[aria-label="Pause voice message"]'))
      .toBeInTheDocument();
  });

  it('shows a localized error when playback cannot start', async () => {
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/webm;base64,invalid',
        durationMs: 1_000,
        waveformPeaks: [0.2],
        filename: 'voice-message.webm'
      }
    });
    const audio = container.querySelector('audio')!;
    vi.spyOn(audio, 'play').mockRejectedValue(new DOMException('decode failed', 'NotSupportedError'));

    await userEvent.click(container.querySelector('button[aria-label="Play voice message"]')!);

    await vi.waitFor(() =>
      expect(getToasts().map((item) => item.message)).toContain(
        'This voice message could not be played. Please try again.'
      )
    );
  });
});
