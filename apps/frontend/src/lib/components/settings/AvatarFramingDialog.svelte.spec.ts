import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../app.css';
import AvatarFramingDialog from './AvatarFramingDialog.svelte';

const navigationMocks = vi.hoisted(() => ({
  pushState: vi.fn(),
  replaceState: vi.fn(),
  pageState: {} as Record<string, unknown>
}));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/state', () => ({ page: { state: navigationMocks.pageState } }));
vi.mock('$app/navigation', () => ({
  pushState: (_url: string, state: Record<string, unknown>) => {
    for (const key of Object.keys(navigationMocks.pageState)) delete navigationMocks.pageState[key];
    Object.assign(navigationMocks.pageState, state);
    navigationMocks.pushState(_url, state);
  },
  replaceState: (_url: string, state: Record<string, unknown>) => {
    for (const key of Object.keys(navigationMocks.pageState)) delete navigationMocks.pageState[key];
    Object.assign(navigationMocks.pageState, state);
    navigationMocks.replaceState(_url, state);
  }
}));

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

const createObjectURL = vi.fn(() => 'blob:avatar-framing-test');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  navigationMocks.pushState.mockReset();
  navigationMocks.replaceState.mockReset();
  vi.spyOn(history, 'back').mockImplementation(() => undefined);
  vi.spyOn(history, 'forward').mockImplementation(() => undefined);
  for (const key of Object.keys(navigationMocks.pageState)) delete navigationMocks.pageState[key];
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL
  });

  class ImmediatelyDecodedImage {
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', ImmediatelyDecodedImage);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll('dialog[open]').forEach((dialog) =>
    (dialog as HTMLDialogElement).close()
  );
});

