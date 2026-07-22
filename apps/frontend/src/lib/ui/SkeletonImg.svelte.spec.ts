import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import SkeletonImg from './SkeletonImg.svelte';

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
});

describe('SkeletonImg', () => {
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
