import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import EventListTestHarness from './EventListTestHarness.svelte';
import { setVirtualizerScrollOffset } from './EventListVirtualizerMock.svelte';

const resumeCallbacks = vi.hoisted(() => [] as Array<() => void>);
let resizeCallbacks: ResizeObserverCallback[] = [];

class ResizeObserverMock implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

function resizeObserverEntry(target: Element, height: number): ResizeObserverEntry {
  return {
    target,
    contentRect: DOMRectReadOnly.fromRect({ width: 320, height }),
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: []
  };
}

vi.mock('virtua/svelte', async () => {
  const { default: Virtualizer } = await import('./EventListVirtualizerMock.svelte');
  return { Virtualizer };
});

vi.mock('./RoomEvent.svelte', async () => {
  const { default: RoomEvent } = await import('./EventListRoomEventMock.svelte');
  return { default: RoomEvent };
});

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'server-1'
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    getStore: () => ({
      currentUser: { user: { id: 'test-user' } },
      serverInfo: { messageEditWindowSeconds: 300 }
    })
  }
}));

vi.mock('$lib/hooks/useTabResumeCallback.svelte', () => ({
  useTabResumeCallback: (callback: () => void) => resumeCallbacks.push(callback)
}));

vi.mock('$lib/hooks/useMayHaveMissedMessagesCallback.svelte', () => ({
  useMayHaveMissedMessagesCallback: () => {}
}));

