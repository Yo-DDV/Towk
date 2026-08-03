import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ImageModal from './ImageModal.svelte';

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

function renderViewer(options?: { longFilename?: string; onclose?: () => void }) {
  return render(ImageModal, {
    props: {
      items: [
        {
          id: 'first',
          src: previewOne,
          originalSrc: originalOne,
          filename: options?.longFilename ?? 'first-image.png'
        },
        {
          id: 'second',
          src: previewTwo,
          originalSrc: originalTwo,
          filename: 'second-image.png'
        }
      ],
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

describe('ImageModal', () => {
  it('exposes a safe overlay close button and calls the close callback', async () => {
    const onclose = vi.fn();
    const { container } = renderViewer({ onclose });
    const closeButton = container.querySelector<HTMLButtonElement>('.image-modal-close');

    expect(closeButton).not.toBeNull();
    expect(closeButton?.getAttribute('aria-label')).toBe('Close');
    await vi.waitFor(() => {
      expect(closeButton?.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(closeButton?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    });

    closeButton?.click();
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('closes through dialog cancellation and the backdrop without native navigation', () => {
    const onclose = vi.fn();
    const { container } = renderViewer({ onclose });
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;

    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onclose).toHaveBeenCalledOnce();

    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onclose).toHaveBeenCalledTimes(2);
  });

  it('closes through Escape from the focused media canvas', async () => {
    const onclose = vi.fn();
    const { container } = renderViewer({ onclose });
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

  it('keeps original media inspection inside Towk without an external link', async () => {
    const { container } = renderViewer();
    await waitForMedia(container);

    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('dialog')?.dataset.mobileNavigationSwipe).toBe('ignore');
    expect(
      container.querySelector('[data-testid="image-modal-stage"]')?.getAttribute('role')
    ).toBe('application');
    const detail = await vi.waitFor(() => {
      const image = container.querySelector<HTMLImageElement>(
        '[data-testid="image-modal-detail-image"]'
      );
      expect(image).not.toBeNull();
      return image!;
    });
    expect(detail.getAttribute('src')).toBe(originalOne);
    expect(
      Array.from(
        container.querySelectorAll<HTMLImageElement>('[data-testid="image-modal-detail-image"]')
      )
    ).toHaveLength(1);
  });

  it('loads only the active detailed source and resets zoom while navigating', async () => {
    const { container } = renderViewer();
    await waitForMedia(container);

    const zoomIn = container.querySelector<HTMLButtonElement>(
      '[data-testid="image-modal-zoom-in"]'
    )!;
    const zoomReset = container.querySelector<HTMLButtonElement>(
      '[data-testid="image-modal-zoom-reset"]'
    )!;
    zoomIn.click();
    await vi.waitFor(() => expect(zoomReset.textContent?.trim()).toBe('125%'));

    container.querySelector<HTMLButtonElement>('.image-modal-nav-next')?.click();

    await vi.waitFor(() => expect(zoomReset.textContent?.trim()).toBe('100%'));
    await vi.waitFor(() => {
      const detail = container.querySelector<HTMLImageElement>(
        '[data-testid="image-modal-detail-image"]'
      );
      expect(detail?.getAttribute('src')).toBe(originalTwo);
    });
    expect(
      Array.from(
        container.querySelectorAll<HTMLImageElement>('[data-testid="image-modal-detail-image"]')
      )
    ).toHaveLength(1);
  });

  it('supports buttons, wheel, keyboard and double-click zoom with one-action reset', async () => {
    const { container } = renderViewer();
    const media = await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;
    const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
    const zoomIn = container.querySelector<HTMLButtonElement>(
      '[data-testid="image-modal-zoom-in"]'
    )!;
    const zoomReset = container.querySelector<HTMLButtonElement>(
      '[data-testid="image-modal-zoom-reset"]'
    )!;

    zoomIn.click();
    await vi.waitFor(() => expect(zoomReset.textContent?.trim()).toBe('125%'));

    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(Number.parseInt(zoomReset.textContent ?? '0', 10)).toBeGreaterThan(125)
    );

    zoomReset.click();
    await vi.waitFor(() => expect(zoomReset.textContent?.trim()).toBe('100%'));

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    await vi.waitFor(() => expect(zoomReset.textContent?.trim()).toBe('125%'));

    zoomReset.click();
    media.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 180, clientY: 160, bubbles: true, cancelable: true })
    );
    await vi.waitFor(() => expect(zoomReset.textContent?.trim()).toBe('200%'));
  });

  it('pans a zoomed image through pointer dragging and keeps it in the viewer', async () => {
    const { container } = renderViewer();
    const media = await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;
    const zoomReset = container.querySelector<HTMLButtonElement>(
      '[data-testid="image-modal-zoom-reset"]'
    )!;

    media.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 180, clientY: 160, bubbles: true, cancelable: true })
    );
    await vi.waitFor(() => expect(zoomReset.textContent?.trim()).toBe('200%'));
    const initialLeft = media.style.left;

    stage.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 7,
        pointerType: 'mouse',
        button: 0,
        clientX: 180,
        clientY: 160,
        bubbles: true,
        cancelable: true
      })
    );
    stage.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 7,
        pointerType: 'mouse',
        clientX: 240,
        clientY: 190,
        bubbles: true,
        cancelable: true
      })
    );
    stage.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 7,
        pointerType: 'mouse',
        clientX: 240,
        clientY: 190,
        bubbles: true,
        cancelable: true
      })
    );

    await vi.waitFor(() => expect(media.style.left).not.toBe(initialLeft));
    expect(media.style.transform).toContain('scale(2)');
  });

  it('expires the post-drag click guard instead of swallowing a later backdrop click', async () => {
    const onclose = vi.fn();
    const { container } = renderViewer({ onclose });
    await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;

    stage.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 9,
        pointerType: 'mouse',
        button: 0,
        clientX: 80,
        clientY: 80,
        bubbles: true,
        cancelable: true
      })
    );
    stage.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 9,
        pointerType: 'mouse',
        clientX: 120,
        clientY: 80,
        bubbles: true,
        cancelable: true
      })
    );
    stage.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 9,
        pointerType: 'mouse',
        clientX: 120,
        clientY: 80,
        bubbles: true,
        cancelable: true
      })
    );

    stage.click();
    expect(onclose).not.toHaveBeenCalled();
    await new Promise((resolve) => window.setTimeout(resolve, 275));
    stage.click();
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('supports touch double-tap zoom without leaving the modal', async () => {
    const { container } = renderViewer();
    const media = await waitForMedia(container);
    const zoomReset = container.querySelector<HTMLButtonElement>(
      '[data-testid="image-modal-zoom-reset"]'
    )!;

    for (const pointerId of [11, 12]) {
      media.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId,
          pointerType: 'touch',
          clientX: 180,
          clientY: 160,
          bubbles: true,
          cancelable: true
        })
      );
      media.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId,
          pointerType: 'touch',
          clientX: 180,
          clientY: 160,
          bubbles: true,
          cancelable: true
        })
      );
    }

    await vi.waitFor(() => expect(zoomReset.textContent?.trim()).toBe('200%'));
    expect(container.querySelector('a')).toBeNull();
  });

  it('supports pinch zoom through pointer events without invoking browser navigation', async () => {
    const { container } = renderViewer();
    await waitForMedia(container);
    const stage = container.querySelector<HTMLElement>('[data-testid="image-modal-stage"]')!;
    const zoomReset = container.querySelector<HTMLButtonElement>(
      '[data-testid="image-modal-zoom-reset"]'
    )!;

    stage.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 120,
        clientY: 180,
        bubbles: true,
        cancelable: true
      })
    );
    stage.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 220,
        clientY: 180,
        bubbles: true,
        cancelable: true
      })
    );
    stage.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 300,
        clientY: 180,
        bubbles: true,
        cancelable: true
      })
    );

    await vi.waitFor(() =>
      expect(Number.parseInt(zoomReset.textContent ?? '0', 10)).toBeGreaterThan(100)
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('falls back to the fitted preview when the detailed source fails', async () => {
    const { container } = render(ImageModal, {
      props: {
        items: [
          {
            id: 'fallback',
            src: previewOne,
            originalSrc: 'data:image/png;base64,invalid',
            filename: 'fallback.png'
          }
        ],
        onclose: () => {}
      }
    });
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

  it('truncates very long filenames without losing their complete accessible value', () => {
    const filename = `${'capture-with-a-very-long-name-'.repeat(20)}.png`;
    const { container } = renderViewer({ longFilename: filename });
    const label = container.querySelector<HTMLElement>('.image-modal-filename')!;

    expect(label.textContent).toBe(filename);
    expect(label.getAttribute('title')).toBe(filename);
    expect(getComputedStyle(label).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(label).whiteSpace).toBe('nowrap');
    expect(container.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });
});
