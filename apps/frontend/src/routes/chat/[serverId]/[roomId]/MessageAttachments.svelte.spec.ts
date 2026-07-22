import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import MessageAttachments from './MessageAttachments.svelte';
import { FitMode, type MessageAttachmentView } from '$lib/render/types';
import type { RefreshedAttachmentUrls } from '$lib/attachments/attachmentUrls';

const attachmentMocks = vi.hoisted(() => ({
  pushState: vi.fn(),
  refreshAssetUrls: vi.fn()
}));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  pushState: attachmentMocks.pushState,
  replaceState: vi.fn()
}));

vi.mock('$lib/api-client/attachments', () => ({
  createAttachmentAPI: vi.fn(() => ({
    refreshAssetUrls: attachmentMocks.refreshAssetUrls
  }))
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    serverId: 'server_1',
    connectBaseUrl: 'https://chat.example.test/api/connect',
    bearerToken: null
  })
}));

const transparentGif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function emptyRefreshedUrls(): RefreshedAttachmentUrls {
  return {
    assetUrl: null,
    thumbnailAssetUrl: null,
    videoThumbnailAssetUrl: null,
    variantAssetUrls: new Map()
  };
}

function imageAttachment(overrides: Partial<MessageAttachmentView>): MessageAttachmentView {
  return {
    id: 'att_1',
    filename: 'image.jpg',
    contentType: 'image/jpeg',
    width: 800,
    height: 600,
    assetUrl: {
      url: transparentGif,
      expiresAt: '2027-05-29T15:00:00Z'
    },
    thumbnailAssetUrl: {
      url: `${transparentGif}#thumb`,
      expiresAt: '2027-05-29T15:00:00Z'
    },
    videoProcessing: null,
    ...overrides
  };
}

function fileAttachment(overrides: Partial<MessageAttachmentView>): MessageAttachmentView {
  return {
    id: 'file_1',
    filename: 'document.pdf',
    contentType: 'application/pdf',
    width: 0,
    height: 0,
    assetUrl: {
      url: 'https://chat.example.test/document.pdf',
      expiresAt: '2027-05-29T15:00:00Z'
    },
    thumbnailAssetUrl: null,
    videoProcessing: null,
    ...overrides
  };
}

function renderAttachments(
  attachments: MessageAttachmentView[],
  options: { canDeleteAttachment?: boolean; videoProcessingEnabled?: boolean } = {}
) {
  return render(MessageAttachments, {
    props: {
      attachments,
      serverId: 'server_1',
      roomId: 'room_1',
      eventId: 'event_1',
      ...options
    }
  });
}

function renderAttachment(
  attachment: MessageAttachmentView,
  options: { canDeleteAttachment?: boolean; videoProcessingEnabled?: boolean } = {}
) {
  return renderAttachments([attachment], options);
}

function imageFrame(container: HTMLElement, filename: string) {
  const image = container.querySelector<HTMLImageElement>(`img[alt="${filename}"]`);
  expect(image).not.toBeNull();
  const button = image?.closest('button');
  expect(button).not.toBeNull();
  return { image: image!, button: button! };
}

