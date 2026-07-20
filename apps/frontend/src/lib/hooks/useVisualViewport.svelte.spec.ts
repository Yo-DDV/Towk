import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { useVisualViewport } from './useVisualViewport.svelte';

type MutableVisualViewport = Omit<VisualViewport, 'height' | 'offsetTop' | 'width'> & {
  height: number;
  offsetTop: number;
  width: number;
};

function createVisualViewport(): MutableVisualViewport {
  return Object.assign(new EventTarget(), {
    height: 780,
    offsetLeft: 0,
    offsetTop: 0,
    onresize: null,
    onscroll: null,
    onscrollend: null,
    pageLeft: 0,
    pageTop: 0,
    scale: 1,
    width: 390
  }) as MutableVisualViewport;
}

function mountHook() {
  const cleanup = $effect.root(() => useVisualViewport());
  flushSync();
  return cleanup;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.height = '';
  document.body.style.top = '';
});

describe('useVisualViewport', () => {
  it('aligns the fixed body with the visible iOS viewport while the keyboard is open', () => {
    const viewport = createVisualViewport();
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('scrollTo', vi.fn());
    const cleanup = mountHook();

    viewport.height = 390;
    viewport.offsetTop = 28;
    viewport.dispatchEvent(new Event('resize'));

    expect(document.body.style.height).toBe('390px');
    expect(document.body.style.top).toBe('28px');

    cleanup();
  });

  it('tracks viewport scrolling and clears the offset after the keyboard closes', () => {
    const viewport = createVisualViewport();
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('scrollTo', vi.fn());
    const cleanup = mountHook();

    viewport.height = 390;
    viewport.offsetTop = 20;
    viewport.dispatchEvent(new Event('resize'));
    viewport.offsetTop = 44;
    viewport.dispatchEvent(new Event('scrollend'));

    expect(document.body.style.top).toBe('44px');

    viewport.height = 780;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('resize'));

    expect(document.body.style.height).toBe('');
    expect(document.body.style.top).toBe('');

    cleanup();
  });

  it('keeps using the new visual viewport when orientation changes with the keyboard open', () => {
    const viewport = createVisualViewport();
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(390);
    const cleanup = mountHook();

    viewport.width = 780;
    viewport.height = 180;
    viewport.offsetTop = 12;
    viewport.dispatchEvent(new Event('resize'));

    expect(document.body.style.height).toBe('180px');
    expect(document.body.style.top).toBe('12px');

    viewport.height = 390;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('resize'));

    expect(document.body.style.height).toBe('');
    expect(document.body.style.top).toBe('');

    cleanup();
  });
});
