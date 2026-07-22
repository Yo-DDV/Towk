import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import SkeletonImg from './SkeletonImg.svelte';
import { clearLoadedImageSourcesForTest, rememberLoadedImageSource } from './imageLoadMemory';

const mockedImageDescriptors: Array<ReturnType<typeof vi.spyOn>> = [];

function mockBrowserCachedImages() {
  mockedImageDescriptors.push(
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true),
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(320)
  );
}

afterEach(() => {
  while (mockedImageDescriptors.length > 0) {
    mockedImageDescriptors.pop()?.mockRestore();
  }
  clearLoadedImageSourcesForTest();
});

describe('SkeletonImg', () => {
  it('skips the initial skeleton when the source was prewarmed before render', () => {
    const src = 'https://chat.example.test/assets/files/preview.webp?access=ticket';
    rememberLoadedImageSource(src);

    const { container } = render(SkeletonImg, {
      props: {
        src,
        alt: 'Prewarmed room media'
      }
    });

    const img = container.querySelector('img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img!.classList.contains('skeleton')).toBe(false);
  });

  it('does not flash the loading skeleton when the browser already has the image cached', async () => {
    mockBrowserCachedImages();

    const { container } = render(SkeletonImg, {
      props: {
        src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E',
        alt: 'Cached room media'
      }
    });

    await tick();
    await tick();

    const img = container.querySelector('img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img!.classList.contains('skeleton')).toBe(false);
  });
});
