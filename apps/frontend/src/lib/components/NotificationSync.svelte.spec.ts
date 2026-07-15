import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NotificationSync from './NotificationSync.svelte';
import type { EventEnvelope, EventHandler } from '$lib/eventBus.svelte';
import { RoomEventKind } from '$lib/render/eventKinds';

const { mocks } = vi.hoisted(() => {
  const bus = {
    handlers: new Set<EventHandler>(),
    catchUpHandlers: new Set()
  };
  const store = {
    isAuthenticated: true,
    notifications: {
      notifications: [] as Array<{ id?: string; kind: string }>,
      count: 0,
      unreadNotificationCount: 0,
      hasCompleteNotificationSnapshot: true,
      pendingNotificationIds: [] as string[],
      hasLoaded: true,
      loading: false,
      addNotification: vi.fn(() => Promise.resolve(true)),
      dismissById: vi.fn(() => Promise.resolve(true)),
      removeNotification: vi.fn(),
      consumeLocalDismissal: vi.fn(),
      fetch: vi.fn(() => Promise.resolve())
    },
    rooms: {
      refreshNotificationCounts: vi.fn(() => Promise.resolve()),
      incrementUnreadNotification: vi.fn(),
      decrementUnreadNotification: vi.fn(),
      refresh: vi.fn()
    },
    roomUnread: {
      hasAnyUnread: false
    }
  };

  return {
    mocks: {
      bus,
      store,
      servers: [{ id: 'origin' }],
      originServer: { id: 'origin' },
      playNotificationSound: vi.fn(),
      updateBadge: vi.fn(() => Promise.resolve()),
      clearBadge: vi.fn(() => Promise.resolve()),
      syncServiceWorkerNotificationBadgeState: vi.fn(),
      acknowledgeNativeNotificationClose: vi.fn(),
      dismissNativeNotification: vi.fn(),
      drainNativeNotificationCloseOutbox: vi.fn(),
      nativeNotificationCloseHandlers: new Set<(notificationId: string, source: string) => void>(),
      onNativeNotificationClose: vi.fn((handler: (notificationId: string, source: string) => void) => {
        mocks.nativeNotificationCloseHandlers.add(handler);
        return () => mocks.nativeNotificationCloseHandlers.delete(handler);
      }),
      reconcileNativeNotifications: vi.fn()
    }
  };
});

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    get originServer() {
      return mocks.originServer;
    },
    get servers() {
      return mocks.servers;
    },
    getStore: vi.fn(() => mocks.store)
  }
}));

vi.mock('$lib/state/server/eventBus.svelte', () => ({
  eventBusManager: {
    getBus: vi.fn(() => mocks.bus)
  }
}));

vi.mock('$lib/state/userPreferences.svelte', () => ({
  userPreferences: {
    notificationSound: 'soft',
    notificationSoundFilters: {
      volume: 1,
      highPassHz: 20,
      lowPassHz: 20000,
      echo: 0,
      reverb: 0,
      crunch: 0
    }
  }
}));

vi.mock('$lib/audio/notificationSounds', () => ({
  playNotificationSound: mocks.playNotificationSound
}));

vi.mock('$lib/notifications/appBadge', () => ({
  updateBadge: mocks.updateBadge,
  clearBadge: mocks.clearBadge,
  syncServiceWorkerNotificationBadgeState: mocks.syncServiceWorkerNotificationBadgeState
}));

vi.mock('$lib/notifications/pushNotifications', () => ({
  acknowledgeNativeNotificationClose: mocks.acknowledgeNativeNotificationClose,
  dismissNativeNotification: mocks.dismissNativeNotification,
  drainNativeNotificationCloseOutbox: mocks.drainNativeNotificationCloseOutbox,
  onNativeNotificationClose: mocks.onNativeNotificationClose,
  reconcileNativeNotifications: mocks.reconcileNativeNotifications
}));

