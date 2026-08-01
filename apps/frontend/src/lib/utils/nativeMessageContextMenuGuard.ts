const MESSAGE_ROW_SELECTOR = '.message-row';

export const TOUCH_CONTEXT_MENU_FALLBACK_MS = 2_500;

type Clock = () => number;

type RecentMessageTouch = {
  row: HTMLElement;
  startedAt: number;
};

function pointerTypeOf(event: Event): string {
  const pointerType = (event as Event & { pointerType?: unknown }).pointerType;
  return typeof pointerType === 'string' ? pointerType : '';
}

function messageRowFromEvent(event: Event): HTMLElement | null {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.matches(MESSAGE_ROW_SELECTOR)) {
      return target;
    }
  }

  const target = event.target;
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return (element?.closest(MESSAGE_ROW_SELECTOR) as HTMLElement | null) ?? null;
}

/**
 * Prevents a touch-originated browser context menu from competing with Towk's
 * message action sheet. The guard intentionally leaves event propagation,
 * scrolling, zooming, mouse right-click, and keyboard context menus untouched.
 */
export function installNativeMessageContextMenuGuard(
  root: Document,
  now: Clock = Date.now
): () => void {
  let recentTouch: RecentMessageTouch | null = null;

  function clearRecentTouch() {
    recentTouch = null;
  }

  function rememberTouch(event: Event) {
    const row = messageRowFromEvent(event);
    recentTouch = row ? { row, startedAt: now() } : null;
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.pointerType === 'touch') {
      rememberTouch(event);
      return;
    }

    clearRecentTouch();
  }

  function handleTouchStart(event: TouchEvent) {
    rememberTouch(event);
  }

  function handleContextMenu(event: MouseEvent) {
    const eventRow = messageRowFromEvent(event);
    const directTouchOnMessage = pointerTypeOf(event) === 'touch' && eventRow !== null;
    const recentMessageTouch =
      recentTouch !== null &&
      now() - recentTouch.startedAt <= TOUCH_CONTEXT_MENU_FALLBACK_MS &&
      (eventRow === null || eventRow === recentTouch.row);

    if (!directTouchOnMessage && !recentMessageTouch) return;

    event.preventDefault();
    clearRecentTouch();
  }

  root.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
  root.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
  root.addEventListener('keydown', clearRecentTouch, true);
  root.addEventListener('contextmenu', handleContextMenu, true);

  return () => {
    root.removeEventListener('pointerdown', handlePointerDown, true);
    root.removeEventListener('touchstart', handleTouchStart, true);
    root.removeEventListener('keydown', clearRecentTouch, true);
    root.removeEventListener('contextmenu', handleContextMenu, true);
  };
}
