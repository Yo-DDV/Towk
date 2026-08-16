import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EventListTestHarness from './EventListTestHarness.svelte';

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
    advanceReadReceipt: async () => false,
    getReadReceiptSummaries: async () => ({ enabled: true, summaries: [] })
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
  useTabResumeCallback: () => undefined
}));

vi.mock('$lib/hooks/useMayHaveMissedMessagesCallback.svelte', () => ({
  useMayHaveMissedMessagesCallback: () => undefined
}));

function deferScrollSettlements() {
  const deferred: Array<() => void> = [];
  const realSetTimeout = window.setTimeout.bind(window);
  const timeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation((handler, timeout) => {
    if (timeout === 200 && typeof handler === 'function') {
      deferred.push(() => handler());
      return 10_000 + deferred.length;
    }
    return realSetTimeout(handler, timeout);
  });

  return {
    deferred,
    restore: () => timeoutSpy.mockRestore()
  };
}

async function nextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe('EventList jump ownership', () => {
  it('acknowledges and consumes a rendered target before delayed scroll settlement', async () => {
    const { deferred, restore } = deferScrollSettlements();
    const onComplete = vi.fn();
    const baseProps = {
      eventIds: ['msg-target'],
      scrollToEventId: 'msg-target',
      onComplete,
      readReceiptsEnabled: false
    };
    const rendered = render(EventListTestHarness, { props: baseProps });

    try {
      await vi.waitFor(() => {
        const target = document.querySelector('[data-event-id="msg-target"]');
        expect(target?.classList.contains('highlight-flash')).toBe(true);
      });

      // Completion owns the request lifecycle and must not wait for the
      // independent 200 ms bottom-stickiness measurement.
      expect(onComplete).toHaveBeenCalledExactlyOnceWith(true);
      expect(deferred).toHaveLength(1);

      // A realtime/resume-style timeline replacement while the parent still
      // exposes the same target must not replay the consumed request.
      await rendered.rerender({
        ...baseProps,
        eventIds: ['msg-before', 'msg-target']
      });
      await nextFrame();

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(deferred).toHaveLength(1);

      // Settlement may still run, but it no longer owns or repeats completion.
      deferred[0]?.();
      expect(onComplete).toHaveBeenCalledTimes(1);

      // Once the parent clears the request, a new explicit jump to the same
      // event remains valid.
      await rendered.rerender({
        ...baseProps,
        eventIds: ['msg-before', 'msg-target'],
        scrollToEventId: null
      });
      await rendered.rerender({
        ...baseProps,
        eventIds: ['msg-before', 'msg-target']
      });

      await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
      expect(deferred).toHaveLength(2);
    } finally {
      rendered.unmount();
      restore();
    }
  });

  it('ignores delayed bottom settlement from a superseded jump', async () => {
    const { deferred, restore } = deferScrollSettlements();
    const onComplete = vi.fn();
    const rendered = render(EventListTestHarness, {
      props: {
        eventIds: ['msg-a', 'msg-b'],
        scrollToEventId: 'msg-a',
        onComplete,
        readReceiptsEnabled: false
      }
    });

    try {
      await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      expect(deferred).toHaveLength(1);

      await rendered.rerender({
        eventIds: ['msg-a', 'msg-b'],
        scrollToEventId: 'msg-b',
        onComplete,
        readReceiptsEnabled: false
      });
      await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
      expect(deferred).toHaveLength(2);
      await vi.waitFor(() =>
        expect(document.querySelector('[data-testid="jump-to-present"]')).not.toBeNull()
      );

      // The first jump's delayed measurement is stale now. If it were allowed
      // to restore bottom stickiness, it would cancel the second jump's scroll state.
      deferred[0]?.();
      await nextFrame();
      expect(document.querySelector('[data-testid="jump-to-present"]')).not.toBeNull();
    } finally {
      rendered.unmount();
      restore();
    }
  });
});
