export const AUTO_HIDE_SCROLLBAR_IDLE_MS = 700;

const AUTO_HIDE_SCROLLBARS_ATTRIBUTE = 'data-auto-hide-scrollbars';
const SCROLLBAR_ACTIVE_ATTRIBUTE = 'data-scrollbar-active';
const FINE_POINTER_QUERY = '(any-hover: hover) and (any-pointer: fine)';
const FORCED_COLORS_QUERY = '(forced-colors: active)';

function listenForMediaQueryChanges(query: MediaQueryList, listener: () => void): () => void {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }

  query.addListener(listener);
  return () => query.removeListener(listener);
}

export function useAutoHideScrollbars() {
  $effect(() => {
    if (
      typeof window === 'undefined' ||
      typeof document === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const root = document.documentElement;
    const finePointer = window.matchMedia(FINE_POINTER_QUERY);
    const forcedColors = window.matchMedia(FORCED_COLORS_QUERY);
    const idleTimers = new Map<Element, number>();
    let enabled = false;

    function clearElement(element: Element): void {
      const timer = idleTimers.get(element);
      if (timer !== undefined) window.clearTimeout(timer);
      idleTimers.delete(element);
      element.removeAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE);
    }

    function clearAll(): void {
      for (const element of [...idleTimers.keys()]) clearElement(element);
    }

    function getScrollTarget(target: EventTarget | null): Element | null {
      if (target instanceof Element) return target;
      if (target === document) return document.scrollingElement;
      return null;
    }

    function handleScroll(event: Event): void {
      const element = getScrollTarget(event.target);
      if (!element) return;

      const previousTimer = idleTimers.get(element);
      if (previousTimer !== undefined) window.clearTimeout(previousTimer);

      element.setAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE, '');
      const timer = window.setTimeout(() => {
        idleTimers.delete(element);
        element.removeAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE);
      }, AUTO_HIDE_SCROLLBAR_IDLE_MS);
      idleTimers.set(element, timer);
    }

    function setEnabled(next: boolean): void {
      if (next === enabled) {
        root.toggleAttribute(AUTO_HIDE_SCROLLBARS_ATTRIBUTE, next);
        if (!next) clearAll();
        return;
      }

      enabled = next;
      root.toggleAttribute(AUTO_HIDE_SCROLLBARS_ATTRIBUTE, enabled);
      if (enabled) {
        document.addEventListener('scroll', handleScroll, true);
      } else {
        document.removeEventListener('scroll', handleScroll, true);
        clearAll();
      }
    }

    function sync(): void {
      setEnabled(finePointer.matches && !forcedColors.matches);
    }

    const removeFinePointerListener = listenForMediaQueryChanges(finePointer, sync);
    const removeForcedColorsListener = listenForMediaQueryChanges(forcedColors, sync);
    sync();

    return () => {
      removeFinePointerListener();
      removeForcedColorsListener();
      document.removeEventListener('scroll', handleScroll, true);
      root.removeAttribute(AUTO_HIDE_SCROLLBARS_ATTRIBUTE);
      clearAll();
    };
  });
}
