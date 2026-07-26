import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import {
  AUTO_HIDE_SCROLLBAR_IDLE_MS,
  useAutoHideScrollbars
} from './useAutoHideScrollbars.svelte';

const FINE_POINTER_QUERY = '(any-hover: hover) and (any-pointer: fine)';
const FORCED_COLORS_QUERY = '(forced-colors: active)';

type MutableMediaQueryList = MediaQueryList & {
  setMatches(matches: boolean): void;
};

function createMediaQueryList(media: string, initialMatches: boolean): MutableMediaQueryList {
  const target = new EventTarget() as MutableMediaQueryList;
  let matches = initialMatches;

  Object.defineProperties(target, {
    matches: { get: () => matches },
    media: { value: media },
    onchange: { value: null, writable: true }
  });

  target.addListener = (listener) => target.addEventListener('change', listener as EventListener);
  target.removeListener = (listener) => target.removeEventListener('change', listener as EventListener);
  target.setMatches = (next) => {
    matches = next;
    target.dispatchEvent(Object.assign(new Event('change'), { matches: next, media }));
  };

  return target;
}

function installMatchMedia(finePointerMatches: boolean, forcedColorsMatches = false) {
  const finePointer = createMediaQueryList(FINE_POINTER_QUERY, finePointerMatches);
  const forcedColors = createMediaQueryList(FORCED_COLORS_QUERY, forcedColorsMatches);
  const matchMedia = vi.fn((query: string) =>
    query === FORCED_COLORS_QUERY ? forcedColors : finePointer
  );
  vi.stubGlobal('matchMedia', matchMedia);
  return { finePointer, forcedColors, matchMedia };
}

function mountHook() {
  const cleanup = $effect.root(() => useAutoHideScrollbars());
  flushSync();
  return cleanup;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.removeAttribute('data-auto-hide-scrollbars');
});

afterEach(() => {
  document
    .querySelectorAll('[data-scrollbar-active]')
    .forEach((element) => element.removeAttribute('data-scrollbar-active'));
  document.documentElement.removeAttribute('data-auto-hide-scrollbars');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useAutoHideScrollbars', () => {
  it('shows the active scrollbar during scrolling and hides it after the idle delay', () => {
    installMatchMedia(true);
    const cleanup = mountHook();
    const scroller = document.createElement('div');
    document.body.append(scroller);

    expect(document.documentElement.hasAttribute('data-auto-hide-scrollbars')).toBe(true);

    scroller.dispatchEvent(new Event('scroll'));
    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(true);

    vi.advanceTimersByTime(AUTO_HIDE_SCROLLBAR_IDLE_MS - 1);
    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(true);

    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(AUTO_HIDE_SCROLLBAR_IDLE_MS);
    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(false);

    cleanup();
    scroller.remove();
  });

  it('leaves native scrollbar behavior untouched on coarse-pointer and forced-color devices', () => {
    installMatchMedia(false);
    const coarseCleanup = mountHook();
    expect(document.documentElement.hasAttribute('data-auto-hide-scrollbars')).toBe(false);
    coarseCleanup();

    installMatchMedia(true, true);
    const forcedColorsCleanup = mountHook();
    expect(document.documentElement.hasAttribute('data-auto-hide-scrollbars')).toBe(false);
    forcedColorsCleanup();
  });

  it('clears active state when capability changes or the hook is destroyed', () => {
    const { finePointer, forcedColors } = installMatchMedia(true);
    const cleanup = mountHook();
    const scroller = document.createElement('div');
    document.body.append(scroller);

    scroller.dispatchEvent(new Event('scroll'));
    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(true);

    forcedColors.setMatches(true);
    expect(document.documentElement.hasAttribute('data-auto-hide-scrollbars')).toBe(false);
    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(false);

    forcedColors.setMatches(false);
    expect(document.documentElement.hasAttribute('data-auto-hide-scrollbars')).toBe(true);

    scroller.dispatchEvent(new Event('scroll'));
    finePointer.setMatches(false);
    expect(document.documentElement.hasAttribute('data-auto-hide-scrollbars')).toBe(false);
    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(false);

    finePointer.setMatches(true);
    scroller.dispatchEvent(new Event('scroll'));
    cleanup();
    expect(document.documentElement.hasAttribute('data-auto-hide-scrollbars')).toBe(false);
    expect(scroller.hasAttribute('data-scrollbar-active')).toBe(false);

    scroller.remove();
  });
});
