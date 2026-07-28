import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { q, testSnippet } from '$lib/test-utils';
import ContextMenu from './ContextMenu.svelte';

const inputCapabilities = vi.hoisted(() => ({
  prefersTouchActions: vi.fn(() => false),
  supportsHoverActions: vi.fn(() => true)
}));

vi.mock('$lib/utils/inputCapabilities', () => inputCapabilities);

let originalShowPopover: typeof HTMLElement.prototype.showPopover;
let originalHidePopover: typeof HTMLElement.prototype.hidePopover;
let originalShowModal: typeof HTMLDialogElement.prototype.showModal;
let originalClose: typeof HTMLDialogElement.prototype.close;

function renderMenu(props: Record<string, unknown> = {}) {
  return render(ContextMenu, {
    props: {
      position: { x: 24, y: 32 },
      onclose: vi.fn(),
      children: testSnippet('<span>Menu body</span>'),
      ...props
    }
  });
}

beforeAll(() => {
  originalShowPopover = HTMLElement.prototype.showPopover;
  originalHidePopover = HTMLElement.prototype.hidePopover;
  originalShowModal = HTMLDialogElement.prototype.showModal;
  originalClose = HTMLDialogElement.prototype.close;

  HTMLElement.prototype.showPopover = function showPopover() {
    this.setAttribute('popover-open', '');
  };
  HTMLElement.prototype.hidePopover = function hidePopover() {
    this.removeAttribute('popover-open');
  };
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

afterAll(() => {
  HTMLElement.prototype.showPopover = originalShowPopover;
  HTMLElement.prototype.hidePopover = originalHidePopover;
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});

beforeEach(() => {
  vi.clearAllMocks();
  inputCapabilities.prefersTouchActions.mockReturnValue(false);
  inputCapabilities.supportsHoverActions.mockReturnValue(true);
});

describe('ContextMenu', () => {
  it('uses floating presentation on hybrid devices by default', async () => {
    inputCapabilities.prefersTouchActions.mockReturnValue(true);
    inputCapabilities.supportsHoverActions.mockReturnValue(true);

    const { container } = renderMenu();

    await expect.element(q(container, '[role="menu"]')).toBeInTheDocument();
    expect(q(container, 'dialog')).toBeNull();
    expect(container.textContent).toContain('Menu body');
  });

  it('can force sheet presentation for touch-initiated nested menus', async () => {
    inputCapabilities.prefersTouchActions.mockReturnValue(true);
    inputCapabilities.supportsHoverActions.mockReturnValue(true);

    const { container } = renderMenu({ presentation: 'sheet' });

    await expect.element(q(container, 'dialog.bottom-sheet')).toBeInTheDocument();
    expect(q(container, '[role="menu"]')).toBeNull();
    expect(container.textContent).toContain('Menu body');
  });

  it('keeps a forced sheet open when iOS cancels the dialog while focusing an input', async () => {
    const onclose = vi.fn();
    const { container } = renderMenu({
      presentation: 'sheet',
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

  it('keeps a forced sheet open when iOS reports focus before the input becomes active', async () => {
    const onclose = vi.fn();
    const { container } = renderMenu({
      presentation: 'sheet',
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
    const { container } = renderMenu({
      presentation: 'sheet',
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

  it('keeps a persistent forced sheet open across external close requests', async () => {
    const onclose = vi.fn();
    const { container } = renderMenu({
      presentation: 'sheet',
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

  it('reopens a persistent forced sheet after an unexpected native close', async () => {
    const onclose = vi.fn();
    const { container } = renderMenu({
      presentation: 'sheet',
      dismissOnExternalInteraction: false,
      onclose
    });

    const dialog = q(container, 'dialog.bottom-sheet') as HTMLDialogElement;

    dialog.close();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(dialog.open).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('still closes a persistent forced sheet from its explicit handle', async () => {
    const onclose = vi.fn();
    const { container } = renderMenu({
      presentation: 'sheet',
      dismissOnExternalInteraction: false,
      onclose
    });

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
});
