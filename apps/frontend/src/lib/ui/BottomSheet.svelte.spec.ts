import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { q, testSnippet } from '$lib/test-utils';
import BottomSheet from './BottomSheet.svelte';

let originalShowModal: typeof HTMLDialogElement.prototype.showModal;
let originalClose: typeof HTMLDialogElement.prototype.close;

type MutableVisualViewport = Omit<VisualViewport, 'height' | 'offsetTop' | 'width'> & {
  height: number;
  offsetTop: number;
  width: number;
};

function createVisualViewport(): MutableVisualViewport {
  return Object.assign(new EventTarget(), {
    height: 780,
    offsetLeft: 0,
    offsetTop: 0,
    onresize: null,
    onscroll: null,
    onscrollend: null,
    pageLeft: 0,
    pageTop: 0,
    scale: 1,
    width: 390
  }) as MutableVisualViewport;
}

function renderSheet(props: Record<string, unknown> = {}) {
  return render(BottomSheet, {
    props: {
      visible: true,
      ariaLabel: 'Message actions',
      children: testSnippet('<p>Sheet body</p>'),
      ...props
    }
  });
}

beforeAll(() => {
  originalShowModal = HTMLDialogElement.prototype.showModal;
  originalClose = HTMLDialogElement.prototype.close;

  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BottomSheet', () => {
  it('exposes the accessible name supplied by the caller', async () => {
    const { container } = renderSheet();
    const dialog = q(container, 'dialog');

    await expect.element(dialog).toHaveAttribute('aria-label', 'Message actions');
  });

  it('stays open when a native cancel races an internal touch focus', async () => {
    const onclose = vi.fn();
    const { container } = renderSheet({
      onclose,
      children: testSnippet('<input data-testid="sheet-search" type="search" />')
    });
    const dialog = q(container, 'dialog.bottom-sheet') as HTMLDialogElement;
    const input = q(container, '[data-testid="sheet-search"]') as HTMLInputElement;

    input.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
    dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(dialog.open).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('stays open when WebKit reports focus before the input becomes active', async () => {
    const onclose = vi.fn();
    const { container } = renderSheet({
      onclose,
      children: testSnippet('<input data-testid="sheet-search" type="search" />')
    });
    const dialog = q(container, 'dialog.bottom-sheet') as HTMLDialogElement;
    const input = q(container, '[data-testid="sheet-search"]') as HTMLInputElement;

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(dialog.open).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('still closes from a later backdrop press after an internal focus', async () => {
    const onclose = vi.fn();
    const { container } = renderSheet({
      onclose,
      children: testSnippet('<input data-testid="sheet-search" type="search" />')
    });
    const dialog = q(container, 'dialog.bottom-sheet') as HTMLDialogElement;
    const input = q(container, '[data-testid="sheet-search"]') as HTMLInputElement;

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    dialog.click();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(dialog.open).toBe(false);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('keeps a persistent sheet open across external close requests', async () => {
    const onclose = vi.fn();
    const { container } = renderSheet({
      dismissOnExternalInteraction: false,
      onclose,
      children: testSnippet('<input data-testid="sheet-search" type="search" />')
    });
    const dialog = q(container, 'dialog.bottom-sheet') as HTMLDialogElement;

    dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    dialog.click();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(dialog.open).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('reopens a persistent sheet after an unexpected native close', async () => {
    const onclose = vi.fn();
    const { container } = renderSheet({ dismissOnExternalInteraction: false, onclose });
    const dialog = q(container, 'dialog.bottom-sheet') as HTMLDialogElement;

    dialog.close();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(dialog.open).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('still closes a persistent sheet from its explicit handle', async () => {
    const onclose = vi.fn();
    const { container } = renderSheet({ dismissOnExternalInteraction: false, onclose });
    const dialog = q(container, 'dialog.bottom-sheet') as HTMLDialogElement;
    const closeHandle = q(
      container,
      'dialog.bottom-sheet > .bottom-sheet-content > button'
    ) as HTMLButtonElement;

    closeHandle.click();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(dialog.open).toBe(false);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('stays inside the visual viewport when the software keyboard opens', async () => {
    const viewport = createVisualViewport();
    vi.stubGlobal('visualViewport', viewport);
    const { container } = renderSheet({ dismissOnExternalInteraction: false });
    const dialog = q(container, 'dialog.bottom-sheet') as HTMLDialogElement;

    viewport.height = 420;
    viewport.offsetTop = 18;
    viewport.dispatchEvent(new Event('resize'));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(dialog.style.top).toBe('18px');
    expect(dialog.style.height).toBe('420px');
    expect(dialog.style.maxHeight).toBe('420px');

    viewport.offsetTop = 32;
    viewport.dispatchEvent(new Event('scroll'));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(dialog.style.top).toBe('32px');
  });
});
