import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { VideoProcessingStatus } from '$lib/render/types';
import VideoPlayer from './VideoPlayer.svelte';

const TRANSPARENT_THUMBNAIL = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
const LAZY_PLAYER_TIMEOUT_MS = 10_000;

function renderAutoLoopVideo({ width, height }: { width: number; height: number }) {
  return render(VideoPlayer, {
    props: {
      status: VideoProcessingStatus.Completed,
      filename: 'clip.mp4',
      autoLoop: true,
      variants: [
        {
          url: 'https://chat.example.test/clip.mp4',
          quality: `${height}p`,
          width,
          height,
          size: 1024
        }
      ]
    }
  });
}

function renderPostedVideo({
  width,
  height,
  thumbnailUrl = null,
  variants = [
    {
      url: 'https://chat.example.test/clip.mp4',
      quality: `${height}p`,
      width,
      height,
      size: 1024
    }
  ]
}: {
  width: number;
  height: number;
  thumbnailUrl?: string | null;
  variants?: Array<{
    url: string;
    quality: string;
    width: number;
    height: number;
    size: number;
  }>;
}) {
  return render(VideoPlayer, {
    props: {
      status: VideoProcessingStatus.Completed,
      filename: 'clip.mp4',
      width,
      height,
      thumbnailUrl,
      variants
    }
  });
}

function frame(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('.embed-frame');
  expect(element).not.toBeNull();
  return element!;
}

function video(container: HTMLElement): HTMLVideoElement {
  const element = container.querySelector<HTMLVideoElement>('video[data-autoloop]');
  expect(element).not.toBeNull();
  return element!;
}

async function mediaPlayer(container: HTMLElement): Promise<HTMLElement> {
  container.querySelector<HTMLButtonElement>('[data-testid="video-player-poster-shell"]')?.click();
  await expect
    .poll(() => container.querySelector('media-player'), { timeout: LAZY_PLAYER_TIMEOUT_MS })
    .toBeTruthy();
  return container.querySelector<HTMLElement>('media-player')!;
}

async function posterImage(container: HTMLElement): Promise<HTMLImageElement> {
  await expect
    .poll(() => container.querySelector('.vds-poster img'), { timeout: LAZY_PLAYER_TIMEOUT_MS })
    .toBeTruthy();
  return container.querySelector<HTMLImageElement>('.vds-poster img')!;
}

