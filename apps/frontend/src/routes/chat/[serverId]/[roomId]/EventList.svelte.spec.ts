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

  it('preserves scrollback when the message viewport resizes while not sticky', async () => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
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
