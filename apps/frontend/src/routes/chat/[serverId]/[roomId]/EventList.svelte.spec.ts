import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import EventListTestHarness from './EventListTestHarness.svelte';
import type { ResumeSignal } from '$lib/hooks/resumeCoordinator.svelte';
import {
  emitVirtualizerScroll,
  setVirtualizerScrollOffset
} from './EventListVirtualizerMock.svelte';

const resumeCallbacks = vi.hoisted(() => [] as Array<() => void>);
const missedMessageCallbacks = vi.hoisted(
  () => [] as Array<(signal: ResumeSignal) => boolean | void | Promise<boolean | void>>
);
const readReceiptMocks = vi.hoisted(() => ({
  advanceReadReceipt: vi.fn(),
  getReadReceiptSummaries: vi.fn()
}));
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

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    serverId: 'server-1',
    connectBaseUrl: 'https://chat.example.test/api/connect',
    bearerToken: 'token'
  })
}));

vi.mock('$lib/api-client/readState', () => ({
  createReadStateAPI: () => ({
    advanceReadReceipt: readReceiptMocks.advanceReadReceipt,
    getReadReceiptSummaries: readReceiptMocks.getReadReceiptSummaries
  })
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
  useMayHaveMissedMessagesCallback: (
    callback: (signal: ResumeSignal) => boolean | void | Promise<boolean | void>
  ) => missedMessageCallbacks.push(callback)
}));

