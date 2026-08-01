import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installNativeMessageContextMenuGuard,
  TOUCH_CONTEXT_MENU_FALLBACK_MS,
  TOUCH_CONTEXT_MENU_MAX_DRIFT_PX
} from './nativeMessageContextMenuGuard';

let cleanup: (() => void) | null = null;
let fixture: HTMLElement | null = null;
let now = 1_000;

function installGuard() {
  cleanup = installNativeMessageContextMenuGuard(document, () => now);
}

function createMessageFixture() {
  fixture = document.createElement('div');

  const row = document.createElement('article');
  row.className = 'message-row';

  const link = document.createElement('a');
  link.href = '/example';
  link.textContent = 'Example link';
  row.append(link);

  const outside = document.createElement('button');
  outside.textContent = 'Outside';

  fixture.append(row, outside);
  document.body.append(fixture);
  return { row, link, outside };
}

function pointerEvent(
  type: string,
  pointerType: 'touch' | 'mouse' | 'pen',
  clientX = 24,
  clientY = 32,
  pointerId = 1
) {
  return new PointerEvent(type, {
    bubbles: true,
    button: pointerType === 'touch' ? 0 : 2,
    buttons: pointerType === 'touch' ? 1 : 2,
    cancelable: true,
    clientX,
    clientY,
    pointerId,
    pointerType
  });
}

function legacyContextMenu(clientX = 24, clientY = 32) {
  return new MouseEvent('contextmenu', {
    bubbles: true,
    button: 2,
    cancelable: true,
    clientX,
    clientY
  });
}

function touchList(clientX: number, clientY: number, count: number): TouchList {
  const touches = Array.from({ length: count }, (_, identifier) => ({
    clientX,
    clientY,
    identifier
  })) as unknown as Touch[] & { item(index: number): Touch | null };
  touches.item = (index: number) => touches[index] ?? null;
  return touches as unknown as TouchList;
}

function legacyTouchEvent(type: string, clientX = 24, clientY = 32, count = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  const activeTouches =
    type === 'touchcancel' ? touchList(clientX, clientY, 0) : touchList(clientX, clientY, count);
  Object.defineProperties(event, {
    touches: { value: activeTouches },
    changedTouches: { value: touchList(clientX, clientY, Math.max(1, count)) }
  });
  return event;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  fixture?.remove();
  fixture = null;
  now = 1_000;
  vi.useRealTimers();
});