describe('MessageAttachments', () => {
  beforeEach(() => {
    attachmentMocks.pushState.mockReset();
    attachmentMocks.refreshAssetUrls.mockReset();
    attachmentMocks.refreshAssetUrls.mockResolvedValue(new Map());
  });

  it('renders very tall portrait images as contained narrow strips', () => {
    const { container } = renderAttachment(
      imageAttachment({
        filename: 'tall.jpg',
        width: 320,
        height: 1600
      })
    );

    const { image, button } = imageFrame(container, 'tall.jpg');

    expect(button.getAttribute('style')).toContain('width: 40px');
    expect(button.getAttribute('style')).toContain('aspect-ratio: 40 / 200');
    expect(image.className).toContain('object-contain');
    expect(image.className).not.toContain('object-cover');
    expect(image.className).toContain('h-full');
    expect(image.className).toContain('w-full');
  });

  it('renders ultra-wide landscape images as contained shallow strips', () => {
    const { container } = renderAttachment(
      imageAttachment({
        filename: 'ultra-wide.jpg',
        width: 2000,
        height: 100
      })
    );

    const { image, button } = imageFrame(container, 'ultra-wide.jpg');

    expect(button.getAttribute('style')).toContain('width: 480px');
    expect(button.getAttribute('style')).toContain('aspect-ratio: 480 / 24');
    expect(image.className).toContain('object-contain');
    expect(image.className).not.toContain('object-cover');
    expect(image.className).toContain('h-full');
    expect(image.className).toContain('w-full');
  });

  it('keeps ordinary images proportionally sized', () => {
    const { container } = renderAttachment(
      imageAttachment({
        filename: 'ordinary.jpg',
        width: 1600,
        height: 900
      })
    );

    const { image, button } = imageFrame(container, 'ordinary.jpg');

    expect(button.getAttribute('style')).toContain('width: 356px');
    expect(button.getAttribute('style')).toContain('aspect-ratio: 356 / 200');
    expect(image.className).toContain('object-cover');
    expect(image.className).toContain('h-full');
    expect(image.className).toContain('w-full');
  });

  it('reserves a stable frame for images without intrinsic dimensions', () => {
    const { container } = renderAttachment(
      imageAttachment({
        filename: 'legacy-without-dimensions.jpg',
        width: 0,
        height: 0
      })
    );

    const { image, button } = imageFrame(container, 'legacy-without-dimensions.jpg');

    expect(button.getAttribute('style')).toContain('width: 192px');
    expect(button.getAttribute('style')).toContain('aspect-ratio: 192 / 128');
    expect(image.getAttribute('loading')).toBe('eager');
    expect(image.getAttribute('decoding')).toBe('async');
    expect(image.className).toContain('object-contain');
    expect(image.className).toContain('h-full');
    expect(image.className).toContain('w-full');
  });

  it('uses the original GIF instead of an animated thumbnail derivative', () => {
    const { container } = renderAttachment(
      imageAttachment({
        filename: 'animated.gif',
        contentType: 'image/gif'
      })
    );

    const { image } = imageFrame(container, 'animated.gif');

    expect(image.getAttribute('src')).toBe(transparentGif);
  });

  it('uses a subtle attachment remove control when deletion is allowed', () => {
    const { container } = renderAttachment(
      imageAttachment({
        filename: 'delete-me.jpg'
      }),
      { canDeleteAttachment: true }
    );

    const deleteControl = container.querySelector<HTMLElement>('[aria-label="Delete attachment"]');

    expect(deleteControl).not.toBeNull();
    expect(deleteControl!.getAttribute('title')).toBe('Delete attachment');
    expect(deleteControl!.className).toContain('attachment-remove-button');
    expect(deleteControl!.className).not.toContain('embed-control-button');
  });

  it('waits for a portable variant before rendering a raw MP4 when video processing is enabled', () => {
    const { container } = renderAttachment(
      fileAttachment({
        id: 'raw_video',
        filename: 'original.mp4',
        contentType: 'video/mp4',
        assetUrl: {
          url: 'https://chat.example.test/original.mp4',
          expiresAt: '2027-05-29T15:00:00Z'
        }
      }),
      { canDeleteAttachment: true }
    );

    expect(container.querySelector('[data-testid="raw-video-player"]')).toBeNull();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(container.querySelector('[aria-label="Delete attachment"]')).not.toBeNull();
  });

  it('renders a raw video player only when portable video processing is unavailable', () => {
    const { container } = renderAttachment(
      fileAttachment({
        id: 'raw_video_disabled_processing',
        filename: 'original.mp4',
        contentType: 'video/mp4',
        assetUrl: {
          url: 'https://chat.example.test/original.mp4',
          expiresAt: '2027-05-29T15:00:00Z'
        }
      }),
      { canDeleteAttachment: true, videoProcessingEnabled: false }
    );

    const player = container.querySelector<HTMLVideoElement>('[data-testid="raw-video-player"]');
    expect(player).not.toBeNull();
    expect(player!.getAttribute('src')).toBe('https://chat.example.test/original.mp4');
    expect(player!.getAttribute('aria-label')).toBe('original.mp4');
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.querySelector('[aria-label="Delete attachment"]')).not.toBeNull();
  });

  it('keeps the raw video player when portable video processing is unavailable', async () => {
    const { container } = renderAttachment(
      fileAttachment({
        id: 'server_without_processing',
        filename: 'iphone-screen-recording.mp4',
        contentType: 'video/mp4',
        assetUrl: {
          url: 'https://chat.example.test/iphone-screen-recording.mp4',
          expiresAt: '2027-05-29T15:00:00Z'
        }
      }),
      { videoProcessingEnabled: false }
    );

    const player = container.querySelector<HTMLVideoElement>('[data-testid="raw-video-player"]');

    expect(player).not.toBeNull();
    expect(player?.className).toContain('raw-inline-video');

    Object.defineProperty(player!, 'videoWidth', { configurable: true, value: 0 });
    Object.defineProperty(player!, 'videoHeight', { configurable: true, value: 0 });

    player!.dispatchEvent(new Event('loadedmetadata'));
    await tick();

    expect(container.querySelector('[data-testid="raw-video-player"]')).not.toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(attachmentMocks.refreshAssetUrls).not.toHaveBeenCalled();
  });

  it('keeps the raw video player after playback errors when portable video processing is unavailable', async () => {
    const { container } = renderAttachment(
      fileAttachment({
        id: 'server_without_processing_error',
        filename: 'iphone-video.mp4',
        contentType: 'video/mp4',
        assetUrl: {
          url: 'https://chat.example.test/iphone-video.mp4',
          expiresAt: '2027-05-29T15:00:00Z'
        }
      }),
      { videoProcessingEnabled: false }
    );

    const player = container.querySelector<HTMLVideoElement>('[data-testid="raw-video-player"]');

    expect(player).not.toBeNull();

    player!.dispatchEvent(new Event('error'));
    await tick();

    expect(container.querySelector('[data-testid="raw-video-player"]')).not.toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(attachmentMocks.refreshAssetUrls).toHaveBeenCalled();
  });

  it('waits for a portable variant before rendering a QuickTime video', () => {
    const { container } = renderAttachment(
      fileAttachment({
        id: 'iphone_video',
        filename: 'IMG_0420.MOV',
        contentType: 'video/quicktime',
        assetUrl: {
          url: 'https://chat.example.test/IMG_0420.MOV',
          expiresAt: '2027-05-29T15:00:00Z'
        }
      }),
      { canDeleteAttachment: true }
    );

    expect(container.querySelector('[data-testid="raw-video-player"]')).toBeNull();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(container.querySelector('[aria-label="Delete attachment"]')).not.toBeNull();
  });

  it('does not show an infinite processing placeholder for QuickTime when video processing is unavailable', () => {
    const { container } = renderAttachment(
      fileAttachment({
        id: 'iphone_video_disabled_processing',
        filename: 'IMG_0420.MOV',
        contentType: 'video/quicktime',
        assetUrl: {
          url: 'https://chat.example.test/IMG_0420.MOV',
          expiresAt: '2027-05-29T15:00:00Z'
        }
      }),
      { videoProcessingEnabled: false }
    );

    expect(container.querySelector('[data-testid="raw-video-player"]')).not.toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('renders first-class voice metadata with the custom player while keeping generic audio native', () => {
    const { container } = renderAttachments([
      fileAttachment({
        id: 'voice_1',
        filename: 'voice-message.webm',
        contentType: 'audio/webm',
        assetUrl: {
          url: 'data:audio/webm;base64,GkXfo0AgQoaBAULygQFC8oEEQvKB',
          expiresAt: '2027-05-29T15:00:00Z'
        },
        voiceMessage: { durationMs: 4_200, waveformPeaks: [0.1, 0.8, 0.3] }
      }),
      fileAttachment({
        id: 'audio_1',
        filename: 'song.ogg',
        contentType: 'audio/ogg',
        assetUrl: {
          url: 'data:audio/ogg;base64,T2dnUwACAAAAAAAAAAD',
          expiresAt: '2027-05-29T15:00:00Z'
        },
        voiceMessage: null
      })
    ]);

    expect(container.querySelectorAll('[data-testid="voice-message-player"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="audio-player"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="audio-download-button"]')).not.toBeNull();
    expect(container.textContent).toContain('song.ogg');
  });

  it('keeps the voice delete control inside the player at narrow widths', async () => {
    const { container } = renderAttachment(
      fileAttachment({
        id: 'voice_delete',
        filename: 'voice-message.webm',
        contentType: 'audio/webm',
        assetUrl: {
          url: 'data:audio/webm;base64,GkXfo0AgQoaBAULygQFC8oEEQvKB',
          expiresAt: '2027-05-29T15:00:00Z'
        },
        voiceMessage: { durationMs: 4_200, waveformPeaks: [0.1, 0.8, 0.3] }
      }),
      { canDeleteAttachment: true }
    );
    container.style.width = '280px';
    await tick();

    const attachment = container.querySelector<HTMLElement>(
      '[data-testid="voice-message-attachment"]'
    );
    const player = container.querySelector<HTMLElement>('[data-testid="voice-message-player"]');
    const deleteControl = container.querySelector<HTMLElement>('[aria-label="Delete attachment"]');

    expect(attachment).not.toBeNull();
    expect(attachment!.classList).not.toContain('pr-7');
    expect(attachment!.classList).toContain('overflow-hidden');
    expect(player?.classList).toContain('pr-12');
    expect(deleteControl?.classList).toContain('voice-message-remove-button');
    expect(deleteControl?.classList).toContain('top-1/2');
    expect(deleteControl?.classList).toContain('right-1');
    expect(deleteControl?.classList).toContain('-translate-y-1/2');
    expect(deleteControl?.classList).not.toContain('top-2');
    expect(deleteControl?.classList).not.toContain('right-2');
    expect(deleteControl?.classList).toContain('h-11');
    expect(deleteControl?.classList).toContain('w-11');
    expect(deleteControl!.getBoundingClientRect().right).toBeLessThanOrEqual(
      attachment!.getBoundingClientRect().right
    );
  });

  it('does not render empty media URLs for attachments that are missing asset URLs', () => {
    const { container } = renderAttachment(
      imageAttachment({
        filename: 'pending.jpg',
        assetUrl: null,
        thumbnailAssetUrl: null
      })
    );

    expect(container.querySelector('img[src=""]')).toBeNull();
    expect(container.querySelector('video[src=""]')).toBeNull();
    expect(container.querySelector('audio[src=""]')).toBeNull();
    expect(container.querySelector('img[alt="pending.jpg"]')).toBeNull();
  });

  it('clears stale image URLs when refresh returns null asset URLs', async () => {
    attachmentMocks.refreshAssetUrls.mockResolvedValue(new Map([['att_1', emptyRefreshedUrls()]]));
    const { container } = renderAttachment(
      imageAttachment({
        filename: 'expired.jpg',
        thumbnailAssetUrl: null
      })
    );

    const image = container.querySelector<HTMLImageElement>('img[alt="expired.jpg"]');
    expect(image).not.toBeNull();
    image!.dispatchEvent(new Event('error'));

    await vi.waitFor(() => {
      expect(container.querySelector('img[alt="expired.jpg"]')).toBeNull();
    });
  });

  it('does not open a different gallery image when the clicked image URL is cleared', async () => {
    attachmentMocks.refreshAssetUrls.mockResolvedValue(
      new Map([['cleared', emptyRefreshedUrls()]])
    );
    const { container } = renderAttachments([
      imageAttachment({
        id: 'cleared',
        filename: 'cleared.jpg'
      }),
      imageAttachment({
        id: 'kept',
        filename: 'kept.jpg'
      })
    ]);

    const { button } = imageFrame(container, 'cleared.jpg');
    button.click();

    await vi.waitFor(() => {
      expect(attachmentMocks.refreshAssetUrls).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(container.querySelector('img[alt="cleared.jpg"]')).toBeNull();
    });
    expect(attachmentMocks.pushState).not.toHaveBeenCalled();
  });

  it('opens the lightbox with a compressed display URL and a separate original URL', async () => {
    attachmentMocks.refreshAssetUrls.mockResolvedValue(
      new Map([
        [
          'att_1',
          {
            assetUrl: {
              url: 'https://cdn.example.test/original.jpg',
              expiresAt: '2027-05-29T15:00:00Z'
            },
            thumbnailAssetUrl: {
              url: 'https://cdn.example.test/lightbox.jpg',
              expiresAt: '2027-05-29T15:00:00Z'
            },
            videoThumbnailAssetUrl: null,
            variantAssetUrls: new Map()
          }
        ]
      ])
    );
    const { container } = renderAttachment(imageAttachment({ filename: 'large.jpg' }));

    imageFrame(container, 'large.jpg').button.click();

    await vi.waitFor(() => {
      expect(attachmentMocks.refreshAssetUrls).toHaveBeenCalledWith('room_1', ['att_1'], {
        width: 2048,
        height: 2048,
        fit: FitMode.Contain
      });
      expect(attachmentMocks.pushState).toHaveBeenCalledWith('', {
        modal: {
          type: 'imageViewer',
          roomId: 'room_1',
          eventId: 'event_1',
          imageItems: [
            {
              id: 'att_1',
              src: 'https://cdn.example.test/lightbox.jpg',
              originalSrc: 'https://cdn.example.test/original.jpg',
              alt: 'large.jpg',
              filename: 'large.jpg'
            }
          ],
          imageIndex: 0
        }
      });
    });
  });

  it('opens GIFs in the lightbox from the original asset URL', async () => {
    attachmentMocks.refreshAssetUrls.mockResolvedValue(
      new Map([
        [
          'att_1',
          {
            assetUrl: {
              url: 'https://cdn.example.test/original.gif',
              expiresAt: '2027-05-29T15:00:00Z'
            },
            thumbnailAssetUrl: {
              url: 'https://cdn.example.test/animated-thumbnail.webp',
              expiresAt: '2027-05-29T15:00:00Z'
            },
            videoThumbnailAssetUrl: null,
            variantAssetUrls: new Map()
          }
        ]
      ])
    );
    const { container } = renderAttachment(
      imageAttachment({ filename: 'animated.gif', contentType: 'image/gif' })
    );

    imageFrame(container, 'animated.gif').button.click();

    await vi.waitFor(() => {
      expect(attachmentMocks.pushState).toHaveBeenCalledWith('', {
        modal: expect.objectContaining({
          imageItems: [
            expect.objectContaining({
              src: 'https://cdn.example.test/original.gif',
              originalSrc: 'https://cdn.example.test/original.gif'
            })
          ]
        })
      });
    });
  });

  it('renders multiple images inside a horizontal gallery with equal-height frames', () => {
    const { container } = renderAttachments([
      imageAttachment({
        id: 'wide',
        filename: 'wide.jpg',
        width: 1600,
        height: 900
      }),
      imageAttachment({
        id: 'tall',
        filename: 'tall.jpg',
        width: 320,
        height: 1600
      })
    ]);

    const gallery = container.querySelector<HTMLElement>('[data-testid="message-image-gallery"]');
    expect(gallery).not.toBeNull();
    expect(gallery!.className).toContain('overflow-x-auto');
    expect(gallery!.className).toContain('overscroll-x-contain');
    expect(gallery!.className).toContain('gap-3');
    expect(gallery!.className).toContain('p-1');
    expect(gallery!.parentElement?.className).toContain('w-full');
    expect(gallery!.parentElement?.getAttribute('style')).toBeNull();
    expect(
      container.querySelector('[data-testid="message-image-gallery-left-fade"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="message-image-gallery-right-fade"]')
    ).not.toBeNull();

    const buttons = Array.from(gallery!.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.style.height)).toEqual(['180px', '180px']);
    expect(buttons.every((button) => Number.parseFloat(button.style.width) <= 320)).toBe(true);
  });

  it('fills moderately wide gallery image frames', () => {
    const { container } = renderAttachments([
      imageAttachment({
        id: 'moderately-wide',
        filename: 'moderately-wide.jpg',
        width: 1200,
        height: 600
      }),
      imageAttachment({
        id: 'ordinary',
        filename: 'ordinary.jpg',
        width: 800,
        height: 600
      })
    ]);

    const { image, button } = imageFrame(container, 'moderately-wide.jpg');

    expect(button.closest('[data-testid="message-image-gallery"]')).not.toBeNull();
    expect(button.getAttribute('style')).toContain('width: 320px');
    expect(button.getAttribute('style')).toContain('height: 180px');
    expect(image.className).toContain('object-cover');
    expect(image.className).not.toContain('object-contain');
  });

  it('fills moderately tall gallery image frames', () => {
    const { container } = renderAttachments([
      imageAttachment({
        id: 'moderately-tall',
        filename: 'moderately-tall.jpg',
        width: 400,
        height: 1000
      }),
      imageAttachment({
        id: 'ordinary',
        filename: 'ordinary.jpg',
        width: 800,
        height: 600
      })
    ]);

    const { image, button } = imageFrame(container, 'moderately-tall.jpg');

    expect(button.closest('[data-testid="message-image-gallery"]')).not.toBeNull();
    expect(button.getAttribute('style')).toContain('width: 72px');
    expect(button.getAttribute('style')).toContain('height: 180px');
    expect(image.className).toContain('object-cover');
    expect(image.className).not.toContain('object-contain');
  });

  it('contains ultra-wide gallery images instead of creating shallow thumbnails', () => {
    const { container } = renderAttachments([
      imageAttachment({
        id: 'ultra-wide',
        filename: 'ultra-wide.jpg',
        width: 2000,
        height: 100
      }),
      imageAttachment({
        id: 'ordinary',
        filename: 'ordinary.jpg',
        width: 1600,
        height: 900
      })
    ]);

    const { image, button } = imageFrame(container, 'ultra-wide.jpg');

    expect(button.closest('[data-testid="message-image-gallery"]')).not.toBeNull();
    expect(button.getAttribute('style')).toContain('width: 320px');
    expect(button.getAttribute('style')).toContain('height: 180px');
    expect(image.className).toContain('object-contain');
    expect(image.className).not.toContain('object-cover');
  });

  it('contains ultra-tall gallery images instead of cropping them', () => {
    const { container } = renderAttachments([
      imageAttachment({
        id: 'ultra-tall',
        filename: 'ultra-tall.jpg',
        width: 320,
        height: 1600
      }),
      imageAttachment({
        id: 'ordinary',
        filename: 'ordinary.jpg',
        width: 1600,
        height: 900
      })
    ]);

    const { image, button } = imageFrame(container, 'ultra-tall.jpg');

    expect(button.closest('[data-testid="message-image-gallery"]')).not.toBeNull();
    expect(button.getAttribute('style')).toContain('width: 72px');
    expect(button.getAttribute('style')).toContain('height: 180px');
    expect(image.className).toContain('object-contain');
    expect(image.className).not.toContain('object-cover');
  });

  it('renders image galleries before non-image attachments in mixed messages', () => {
    const { container } = renderAttachments([
      imageAttachment({
        id: 'first-image',
        filename: 'first.jpg'
      }),
      fileAttachment({
        id: 'document',
        filename: 'document.pdf'
      }),
      imageAttachment({
        id: 'second-image',
        filename: 'second.jpg'
      })
    ]);

    const gallery = container.querySelector<HTMLElement>('[data-testid="message-image-gallery"]');
    const downloadButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Download"]'
    );

    expect(gallery).not.toBeNull();
    expect(gallery!.querySelectorAll('button[aria-label^="View"]')).toHaveLength(2);
    expect(downloadButton).not.toBeNull();
    expect(
      gallery!.compareDocumentPosition(downloadButton!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
