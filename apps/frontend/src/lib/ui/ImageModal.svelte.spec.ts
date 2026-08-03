import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ImageModal, { type ImageItem } from './ImageModal.svelte';

function svgData(width: number, height: number, fill: string): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`,
    ` viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${fill}"/>`,
    '</svg>'
  ].join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const previewOne = svgData(1_200, 800, '#666');
const originalOne = svgData(2_400, 1_600, '#999');
const previewTwo = svgData(900, 1_200, '#444');
const originalTwo = svgData(1_800, 2_400, '#777');

function defaultItems(): ImageItem[] {
  return [
    {
      id: 'first',
      src: previewOne,
      originalSrc: originalOne,
      filename: 'first-image.png'
    },
    {
      id: 'second',
      src: previewTwo,
      originalSrc: originalTwo,
      filename: 'second-image.png'
    }
  ];
}

async function renderViewer(options?: {
  items?: ImageItem[];
  index?: number;
  longFilename?: string;
  onclose?: () => void;
}) {
  const items = options?.items ?? defaultItems();
  if (options?.longFilename && items[0]) items[0].filename = options.longFilename;
  return await render(ImageModal, {
    props: {
      items,
      index: options?.index ?? 0,
      onclose: options?.onclose ?? (() => {})
    }
  });
}

async function waitForMedia(container: HTMLElement): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const media = container.querySelector<HTMLElement>('[data-testid="image-modal-media"]');
    expect(media).not.toBeNull();
    return media!;
  });
}

function zoomReset(container: HTMLElement): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('[data-testid="image-modal-zoom-reset"]')!;
}