describe('VideoPlayer', () => {
  it('keeps a stable poster frame while the custom player registers', () => {
    const { container } = renderPostedVideo({
      width: 1080,
      height: 1920,
      thumbnailUrl: TRANSPARENT_THUMBNAIL
    });

    const posterShell = container.querySelector('[data-testid="video-player-poster-shell"]');
    expect(container.querySelector('media-player')).toBeNull();
    expect(posterShell).not.toBeNull();
    expect(posterShell?.querySelector('img')?.getAttribute('src')).toBe(TRANSPARENT_THUMBNAIL);
    expect(posterShell?.textContent).not.toContain('clip.mp4');
  });

  it('renders video poster thumbnails with a skeleton until the image has loaded', () => {
    const { container } = renderPostedVideo({
      width: 1080,
      height: 1920,
      thumbnailUrl: 'https://chat.example.test/poster.webp'
    });

    const poster = container.querySelector<HTMLImageElement>(
      '[data-testid="video-player-poster-shell"] img'
    );

    expect(poster).not.toBeNull();
    expect(poster?.className).toContain('skeleton');
  });

  it('mounts the custom player only after the user opens the video', async () => {
    const { container } = renderPostedVideo({
      width: 1920,
      height: 1080,
      thumbnailUrl: TRANSPARENT_THUMBNAIL
    });

    expect(container.querySelector('media-player')).toBeNull();
    container.querySelector<HTMLButtonElement>('[data-testid="video-player-poster-shell"]')?.click();

    expect(await mediaPlayer(container)).not.toBeNull();
  });

  it('frames 16:9 videos as 16:9 embeds', () => {
    const { container } = renderAutoLoopVideo({ width: 1600, height: 900 });

    expect(frame(container).getAttribute('style')).toContain('aspect-ratio: 480 / 270');
    expect(video(container).className).toContain('h-full');
    expect(video(container).className).toContain('w-full');
  });

  it('preserves 4:3 autoloop videos instead of forcing 16:9', () => {
    const { container } = renderAutoLoopVideo({ width: 640, height: 480 });

    expect(frame(container).getAttribute('style')).toContain('aspect-ratio: 427 / 320');
  });

  it('presents near-square posted landscape videos in a 16:9 frame', async () => {
    const { container } = renderPostedVideo({
      width: 1024,
      height: 768,
      thumbnailUrl: TRANSPARENT_THUMBNAIL
    });

    const player = await mediaPlayer(container);
    const poster = await posterImage(container);

    expect(frame(container).getAttribute('style')).toContain('aspect-ratio: 640 / 360');
    expect(player.dataset.fit).toBe('cover');
    expect(getComputedStyle(poster).objectFit).toBe('cover');
  });

  it('gives portrait posted videos a watchable responsive inline frame', async () => {
    const { container } = renderPostedVideo({
      width: 1080,
      height: 1920,
      thumbnailUrl: TRANSPARENT_THUMBNAIL
    });

    const player = await mediaPlayer(container);
    const style = frame(container).getAttribute('style');

    expect(style).toContain('aspect-ratio: 360 / 640');
    expect(style).toContain('width: min(100%, 360px, 40.5svh)');
    expect(player.dataset.fit).toBe('contain');
  });

  it('lets landscape posted videos use the available message width', async () => {
    const { container } = renderPostedVideo({
      width: 1920,
      height: 1080,
      thumbnailUrl: TRANSPARENT_THUMBNAIL
    });

    await mediaPlayer(container);

    expect(frame(container).getAttribute('style')).toContain('aspect-ratio: 640 / 360');
  });

  it('passes every portable MP4 variant to Vidstack with explicit media metadata', async () => {
    const { container } = renderPostedVideo({
      width: 1280,
      height: 720,
      variants: [
        {
          url: 'https://chat.example.test/clip-480.mp4',
          quality: '480p',
          width: 854,
          height: 480,
          size: 512
        },
        {
          url: 'https://chat.example.test/clip-720.mp4',
          quality: '720p',
          width: 1280,
          height: 720,
          size: 1024
        }
      ]
    });

    const player = await mediaPlayer(container);

    expect((player as HTMLElement & { src?: unknown }).src).toEqual([
      {
        src: 'https://chat.example.test/clip-720.mp4',
        type: 'video/mp4',
        width: 1280,
        height: 720
      },
      {
        src: 'https://chat.example.test/clip-480.mp4',
        type: 'video/mp4',
        width: 854,
        height: 480
      }
    ]);
  });

  it('opens fullscreen with the highest quality variant', async () => {
    const { fullscreenVideo } = await import('$lib/state/globals.svelte');
    fullscreenVideo.close();

    const { container } = renderPostedVideo({
      width: 1280,
      height: 720,
      variants: [
        {
          url: 'https://chat.example.test/clip-480.mp4',
          quality: '480p',
          width: 854,
          height: 480,
          size: 512
        },
        {
          url: 'https://chat.example.test/clip-720.mp4',
          quality: '720p',
          width: 1280,
          height: 720,
          size: 1024
        }
      ]
    });

    const player = await mediaPlayer(container);
    player.dispatchEvent(new Event('media-enter-fullscreen-request', { cancelable: true }));
    await tick();

    expect(fullscreenVideo.src).toBe('https://chat.example.test/clip-720.mp4');
    fullscreenVideo.close();
  });

  it('corrects stale metadata after the browser loads intrinsic video dimensions', async () => {
    const { container } = renderAutoLoopVideo({ width: 1024, height: 768 });
    const media = video(container);

    expect(frame(container).getAttribute('style')).toContain('aspect-ratio: 427 / 320');

    Object.defineProperty(media, 'videoWidth', { configurable: true, value: 1920 });
    Object.defineProperty(media, 'videoHeight', { configurable: true, value: 1080 });
    media.dispatchEvent(new Event('loadedmetadata'));
    await tick();

    expect(frame(container).getAttribute('style')).toContain('aspect-ratio: 480 / 270');
  });

  it('falls back to the original GIF when the optimized video cannot load', async () => {
    const onMediaError = vi.fn();
    const { container } = render(VideoPlayer, {
      props: {
        status: VideoProcessingStatus.Completed,
        filename: 'animated.gif',
        autoLoop: true,
        fallbackImageUrl: TRANSPARENT_THUMBNAIL,
        onMediaError,
        variants: [
          {
            url: 'https://chat.example.test/animated.mp4',
            quality: '480p',
            width: 640,
            height: 480,
            size: 1024
          }
        ]
      } as never
    });

    video(container).dispatchEvent(new Event('error'));
    await tick();

    const fallback = container.querySelector<HTMLImageElement>('img[alt="animated.gif"]');
    expect(fallback?.getAttribute('src')).toBe(TRANSPARENT_THUMBNAIL);
    expect(onMediaError).toHaveBeenCalledOnce();
  });

  it('uses the lightest processed variant for animated GIF autoloop playback', () => {
    const { container } = render(VideoPlayer, {
      props: {
        status: VideoProcessingStatus.Completed,
        filename: 'animated.gif',
        autoLoop: true,
        variants: [
          {
            url: 'https://chat.example.test/animated-720.mp4',
            quality: '720p',
            width: 1280,
            height: 720,
            size: 4096
          },
          {
            url: 'https://chat.example.test/animated-480.mp4',
            quality: '480p',
            width: 854,
            height: 480,
            size: 1024
          }
        ]
      } as never
    });

    expect(container.querySelector('source')?.getAttribute('src')).toBe(
      'https://chat.example.test/animated-480.mp4'
    );
  });
});