describe('EventList jump completion', () => {
  it('shows a retryable load failure instead of the empty state', async () => {
    const onRetryLoad = vi.fn();
    render(EventListTestHarness, {
      props: {
        eventIds: [],
        scrollToEventId: null,
        loadFailed: true,
        onRetryLoad
      }
    });

    await expect.element(page.getByText('Messages could not be loaded')).toBeVisible();
    await expect.element(page.getByText('Check your connection and try again.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    (page.getByRole('button', { name: 'Try again' }).element() as HTMLButtonElement).click();

    expect(onRetryLoad).toHaveBeenCalledOnce();
  });

  it('delays the loading skeleton to avoid flashing on fast room transitions', async () => {
    render(EventListTestHarness, {
      props: {
        eventIds: [],
        scrollToEventId: null,
        isLoading: true
      }
    });

    expect(document.querySelector('[aria-label="Loading messages"]')).toBeNull();

    await vi.waitFor(
      () => expect(document.querySelector('[aria-label="Loading messages"]')).not.toBeNull(),
      { timeout: 1_000 }
    );
  });

  it('delays room switch scroll reset until the rendered timeline catches up', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        roomId: 'room-old',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    await vi.waitFor(() =>
      expect(
        Number(page.getByTestId('virtualizer-scroll-calls').element().textContent)
      ).toBeGreaterThanOrEqual(7)
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const callsBeforeRouteChange = Number(
      page.getByTestId('virtualizer-scroll-calls').element().textContent
    );

    await rendered.rerender({
      roomId: 'room-new',
      renderedRoomId: 'room-old',
      eventIds: ['msg-old'],
      scrollToEventId: null
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(document.querySelector('[aria-label="Loading messages"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="virtualizer-scroll-calls"]')).toBeNull();

    await rendered.rerender({
      roomId: 'room-new',
      renderedRoomId: 'room-new',
      eventIds: ['msg-new'],
      scrollToEventId: null
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="Loading messages"]')).toBeNull();
      expect(document.querySelector('[data-testid="virtualizer-scroll-calls"]')).not.toBeNull();
    });
    await expect.element(page.getByText('msg-new', { exact: true })).toBeInTheDocument();
  });

  it('does not bottom-align the carried-over timeline during a room switch', async () => {
    render(EventListTestHarness, {
      props: {
        roomId: 'room-new',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    const carryover = document.querySelector('.timeline-room-carryover');

    expect(carryover).toBeInstanceOf(HTMLElement);
    expect(carryover?.classList.contains('mt-auto')).toBe(false);
  });

  it('masks partial carry-over rows behind a stable room-switch placeholder', async () => {
    render(EventListTestHarness, {
      props: {
        roomId: 'room-new',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    expect(document.querySelector('[aria-label="Loading messages"]')).not.toBeNull();
    await expect.element(page.getByText('msg-old', { exact: true })).not.toBeInTheDocument();
  });

  it('signals completion after highlighting a rendered target', async () => {
    const onComplete = vi.fn();
    render(EventListTestHarness, {
      props: {
        eventIds: ['msg-target'],
        scrollToEventId: 'msg-target',
        onComplete
      }
    });

    await expect.element(page.getByText('msg-target', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByTestId('virtualizer-scroll-index')).not.toHaveTextContent('');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledExactlyOnceWith(true));
  });

  it('signals completion after bounded retries when the target is not rendered', async () => {
    const onComplete = vi.fn();
    render(EventListTestHarness, {
      props: {
        eventIds: ['msg-other'],
        scrollToEventId: 'msg-target',
        onComplete
      }
    });

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledExactlyOnceWith(false), {
      timeout: 2_000
    });
  });

  it('cancels completion for a superseded scroll target', async () => {
    const onComplete = vi.fn();
    const rendered = render(EventListTestHarness, {
      props: {
        eventIds: ['msg-new'],
        scrollToEventId: 'msg-old',
        onComplete
      }
    });

    await rendered.rerender({
      eventIds: ['msg-new'],
      scrollToEventId: 'msg-new',
      onComplete
    });

    await expect.element(page.getByText('msg-new', { exact: true })).toBeInTheDocument();
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledExactlyOnceWith(true));
  });

  it('cancels a pending scroll attempt when unmounted', async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      })
    );
    const onComplete = vi.fn();
    try {
      const rendered = render(EventListTestHarness, {
        props: {
          eventIds: ['msg-other'],
          scrollToEventId: 'msg-never-mounted',
          onComplete
        }
      });

      await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
      rendered.unmount();
      for (let index = 0; index < 100 && animationFrames[index]; index++) {
        animationFrames[index](index * 16);
      }

      expect(onComplete).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('scrolls to present after the latest window finishes loading', async () => {
    let finishLoading: ((loaded: boolean) => void) | undefined;
    const latestLoaded = new Promise<boolean>((resolve) => {
      finishLoading = resolve;
    });
    const onJumpToPresent = vi.fn(() => latestLoaded);
    const rendered = render(EventListTestHarness, {
      props: {
        eventIds: ['msg-target'],
        scrollToEventId: 'msg-target',
        isJumpedMode: true,
        onJumpToPresent,
        pendingHighlightId: 'suppress-normal-auto-scroll'
      }
    });

    await expect.element(page.getByTestId('jump-to-present')).toBeVisible();
    await expect
      .element(page.getByTestId('virtualizer-scroll-alignment'))
      .toHaveTextContent('center');
    (page.getByTestId('jump-to-present').element() as HTMLButtonElement).click();
    expect(onJumpToPresent).toHaveBeenCalledOnce();
    await expect
      .element(page.getByTestId('virtualizer-scroll-alignment'))
      .toHaveTextContent('center');

    finishLoading?.(true);
    await rendered.rerender({
      eventIds: ['msg-target'],
      scrollToEventId: null,
      isJumpedMode: false,
      onJumpToPresent,
      pendingHighlightId: 'suppress-normal-auto-scroll'
    });
    await expect.element(page.getByTestId('virtualizer-scroll-alignment')).toHaveTextContent('end');
  });

  it('completes initialization when a bottom scroll supersedes the initial request', async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      })
    );
    try {
      const rendered = render(EventListTestHarness, {
        props: {
          eventIds: ['msg-target'],
          scrollToEventId: null,
          updateCounter: 0
        }
      });

      await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
      await rendered.rerender({
        eventIds: ['msg-target'],
        scrollToEventId: null,
        updateCounter: 1
      });

      for (let frame = 0; frame < 50; frame++) {
        await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
        animationFrames.shift()?.(frame * 16);
        if (Number(page.getByTestId('virtualizer-scroll-calls').element().textContent) >= 7) {
          break;
        }
      }
      await vi.waitFor(() =>
        expect(
          Number(page.getByTestId('virtualizer-scroll-calls').element().textContent)
        ).toBeGreaterThanOrEqual(7)
      );
      await Promise.resolve();

      const resume = resumeCallbacks.at(-1);
      expect(resume).toBeDefined();
      setVirtualizerScrollOffset(400);
      resume?.();
      await expect.element(page.getByTestId('jump-to-present')).toBeVisible();
    } finally {
      setVirtualizerScrollOffset(700);
      vi.unstubAllGlobals();
    }
  });

  it('re-converges at the bottom when the message viewport resizes while sticky', async () => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    try {
      render(EventListTestHarness, {
        props: {
          eventIds: ['msg-latest'],
          scrollToEventId: null
        }
      });

      const scrollCalls = () =>
        Number(page.getByTestId('virtualizer-scroll-calls').element().textContent);

      await vi.waitFor(() => expect(resizeCallbacks.length).toBeGreaterThan(0));
      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThanOrEqual(7));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const callsBeforeResize = scrollCalls();
      const messageContainer = page.getByTestId('messages-container').element();
      const initialEntry = resizeObserverEntry(messageContainer, 300);
      const resizedEntry = resizeObserverEntry(messageContainer, 200);

      for (const callback of resizeCallbacks) {
        callback([initialEntry], {} as ResizeObserver);
        callback([resizedEntry], {} as ResizeObserver);
      }

      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThan(callsBeforeResize));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('re-converges when the visual viewport resizes before the message container', async () => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const visualViewport = Object.assign(new EventTarget(), {
      height: 700,
      offsetLeft: 0,
      offsetTop: 0,
      onresize: null,
      onscroll: null,
      onscrollend: null,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      width: 320
    }) as VisualViewport;
    vi.stubGlobal('visualViewport', visualViewport);
    try {
      render(EventListTestHarness, {
        props: {
          eventIds: ['msg-latest'],
          scrollToEventId: null
        }
      });

      const scrollCalls = () =>
        Number(page.getByTestId('virtualizer-scroll-calls').element().textContent);

      await vi.waitFor(() => expect(resizeCallbacks.length).toBeGreaterThan(0));
      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThanOrEqual(7));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const callsBeforeResize = scrollCalls();

      visualViewport.dispatchEvent(new Event('resize'));

      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThan(callsBeforeResize));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('re-converges when the visual viewport finishes moving while sticky', async () => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const visualViewport = Object.assign(new EventTarget(), {
      height: 700,
      offsetLeft: 0,
      offsetTop: 0,
      onresize: null,
      onscroll: null,
      onscrollend: null,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      width: 320
    }) as VisualViewport;
    vi.stubGlobal('visualViewport', visualViewport);
    try {
      render(EventListTestHarness, {
        props: {
          eventIds: ['msg-latest'],
          scrollToEventId: null
        }
      });

      const scrollCalls = () =>
        Number(page.getByTestId('virtualizer-scroll-calls').element().textContent);

      await vi.waitFor(() => expect(resizeCallbacks.length).toBeGreaterThan(0));
      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThanOrEqual(7));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const callsBeforeScrollEnd = scrollCalls();

      visualViewport.dispatchEvent(new Event('scrollend'));

      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThan(callsBeforeScrollEnd));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('re-converges when sticky content resizes after the keyboard viewport event', async () => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    try {
      render(EventListTestHarness, {
        props: {
          eventIds: ['msg-latest'],
          scrollToEventId: null
        }
      });

      const scrollCalls = () =>
        Number(page.getByTestId('virtualizer-scroll-calls').element().textContent);

      await vi.waitFor(() => expect(resizeCallbacks.length).toBeGreaterThan(0));
      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThanOrEqual(7));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const callsBeforeContentResize = scrollCalls();
      const messageContainer = page.getByTestId('messages-container').element();
      const content = messageContainer.firstElementChild!;

      for (const callback of resizeCallbacks) {
        callback([resizeObserverEntry(content, 520)], {} as ResizeObserver);
      }

      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThan(callsBeforeContentResize));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('starts viewport convergence while the initial bottom scroll is still settling', async () => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      })
    );
    const visualViewport = Object.assign(new EventTarget(), {
      height: 700,
      offsetLeft: 0,
      offsetTop: 0,
      onresize: null,
      onscroll: null,
      onscrollend: null,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      width: 320
    }) as VisualViewport;
    vi.stubGlobal('visualViewport', visualViewport);
    try {
      render(EventListTestHarness, {
        props: {
          eventIds: ['msg-latest'],
          scrollToEventId: null
        }
      });

      await vi.waitFor(() => expect(resizeCallbacks.length).toBeGreaterThan(0));
      await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const framesBeforeResize = animationFrames.length;

      visualViewport.dispatchEvent(new Event('resize'));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(animationFrames.length).toBeGreaterThan(framesBeforeResize);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves scrollback when the message viewport resizes while not sticky', async () => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    const visualViewport = Object.assign(new EventTarget(), {
      height: 700,
      offsetLeft: 0,
      offsetTop: 0,
      onresize: null,
      onscroll: null,
      onscrollend: null,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      width: 320
    }) as VisualViewport;
    vi.stubGlobal('visualViewport', visualViewport);
    try {
      render(EventListTestHarness, {
        props: {
          eventIds: ['msg-history', 'msg-latest'],
          scrollToEventId: null
        }
      });

      const scrollCalls = () =>
        Number(page.getByTestId('virtualizer-scroll-calls').element().textContent);

      await vi.waitFor(() => expect(resizeCallbacks.length).toBeGreaterThan(0));
      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThanOrEqual(7));
      setVirtualizerScrollOffset(400);
      resumeCallbacks.at(-1)?.();
      await expect.element(page.getByTestId('jump-to-present')).toBeVisible();
      const callsBeforeResize = scrollCalls();
      const messageContainer = page.getByTestId('messages-container').element();
      const initialEntry = resizeObserverEntry(messageContainer, 300);
      const resizedEntry = resizeObserverEntry(messageContainer, 200);

      for (const callback of resizeCallbacks) {
        callback([initialEntry], {} as ResizeObserver);
        callback([resizedEntry], {} as ResizeObserver);
      }
      visualViewport.dispatchEvent(new Event('scrollend'));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(scrollCalls()).toBe(callsBeforeResize);
    } finally {
      setVirtualizerScrollOffset(700);
      vi.unstubAllGlobals();
    }
  });

  it('does not race a pending message highlight when the viewport resizes', async () => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    try {
      render(EventListTestHarness, {
        props: {
          eventIds: ['msg-target'],
          scrollToEventId: null,
          pendingHighlightId: 'msg-target'
        }
      });

      await vi.waitFor(() => expect(resizeCallbacks.length).toBeGreaterThan(0));
      const messageContainer = page.getByTestId('messages-container').element();
      const initialEntry = resizeObserverEntry(messageContainer, 300);
      const resizedEntry = resizeObserverEntry(messageContainer, 200);

      for (const callback of resizeCallbacks) {
        callback([initialEntry], {} as ResizeObserver);
        callback([resizedEntry], {} as ResizeObserver);
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(Number(page.getByTestId('virtualizer-scroll-calls').element().textContent)).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
