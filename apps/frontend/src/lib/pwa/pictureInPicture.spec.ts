import { describe, expect, it, vi } from 'vitest';
import { supportsVideoPictureInPicture, toggleVideoPictureInPicture } from './pictureInPicture';

describe('video Picture-in-Picture', () => {
  it('detects standards and Apple video presentation modes', () => {
    expect(
      supportsVideoPictureInPicture({ pictureInPictureEnabled: true } as Document, {
        requestPictureInPicture: vi.fn()
      })
    ).toBe(true);
    expect(
      supportsVideoPictureInPicture({} as Document, { webkitSetPresentationMode: vi.fn() })
    ).toBe(true);
    expect(supportsVideoPictureInPicture({} as Document, {})).toBe(false);
  });

  it('enters and exits standards-based PiP', async () => {
    const requestPictureInPicture = vi.fn(async () => ({}));
    const exitPictureInPicture = vi.fn(async () => ({}));
    const video = { requestPictureInPicture } as unknown as HTMLVideoElement;
    const documentLike = {
      pictureInPictureEnabled: true,
      pictureInPictureElement: null,
      exitPictureInPicture
    } as unknown as Document;

    await expect(toggleVideoPictureInPicture(video, documentLike)).resolves.toBe(true);
    expect(requestPictureInPicture).toHaveBeenCalledOnce();
    Object.assign(documentLike, { pictureInPictureElement: video });
    await expect(toggleVideoPictureInPicture(video, documentLike)).resolves.toBe(false);
    expect(exitPictureInPicture).toHaveBeenCalledOnce();
  });

  it('uses the iOS WebKit presentation fallback', async () => {
    const webkitSetPresentationMode = vi.fn();
    const video = {
      webkitPresentationMode: 'inline',
      webkitSupportsPresentationMode: () => true,
      webkitSetPresentationMode
    } as unknown as HTMLVideoElement;

    await expect(toggleVideoPictureInPicture(video, {} as Document)).resolves.toBe(true);
    expect(webkitSetPresentationMode).toHaveBeenCalledWith('picture-in-picture');
  });
});
