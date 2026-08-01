import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installNativeMessageContextMenuGuard,
  TOUCH_CONTEXT_MENU_FALLBACK_MS
} from './nativeMessageContextMenuGuard';

let cleanup: (() => void) | null = null;
let fixture: HTMLElement | null = null;
let now = 1_000;

function installGuard() {
  cleanup = installNativeMessageContextMenuGuard(document, () => now);
}

function createMessageFixture() {
  const row = document.createElement('article');
  row.className = 'message-row';

  const link = document.createElement('a');
  link.href = '/example';
  link.textContent = 'Example link';
  row.append(link);

  fixture = row;
  document.body.append(row);
  return { row, link };
}

function touchPointerEvent(type: string) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'touch'
  });
}

function mousePointerEvent(type: string) {
  return new PointerEvent(type, {
    bubbles: true,
    button: 2,
    buttons: 2,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse'
  });
}

function legacyContextMenu() {
  return new MouseEvent('contextmenu', {
    bubbles: true,
    button: 2,
    cancelable: true
  });
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  fixture?.remove();
  fixture = null;
  now = 1_000;
});

describe('installNativeMessageContextMenuGuard', () => {
  it('cancels a legacy touch context menu without stopping Towk handlers', () => {
    installGuard();
    const { row, link } = createMessageFixture();
    const internalHandler = vi.fn();
    row.addEventListener('contextmenu', internalHandler);

    link.dispatchEvent(touchPointerEvent('pointerdown'));
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
    expect(internalHandler).toHaveBeenCalledOnce();
  });

  it('cancels a direct touch PointerEvent context menu inside a message', () => {
    installGuard();
    const { link } = createMessageFixture();
    const contextMenu = touchPointerEvent('contextmenu');

    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it('cancels a retargeted legacy menu that follows a message touch', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(touchPointerEvent('pointerdown'));
    const contextMenu = legacyContextMenu();
    document.body.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it('preserves mouse right-click inside a message row', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(mousePointerEvent('pointerdown'));
    const contextMenu = mousePointerEvent('contextmenu');
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('preserves keyboard context-menu invocation after a previous touch', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(touchPointerEvent('pointerdown'));
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ContextMenu' }));
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('does not cancel touch context menus outside message rows', () => {
    installGuard();
    fixture = document.createElement('button');
    document.body.append(fixture);
    const contextMenu = touchPointerEvent('contextmenu');

    fixture.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('expires the synthetic-mouse fallback window', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(touchPointerEvent('pointerdown'));
    now += TOUCH_CONTEXT_MENU_FALLBACK_MS + 1;
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('uses touchstart as a fallback when no PointerEvent precedes the menu', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it('removes every listener during teardown', () => {
    installGuard();
    const { link } = createMessageFixture();
    cleanup?.();
    cleanup = null;

    link.dispatchEvent(touchPointerEvent('pointerdown'));
    const contextMenu = touchPointerEvent('contextmenu');
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });
});
