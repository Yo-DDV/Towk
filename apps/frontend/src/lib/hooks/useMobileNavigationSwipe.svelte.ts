import { sidebarNav } from '$lib/state/globals.svelte';
import { panGesture, type PanGestureConfig } from './panGesture.svelte';

const MAX_TOUCH_VIEWPORT_WIDTH_PX = 1023;
const SYSTEM_EDGE_GUARD_PX = 24;
const BOTTOM_GESTURE_GUARD_PX = 24;
const DIRECTION_LOCK_PX = 12;
const DIRECTION_LOCK_RATIO = 1.25;
const MIN_FLING_VELOCITY_PX_PER_MS = 0.5;
const MIN_COMMIT_DISTANCE_PX = 56;
const MAX_COMMIT_DISTANCE_PX = 96;
const COMMIT_VIEWPORT_RATIO = 0.18;
const SAFE_AREA_LEFT_PROPERTY = '--mobile-navigation-safe-left';
const SAFE_AREA_RIGHT_PROPERTY = '--mobile-navigation-safe-right';
const SAFE_AREA_BOTTOM_PROPERTY = '--mobile-navigation-safe-bottom';

const BLOCKED_START_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  'summary',
  'iframe',
  'audio',
  'video',
  'canvas',
  '[contenteditable]:not([contenteditable="false"])',
  '[draggable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="switch"]',
  '[role="textbox"]',
  '[data-app-sidebar="true"]',
  '[data-mobile-navigation-swipe="ignore"]'
].join(',');

type NavigationIntent =
  | { kind: 'open-left' }
  | { kind: 'close-left' }
  | { kind: 'open-members'; button: HTMLButtonElement }
  | { kind: 'close-right'; button: HTMLButtonElement };

export type MobileNavigationSwipeOptions = {
  edgeGuardPx?: number;
  bottomGuardPx?: number;
  directionLockPx?: number;
  directionLockRatio?: number;
  minDistancePx?: number;
  minVelocityPxPerMs?: number;
  maxViewportWidthPx?: number;
};

type ViewportBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function viewportBounds(): ViewportBounds {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight
  };
}

function touchStartPoint(event: PointerEvent | TouchEvent) {
  if (!('touches' in event) || event.touches.length !== 1) return null;
  const touch = event.changedTouches.item(0) ?? event.touches.item(0);
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function startElement(event: Event): Element | null {
  for (const entry of event.composedPath()) {
    if (entry instanceof Element) return entry;
  }
  return event.target instanceof Element ? event.target : null;
}

function cssPixelValue(node: HTMLElement, property: string) {
  const value = Number.parseFloat(getComputedStyle(node).getPropertyValue(property));
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isInsideSystemGestureGuard(
  x: number,
  y: number,
  bounds: ViewportBounds,
  guards: { left: number; right: number; bottom: number }
) {
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  return (
    x <= bounds.left + guards.left ||
    x >= right - guards.right ||
    y >= bottom - guards.bottom
  );
}

function hasActiveTextSelection() {
  const selection = document.getSelection();
  return selection !== null && !selection.isCollapsed;
}

function ownsHorizontalGesture(element: Element, host: HTMLElement) {
  for (
    let current: Element | null = element;
    current && current !== host;
    current = current.parentElement
  ) {
    const style = getComputedStyle(current);
    const overflowX = style.overflowX || style.overflow;
    if (
      /^(auto|scroll|overlay)$/.test(overflowX) &&
      current.scrollWidth > current.clientWidth + 1
    ) {
      return true;
    }

    const touchAction = style.touchAction;
    if (touchAction === 'none' || touchAction.split(/\s+/).includes('pan-x')) {
      return true;
    }
  }
  return false;
}

function mobileRoomSidebarButtons() {
  const group = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="room-sidebar-toggle"]')
  ).find((candidate) => candidate.classList.contains('lg:hidden'));

  return group ? Array.from(group.querySelectorAll<HTMLButtonElement>('button')) : [];
}

function activeRoomSidebarButton() {
  return mobileRoomSidebarButtons().find(
    (button) => button.getAttribute('aria-pressed') === 'true'
  );
}

function memberRoomSidebarButton() {
  return mobileRoomSidebarButtons().find(
    (button) => button.querySelector('.uil--users-alt') !== null
  );
}

function resolveIntent(deltaX: number): NavigationIntent | null {
  const activeRightButton = activeRoomSidebarButton();

  if (deltaX > 0) {
    if (activeRightButton) return { kind: 'close-right', button: activeRightButton };
    if (sidebarNav.isMobile && sidebarNav.isOpen) return null;
    return sidebarNav.isMobile ? { kind: 'open-left' } : null;
  }

  if (deltaX < 0) {
    if (sidebarNav.isMobile && sidebarNav.isOpen) return { kind: 'close-left' };
    if (activeRightButton) return null;

    const memberButton = memberRoomSidebarButton();
    return memberButton ? { kind: 'open-members', button: memberButton } : null;
  }

  return null;
}

function isLeftNavigationIntent(
  intent: NavigationIntent | null
): intent is Extract<NavigationIntent, { kind: 'open-left' | 'close-left' }> {
  return intent?.kind === 'open-left' || intent?.kind === 'close-left';
}

function settleLeftNavigation(
  intent: Extract<NavigationIntent, { kind: 'open-left' | 'close-left' }>,
  commit: boolean
) {
  const shouldBeOpen = intent.kind === 'open-left' ? commit : !commit;
  sidebarNav.endDrag(0);
  if (sidebarNav.isOpen !== shouldBeOpen) sidebarNav.toggle();
}

