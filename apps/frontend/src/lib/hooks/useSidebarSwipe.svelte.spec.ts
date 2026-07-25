import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sidebarNav } from '$lib/state/globals.svelte';
import { sidebarSwipe } from './useSidebarSwipe.svelte';

const originalElementsFromPoint = document.elementsFromPoint;

function resetSidebar() {
  sidebarNav.setMobile(false);
  if (!sidebarNav.isOpen) sidebarNav.toggle();
  sidebarNav.setMobile(true);
}

function makeGestureHost() {
  const host = document.createElement('div');
  const underlying = document.createElement('button');

  host.setPointerCapture = vi.fn();
  host.releasePointerCapture = vi.fn();
  document.body.append(underlying, host);

  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: vi.fn(() => [host, underlying])
  });

  return { host, underlying };
}

function pointer(type: string, x: number, y = 24) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    clientX: x,
    clientY: y
  });
}

function touch(type: string, x: number, y = 24) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  const item = { identifier: 1, clientX: x, clientY: y };
  const currentTouches = type === 'touchend' || type === 'touchcancel' ? [] : [item];
  const touchList = (items: typeof currentTouches) =>
    Object.assign(items, { item: (i: number) => items[i] ?? null });
  Object.defineProperty(event, 'touches', {
    value: touchList(currentTouches)
  });
  Object.defineProperty(event, 'changedTouches', {
    value: touchList([item])
  });
  return event;
}

describe('sidebarSwipe', () => {
  beforeEach(() => {
    resetSidebar();
  });

  afterEach(() => {
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint
    });
    document.body.replaceChildren();
  });

  it('forwards a stationary overlay tap to the underlying content', () => {
    const { host, underlying } = makeGestureHost();
    const onUnderlyingPointerDown = vi.fn();
    const onUnderlyingClick = vi.fn();
    underlying.addEventListener('pointerdown', onUnderlyingPointerDown);
    underlying.addEventListener('click', onUnderlyingClick);

    const action = sidebarSwipe(host);
    host.dispatchEvent(pointer('pointerdown', 120));
    window.dispatchEvent(pointer('pointerup', 120));

    expect(onUnderlyingPointerDown).toHaveBeenCalledOnce();
    expect(onUnderlyingClick).toHaveBeenCalledOnce();
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('opens the mobile sidebar on a rightward drag', () => {
    const { host } = makeGestureHost();
    const action = sidebarSwipe(host);

    host.dispatchEvent(pointer('pointerdown', 40));
    window.dispatchEvent(pointer('pointermove', 250));
    window.dispatchEvent(pointer('pointerup', 250));

    expect(sidebarNav.isOpen).toBe(true);

    action.destroy();
  });

  it('closes the mobile sidebar on a leftward pointer drag', () => {
    const { host } = makeGestureHost();
    sidebarNav.isOpen = true;
    const action = sidebarSwipe(host);

    host.dispatchEvent(pointer('pointerdown', 320));
    window.dispatchEvent(pointer('pointermove', 0));
    window.dispatchEvent(pointer('pointerup', 0));

    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('closes the mobile sidebar on a leftward touch drag', () => {
    const { host } = makeGestureHost();
    sidebarNav.isOpen = true;
    const action = sidebarSwipe(host);

    host.dispatchEvent(touch('touchstart', 320));
    const move = touch('touchmove', 0);
    window.dispatchEvent(move);
    window.dispatchEvent(touch('touchend', 0));

    expect(move.defaultPrevented).toBe(true);
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });
});