describe('EventList jump completion', () => {
  beforeEach(() => {
    resumeCallbacks.length = 0;
    missedMessageCallbacks.length = 0;
    readReceiptMocks.advanceReadReceipt.mockReset().mockResolvedValue(false);
    readReceiptMocks.getReadReceiptSummaries
      .mockReset()
      .mockResolvedValue({ enabled: true, summaries: [] });
  });

  it('discards an in-flight summary response after receipts are disabled', async () => {
    let resolveSummary:
      | ((value: {
          enabled: boolean;
          summaries: Array<{ messageEventId: string; readerCount: number }>;
        }) => void)
      | undefined;
    readReceiptMocks.getReadReceiptSummaries.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSummary = resolve;
        })
    );

    const rendered = render(EventListTestHarness, {
      props: {
        eventIds: ['msg-1'],
        scrollToEventId: null,
        readReceiptsEnabled: true
      }
    });

    await vi.waitFor(() =>
      expect(readReceiptMocks.getReadReceiptSummaries).toHaveBeenCalledTimes(1)
    );
    await rendered.rerender({
      eventIds: ['msg-1'],
      scrollToEventId: null,
      readReceiptsEnabled: false
    });
    resolveSummary?.({
      enabled: true,
      summaries: [{ messageEventId: 'msg-1', readerCount: 1 }]
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-testid="read-receipt-summary-msg-1"]')).toBeNull();
  });

  it('cancels delayed read advancement when the call surface takes attention', async () => {
    const props = {
      eventIds: ['msg-1'],
      eventActorId: 'other-user',
      scrollToEventId: null,
      readReceiptsEnabled: true
    };
    const rendered = render(EventListTestHarness, {
      props: { ...props, attentionEnabled: true }
    });

    await rendered.rerender({ ...props, attentionEnabled: false });
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(readReceiptMocks.advanceReadReceipt).not.toHaveBeenCalled();
    rendered.unmount();
  });

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

  it('keeps the empty-room indicator clear of the composer across representative viewports', async () => {
    const viewports = [
      [320, 568],
      [390, 844],
      [844, 390],
      [768, 1024],
      [1440, 900]
    ] as const;

    try {
      render(EventListTestHarness, {
        props: {
          eventIds: [],
          scrollToEventId: null,
          isLoading: false
        }
      });

      await expect.element(page.getByText('No messages yet')).toBeVisible();

      for (const [width, height] of viewports) {
        await page.viewport(width, height);

        const emptyState = document.querySelector('.timeline-room-empty-state');
        const indicator = emptyState?.firstElementChild;
        expect(emptyState).toBeInstanceOf(HTMLElement);
        expect(indicator).toBeInstanceOf(HTMLElement);

        const emptyStateBounds = (emptyState as HTMLElement).getBoundingClientRect();
        const indicatorBounds = (indicator as HTMLElement).getBoundingClientRect();
        expect(getComputedStyle(emptyState as HTMLElement).paddingBottom).toBe('16px');
        const indicatorGap = emptyStateBounds.bottom - indicatorBounds.bottom;
        expect(indicatorGap).toBeGreaterThanOrEqual(15.5);
        expect(indicatorGap).toBeLessThanOrEqual(16.5);
        expect(indicatorBounds.left).toBeGreaterThanOrEqual(0);
        expect(indicatorBounds.right).toBeLessThanOrEqual(window.innerWidth + 1);
      }

      expect(document.querySelector('[aria-label="Loading messages"]')).toBeNull();
    } finally {
      await page.viewport(414, 896);
    }
  });

  it('covers the first route-change frame with a static room switch placeholder', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        roomId: 'room-old',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    try {
      await vi.waitFor(() =>
        expect(document.querySelector('[data-event-id="msg-old"]')).not.toBeNull()
      );

      await rendered.rerender({
        roomId: 'room-new',
        renderedRoomId: 'room-new',
        eventIds: [],
        scrollToEventId: null
      });

      const mask = document.querySelector('[data-testid="timeline-room-switch-mask"]');
      const scrollContainer = page.getByTestId('messages-container').element();
      expect(mask).not.toBeNull();
      expect(mask?.querySelector('.timeline-room-switch-block')).not.toBeNull();
      expect(scrollContainer.classList.contains('timeline-scrollbar-suspended')).toBe(true);
      expect(document.querySelector('.timeline-room-empty-state')).toBeNull();

      await rendered.rerender({
        roomId: 'room-new',
        renderedRoomId: 'room-new',
        eventIds: ['msg-new'],
        scrollToEventId: null
      });
      await vi.waitFor(() =>
        expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).toBeNull()
      );
      await vi.waitFor(() =>
        expect(scrollContainer.classList.contains('timeline-scrollbar-suspended')).toBe(false)
      );
    } finally {
      rendered.unmount();
    }
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

    expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="timeline-room-carryover"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="virtualizer-scroll-calls"]')).not.toBeNull();
    expect(Number(page.getByTestId('virtualizer-scroll-calls').element().textContent)).toBe(
      callsBeforeRouteChange
    );

    await rendered.rerender({
      roomId: 'room-new',
      renderedRoomId: 'room-new',
      eventIds: ['msg-new'],
      scrollToEventId: null
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).toBeNull()
    );
    expect(document.querySelector('[data-testid="virtualizer-scroll-calls"]')).not.toBeNull();
    await expect.element(page.getByText('msg-new', { exact: true })).toBeInTheDocument();
  });

  it('keeps the carried-over timeline masked during a room switch', async () => {
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
    expect(carryover?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull();
  });

  it('uses a static placeholder over carried-over room switches', () => {
    render(EventListTestHarness, {
      props: {
        roomId: 'room-new',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    const mask = document.querySelector('[data-testid="timeline-room-switch-mask"]');

    expect(mask).not.toBeNull();
    expect(mask?.querySelector('.skeleton')).toBeNull();
    expect(mask?.querySelector('.timeline-room-switch-block')).not.toBeNull();
    expect(mask?.classList.contains('timeline-room-switch-mask--carryover')).toBe(false);
  });

  it('uses static room switch placeholders when no carry-over timeline exists', () => {
    render(EventListTestHarness, {
      props: {
        roomId: 'room-new',
        renderedRoomId: 'room-old',
        eventIds: [],
        scrollToEventId: null
      }
    });

    const mask = document.querySelector('[data-testid="timeline-room-switch-mask"]');

    expect(mask).not.toBeNull();
    expect(mask?.querySelector('.skeleton')).toBeNull();
    expect(mask?.querySelector('.timeline-room-switch-block')).not.toBeNull();
    expect(mask?.classList.contains('timeline-room-switch-mask--carryover')).toBe(false);
  });

  it('keeps the room switch mask until visible timeline media has decoded', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        roomId: 'room-old',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-event-id="msg-old"]')).not.toBeNull()
    );

    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      })
    );

    try {
      await rendered.rerender({
        roomId: 'room-new',
        renderedRoomId: 'room-new',
        eventIds: ['msg-with-pending-image'],
        scrollToEventId: null
      });

      await vi.waitFor(() =>
        expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull()
      );
      await vi.waitFor(() =>
        expect(document.querySelector('[data-testid="mock-timeline-image"]')).not.toBeNull()
      );

      for (let frame = 0; frame < 12; frame++) {
        await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
        animationFrames.shift()?.(frame * 16);
        await Promise.resolve();
      }

      expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull();

      const image = document.querySelector('[data-testid="mock-timeline-image"]');
      expect(image).toBeInstanceOf(HTMLImageElement);
      Object.defineProperty(image, 'complete', { configurable: true, value: true });
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 320 });
      image?.classList.remove('skeleton');

      for (let frame = 12; frame < 80; frame++) {
        if (document.querySelector('[data-testid="timeline-room-switch-mask"]') === null) break;
        await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
        animationFrames.shift()?.(frame * 16);
        await Promise.resolve();
      }

      expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the room switch mask while visible media geometry is still settling', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        roomId: 'room-old',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-event-id="msg-old"]')).not.toBeNull()
    );

    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      })
    );

    try {
      await rendered.rerender({
        roomId: 'room-new',
        renderedRoomId: 'room-new',
        eventIds: ['msg-with-pending-image'],
        scrollToEventId: null
      });

      await vi.waitFor(() =>
        expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull()
      );

      const container = page.getByTestId('messages-container').element();
      const image = document.querySelector('[data-testid="mock-timeline-image"]');
      expect(image).toBeInstanceOf(HTMLImageElement);

      Object.defineProperty(container, 'getBoundingClientRect', {
        configurable: true,
        value: () => DOMRect.fromRect({ x: 0, y: 0, width: 360, height: 600 })
      });
      Object.defineProperty(image, 'complete', { configurable: true, value: true });
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 320 });
      image?.classList.remove('skeleton');

      let mediaHeight = 96;
      Object.defineProperty(image, 'getBoundingClientRect', {
        configurable: true,
        value: () => DOMRect.fromRect({ x: 16, y: 24, width: 320, height: mediaHeight })
      });

      for (let frame = 0; frame < 12; frame++) {
        mediaHeight += 6;
        await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
        animationFrames.shift()?.(frame * 16);
        await Promise.resolve();
      }

      expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull();

      for (let frame = 12; frame < 80; frame++) {
        if (document.querySelector('[data-testid="timeline-room-switch-mask"]') === null) break;
        await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
        animationFrames.shift()?.(frame * 16);
        await Promise.resolve();
      }

      expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the settling mask for a short minimum reveal window on media-heavy rooms', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        roomId: 'room-old',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-event-id="msg-old"]')).not.toBeNull()
    );

    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      })
    );

    try {
      await rendered.rerender({
        roomId: 'room-new',
        renderedRoomId: 'room-new',
        eventIds: ['msg-with-pending-image'],
        scrollToEventId: null
      });

      await vi.waitFor(() =>
        expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull()
      );

      const container = page.getByTestId('messages-container').element();
      const image = document.querySelector('[data-testid="mock-timeline-image"]');
      expect(image).toBeInstanceOf(HTMLImageElement);

      Object.defineProperty(container, 'getBoundingClientRect', {
        configurable: true,
        value: () => DOMRect.fromRect({ x: 0, y: 0, width: 360, height: 600 })
      });
      Object.defineProperty(image, 'complete', { configurable: true, value: true });
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 320 });
      Object.defineProperty(image, 'getBoundingClientRect', {
        configurable: true,
        value: () => DOMRect.fromRect({ x: 16, y: 24, width: 320, height: 180 })
      });
      image?.classList.remove('skeleton');

      for (let frame = 0; frame < 10; frame++) {
        await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
        animationFrames.shift()?.(frame * 16);
        await Promise.resolve();
      }

      const mask = document.querySelector('[data-testid="timeline-room-switch-mask"]');
      expect(mask).not.toBeNull();
      expect(mask?.classList.contains('timeline-room-switch-mask--settling')).toBe(true);

      for (let frame = 10; frame < 80; frame++) {
        if (document.querySelector('[data-testid="timeline-room-switch-mask"]') === null) break;
        await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
        animationFrames.shift()?.(frame * 16);
        await Promise.resolve();
      }

      expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the room switch mask while cached data is reconciling with the server window', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        roomId: 'room-old',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-event-id="msg-old"]')).not.toBeNull()
    );

    try {
      await rendered.rerender({
        roomId: 'room-new',
        renderedRoomId: 'room-new',
        eventIds: ['msg-cached'],
        isReconcilingCachedData: true,
        scrollToEventId: null
      });

      const mask = document.querySelector('[data-testid="timeline-room-switch-mask"]');
      expect(mask).not.toBeNull();
      expect(mask?.classList.contains('timeline-room-switch-mask--settling')).toBe(true);
      expect(document.querySelector('[data-event-id="msg-cached"]')).not.toBeNull();
    } finally {
      await rendered.rerender({
        roomId: 'room-new',
        renderedRoomId: 'room-new',
        eventIds: ['msg-network'],
        isReconcilingCachedData: false,
        scrollToEventId: null
      });
      await vi.waitFor(() =>
        expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).toBeNull()
      );
      rendered.unmount();
    }
  });

  it('does not hide an initial cached room before a room switch has happened', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        roomId: 'room-new',
        renderedRoomId: 'room-new',
        eventIds: ['msg-cached'],
        isReconcilingCachedData: true,
        scrollToEventId: null
      }
    });

    try {
      expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).toBeNull();
      await vi.waitFor(() =>
        expect(document.querySelector('[data-event-id="msg-cached"]')).not.toBeNull()
      );
    } finally {
      rendered.unmount();
    }
  });

  it('keeps the room switch mask while silent backfill settles the new room window', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        roomId: 'room-old',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null,
        enablePagination: true,
        hasReachedStart: false
      }
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-event-id="msg-old"]')).not.toBeNull()
    );

    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      })
    );

    let resolveBackfill!: () => void;
    const backfill = new Promise<void>((resolve) => {
      resolveBackfill = resolve;
    });
    const onLoadMore = vi.fn(() => backfill);

    try {
      await rendered.rerender({
        roomId: 'room-new',
        renderedRoomId: 'room-new',
        eventIds: ['msg-new'],
        scrollToEventId: null,
        enablePagination: true,
        hasReachedStart: false,
        onLoadMore
      });

      await vi.waitFor(() =>
        expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull()
      );

      for (let frame = 0; frame < 80; frame++) {
        await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
        animationFrames.shift()?.(frame * 16);
        await Promise.resolve();
        if (onLoadMore.mock.calls.length > 0) break;
      }

      expect(onLoadMore).toHaveBeenCalledWith({ silent: true });
      expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull();

      resolveBackfill();
      await Promise.resolve();

      for (let frame = 80; frame < 160; frame++) {
        if (document.querySelector('[data-testid="timeline-room-switch-mask"]') === null) break;
        await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
        animationFrames.shift()?.(frame * 16);
        await Promise.resolve();
      }

      expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the previous rendered window mounted but hidden during a room switch', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        roomId: 'room-old',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-event-id="msg-old"]')).not.toBeNull()
    );

    await rendered.rerender({
      roomId: 'room-new',
      renderedRoomId: 'room-old',
      eventIds: ['msg-old'],
      scrollToEventId: null
    });

    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull()
    );

    expect(document.querySelector('[data-event-id="msg-old"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="timeline-room-carryover"]')).not.toBeNull();
    expect(
      document.querySelector('[data-testid="timeline-room-carryover"]')?.getAttribute('aria-hidden')
    ).toBe('true');
    expect(document.querySelector('[data-testid="virtualizer-scroll-calls"]')).not.toBeNull();
  });

  it('shows a room switch mask when rendering starts already in carry-over mode', async () => {
    render(EventListTestHarness, {
      props: {
        roomId: 'room-new',
        renderedRoomId: 'room-old',
        eventIds: ['msg-old'],
        scrollToEventId: null
      }
    });

    expect(document.querySelector('[data-testid="timeline-room-switch-mask"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="timeline-room-carryover"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="virtualizer-scroll-calls"]')).not.toBeNull();
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

  it('re-converges instead of abandoning a sticky timeline when resume reveals media drift', async () => {
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
      const callsBeforeResume = Number(
        page.getByTestId('virtualizer-scroll-calls').element().textContent
      );
      setVirtualizerScrollOffset(400);
      resume?.();
      for (let frame = 0; frame < 20; frame++) {
        await vi.waitFor(() => expect(animationFrames.length).toBeGreaterThan(0));
        animationFrames.shift()?.((frame + 50) * 16);
        if (
          Number(page.getByTestId('virtualizer-scroll-calls').element().textContent) >
          callsBeforeResume
        ) {
          break;
        }
      }
      await vi.waitFor(() =>
        expect(
          Number(page.getByTestId('virtualizer-scroll-calls').element().textContent)
        ).toBeGreaterThan(callsBeforeResume)
      );
      await expect.element(page.getByTestId('jump-to-present')).not.toBeInTheDocument();
    } finally {
      setVirtualizerScrollOffset(700);
      vi.unstubAllGlobals();
    }
  });

  it('refreshes the latest window when resume finds physical drift in a logically sticky timeline', async () => {
    const refreshCurrentWindow = vi.fn().mockResolvedValue({
      hasOlder: true,
      hasNewer: false,
      refreshed: true,
      changed: false
    });
    const onSoftRefresh = vi.fn();
    const rendered = render(EventListTestHarness, {
      props: {
        eventIds: ['msg-history', 'msg-latest'],
        scrollToEventId: null,
        refreshCurrentWindow,
        onSoftRefresh
      }
    });

    try {
      await vi.waitFor(() =>
        expect(
          Number(page.getByTestId('virtualizer-scroll-calls').element().textContent)
        ).toBeGreaterThanOrEqual(7)
      );
      const renderedEvent = document.querySelector<HTMLElement>('[data-event-id]');
      expect(renderedEvent).not.toBeNull();
      vi.spyOn(renderedEvent!, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 20, width: 200, height: 40 })
      );

      setVirtualizerScrollOffset(400);
      const signal: ResumeSignal = {
        serverId: 'server-1',
        reason: 'visibility',
        phase: 'immediate',
        source: 'browser',
        hiddenDurationMs: 10_000,
        epoch: 1,
        at: Date.now()
      };
      const refresh = missedMessageCallbacks.at(-1)?.(signal);
      resumeCallbacks.at(-1)?.();
      await refresh;

      expect(refreshCurrentWindow).toHaveBeenCalledExactlyOnceWith(null);
      expect(onSoftRefresh).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ refreshed: true }),
        false
      );
      await expect.element(page.getByTestId('jump-to-present')).not.toBeInTheDocument();
    } finally {
      setVirtualizerScrollOffset(700);
      rendered.unmount();
    }
  });

  it('does not treat pressing a timeline control as scroll intent', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        eventIds: ['msg-control'],
        scrollToEventId: null
      }
    });

    try {
      await vi.waitFor(() =>
        expect(
          Number(page.getByTestId('virtualizer-scroll-calls').element().textContent)
        ).toBeGreaterThanOrEqual(7)
      );
      page
        .getByTestId('mock-timeline-control')
        .element()
        .dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerId: 1,
            clientY: 120
          })
        );
      emitVirtualizerScroll(650);
      emitVirtualizerScroll(400);

      await expect.element(page.getByTestId('jump-to-present')).not.toBeInTheDocument();
    } finally {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      setVirtualizerScrollOffset(700);
      rendered.unmount();
    }
  });

  it('does not restore an anchored refresh after the user returns to the latest message', async () => {
    let resolveRefresh:
      | ((value: {
          hasOlder: boolean;
          hasNewer: boolean;
          refreshed: boolean;
          changed: boolean;
        }) => void)
      | undefined;
    const refreshCurrentWindow = vi.fn(
      () =>
        new Promise<{
          hasOlder: boolean;
          hasNewer: boolean;
          refreshed: boolean;
          changed: boolean;
        }>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const onSoftRefresh = vi.fn();
    const rendered = render(EventListTestHarness, {
      props: {
        eventIds: ['msg-history', 'msg-latest'],
        scrollToEventId: null,
        refreshCurrentWindow,
        onSoftRefresh
      }
    });

    try {
      await vi.waitFor(() =>
        expect(
          Number(page.getByTestId('virtualizer-scroll-calls').element().textContent)
        ).toBeGreaterThanOrEqual(7)
      );
      const renderedEvent = document.querySelector<HTMLElement>('[data-event-id]');
      expect(renderedEvent).not.toBeNull();
      vi.spyOn(renderedEvent!, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 20, width: 200, height: 40 })
      );

      page
        .getByTestId('messages-container')
        .element()
        .dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
      emitVirtualizerScroll(650);
      emitVirtualizerScroll(400);
      await expect.element(page.getByTestId('jump-to-present')).toBeVisible();

      const signal: ResumeSignal = {
        serverId: 'server-1',
        reason: 'visibility',
        phase: 'immediate',
        source: 'browser',
        hiddenDurationMs: 10_000,
        epoch: 2,
        at: Date.now()
      };
      const refresh = missedMessageCallbacks.at(-1)?.(signal);
      expect(refreshCurrentWindow).toHaveBeenCalledExactlyOnceWith('msg-latest');

      (page.getByTestId('jump-to-present').element() as HTMLButtonElement).click();
      setVirtualizerScrollOffset(700);
      await Promise.resolve();
      resolveRefresh?.({
        hasOlder: true,
        hasNewer: true,
        refreshed: true,
        changed: false
      });
      await refresh;

      expect(onSoftRefresh).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ refreshed: true }),
        false
      );
      await expect.element(page.getByTestId('jump-to-present')).not.toBeInTheDocument();
    } finally {
      setVirtualizerScrollOffset(700);
      rendered.unmount();
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

  it('re-converges after a non-user virtualizer correction moves a sticky viewport', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        eventIds: ['msg-latest'],
        scrollToEventId: null
      }
    });

    try {
      const scrollCalls = () =>
        Number(page.getByTestId('virtualizer-scroll-calls').element().textContent);

      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThanOrEqual(7));
      const callsBeforeCorrection = scrollCalls();

      emitVirtualizerScroll(400);

      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThan(callsBeforeCorrection));
      await expect.element(page.getByTestId('jump-to-present')).not.toBeInTheDocument();
    } finally {
      setVirtualizerScrollOffset(700);
      rendered.unmount();
    }
  });

  it('preserves an intentional user scroll away from the sticky viewport', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        eventIds: ['msg-history', 'msg-latest'],
        scrollToEventId: null
      }
    });

    try {
      const scrollCalls = () =>
        Number(page.getByTestId('virtualizer-scroll-calls').element().textContent);

      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThanOrEqual(7));
      const callsBeforeUserScroll = scrollCalls();
      const messageContainer = page.getByTestId('messages-container').element();

      messageContainer.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
      emitVirtualizerScroll(650);
      emitVirtualizerScroll(400);

      await expect.element(page.getByTestId('jump-to-present')).toBeVisible();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(scrollCalls()).toBe(callsBeforeUserScroll);
    } finally {
      setVirtualizerScrollOffset(700);
      rendered.unmount();
    }
  });

  it('does not fight a slow scrollbar drag after the short intent window expires', async () => {
    const rendered = render(EventListTestHarness, {
      props: {
        eventIds: ['msg-history', 'msg-latest'],
        scrollToEventId: null
      }
    });

    try {
      const scrollCalls = () =>
        Number(page.getByTestId('virtualizer-scroll-calls').element().textContent);

      await vi.waitFor(() => expect(scrollCalls()).toBeGreaterThanOrEqual(7));
      const callsBeforeUserScroll = scrollCalls();
      const messageContainer = page.getByTestId('messages-container').element();

      messageContainer.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 1,
          clientY: 300
        })
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientY: 280
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      emitVirtualizerScroll(650);
      emitVirtualizerScroll(400);

      await expect.element(page.getByTestId('jump-to-present')).toBeVisible();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(scrollCalls()).toBe(callsBeforeUserScroll);
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    } finally {
      setVirtualizerScrollOffset(700);
      rendered.unmount();
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
      const messageContainer = page.getByTestId('messages-container').element();
      messageContainer.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
      emitVirtualizerScroll(650);
      emitVirtualizerScroll(400);
      await expect.element(page.getByTestId('jump-to-present')).toBeVisible();
      const callsBeforeResize = scrollCalls();
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
