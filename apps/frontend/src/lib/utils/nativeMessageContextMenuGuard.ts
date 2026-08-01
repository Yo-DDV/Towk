const MESSAGE_ROW_SELECTOR = '.message-row';

export const TOUCH_CONTEXT_MENU_FALLBACK_MS = 2_500;
export const TOUCH_CONTEXT_MENU_MAX_DRIFT_PX = 24;

type Clock = () => number;

type Point = {
  clientX: number;
  clientY: number;
};

type RecentMessageTouch = Point & {
  row: HTMLElement;
  pointerId: number | null;
  startedAt: number;
};

function pointerTypeOf(event: Event): string {
  const pointerType = (event as Event & { pointerType?: unknown }).pointerType;
  return typeof pointerType === 'string' ? pointerType : '';
}

function messageRowFromEvent(event: Event): HTMLElement | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    const row = target.matches(MESSAGE_ROW_SELECTOR)
      ? target
      : target.closest(MESSAGE_ROW_SELECTOR);
    if (row instanceof HTMLElement) return row;
  }

  const target = event.target;
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return (element?.closest(MESSAGE_ROW_SELECTOR) as HTMLElement | null) ?? null;
}

function firstTouch(list: TouchList | undefined): Touch | null {
  if (!list || list.length === 0) return null;
  return list.item?.(0) ?? list[0] ?? null;
}

function pointFromEvent(event: Event): Point | null {
  const mouseEvent = event as MouseEvent;
  if (typeof mouseEvent.clientX === 'number' && typeof mouseEvent.clientY === 'number') {
    return { clientX: mouseEvent.clientX, clientY: mouseEvent.clientY };
  }

  const touchEvent = event as TouchEvent;
  const touch = firstTouch(touchEvent.touches) ?? firstTouch(touchEvent.changedTouches);
  return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
}

function isNear(point: Point, touch: RecentMessageTouch): boolean {
  return (
    Math.hypot(point.clientX - touch.clientX, point.clientY - touch.clientY) <=
    TOUCH_CONTEXT_MENU_MAX_DRIFT_PX
  );
}

/**
 * Prevents a touch-originated browser context menu from competing with Towk's
 * message action sheet. The guard intentionally leaves event propagation,
 * scrolling, zooming, mouse/pen right-click, and keyboard context menus
 * untouched.
 */
export function installNativeMessageContextMenuGuard(
  root: Document,
  now: Clock = Date.now
): () => void {
  let recentTouch: RecentMessageTouch | null = null;

  function clearRecentTouch() {
    recentTouch = null;
  }

  function rememberTouch(event: Event, pointerId: number | null) {
    const row = messageRowFromEvent(event);
    const point = pointFromEvent(event);
    recentTouch = row && point ? { row, pointerId, startedAt: now(), ...point } : null;
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.pointerType !== 'touch') {
      clearRecentTouch();
      return;
    }

    if (
      recentTouch &&
      recentTouch.pointerId !== null &&
      recentTouch.pointerId !== event.pointerId
    ) {
      clearRecentTouch();
      return;
    }

    rememberTouch(event, event.pointerId);
  }

  function handleTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      clearRecentTouch();
      return;
    }

    rememberTouch(event, recentTouch?.pointerId ?? null);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!recentTouch || event.pointerType !== 'touch') return;
    if (recentTouch.pointerId !== null && recentTouch.pointerId !== event.pointerId) return;

    const point = pointFromEvent(event);
    if (point && !isNear(point, recentTouch)) clearRecentTouch();
  }

  function handleTouchMove(event: TouchEvent) {
    if (!recentTouch) return;
    if (event.touches.length !== 1) {
      clearRecentTouch();
      return;
    }

    const point = pointFromEvent(event);
    if (point && !isNear(point, recentTouch)) clearRecentTouch();
  }

  function handlePointerCancel(event: PointerEvent) {
    if (!recentTouch) return;
    if (recentTouch.pointerId === null || recentTouch.pointerId === event.pointerId) {
      clearRecentTouch();
    }
  }

  function handleContextMenu(event: MouseEvent) {
    const eventRow = messageRowFromEvent(event);
    const pointerType = pointerTypeOf(event);
    const directTouchOnMessage = pointerType === 'touch' && eventRow !== null;

    let legacyTouchOnMessage = false;
    if (pointerType === '' && recentTouch !== null) {
      const age = now() - recentTouch.startedAt;
      if (age < 0 || age > TOUCH_CONTEXT_MENU_FALLBACK_MS) {
        clearRecentTouch();
      } else if (eventRow === recentTouch.row) {
        legacyTouchOnMessage = true;
      } else if (eventRow === null) {
        const point = pointFromEvent(event);
        legacyTouchOnMessage = point !== null && isNear(point, recentTouch);
      }
    }

    if (!directTouchOnMessage && !legacyTouchOnMessage) return;

    event.preventDefault();
    clearRecentTouch();
  }

  root.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
  root.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true });
  root.addEventListener('pointercancel', handlePointerCancel, { capture: true, passive: true });
  root.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
  root.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true });
  root.addEventListener('touchcancel', clearRecentTouch, { capture: true, passive: true });
  root.addEventListener('keydown', clearRecentTouch, true);
  root.addEventListener('visibilitychange', clearRecentTouch, true);
  root.addEventListener('contextmenu', handleContextMenu, true);

  return () => {
    root.removeEventListener('pointerdown', handlePointerDown, true);
    root.removeEventListener('pointermove', handlePointerMove, true);
    root.removeEventListener('pointercancel', handlePointerCancel, true);
    root.removeEventListener('touchstart', handleTouchStart, true);
    root.removeEventListener('touchmove', handleTouchMove, true);
    root.removeEventListener('touchcancel', clearRecentTouch, true);
    root.removeEventListener('keydown', clearRecentTouch, true);
    root.removeEventListener('visibilitychange', clearRecentTouch, true);
    root.removeEventListener('contextmenu', handleContextMenu, true);
  };
}
