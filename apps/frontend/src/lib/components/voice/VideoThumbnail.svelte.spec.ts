import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Track } from 'livekit-client';
import { PresenceStatus } from '$lib/render/types';
import '../../../app.css';
import VideoThumbnail from './VideoThumbnail.svelte';

describe('VideoThumbnail', () => {
  it('always contains call media so camera and screen-share pixels are never cropped', async () => {
    const track = {
      attach: vi.fn((element: HTMLVideoElement) => element),
      detach: vi.fn((element: HTMLVideoElement) => element)
    } as unknown as Track;

    const { container } = render(VideoThumbnail, {
      props: {
        track,
        name: 'Alice',
        showIdentityOverlay: false,
        user: {
          id: 'user-1',
          login: 'alice',
          displayName: 'Alice',
          avatarUrl: null,
          presenceStatus: PresenceStatus.Online
        }
      }
    });

    const video = await vi.waitFor(() => {
      const value = container.querySelector('video');
      expect(value).not.toBeNull();
      return value as HTMLVideoElement;
    });

    expect(video.className).toContain('object-contain');
    expect(video.className).not.toContain('object-cover');
    expect(video.parentElement?.className).toContain('bg-black');
    expect(track.attach as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(video);
  });
});