describe('installNativeMessageContextMenuGuard', () => {
  it('cancels a legacy touch context menu without stopping Towk handlers', () => {
    installGuard();
    const { row, link } = createMessageFixture();
    const internalHandler = vi.fn();
    row.addEventListener('contextmenu', internalHandler);

    link.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
    expect(internalHandler).toHaveBeenCalledOnce();
  });

  it('captures before nested message content stops propagation', () => {
    installGuard();
    const { link } = createMessageFixture();
    link.addEventListener('contextmenu', (event) => event.stopPropagation());

    link.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it('cancels a direct touch PointerEvent context menu inside a message', () => {
    installGuard();
    const { link } = createMessageFixture();
    const contextMenu = pointerEvent('contextmenu', 'touch');

    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it('cancels a compatibility mouse PointerEvent that follows a message touch', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    const contextMenu = pointerEvent('contextmenu', 'mouse');
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it('cancels a retargeted legacy menu only when it matches the touch point', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch', 40, 50));
    const matchingMenu = legacyContextMenu(42, 52);
    document.body.dispatchEvent(matchingMenu);

    expect(matchingMenu.defaultPrevented).toBe(true);
  });

  it('does not consume an unrelated context menu outside the touched message', () => {
    installGuard();
    const { link, outside } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch', 40, 50));
    const unrelatedMenu = legacyContextMenu(140, 150);
    outside.dispatchEvent(unrelatedMenu);

    expect(unrelatedMenu.defaultPrevented).toBe(false);
  });

  it('does not reuse a touch from one message for another message', () => {
    installGuard();
    const { link } = createMessageFixture();
    const otherRow = document.createElement('article');
    otherRow.className = 'message-row';
    const otherLink = document.createElement('a');
    otherLink.href = '/other';
    otherRow.append(otherLink);
    fixture?.append(otherRow);

    link.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    const contextMenu = legacyContextMenu();
    otherLink.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('clears the remembered message touch when the next touch starts outside messages', () => {
    installGuard();
    const { link, outside } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    outside.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('keeps small touch jitter inside the long-press fallback', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch', 40, 50));
    link.dispatchEvent(pointerEvent('pointermove', 'touch', 44, 54));
    const contextMenu = legacyContextMenu(44, 54);
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it('drops the legacy fallback after the finger moves into a scroll gesture', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch', 40, 50));
    link.dispatchEvent(
      pointerEvent('pointermove', 'touch', 40 + TOUCH_CONTEXT_MENU_MAX_DRIFT_PX + 1, 50)
    );
    const contextMenu = legacyContextMenu(40, 50);
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('drops the legacy fallback after a legacy touchmove becomes a scroll gesture', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(legacyTouchEvent('touchstart', 40, 50));
    link.dispatchEvent(legacyTouchEvent('touchmove', 40 + TOUCH_CONTEXT_MENU_MAX_DRIFT_PX + 1, 50));
    const contextMenu = legacyContextMenu(40, 50);
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('tracks a second sequential touch after the first pointer is released', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch', 24, 32, 1));
    link.dispatchEvent(pointerEvent('pointerup', 'touch', 24, 32, 1));
    link.dispatchEvent(pointerEvent('pointerdown', 'touch', 48, 64, 2));
    const contextMenu = legacyContextMenu(48, 64);
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it('does not treat a simultaneous second touch pointer as a long press', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch', 24, 32, 1));
    link.dispatchEvent(pointerEvent('pointerdown', 'touch', 48, 64, 2));
    const contextMenu = legacyContextMenu(24, 32);
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('drops the legacy fallback when the browser cancels the touch pointer', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    link.dispatchEvent(pointerEvent('pointercancel', 'touch'));
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('drops the legacy fallback when a legacy touch sequence is cancelled', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(legacyTouchEvent('touchstart'));
    link.dispatchEvent(legacyTouchEvent('touchcancel'));
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('preserves mouse right-click inside a message row', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'mouse'));
    const contextMenu = pointerEvent('contextmenu', 'mouse');
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('preserves pen context menus inside a message row', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'pen'));
    const contextMenu = pointerEvent('contextmenu', 'pen');
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('preserves keyboard context-menu invocation after a previous touch', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ContextMenu' }));
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('does not cancel direct touch context menus outside message rows', () => {
    installGuard();
    const { outside } = createMessageFixture();
    const contextMenu = pointerEvent('contextmenu', 'touch');

    outside.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('expires the synthetic-mouse fallback window against the event clock', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    now += TOUCH_CONTEXT_MENU_FALLBACK_MS + 1;
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('releases remembered message state when the fallback timer expires', () => {
    vi.useFakeTimers();
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(pointerEvent('pointerdown', 'touch'));
    vi.advanceTimersByTime(TOUCH_CONTEXT_MENU_FALLBACK_MS);
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('uses a passive touchstart fallback when no PointerEvent precedes the menu', () => {
    installGuard();
    const { link } = createMessageFixture();
    const touchStart = legacyTouchEvent('touchstart');

    link.dispatchEvent(touchStart);
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(touchStart.defaultPrevented).toBe(false);
    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it('does not arm the legacy fallback for a multi-touch gesture', () => {
    installGuard();
    const { link } = createMessageFixture();

    link.dispatchEvent(legacyTouchEvent('touchstart', 24, 32, 2));
    const contextMenu = legacyContextMenu();
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });

  it('removes every listener and pending fallback during teardown', () => {
    vi.useFakeTimers();
    installGuard();
    const { link } = createMessageFixture();
    link.dispatchEvent(pointerEvent('pointerdown', 'touch'));

    cleanup?.();
    cleanup = null;
    vi.runAllTimers();
    const contextMenu = pointerEvent('contextmenu', 'touch');
    link.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(false);
  });
});
