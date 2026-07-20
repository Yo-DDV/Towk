import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import VoiceMessagePlayer from './VoiceMessagePlayer.svelte';
import { getToasts, toast } from '$lib/ui/toast';

function installAnimationFrameHarness() {
  let nextID = -1;
  const frames = new Map<number, FrameRequestCallback>();
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    if (!callback.toString().includes('scheduleProgressLoop')) return nativeRequest(callback);
    const id = nextID--;
    frames.set(id, callback);
    return id;
  });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    if (frames.has(id)) frames.delete(id);
    else nativeCancel(id);
  });

  function runNext(timestamp: number) {
    const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    expect(next).toBeDefined();
    frames.delete(next![0]);
    next![1](timestamp);
  }

  return { frames, request, cancel, runNext };
}

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

    const waveformBars = [
      ...container.querySelectorAll<HTMLElement>('[data-waveform-layer="base"] > span')
    ];
    const waveform = container.querySelector<HTMLElement>('[data-testid="voice-message-waveform"]');
    const waveformHeights = waveformBars.map((bar) => Number.parseInt(bar.style.height, 10));
    expect(waveformBars).toHaveLength(42);
    expect(waveform?.querySelectorAll('[data-waveform-layer="base"] > span')).toHaveLength(42);
    expect(waveform?.querySelectorAll('.voice-waveform-fill')).toHaveLength(0);
    expect(waveform?.querySelector('.h-px')).toBeNull();
    expect(Math.max(...waveformHeights)).toBeGreaterThan(28);
    expect(new Set(waveformHeights).size).toBeGreaterThan(2);
    expect(container.textContent).toContain('0:12');
    expect(container.querySelector('button[aria-label="Play voice message"]')?.classList).toContain(
      'h-[44px]'
    );
    expect(container.querySelector('button[aria-label="Play voice message"]')?.classList).toContain(
      'w-[44px]'
    );
    expect(container.querySelector('[data-testid="voice-message-waveform"]')?.classList).toContain(
      'h-[44px]'
    );

    const seek = container.querySelector('input[type="range"]') as HTMLInputElement;
    seek.value = '5';
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(audio.currentTime).toBe(5);
    expect(container.textContent).toContain('−0:07');
    expect(
      container.querySelectorAll(
        '[data-testid="voice-message-progress"] [data-progress-state="played"]'
      )
    ).toHaveLength(17);
    expect(
      container.querySelectorAll(
        '[data-testid="voice-message-progress"] [data-progress-state="active"]'
      )
    ).toHaveLength(1);
    expect(
      container.querySelector<HTMLElement>(
        '[data-testid="voice-message-progress"] [data-progress-state="active"]'
      )
    ).toHaveAttribute('data-progress-fill', '0.500');

    const speed = container.querySelector('button[aria-label^="Playback speed"]')!;
    await userEvent.click(speed);
    expect(audio.playbackRate).toBe(1.5);
    expect(speed.textContent).toContain('1.5×');
  });

  it('uses an accessible play/pause action', async () => {
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        durationMs: 1_000,
        waveformPeaks: [0.2, 0.4],
        filename: 'voice-message.wav'
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
      .element(
        container.querySelector<HTMLButtonElement>('button[aria-label="Pause voice message"]')
      )
      .toBeInTheDocument();
  });

  it('advances playback progress from the media clock between coarse media events', async () => {
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQy',
        durationMs: 4_000,
        waveformPeaks: [0.2, 0.8, 0.4, 0.6],
        filename: 'voice-message.m4a'
      }
    });
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 4 });
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 });
    Object.defineProperty(audio, 'paused', { configurable: true, writable: true, value: false });
    Object.defineProperty(audio, 'ended', { configurable: true, value: false });
    const animation = installAnimationFrameHarness();

    audio.dispatchEvent(new Event('loadedmetadata'));
    audio.dispatchEvent(new Event('play'));
    await tick();
    expect(animation.frames.size).toBe(1);

    audio.currentTime = 3;
    animation.runNext(1_000);
    await tick();

    const progress = container.querySelector<HTMLElement>('[data-testid="voice-message-progress"]');
    expect(progress).not.toBeNull();
    expect(progress).toHaveAttribute('data-played-bars', '32');
    expect(progress!.querySelectorAll('[data-progress-state="played"]')).toHaveLength(31);
    expect(progress!.querySelectorAll('[data-progress-state="active"]')).toHaveLength(1);
    expect(progress!.querySelectorAll('[data-progress-state="remaining"]')).toHaveLength(10);
    expect(
      progress!.querySelector('[data-progress-state="played"]')?.classList
    ).toContain('voice-waveform-bar--played');
    expect(
      progress!.querySelector('[data-progress-state="active"]')?.classList
    ).toContain('voice-waveform-bar--active');
    expect(progress!.querySelector('[data-progress-state="played"]')?.classList).toContain(
      'voice-waveform-bar'
    );
    expect(
      progress!.querySelector('[data-progress-state="remaining"]')?.classList
    ).toContain('voice-waveform-bar--remaining');
    expect(progress!.style.clipPath).toBe('');

    Object.defineProperty(audio, 'paused', { configurable: true, writable: true, value: true });
    audio.dispatchEvent(new Event('pause'));
    await tick();
    expect(animation.frames.size).toBe(0);
    expect(animation.cancel).toHaveBeenCalled();
  });

  it('shows buffering and recoverable playback failure inside the player', async () => {
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQy',
        durationMs: 4_000,
        waveformPeaks: [0.2, 0.8],
        filename: 'voice-message.m4a'
      }
    });
    const audio = container.querySelector('audio')!;

    audio.dispatchEvent(new Event('waiting'));
    await tick();
    expect(container.querySelector('[data-testid="voice-message-status"]')?.textContent).toContain(
      'Buffering'
    );

    audio.dispatchEvent(new Event('error'));
    await tick();
    expect(container.querySelector('[data-testid="voice-message-status"]')?.textContent).toContain(
      'could not be played'
    );
    expect(container.querySelector('button[aria-label="Retry voice message"]')).not.toBeNull();
  });

  it('falls back to media events when reduced motion is requested', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    } as unknown as MediaQueryList);
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQy',
        durationMs: 4_000,
        waveformPeaks: [0.2, 0.8],
        filename: 'voice-message.m4a'
      }
    });
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 4 });
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 });
    Object.defineProperty(audio, 'paused', { configurable: true, writable: true, value: false });
    Object.defineProperty(audio, 'ended', { configurable: true, value: false });
    const animation = installAnimationFrameHarness();

    audio.dispatchEvent(new Event('loadedmetadata'));
    audio.dispatchEvent(new Event('play'));
    await tick();
    expect(animation.frames.size).toBe(0);

    audio.currentTime = 2;
    audio.dispatchEvent(new Event('timeupdate'));
    await tick();
    const progress = container.querySelector<HTMLElement>('[data-testid="voice-message-progress"]');
    expect(progress).toHaveAttribute('data-played-bars', '21');
    expect(progress?.querySelectorAll('[data-progress-state="played"]')).toHaveLength(21);
    expect(progress?.querySelectorAll('[data-progress-state="active"]')).toHaveLength(0);
  });

  it('stops progress work in the background and resumes it when visible', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQy',
        durationMs: 4_000,
        waveformPeaks: [0.2, 0.8],
        filename: 'voice-message.m4a'
      }
    });
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'paused', { configurable: true, writable: true, value: false });
    Object.defineProperty(audio, 'ended', { configurable: true, value: false });
    const animation = installAnimationFrameHarness();

    audio.dispatchEvent(new Event('play'));
    expect(animation.frames.size).toBe(1);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(animation.frames.size).toBe(0);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(animation.frames.size).toBe(1);
  });

  it('distinguishes offline buffering and enables retry after reconnection', async () => {
    let online = false;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQy',
        durationMs: 4_000,
        waveformPeaks: [0.2, 0.8],
        filename: 'voice-message.m4a'
      }
    });
    const audio = container.querySelector('audio')!;

    audio.dispatchEvent(new Event('waiting'));
    await tick();
    expect(container.querySelector('[data-testid="voice-message-status"]')?.textContent).toContain(
      'Waiting for a connection'
    );
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Retry voice message"]')
        ?.disabled
    ).toBe(true);

    online = true;
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Retry voice message"]')
        ?.disabled
    ).toBe(false);
  });

  it('reloads failed media before a user-initiated retry', async () => {
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQy',
        durationMs: 4_000,
        waveformPeaks: [0.2, 0.8],
        filename: 'voice-message.m4a'
      }
    });
    const audio = container.querySelector('audio')!;
    const load = vi.spyOn(audio, 'load').mockImplementation(() => {});
    const play = vi.spyOn(audio, 'play').mockResolvedValue();

    audio.dispatchEvent(new Event('error'));
    await tick();
    await userEvent.click(container.querySelector('button[aria-label="Retry voice message"]')!);

    expect(load).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
  });

  it('does not leave animation frames behind after repeated playback mounts', async () => {
    const animation = installAnimationFrameHarness();

    for (let index = 0; index < 100; index += 1) {
      const rendered = render(VoiceMessagePlayer, {
        props: {
          src: 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQy',
          durationMs: 1_000,
          waveformPeaks: [0.2, 0.4],
          filename: 'voice-message.m4a'
        }
      });
      const audio = rendered.container.querySelector('audio')!;
      Object.defineProperty(audio, 'paused', { configurable: true, value: false });
      Object.defineProperty(audio, 'ended', { configurable: true, value: false });
      audio.dispatchEvent(new Event('play'));
      const playbackFrame = [...animation.frames.keys()][0];
      expect(animation.frames.size).toBe(1);
      rendered.unmount();
      expect(animation.frames.has(playbackFrame)).toBe(false);
    }

    expect(animation.frames.size).toBe(0);
    expect(
      animation.request.mock.calls.filter(([callback]) =>
        callback.toString().includes('scheduleProgressLoop')
      )
    ).toHaveLength(100);
    expect(animation.cancel.mock.calls.filter(([id]) => id < 0)).toHaveLength(100);
  });

  it('stays bounded by a narrow message column', async () => {
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/webm;base64,GkXfo0AgQoaBAULygQFC8oEEQvKB',
        durationMs: 4_000,
        waveformPeaks: Array.from({ length: 64 }, (_, index) => (index % 5 === 0 ? 0.85 : 0.12)),
        filename: 'voice-message.webm'
      }
    });
    container.style.width = '210px';
    await tick();

    const player = container.querySelector<HTMLElement>('[data-testid="voice-message-player"]')!;
    const waveform = container.querySelector<HTMLElement>(
      '[data-testid="voice-message-waveform"]'
    )!;
    const waveformBounds = waveform.getBoundingClientRect();
    const waveformLayer = waveform.querySelector<HTMLElement>('[data-waveform-layer="base"]')!;
    const waveformBars = [...waveform.querySelectorAll<HTMLElement>('[data-progress-state]')];
    expect(Math.ceil(player.getBoundingClientRect().width)).toBeLessThanOrEqual(210);
    expect(waveformBars).toHaveLength(42);
    expect(waveformLayer.classList).toContain('gap-px');
    expect(waveformBars.every((bar) => bar.classList.contains('min-w-0'))).toBe(true);
    expect(
      waveformBars.every((bar) => {
        const bounds = bar.getBoundingClientRect();
        return bounds.left >= waveformBounds.left && bounds.right <= waveformBounds.right;
      })
    ).toBe(true);
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
    vi.spyOn(audio, 'play').mockRejectedValue(
      new DOMException('decode failed', 'NotSupportedError')
    );

    await userEvent.click(container.querySelector('button[aria-label="Play voice message"]')!);

    await vi.waitFor(() =>
      expect(getToasts().map((item) => item.message)).toContain(
        'This voice message could not be played. Please try again.'
      )
    );
  });

  it('does not keep a failed player as the active playback owner', async () => {
    const first = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        durationMs: 1_000,
        waveformPeaks: [0.2],
        filename: 'first.wav'
      }
    });
    const firstAudio = first.container.querySelector('audio')!;
    const firstPause = vi.spyOn(firstAudio, 'pause');
    vi.spyOn(firstAudio, 'play').mockRejectedValue(
      new DOMException('decode failed', 'NotSupportedError')
    );

    await userEvent.click(
      first.container.querySelector('button[aria-label="Play voice message"]')!
    );

    const second = render(VoiceMessagePlayer, {
      props: {
        src: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        durationMs: 1_000,
        waveformPeaks: [0.4],
        filename: 'second.wav'
      }
    });
    const secondAudio = second.container.querySelector('audio')!;
    vi.spyOn(secondAudio, 'play').mockResolvedValue();

    await userEvent.click(
      second.container.querySelector('button[aria-label="Play voice message"]')!
    );

    expect(firstPause).not.toHaveBeenCalled();
  });

  it('unloads completed media and restores the source before replay', async () => {
    const source = 'data:audio/mp4;base64,AAAAHGZ0eXBtcDQy';
    const { container } = render(VoiceMessagePlayer, {
      props: {
        src: source,
        durationMs: 1_000,
        waveformPeaks: [0.2, 0.4],
        filename: 'voice-message.m4a'
      }
    });
    const audio = container.querySelector('audio')!;
    const load = vi.spyOn(audio, 'load').mockImplementation(() => {});
    const play = vi.spyOn(audio, 'play').mockResolvedValue();

    audio.dispatchEvent(new Event('ended'));
    await tick();

    expect(audio.getAttribute('src')).toBeNull();
    expect(load).toHaveBeenCalledOnce();

    await userEvent.click(container.querySelector('button[aria-label="Play voice message"]')!);

    expect(audio.getAttribute('src')).toBe(source);
    expect(load).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenCalledOnce();
  });
});