function executeRightIntent(
  intent: Extract<NavigationIntent, { kind: 'open-members' | 'close-right' }>
) {
  switch (intent.kind) {
    case 'open-members':
      if (intent.button.isConnected && intent.button.getAttribute('aria-pressed') !== 'true') {
        intent.button.click();
      }
      break;
    case 'close-right':
      if (intent.button.isConnected && intent.button.getAttribute('aria-pressed') === 'true') {
        intent.button.click();
      }
      break;
  }
}

function commitDistance(options: MobileNavigationSwipeOptions) {
  if (options.minDistancePx !== undefined) return Math.max(0, options.minDistancePx);
  const distance = viewportBounds().width * COMMIT_VIEWPORT_RATIO;
  return Math.min(MAX_COMMIT_DISTANCE_PX, Math.max(MIN_COMMIT_DISTANCE_PX, distance));
}

function shouldCommit(
  deltaX: number,
  velocityX: number,
  options: MobileNavigationSwipeOptions
) {
  if (Math.abs(deltaX) >= commitDistance(options)) return true;

  const minVelocity = options.minVelocityPxPerMs ?? MIN_FLING_VELOCITY_PX_PER_MS;
  return (
    Math.abs(deltaX) >= (options.directionLockPx ?? DIRECTION_LOCK_PX) &&
    Math.abs(velocityX) >= minVelocity &&
    Math.sign(velocityX) === Math.sign(deltaX)
  );
}

function panConfig(
  node: HTMLElement,
  options: MobileNavigationSwipeOptions,
  setPendingIntent: (intent: NavigationIntent | null) => void,
  getPendingIntent: () => NavigationIntent | null
): PanGestureConfig {
  return {
    axis: 'x',
    enabled: () =>
      viewportBounds().width <=
      (options.maxViewportWidthPx ?? MAX_TOUCH_VIEWPORT_WIDTH_PX),
    shouldStart: (event) => {
      setPendingIntent(null);

      const point = touchStartPoint(event);
      if (!point) return false;

      const bounds = viewportBounds();
      const edgeGuard = Math.max(0, options.edgeGuardPx ?? SYSTEM_EDGE_GUARD_PX);
      const bottomGuard = Math.max(
        0,
        options.bottomGuardPx ?? BOTTOM_GESTURE_GUARD_PX
      );
      if (
        isInsideSystemGestureGuard(point.x, point.y, bounds, {
          left: Math.max(edgeGuard, cssPixelValue(node, SAFE_AREA_LEFT_PROPERTY)),
          right: Math.max(edgeGuard, cssPixelValue(node, SAFE_AREA_RIGHT_PROPERTY)),
          bottom: Math.max(bottomGuard, cssPixelValue(node, SAFE_AREA_BOTTOM_PROPERTY))
        })
      ) {
        return false;
      }

      const target = startElement(event);
      if (!target || !node.contains(target)) return false;
      if (target.closest(BLOCKED_START_SELECTOR)) return false;
      if (hasActiveTextSelection()) return false;
      if (ownsHorizontalGesture(target, node)) return false;
      return true;
    },
    directionLockPx: options.directionLockPx ?? DIRECTION_LOCK_PX,
    directionLockRatio: options.directionLockRatio ?? DIRECTION_LOCK_RATIO,
    shouldClaim: (deltaX) => {
      const intent = resolveIntent(deltaX);
      setPendingIntent(intent);
      return intent !== null;
    },
    onStart: () => {
      if (isLeftNavigationIntent(getPendingIntent())) sidebarNav.startDrag();
    },
    onUpdate: (deltaX) => {
      if (isLeftNavigationIntent(getPendingIntent())) sidebarNav.updateDrag(deltaX);
    },
    onEnd: (deltaX, velocityX) => {
      const intent = getPendingIntent();
      setPendingIntent(null);
      if (!intent) return;

      const commit = shouldCommit(deltaX, velocityX, options);
      if (isLeftNavigationIntent(intent)) {
        settleLeftNavigation(intent, commit);
        return;
      }
      if (commit) executeRightIntent(intent);
    },
    onCancel: () => {
      const intent = getPendingIntent();
      setPendingIntent(null);
      if (isLeftNavigationIntent(intent)) settleLeftNavigation(intent, false);
    }
  };
}

/**
 * Adds touch-only, system-safe horizontal navigation gestures to the app shell.
 *
 * The action deliberately leaves the outer screen edges, the bottom OS gesture
 * area, vertical scrolling, interactive controls, embedded content, and nested
 * horizontal scrollers untouched. A claimed gesture performs one state change:
 * open/close the left navigation or open/close the current room's right panel.
 */
export function mobileNavigationSwipe(
  node: HTMLElement,
  initialOptions: MobileNavigationSwipeOptions = {}
) {
  let options = initialOptions;
  let pendingIntent: NavigationIntent | null = null;
  const setPendingIntent = (intent: NavigationIntent | null) => {
    pendingIntent = intent;
  };
  const getPendingIntent = () => pendingIntent;

  const gesture = panGesture(node, panConfig(node, options, setPendingIntent, getPendingIntent));

  return {
    update(nextOptions: MobileNavigationSwipeOptions = {}) {
      options = nextOptions;
      gesture.update(panConfig(node, options, setPendingIntent, getPendingIntent));
    },
    destroy() {
      pendingIntent = null;
      gesture.destroy();
    }
  };
}