function dispatchPointer(target: Element, type: string, init: PointerEventInit): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init
    })
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ImageModal', () => {
  it('keeps a 44px close action and makes repeated close signals idempotent', async () => {
    const onclose = vi.fn();
    const { container } = await renderViewer({ onclose });
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    const closeButton = container.querySelector<HTMLButtonElement>('.image-modal-close')!;

    expect(closeButton.getAttribute('aria-label')).toBe('Close');
    await vi.waitFor(() => {
      expect(closeButton.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(closeButton.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    });

    closeButton.click();
    closeButton.click();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onclose).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(closeButton.disabled).toBe(true));
  });

  it('closes through dialog cancellation and prevents native document navigation', async () => {
    const onclose = vi.fn();
    const { container } = await renderViewer({ onclose });
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    const cancel = new Event('cancel', { cancelable: true });

    dialog.dispatchEvent(cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('closes through Escape from the focused media canvas', async () => {
    const onclose = vi.fn();
    const { container } = await renderViewer({ onclose });
    await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;
    stage.focus();
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    });

    stage.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('keeps a usable close action and fallback when the gallery becomes empty', async () => {
    const onclose = vi.fn();
    const { container } = await renderViewer({ items: [], onclose });

    expect(container.querySelector('.image-modal-empty-fallback')).not.toBeNull();
    const closeButton = container.querySelector<HTMLButtonElement>('.image-modal-close')!;
    expect(closeButton).not.toBeNull();
    closeButton.click();
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('keeps original media inspection inside Towk with a named keyboard canvas', async () => {
    const { container } = await renderViewer();
    await waitForMedia(container);

    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('dialog')?.dataset.mobileNavigationSwipe).toBe('ignore');
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;
    expect(stage.getAttribute('role')).toBe('application');
    expect(stage.getAttribute('aria-label')).toBe('first-image.png');
    expect(
      container.querySelector<HTMLImageElement>('[data-testid="image-modal-preview-image"]')
        ?.getAttribute('aria-hidden')
    ).toBe('true');
    expect(
      container.querySelector<HTMLImageElement>('[data-testid="image-modal-detail-image"]')
        ?.getAttribute('aria-hidden')
    ).toBe('true');
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="image-modal-zoom-in"]')
        ?.getAttribute('aria-label')
    ).toBe('+25%');
  });

  it('loads only the active detailed source and resets zoom while navigating', async () => {
    const { container } = await renderViewer();
    await waitForMedia(container);
    const zoomIn = container.querySelector<HTMLButtonElement>(
      '[data-testid="image-modal-zoom-in"]'
    )!;

    zoomIn.click();
    await vi.waitFor(() => expect(zoomReset(container).textContent?.trim()).toBe('125%'));
    container.querySelector<HTMLButtonElement>('.image-modal-nav-next')?.click();

    await vi.waitFor(() => expect(zoomReset(container).textContent?.trim()).toBe('100%'));
    await vi.waitFor(() => {
      const detail = container.querySelector<HTMLImageElement>(
        '[data-testid="image-modal-detail-image"]'
      );
      expect(detail?.getAttribute('src')).toBe(originalTwo);
    });
    expect(
      container.querySelectorAll<HTMLImageElement>('[data-testid="image-modal-detail-image"]')
    ).toHaveLength(1);
  });

  it('preserves the selected attachment when refreshed items replay a stale parent index', async () => {
    const { container, rerender } = await renderViewer();
    await waitForMedia(container);
    container.querySelector<HTMLButtonElement>('.image-modal-nav-next')?.click();
    await vi.waitFor(() =>
      expect(container.querySelector('.image-modal-counter')?.textContent?.trim()).toBe('2 / 2')
    );

    const refreshed = defaultItems();
    refreshed[0] = { ...refreshed[0]!, src: `${previewOne}#fresh-first` };
    refreshed[1] = {
      ...refreshed[1]!,
      src: `${previewTwo}#fresh-second`,
      originalSrc: `${originalTwo}#fresh-second`
    };
    await rerender({ items: refreshed, index: 0, onclose: () => {} });

    await vi.waitFor(() =>
      expect(container.querySelector('.image-modal-counter')?.textContent?.trim()).toBe('2 / 2')
    );
    await vi.waitFor(() =>
      expect(
        container
          .querySelector<HTMLImageElement>('[data-testid="image-modal-detail-image"]')
          ?.getAttribute('src')
      ).toBe(`${originalTwo}#fresh-second`)
    );
  });

  it('normalizes a non-finite or out-of-range initial index', async () => {
    const { container } = await renderViewer({ index: 99 });

    await vi.waitFor(() =>
      expect(container.querySelector('.image-modal-counter')?.textContent?.trim()).toBe('2 / 2')
    );
  });

  it('supports buttons, wheel, keyboard and double-click zoom with one-action reset', async () => {
    const { container } = await renderViewer();
    const media = await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    const zoomIn = container.querySelector<HTMLButtonElement>(
      '[data-testid="image-modal-zoom-in"]'
    )!;

    zoomIn.click();
    await vi.waitFor(() => expect(zoomReset(container).textContent?.trim()).toBe('125%'));
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(Number.parseInt(zoomReset(container).textContent ?? '0', 10)).toBeGreaterThan(125)
    );

    zoomReset(container).click();
    await vi.waitFor(() => expect(zoomReset(container).textContent?.trim()).toBe('100%'));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    await vi.waitFor(() => expect(zoomReset(container).textContent?.trim()).toBe('125%'));

    zoomReset(container).click();
    media.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 180, clientY: 160, bubbles: true, cancelable: true })
    );
    await vi.waitFor(() => expect(zoomReset(container).textContent?.trim()).toBe('200%'));
  });

  it('removes wheel-only transition suppression after the trackpad stream settles', async () => {
    const { container } = await renderViewer();
    await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;

    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(stage.classList.contains('viewer-is-interacting')).toBe(true)
    );
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    await vi.waitFor(() =>
      expect(stage.classList.contains('viewer-is-interacting')).toBe(false)
    );
  });

  it('pans a zoomed image through pointer dragging and keeps it in the viewer', async () => {
    const { container } = await renderViewer();
    const media = await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;

    media.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 180, clientY: 160, bubbles: true, cancelable: true })
    );
    await vi.waitFor(() => expect(zoomReset(container).textContent?.trim()).toBe('200%'));
    const initialLeft = media.style.left;

    dispatchPointer(stage, 'pointerdown', {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      clientX: 180,
      clientY: 160
    });
    dispatchPointer(stage, 'pointermove', {
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 240,
      clientY: 190
    });
    dispatchPointer(stage, 'pointerup', {
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 240,
      clientY: 190
    });

    await vi.waitFor(() => expect(media.style.left).not.toBe(initialLeft));
    expect(media.style.transform).toContain('scale(2)');
  });

  it('expires the post-drag click guard instead of swallowing a later backdrop click', async () => {
    const onclose = vi.fn();
    const { container } = await renderViewer({ onclose });
    await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;

    dispatchPointer(stage, 'pointerdown', {
      pointerId: 9,
      pointerType: 'mouse',
      button: 0,
      clientX: 80,
      clientY: 80
    });
    dispatchPointer(stage, 'pointermove', {
      pointerId: 9,
      pointerType: 'mouse',
      clientX: 120,
      clientY: 80
    });
    dispatchPointer(stage, 'pointerup', {
      pointerId: 9,
      pointerType: 'mouse',
      clientX: 120,
      clientY: 80
    });

    stage.click();
    expect(onclose).not.toHaveBeenCalled();
    await new Promise((resolve) => window.setTimeout(resolve, 375));
    stage.click();
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('closes on a touch tap of empty stage background at fitted scale', async () => {
    const onclose = vi.fn();
    const { container } = await renderViewer({ onclose });
    await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;

    dispatchPointer(stage, 'pointerdown', {
      pointerId: 40,
      pointerType: 'touch',
      clientX: 8,
      clientY: 8
    });
    dispatchPointer(stage, 'pointerup', {
      pointerId: 40,
      pointerType: 'touch',
      clientX: 8,
      clientY: 8
    });

    expect(onclose).toHaveBeenCalledOnce();
  });

  it('supports touch double-tap without a synthesized double-click undo', async () => {
    const { container } = await renderViewer();
    const media = await waitForMedia(container);

    for (const pointerId of [11, 12]) {
      dispatchPointer(media, 'pointerdown', {
        pointerId,
        pointerType: 'touch',
        clientX: 180,
        clientY: 160
      });
      dispatchPointer(media, 'pointerup', {
        pointerId,
        pointerType: 'touch',
        clientX: 180,
        clientY: 160
      });
    }

    await vi.waitFor(() => expect(zoomReset(container).textContent?.trim()).toBe('200%'));
    media.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 180, clientY: 160, bubbles: true, cancelable: true })
    );
    expect(zoomReset(container).textContent?.trim()).toBe('200%');
    expect(container.querySelector('a')).toBeNull();
  });

  it('supports pinch zoom through pointer events without browser navigation', async () => {
    const { container } = await renderViewer();
    await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;

    dispatchPointer(stage, 'pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 120,
      clientY: 180
    });
    dispatchPointer(stage, 'pointerdown', {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 220,
      clientY: 180
    });
    dispatchPointer(stage, 'pointermove', {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 300,
      clientY: 180
    });

    await vi.waitFor(() =>
      expect(Number.parseInt(zoomReset(container).textContent ?? '0', 10)).toBeGreaterThan(100)
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('retries a refreshed detailed URL without losing zoom and ignores stale errors', async () => {
    const items = [defaultItems()[0]!];
    const { container, rerender } = await renderViewer({ items });
    const media = await waitForMedia(container);
    media.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 180, clientY: 160, bubbles: true, cancelable: true })
    );
    await vi.waitFor(() => expect(zoomReset(container).textContent?.trim()).toBe('200%'));

    const staleDetail = await vi.waitFor(() => {
      const detail = container.querySelector<HTMLImageElement>(
        '[data-testid="image-modal-detail-image"]'
      );
      expect(detail).not.toBeNull();
      return detail!;
    });
    staleDetail.dispatchEvent(new Event('error'));
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="image-modal-detail-image"]')).toBeNull()
    );

    const refreshedOriginal = `${originalOne}#fresh-ticket`;
    await rerender({
      items: [{ ...items[0]!, originalSrc: refreshedOriginal }],
      index: 0,
      onclose: () => {}
    });
    const freshDetail = await vi.waitFor(() => {
      const detail = container.querySelector<HTMLImageElement>(
        '[data-testid="image-modal-detail-image"]'
      );
      expect(detail?.getAttribute('src')).toBe(refreshedOriginal);
      return detail!;
    });
    staleDetail.dispatchEvent(new Event('error'));

    expect(freshDetail.isConnected).toBe(true);
    expect(zoomReset(container).textContent?.trim()).toBe('200%');
  });

  it('falls back to the fitted preview when the detailed source fails', async () => {
    const { container } = await renderViewer({ items: [defaultItems()[0]!] });
    await waitForMedia(container);
    const detail = await vi.waitFor(() => {
      const image = container.querySelector<HTMLImageElement>(
        '[data-testid="image-modal-detail-image"]'
      );
      expect(image).not.toBeNull();
      return image!;
    });

    detail.dispatchEvent(new Event('error'));

    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="image-modal-detail-image"]')).toBeNull()
    );
    expect(
      container.querySelector<HTMLImageElement>('[data-testid="image-modal-preview-image"]')
        ?.getAttribute('src')
    ).toBe(previewOne);
  });

  it('shows a bounded unavailable state when no source can load', async () => {
    const { container } = await renderViewer({
      items: [{ id: 'missing', src: '', filename: 'missing.png' }]
    });

    const fallback = container.querySelector<HTMLElement>('.image-modal-empty-fallback')!;
    expect(fallback).not.toBeNull();
    expect(fallback.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth);
    expect(container.querySelector<HTMLImageElement>('img')).toBeNull();
  });

  it('uses a flow layout that keeps long filenames and controls inside the viewport', async () => {
    const filename = `${'capture-with-a-very-long-name-'.repeat(20)}.png`;
    const { container } = await renderViewer({ longFilename: filename });
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    const label = container.querySelector<HTMLElement>('.image-modal-filename')!;
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;
    const controls = container.querySelector<HTMLElement>('.image-modal-zoom')!;

    expect(label.textContent).toBe(filename);
    expect(label.getAttribute('title')).toBe(filename);
    expect(getComputedStyle(label).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
    expect(getComputedStyle(dialog).display).toBe('grid');
    await vi.waitFor(() => expect(stage.getBoundingClientRect().height).toBeGreaterThan(0));
    expect(controls.getBoundingClientRect().right).toBeLessThanOrEqual(
      dialog.getBoundingClientRect().right
    );
    expect(container.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it('removes resize listeners when the viewer is unmounted', async () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = await renderViewer();

    await unmount();

    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