describe('AvatarFramingDialog', () => {
  it('offers a responsive, accessible full-image path and leaves failed uploads retryable', async () => {
    const submit = vi.fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const completed = vi.fn();
    const file = new File([pngHeader(1200, 800)], 'wide.png', { type: 'image/png' });

    const { container } = render(AvatarFramingDialog, {
      props: {
        file,
        visible: true,
        onsubmit: submit,
        oncomplete: completed
      }
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Frame your avatar');
      expect(createObjectURL).toHaveBeenCalledWith(file);
      expect(navigationMocks.pushState).toHaveBeenCalledTimes(1);
    });

    const stage = container.querySelector<HTMLElement>('[aria-label="Avatar framing area"]');
    expect(stage).not.toBeNull();
    expect(stage?.getAttribute('aria-describedby')).toContain('avatar-framing-keyboard-help');
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(3);

    const fullImage = buttonByText(container, 'Full image');
    fullImage.click();
    await vi.waitFor(() => expect(fullImage.getAttribute('aria-pressed')).toBe('true'));

    const profilePreview = container.querySelector<HTMLElement>(
      '[role="img"][aria-label="Profile avatar preview"]'
    );
    const previewImage = profilePreview?.querySelector<HTMLImageElement>('img');
    const previewWidth = Number.parseFloat(previewImage?.style.width ?? '0');
    const previewHeight = Number.parseFloat(previewImage?.style.height ?? '0');
    expect(Math.hypot(previewWidth, previewHeight)).toBeLessThanOrEqual(72.01);

    for (const preview of container.querySelectorAll<HTMLElement>('[role="img"]')) {
      const image = preview.querySelector<HTMLImageElement>('img');
      expect(image).not.toBeNull();
      const width = Number.parseFloat(image?.style.width ?? '0');
      const height = Number.parseFloat(image?.style.height ?? '0');
      const diameter = preview.getBoundingClientRect().width;
      expect(Math.hypot(width / 2, height / 2)).toBeLessThanOrEqual(diameter / 2 + 0.01);
    }

    const apply = buttonByText(container, 'Apply and upload');
    apply.click();
    await vi.waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        mode: 'contain',
        sourceWidth: 1200,
        sourceHeight: 800
      })
    );
    expect(container.textContent).toContain('Frame your avatar');

    apply.click();
    await vi.waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar-framing-test');
  });

  it('exposes real disabled states and refuses dismissal during upload', async () => {
    const cancelled = vi.fn();
    const file = new File([pngHeader(640, 640)], 'square.png', { type: 'image/png' });
    const { container } = render(AvatarFramingDialog, {
      props: {
        file,
        visible: true,
        busy: true,
        onsubmit: vi.fn(async () => true),
        oncancel: cancelled
      }
    });

    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(file));
    expect(buttonByText(container, 'Apply and upload').disabled).toBe(true);
    expect(buttonByText(container, 'Full image').disabled).toBe(true);

    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(close).not.toBeNull();
    close?.click();

    // A busy upload cannot be dismissed by Escape, backdrop, Back, or the close control.
    await vi.waitFor(() => expect(container.textContent).toContain('Frame your avatar'));
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('maps cancellation to browser Back and releases the local preview', async () => {
    const cancelled = vi.fn();
    const file = new File([pngHeader(640, 320)], 'wide.png', { type: 'image/png' });
    const { container } = render(AvatarFramingDialog, {
      props: {
        file,
        visible: true,
        onsubmit: vi.fn(async () => false),
        oncancel: cancelled
      }
    });

    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(file));
    buttonByText(container, 'Cancel').click();

    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar-framing-test');
  });

  it('supports mouse-wheel and two-pointer pinch zoom without losing the selected file', async () => {
    const file = new File([pngHeader(1200, 800)], 'wide.png', { type: 'image/png' });
    const { container } = render(AvatarFramingDialog, {
      props: { file, visible: true, onsubmit: vi.fn(async () => false) }
    });

    const stage = await vi.waitFor(() => {
      const value = container.querySelector<HTMLElement>('[data-testid="avatar-framing-stage"]');
      expect(value?.tabIndex).toBe(0);
      return value!;
    });
    stage.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        clientX: stage.getBoundingClientRect().left + stage.clientWidth / 2,
        clientY: stage.getBoundingClientRect().top + stage.clientHeight / 2,
        bubbles: true,
        cancelable: true
      })
    );
    await vi.waitFor(() => {
      const output = container.querySelector<HTMLOutputElement>('output[for="avatar-framing-zoom"]');
      expect(Number.parseInt(output?.textContent ?? '0', 10)).toBeGreaterThan(100);
    });

    const rect = stage.getBoundingClientRect();
    const pointer = (type: string, pointerId: number, x: number, y: number) =>
      stage.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          pointerType: 'touch',
          clientX: rect.left + x,
          clientY: rect.top + y,
          bubbles: true,
          cancelable: true
        })
      );
    pointer('pointerdown', 1, stage.clientWidth * 0.35, stage.clientHeight * 0.5);
    pointer('pointerdown', 2, stage.clientWidth * 0.65, stage.clientHeight * 0.5);
    pointer('pointermove', 2, stage.clientWidth * 0.9, stage.clientHeight * 0.5);
    pointer('pointerup', 2, stage.clientWidth * 0.9, stage.clientHeight * 0.5);
    pointer('pointerup', 1, stage.clientWidth * 0.35, stage.clientHeight * 0.5);

    await vi.waitFor(() => {
      const output = container.querySelector<HTMLOutputElement>('output[for="avatar-framing-zoom"]');
      expect(Number.parseInt(output?.textContent ?? '0', 10)).toBeGreaterThan(100);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the composition controls keyboard-operable', async () => {
    const file = new File([pngHeader(1200, 800)], 'wide.png', { type: 'image/png' });
    const { container } = render(AvatarFramingDialog, {
      props: { file, visible: true, onsubmit: vi.fn(async () => false) }
    });

    const stage = await vi.waitFor(() => {
      const value = container.querySelector<HTMLElement>('[aria-label="Avatar framing area"]');
      expect(value?.tabIndex).toBe(0);
      return value!;
    });
    stage.focus();
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      const output = container.querySelector<HTMLOutputElement>('output[for="avatar-framing-zoom"]');
      expect(output?.textContent).toBe('110%');
    });

    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      const output = container.querySelector<HTMLOutputElement>('output[for="avatar-framing-zoom"]');
      expect(output?.textContent).toBe('100%');
    });
  });
});
