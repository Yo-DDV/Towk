import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sidebarNav } from '$lib/state/globals.svelte';
import {
  mobileNavigationSwipe,
  type MobileNavigationSwipeOptions
} from './useMobileNavigationSwipe.svelte';

const TEST_OPTIONS: MobileNavigationSwipeOptions = {
  maxViewportWidthPx: 2000,
  minDistancePx: 60,
  minVelocityPxPerMs: Number.POSITIVE_INFINITY
};

function resetSidebar() {
  sidebarNav.setMobile(false);
  if (!sidebarNav.isOpen) sidebarNav.toggle();
  sidebarNav.setMobile(true);
}

function hostElement() {
  const host = document.createElement('div');
  const content = document.createElement('div');
  host.append(content);
  document.body.append(host);
  return { host, content };
}

function roomPanelButton(
  panel: 'members' | 'files',
  pressed = false,
  mode: 'mobile' | 'desktop' = 'mobile'
) {
  const group = document.createElement('span');
  group.dataset.testid = 'room-sidebar-toggle';
  group.className = mode === 'mobile' ? 'inline-flex lg:hidden' : 'hidden lg:inline-flex';
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-pressed', String(pressed));
  const icon = document.createElement('span');
  icon.className = panel === 'members' ? 'uil--users-alt' : 'uil--paperclip';
  button.append(icon);
  group.append(button);
  document.body.append(group);

  const onToggle = vi.fn(() => {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
  });
  button.addEventListener('click', onToggle);
  return { button, onToggle };
}

function touch(
  type: string,
  x: number,
  y = 120,
  touchCount = 1,
  identifier = 1
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  const items = Array.from({ length: touchCount }, (_, index) => ({
    identifier: identifier + index,
    clientX: x + index,
    clientY: y + index
  }));
  const currentTouches = type === 'touchend' || type === 'touchcancel' ? [] : items;
  const touchList = <T>(values: T[]) =>
    Object.assign(values, { item: (i: number) => values[i] ?? null });
  Object.defineProperty(event, 'touches', {
    value: touchList(currentTouches)
  });
  Object.defineProperty(event, 'changedTouches', {
    value: touchList(items)
  });
  return event;
}

function swipe(
  target: Element,
  startX: number,
  endX: number,
  startY = 120,
  endY = startY,
  touchCount = 1
) {
  target.dispatchEvent(touch('touchstart', startX, startY, touchCount));
  const move = touch('touchmove', endX, endY, touchCount);
  window.dispatchEvent(move);
  window.dispatchEvent(touch('touchend', endX, endY, touchCount));
  return move;
}

function viewportWidth() {
  return window.visualViewport?.width ?? window.innerWidth;
}

function viewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}

describe('mobileNavigationSwipe', () => {
  beforeEach(() => {
    resetSidebar();
  });

  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it('tracks and opens the left navigation from a deliberate rightward content swipe', () => {
    const { host, content } = hostElement();
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    content.dispatchEvent(touch('touchstart', 120));
    const move = touch('touchmove', 190);
    window.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(true);
    expect(sidebarNav.dragOffset).toBe(70);
    expect(sidebarNav.progress).toBeGreaterThan(0);
    expect(sidebarNav.isOpen).toBe(false);

    window.dispatchEvent(touch('touchend', 240));

    expect(sidebarNav.dragOffset).toBeNull();
    expect(sidebarNav.isOpen).toBe(true);

    action.destroy();
  });

  it('closes the left navigation from the opposite swipe', () => {
    const { host, content } = hostElement();
    sidebarNav.isOpen = true;
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    swipe(content, 260, 120);

    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('opens the member panel from a deliberate leftward content swipe', () => {
    const { host, content } = hostElement();
    const { button, onToggle } = roomPanelButton('members');
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    swipe(content, 260, 120);

    expect(onToggle).toHaveBeenCalledOnce();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('ignores a persisted desktop panel state when resolving mobile gestures', () => {
    const { host, content } = hostElement();
    const desktop = roomPanelButton('files', true, 'desktop');
    const mobile = roomPanelButton('members');
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    swipe(content, 260, 120);

    expect(desktop.onToggle).not.toHaveBeenCalled();
    expect(desktop.button.getAttribute('aria-pressed')).toBe('true');
    expect(mobile.onToggle).toHaveBeenCalledOnce();
    expect(mobile.button.getAttribute('aria-pressed')).toBe('true');

    action.destroy();
  });

  it('closes the active right panel from a rightward swipe', () => {
    const { host, content } = hostElement();
    const { button, onToggle } = roomPanelButton('files', true);
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    swipe(content, 120, 260);

    expect(onToggle).toHaveBeenCalledOnce();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('commits only the close action when the right panel is open', () => {
    const { host, content } = hostElement();
    const { onToggle } = roomPanelButton('members', true);
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    swipe(content, 120, 260);

    expect(onToggle).toHaveBeenCalledOnce();
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('does not claim a leftward swipe when the room has no member panel', () => {
    const { host, content } = hostElement();
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    const move = swipe(content, 260, 120);

    expect(move.defaultPrevented).toBe(false);
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('leaves left, right, and bottom system gesture guards untouched', () => {
    const { host, content } = hostElement();
    const { onToggle } = roomPanelButton('members');
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);
    const width = viewportWidth();
    const height = viewportHeight();

    swipe(content, 10, 140);
    swipe(content, width - 10, width - 140);
    swipe(content, 120, 240, height - 10);

    expect(onToggle).not.toHaveBeenCalled();
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('does not claim vertical or ambiguous diagonal movement', () => {
    const { host, content } = hostElement();
    const { onToggle } = roomPanelButton('members');
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    const move = swipe(content, 220, 190, 120, 260);

    expect(move.defaultPrevented).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('cancels a short horizontal drag below the commit threshold', () => {
    const { host, content } = hostElement();
    const { onToggle } = roomPanelButton('members');
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    swipe(content, 220, 195);

    expect(onToggle).not.toHaveBeenCalled();
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('does not start from editable or interactive controls', () => {
    const { host } = hostElement();
    const input = document.createElement('input');
    host.append(input);
    const { onToggle } = roomPanelButton('members');
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    const move = swipe(input, 260, 120);

    expect(move.defaultPrevented).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();

    action.destroy();
  });

  it('does not steal gestures from nested horizontal scrollers', () => {
    const { host } = hostElement();
    const scroller = document.createElement('div');
    const child = document.createElement('div');
    scroller.style.overflowX = 'auto';
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 240 });
    scroller.append(child);
    host.append(scroller);
    const { onToggle } = roomPanelButton('members');
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    const move = swipe(child, 260, 120);

    expect(move.defaultPrevented).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();

    action.destroy();
  });

  it('ignores multi-touch input', () => {
    const { host, content } = hostElement();
    const { onToggle } = roomPanelButton('members');
    const action = mobileNavigationSwipe(host, TEST_OPTIONS);

    const move = swipe(content, 260, 120, 120, 120, 2);

    expect(move.defaultPrevented).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });

  it('stays disabled above the configured touch viewport width', () => {
    const { host, content } = hostElement();
    const action = mobileNavigationSwipe(host, {
      ...TEST_OPTIONS,
      maxViewportWidthPx: 0
    });

    const move = swipe(content, 120, 260);

    expect(move.defaultPrevented).toBe(false);
    expect(sidebarNav.isOpen).toBe(false);

    action.destroy();
  });
});
