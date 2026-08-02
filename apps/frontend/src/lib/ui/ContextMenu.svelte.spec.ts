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
      ariaLabel: 'Message actions',
      onclose: vi.fn(),
      children: testSnippet('<button type="button" role="menuitem">Reply</button>'),
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
    if (originalShowPopover) {
      originalShowPopover.call(this);
    } else {
      this.setAttribute('popover-open', '');
    }
  };
  HTMLElement.prototype.hidePopover = function hidePopover() {
    if (originalHidePopover) {
      originalHidePopover.call(this);
    } else {
      this.removeAttribute('popover-open');
    }
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
  });

  it('can force sheet presentation without changing menu semantics', async () => {
    inputCapabilities.prefersTouchActions.mockReturnValue(true);
    inputCapabilities.supportsHoverActions.mockReturnValue(true);

    const { container } = renderMenu({ presentation: 'sheet' });

    await expect.element(q(container, 'dialog.bottom-sheet')).toBeInTheDocument();
    await expect.element(q(container, '[role="menu"]')).toBeInTheDocument();
    await expect.element(q(container, '[role="menuitem"]')).toBeInTheDocument();
  });

  it('moves focus with menu keys, supports typeahead, and skips disabled commands', async () => {
    const onclose = vi.fn();
    const { container } = renderMenu({
      presentation: 'sheet',
      onclose,
      children: testSnippet(`
        <div>
          <button type="button" role="menuitem" data-testid="reply">Reply</button>
          <button type="button" role="menuitem" data-testid="disabled" disabled>Disabled</button>
          <button type="button" role="menuitem" data-testid="delete">Delete</button>
        </div>
      `)
    });

    const reply = q(container, '[data-testid="reply"]') as HTMLButtonElement;
    const disabled = q(container, '[data-testid="disabled"]') as HTMLButtonElement;
    const deleteAction = q(container, '[data-testid="delete"]') as HTMLButtonElement;

    await vi.waitFor(() => expect(document.activeElement).toBe(reply));
    expect(reply.tabIndex).toBe(0);
    expect(disabled.tabIndex).toBe(-1);

    reply.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(deleteAction);
    expect(deleteAction.tabIndex).toBe(0);
    expect(reply.tabIndex).toBe(-1);

    deleteAction.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(reply);

    reply.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(document.activeElement).toBe(deleteAction);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('restores the trigger focus when Escape dismisses the menu', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open menu';
    document.body.append(trigger);
    trigger.focus();

    try {
      const onclose = vi.fn();
      const { container } = renderMenu({ onclose });
      const item = q(container, '[role="menuitem"]') as HTMLButtonElement;

      await vi.waitFor(() => expect(document.activeElement).toBe(item));

      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)));

      expect(onclose).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(trigger);
    } finally {
      trigger.remove();
    }
  });
});