function dispatch(event: Record<string, unknown>) {
  const envelope = {
    id: 'event-id',
    createdAt: new Date().toISOString(),
    actorId: 'actor-id',
    actor: null,
    event
  } as EventEnvelope;

  for (const handler of mocks.bus.handlers) {
    handler(envelope);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderAndWaitForSubscription() {
  render(NotificationSync);
  await vi.waitFor(() => expect(mocks.bus.handlers.size).toBe(1));
}

describe('NotificationSync', () => {
  beforeEach(() => {
    mocks.bus.handlers.clear();
    mocks.bus.catchUpHandlers.clear();
    vi.clearAllMocks();

    mocks.store.isAuthenticated = true;
    mocks.servers = [{ id: 'origin' }];
    mocks.originServer = { id: 'origin' };
    mocks.store.notifications.notifications = [];
    mocks.store.notifications.count = 0;
    mocks.store.notifications.unreadNotificationCount = 0;
    mocks.store.notifications.hasCompleteNotificationSnapshot = true;
    mocks.store.notifications.pendingNotificationIds = [];
    mocks.store.notifications.hasLoaded = true;
    mocks.store.notifications.loading = false;
    mocks.store.roomUnread.hasAnyUnread = false;
    mocks.store.notifications.addNotification.mockResolvedValue(true);
    mocks.store.notifications.dismissById.mockResolvedValue(true);
    mocks.store.notifications.removeNotification.mockReturnValue(null);
    mocks.store.notifications.consumeLocalDismissal.mockReturnValue(false);
    mocks.store.notifications.fetch.mockResolvedValue(undefined);
    mocks.store.rooms.refreshNotificationCounts.mockResolvedValue(undefined);
    mocks.nativeNotificationCloseHandlers.clear();
  });

  it('reconciles authoritative counts on notification creation instead of incrementing locally', async () => {
    await renderAndWaitForSubscription();

    dispatch({
      kind: RoomEventKind.NotificationCreated,
      notificationId: 'n1',
      roomId: 'room-1',
      eventId: 'event-1',
      inReplyToId: null,
      silent: false
    });

    expect(mocks.store.notifications.addNotification).toHaveBeenCalledOnce();
    expect(mocks.store.notifications.addNotification).toHaveBeenCalledWith('n1');
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
    expect(mocks.store.rooms.incrementUnreadNotification).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.playNotificationSound).toHaveBeenCalledOnce());
  });

  it('loads authoritative notification state once when the app starts without a loaded snapshot', async () => {
    mocks.store.notifications.hasLoaded = false;

    await renderAndWaitForSubscription();

    await vi.waitFor(() => expect(mocks.store.notifications.fetch).toHaveBeenCalledOnce());
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
  });

  it('does not force a launch refresh when the notification snapshot is already loaded', async () => {
    await renderAndWaitForSubscription();

    expect(mocks.store.notifications.fetch).not.toHaveBeenCalled();
    expect(mocks.store.rooms.refreshNotificationCounts).not.toHaveBeenCalled();
    expect(mocks.drainNativeNotificationCloseOutbox).toHaveBeenCalledOnce();
  });

  it('dismisses native notification-center close replays through the origin server store', async () => {
    await renderAndWaitForSubscription();

    for (const handler of mocks.nativeNotificationCloseHandlers) {
      handler('notification-from-tray', 'replay');
    }

    await vi.waitFor(() =>
      expect(mocks.store.notifications.dismissById).toHaveBeenCalledWith('notification-from-tray')
    );
    expect(mocks.acknowledgeNativeNotificationClose).toHaveBeenCalledWith('notification-from-tray');
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
    expect(mocks.store.notifications.fetch).toHaveBeenCalledOnce();
  });

  it('keeps a native close intent queued when the origin account is not authenticated', async () => {
    mocks.store.isAuthenticated = false;
    render(NotificationSync);
    await vi.waitFor(() => expect(mocks.nativeNotificationCloseHandlers.size).toBe(1));

    for (const handler of mocks.nativeNotificationCloseHandlers) {
      handler('notification-from-signed-out-account', 'native-close');
    }

    expect(mocks.store.notifications.dismissById).not.toHaveBeenCalled();
    expect(mocks.acknowledgeNativeNotificationClose).not.toHaveBeenCalled();
  });

  it('refreshes authoritative notification state when the visible app regains focus', async () => {
    await renderAndWaitForSubscription();

    window.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => expect(mocks.store.notifications.fetch).toHaveBeenCalledOnce());
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
  });

  it('coalesces focus and online refreshes into one active pass and one final dirty pass', async () => {
    const fetch = deferred<void>();
    mocks.store.notifications.fetch.mockReturnValue(fetch.promise);
    await renderAndWaitForSubscription();

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));

    expect(mocks.store.notifications.fetch).toHaveBeenCalledOnce();
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
    fetch.resolve();
    await vi.waitFor(() => expect(mocks.store.notifications.fetch).toHaveBeenCalledTimes(2));
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledTimes(2);
  });

  it('coalesces count refreshes for a burst and performs one final authoritative pass', async () => {
    const refresh = deferred<void>();
    mocks.store.rooms.refreshNotificationCounts.mockReturnValue(refresh.promise);
    await renderAndWaitForSubscription();

    dispatch({
      kind: RoomEventKind.NotificationCreated,
      notificationId: 'burst-1',
      silent: false
    });
    dispatch({
      kind: RoomEventKind.NotificationCreated,
      notificationId: 'burst-2',
      silent: false
    });

    expect(mocks.store.notifications.addNotification).toHaveBeenCalledTimes(2);
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
    refresh.resolve();
    await vi.waitFor(() => expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledTimes(2)
    );
  });

  it('still performs the dirty final pass after the active refresh fails', async () => {
    const firstRefresh = deferred<void>();
    mocks.store.rooms.refreshNotificationCounts
      .mockReturnValueOnce(firstRefresh.promise)
      .mockResolvedValue(undefined);
    await renderAndWaitForSubscription();

    dispatch({
      kind: RoomEventKind.NotificationCreated,
      notificationId: 'retry-1',
      silent: false
    });
    dispatch({
      kind: RoomEventKind.NotificationCreated,
      notificationId: 'retry-2',
      silent: false
    });

    firstRefresh.reject(new Error('transient count refresh failure'));

    await vi.waitFor(() =>
      expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledTimes(2)
    );
    await vi.waitFor(() => expect(mocks.playNotificationSound).toHaveBeenCalledTimes(2));
  });

  it('reconciles silent notification creation without playing a sound', async () => {
    await renderAndWaitForSubscription();

    dispatch({
      kind: RoomEventKind.NotificationCreated,
      notificationId: 'n1',
      roomId: 'room-1',
      eventId: 'event-1',
      inReplyToId: null,
      silent: true
    });

    expect(mocks.store.notifications.addNotification).toHaveBeenCalledOnce();
    expect(mocks.store.notifications.addNotification).toHaveBeenCalledWith('n1');
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
    expect(mocks.playNotificationSound).not.toHaveBeenCalled();
  });

  it('does not play a stale alert when the notification disappeared before hydration', async () => {
    mocks.store.notifications.addNotification.mockResolvedValue(false);
    await renderAndWaitForSubscription();

    dispatch({
      kind: RoomEventKind.NotificationCreated,
      notificationId: 'already-read',
      roomId: 'room-1',
      eventId: 'event-1',
      inReplyToId: null,
      silent: false
    });

    await vi.waitFor(() =>
      expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce()
    );
    expect(mocks.playNotificationSound).not.toHaveBeenCalled();
  });

  it('reconciles counts when a cached notification is dismissed elsewhere', async () => {
    mocks.store.notifications.removeNotification.mockReturnValue('room-1');
    await renderAndWaitForSubscription();

    dispatch({
      kind: RoomEventKind.NotificationDismissed,
      notificationId: 'n1'
    });

    expect(mocks.store.notifications.removeNotification).toHaveBeenCalledWith('n1');
    expect(mocks.dismissNativeNotification).toHaveBeenCalledWith('n1');
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
    expect(mocks.store.rooms.decrementUnreadNotification).not.toHaveBeenCalled();
    expect(mocks.store.notifications.fetch).not.toHaveBeenCalled();
  });

  it('does not close an origin-native notification for a remote instance dismissal', async () => {
    mocks.servers = [{ id: 'remote' }];
    await renderAndWaitForSubscription();

    dispatch({
      kind: RoomEventKind.NotificationDismissed,
      notificationId: 'shared-id'
    });

    expect(mocks.dismissNativeNotification).not.toHaveBeenCalled();
  });

  it('refetches notification state and counts when an uncached remote dismissal arrives', async () => {
    mocks.store.notifications.removeNotification.mockReturnValue(null);
    mocks.store.notifications.consumeLocalDismissal.mockReturnValue(false);
    await renderAndWaitForSubscription();

    dispatch({
      kind: RoomEventKind.NotificationDismissed,
      notificationId: 'unknown-notification'
    });

    expect(mocks.store.notifications.consumeLocalDismissal).toHaveBeenCalledWith(
      'unknown-notification'
    );
    expect(mocks.store.notifications.fetch).toHaveBeenCalledOnce();
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
    expect(mocks.store.rooms.refresh).not.toHaveBeenCalled();
  });

  it('coalesces a burst of uncached remote dismissals into one reconciliation', async () => {
    const fetch = deferred<void>();
    mocks.store.notifications.removeNotification.mockReturnValue(null);
    mocks.store.notifications.consumeLocalDismissal.mockReturnValue(false);
    mocks.store.notifications.fetch.mockReturnValue(fetch.promise);
    await renderAndWaitForSubscription();

    for (let index = 0; index < 20; index++) {
      dispatch({
        kind: RoomEventKind.NotificationDismissed,
        notificationId: `unknown-${index}`
      });
    }

    expect(mocks.store.notifications.fetch).toHaveBeenCalledOnce();
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
    fetch.resolve();
    await vi.waitFor(() => expect(mocks.store.notifications.fetch).toHaveBeenCalledTimes(2));
    expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledTimes(2);
  });

  it('uses the exact pending-notification total for loaded stores', async () => {
    mocks.store.notifications.notifications = [{ id: 'notification-1', kind: 'directMessage' }];
    mocks.store.notifications.count = 1;
    mocks.store.notifications.unreadNotificationCount = 1;
    mocks.store.notifications.pendingNotificationIds = ['notification-1'];

    await renderAndWaitForSubscription();

    await vi.waitFor(() =>
      expect(mocks.updateBadge).toHaveBeenCalledWith({ kind: 'count', count: 1 })
    );
    expect(mocks.syncServiceWorkerNotificationBadgeState).toHaveBeenCalledWith({
      kind: 'count',
      count: 1
    });
    expect(mocks.reconcileNativeNotifications).toHaveBeenCalledWith(['notification-1']);
    expect(mocks.clearBadge).not.toHaveBeenCalled();
  });

  it('does not reconcile native notifications from an incomplete capped snapshot', async () => {
    mocks.store.notifications.notifications = [{ id: 'notification-1', kind: 'directMessage' }];
    mocks.store.notifications.count = 1;
    mocks.store.notifications.unreadNotificationCount = 3;
    mocks.store.notifications.hasCompleteNotificationSnapshot = false;
    mocks.store.notifications.pendingNotificationIds = ['notification-1'];

    await renderAndWaitForSubscription();

    await vi.waitFor(() =>
      expect(mocks.updateBadge).toHaveBeenCalledWith({ kind: 'count', count: 3 })
    );
    expect(mocks.reconcileNativeNotifications).not.toHaveBeenCalled();
  });

  it('uses the server total even when the cached page is capped', async () => {
    mocks.store.notifications.notifications = [{ kind: 'directMessage' }];
    mocks.store.notifications.count = 1;
    mocks.store.notifications.unreadNotificationCount = 3;
    mocks.store.notifications.hasCompleteNotificationSnapshot = false;

    await renderAndWaitForSubscription();

    await vi.waitFor(() =>
      expect(mocks.updateBadge).toHaveBeenCalledWith({ kind: 'count', count: 3 })
    );
    expect(mocks.syncServiceWorkerNotificationBadgeState).toHaveBeenCalledWith({
      kind: 'count',
      count: 3
    });
    expect(mocks.clearBadge).not.toHaveBeenCalled();
  });

  it('counts channel notifications as pending app attention', async () => {
    mocks.store.notifications.notifications = [{ kind: 'mention' }];
    mocks.store.notifications.count = 1;
    mocks.store.notifications.unreadNotificationCount = 1;

    await renderAndWaitForSubscription();

    await vi.waitFor(() =>
      expect(mocks.updateBadge).toHaveBeenCalledWith({ kind: 'count', count: 1 })
    );
    expect(mocks.syncServiceWorkerNotificationBadgeState).toHaveBeenCalledWith({
      kind: 'count',
      count: 1
    });
    expect(mocks.clearBadge).not.toHaveBeenCalled();
  });

  it('clears the app badge when there are no notifications or unread rooms', async () => {
    await renderAndWaitForSubscription();

    await vi.waitFor(() => expect(mocks.clearBadge).toHaveBeenCalledOnce());
    expect(mocks.syncServiceWorkerNotificationBadgeState).toHaveBeenCalledWith({ kind: 'clear' });
    expect(mocks.updateBadge).not.toHaveBeenCalled();
  });

  it('does not treat startup zero as authoritative before notifications load', async () => {
    mocks.store.notifications.hasLoaded = false;

    await renderAndWaitForSubscription();

    expect(mocks.syncServiceWorkerNotificationBadgeState).not.toHaveBeenCalled();
    expect(mocks.updateBadge).not.toHaveBeenCalled();
    expect(mocks.clearBadge).not.toHaveBeenCalled();
  });

  it('still publishes a positive count before all stores are loaded', async () => {
    mocks.store.notifications.hasLoaded = false;
    mocks.store.notifications.unreadNotificationCount = 2;
    mocks.store.notifications.hasCompleteNotificationSnapshot = false;

    await renderAndWaitForSubscription();

    await vi.waitFor(() => expect(mocks.updateBadge).toHaveBeenCalledWith({ kind: 'flag' }));
    expect(mocks.syncServiceWorkerNotificationBadgeState).toHaveBeenCalledWith({ kind: 'flag' });
    expect(mocks.clearBadge).not.toHaveBeenCalled();
  });

  it('does not set a dock badge for unread-only rooms', async () => {
    mocks.store.roomUnread.hasAnyUnread = true;

    await renderAndWaitForSubscription();

    await vi.waitFor(() => expect(mocks.clearBadge).toHaveBeenCalledOnce());
    expect(mocks.syncServiceWorkerNotificationBadgeState).toHaveBeenCalledWith({ kind: 'clear' });
    expect(mocks.updateBadge).not.toHaveBeenCalled();
  });
});
