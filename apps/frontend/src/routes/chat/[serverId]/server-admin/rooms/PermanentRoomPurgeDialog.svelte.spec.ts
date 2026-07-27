import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { render } from 'vitest-browser-svelte';
import type { AdminRoomInfo } from '$lib/state/server/adminRoomLayout.svelte';
import PermanentRoomPurgeDialog from './PermanentRoomPurgeDialog.svelte';

const archivedRoom: AdminRoomInfo = {
  id: 'R00000000000000',
  name: 'retired-room',
  description: 'Disposable QA room',
  archived: true,
  isUniversal: false
};

function fill(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function buttonByText(container: Element, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`);
  return button;
}

describe('PermanentRoomPurgeDialog', () => {
  it('uses accessible dialog semantics and keeps the destructive action disabled until exact confirmation', () => {
    const onconfirm = vi.fn();
    const { container } = render(PermanentRoomPurgeDialog, {
      props: {
        room: archivedRoom,
        visible: true,
        onconfirm,
        onclose: vi.fn()
      }
    });
    flushSync();

    const dialog = container.querySelector('dialog');
    if (!(dialog instanceof HTMLDialogElement)) throw new Error('dialog not found');
    expect(dialog.open).toBe(true);
    const labelledBy = dialog.getAttribute('aria-labelledby');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy}`)?.textContent).toContain('#retired-room');
    expect(container.querySelector(`#${describedBy}`)?.textContent).toContain('cannot be restored');

    const shell = container.querySelector('.room-purge-shell');
    expect(shell?.classList.contains('max-h-[calc(100dvh-1.5rem)]')).toBe(true);
    const input = container.querySelector('#room-purge-confirmation');
    if (!(input instanceof HTMLInputElement)) throw new Error('confirmation input not found');
    const submit = buttonByText(container, 'Delete room permanently');
    expect(submit.disabled).toBe(true);

    fill(input, 'RETIRED-ROOM');
    expect(submit.disabled).toBe(true);
    expect(container.textContent).toContain('must exactly match');

    fill(input, archivedRoom.name);
    expect(submit.disabled).toBe(false);
    submit.click();
    expect(onconfirm).toHaveBeenCalledWith(archivedRoom.name);
  });

  it('locks Escape, backdrop, and close controls while the irreversible request is running', async () => {
    const onclose = vi.fn();
    const rendered = render(PermanentRoomPurgeDialog, {
      props: {
        room: archivedRoom,
        visible: true,
        loading: true,
        onconfirm: vi.fn(),
        onclose
      }
    });
    flushSync();

    const dialog = rendered.container.querySelector('dialog');
    if (!(dialog instanceof HTMLDialogElement)) throw new Error('dialog not found');
    const closeButton = rendered.container.querySelector('button[aria-label="Close"]');
    if (!(closeButton instanceof HTMLButtonElement)) throw new Error('close button not found');
    expect(closeButton.disabled).toBe(true);

    dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }));
    dialog.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(dialog.open).toBe(true);
    expect(onclose).not.toHaveBeenCalled();

    await rendered.rerender({
      room: archivedRoom,
      visible: true,
      loading: false,
      onconfirm: vi.fn(),
      onclose
    });
    flushSync();
    const enabledClose = rendered.container.querySelector('button[aria-label="Close"]');
    if (!(enabledClose instanceof HTMLButtonElement)) throw new Error('enabled close button not found');
    enabledClose.click();
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
  });
});
