import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotificationStore,
  notificationTarget,
  type NotificationItem
} from './notifications.svelte';
import {
  NotificationItemKind,
  type NotificationAPI,
  type NotificationPage
} from '$lib/api-client/notifications';

type MockNotificationAPI = NotificationAPI & {
  listNotifications: ReturnType<typeof vi.fn>;
  listNotificationSignals: ReturnType<typeof vi.fn>;
  getNotification: ReturnType<typeof vi.fn>;
  getNotificationSignal: ReturnType<typeof vi.fn>;
  batchGetNotifications: ReturnType<typeof vi.fn>;
  listRoomNotifications: ReturnType<typeof vi.fn>;
  hasNotifications: ReturnType<typeof vi.fn>;
  listRoomNotificationCounts: ReturnType<typeof vi.fn>;
  listNotificationCounts: ReturnType<typeof vi.fn>;
  dismissNotification: ReturnType<typeof vi.fn>;
  dismissAllNotifications: ReturnType<typeof vi.fn>;
};

function page(items: NotificationItem[], totalCount = items.length): NotificationPage {
  return {
    items,
    totalCount,
    hasMore: false
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeAPI(
  options: {
    notifications?: NotificationPage;
    signals?: NotificationPage;
    roomNotifications?: NotificationPage;
    notificationsError?: Error;
    roomNotificationsError?: Error;
    getNotification?: (
      notificationId: string
    ) => Promise<NotificationItem | null> | NotificationItem | null;
    getNotificationSignal?: (
      notificationId: string
    ) => Promise<NotificationItem | null> | NotificationItem | null;
    dismissNotification?: (notificationId: string) => Promise<boolean> | boolean;
    dismissAllNotifications?: () => Promise<number> | number;
  } = {}
): MockNotificationAPI {
  return {
    listNotifications: vi.fn().mockImplementation(async () => {
      if (options.notificationsError) throw options.notificationsError;
      return options.notifications ?? page([]);
    }),
    listNotificationSignals: vi
      .fn()
      .mockResolvedValue(options.signals ?? options.notifications ?? page([])),
    getNotification: vi
      .fn()
      .mockImplementation(async (notificationId: string) =>
        options.getNotification ? options.getNotification(notificationId) : null
      ),
    getNotificationSignal: vi
      .fn()
      .mockImplementation(async (notificationId: string) =>
        options.getNotificationSignal
          ? options.getNotificationSignal(notificationId)
          : options.getNotification
            ? options.getNotification(notificationId)
            : null
      ),
    batchGetNotifications: vi.fn().mockResolvedValue([]),
    listRoomNotifications: vi.fn().mockImplementation(async () => {
      if (options.roomNotificationsError) throw options.roomNotificationsError;
      return options.roomNotifications ?? page([]);
    }),
    hasNotifications: vi.fn().mockResolvedValue(false),
    listRoomNotificationCounts: vi.fn().mockResolvedValue({}),
    listNotificationCounts: vi.fn().mockResolvedValue({}),
    dismissNotification: vi
      .fn()
      .mockImplementation(async (notificationId: string) =>
        options.dismissNotification ? options.dismissNotification(notificationId) : true
      ),
    dismissAllNotifications: vi
      .fn()
      .mockImplementation(async () =>
        options.dismissAllNotifications ? options.dismissAllNotifications() : 0
      )
  };
}

const mention = (id: string): NotificationItem =>
  ({
    kind: NotificationItemKind.Mention,
    id,
    createdAt: new Date('2026-04-29T12:00:00Z').toISOString(),
    actor: {
      id: 'a',
      login: 'tester',
      displayName: 'Tester',
      avatarUrl: null,
      presenceStatus: 'OFFLINE'
    },
    summary: 'mentioned you',
    mentionSpace: { id: 's1', name: 'Space' },
    mentionRoom: { id: 'r1', name: 'general' },
    mentionEventId: 'evt'
  }) as unknown as NotificationItem;

describe('NotificationStore', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('populates notifications on success', async () => {
    const store = new NotificationStore(
      makeAPI({ notifications: page([mention('n1'), mention('n2')]) })
    );
    await store.fetch();
    expect(store.notifications).toHaveLength(2);
    expect(store.pendingNotificationIds).toEqual(['n1', 'n2']);
    expect(store.hasCompleteNotificationSnapshot).toBe(true);
    expect(store.error).toBeNull();
    expect(store.hasLoaded).toBe(true);
  });

  it('keeps foreground-hidden center rows separate from global channel and thread signals', async () => {
    const threadMention = {
      ...mention('foreground-thread'),
      mentionInThread: 'thread-root'
    } as NotificationItem;
    const store = new NotificationStore(
      makeAPI({ notifications: page([]), signals: page([threadMention]) })
    );

    await store.fetch();

    expect(store.notifications).toEqual([]);
    expect(store.unreadNotificationCount).toBe(0);
    expect(store.signalNotifications.map((notification) => notification.id)).toEqual([
      'foreground-thread'
    ]);
    expect(store.signalNotificationCount).toBe(1);
    expect(store.hasThreadNotification('thread-root')).toBe(true);
    expect(store.hasRoomNotification('r1')).toBe(true);
    expect(store.hasSpaceNotification()).toBe(true);
  });

  it('hydrates a foreground-hidden signal without adding it to the center', async () => {
    const signal = {
      ...mention('live-signal'),
      mentionInThread: 'signal-thread'
    } as NotificationItem;
    const store = new NotificationStore(
      makeAPI({
        notifications: page([]),
        getNotificationSignal: (notificationId) => (notificationId === signal.id ? signal : null)
      })
    );

    await expect(store.addNotificationSignal(signal.id)).resolves.toBe(true);

    expect(store.notifications).toEqual([]);
    expect(store.unreadNotificationCount).toBe(0);
    expect(store.signalNotificationCount).toBe(1);
    expect(store.hasThreadNotification('signal-thread')).toBe(true);
  });

  it('marks a fetched notification snapshot incomplete when the server total is capped', async () => {
    const store = new NotificationStore(makeAPI({ notifications: page([mention('n1')], 3) }));

    await store.fetch();

    expect(store.pendingNotificationIds).toEqual(['n1']);
    expect(store.unreadNotificationCount).toBe(3);
    expect(store.hasCompleteNotificationSnapshot).toBe(false);
  });

  it('discards an older full-list response that arrives after a newer response', async () => {
    const older = deferred<NotificationPage>();
    const newer = deferred<NotificationPage>();
    const api = makeAPI();
    api.listNotifications.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const store = new NotificationStore(api);

    const olderFetch = store.fetch();
    const newerFetch = store.fetch();

    newer.resolve(page([mention('newer')]));
    await newerFetch;
    older.resolve(page([mention('older')]));
    await olderFetch;

    expect(store.notifications.map((notification) => notification.id)).toEqual(['newer']);
  });

  it('hydrates one realtime notification by ID without refetching the full list', async () => {
    const liveNotification = mention('live');
    const api = makeAPI({
      getNotification: (notificationId) =>
        notificationId === liveNotification.id ? liveNotification : null
    });
    const store = new NotificationStore(api);

    await store.addNotification(liveNotification.id);
    await store.addNotification(liveNotification.id);

    expect(api.getNotification).toHaveBeenCalledTimes(2);
    expect(api.listNotifications).not.toHaveBeenCalled();
    expect(store.notifications.map((notification) => notification.id)).toEqual(['live']);
    expect(store.unreadNotificationCount).toBe(1);
  });

  it('reports a newly hydrated fallback notification when the singular read fails', async () => {
    const liveNotification = mention('fallback-live');
    const api = makeAPI({
      notifications: page([liveNotification]),
      getNotification: () => {
        throw new Error('singular read unavailable');
      }
    });
    const store = new NotificationStore(api);

    await expect(store.addNotification(liveNotification.id)).resolves.toBe(true);

    expect(api.listNotifications).toHaveBeenCalledOnce();
    expect(store.notifications.map((notification) => notification.id)).toEqual([
      liveNotification.id
    ]);
  });

  it('does not let an in-flight fetch restore an optimistically dismissed notification', async () => {
    const response = deferred<NotificationPage>();
    const api = makeAPI();
    api.listNotifications.mockReturnValueOnce(response.promise);
    const store = new NotificationStore(api);
    store.notifications = [mention('dismiss-me')];
    store.unreadNotificationCount = 1;

    const fetch = store.fetch();
    await store.dismiss('dismiss-me');
    response.resolve(page([mention('dismiss-me')]));
    await fetch;

    expect(api.listNotifications).toHaveBeenCalledTimes(2);
    expect(store.notifications).toEqual([]);
    expect(store.unreadNotificationCount).toBe(0);
  });

  it('dismissById dismisses an uncached native-close notification on the server', async () => {
    const api = makeAPI();
    const store = new NotificationStore(api);

    await expect(store.dismissById('native-close-id')).resolves.toBe(true);

    expect(api.dismissNotification).toHaveBeenCalledWith('native-close-id');
    expect(store.notifications).toEqual([]);
  });

  it('dismissById reuses the optimistic local path when the notification is cached', async () => {
    const api = makeAPI();
    const store = new NotificationStore(api);
    store.notifications = [mention('cached-native-close')];
    store.unreadNotificationCount = 1;

    await expect(store.dismissById('cached-native-close')).resolves.toBe(true);

    expect(api.dismissNotification).toHaveBeenCalledWith('cached-native-close');
    expect(store.notifications).toEqual([]);
    expect(store.unreadNotificationCount).toBe(0);
  });

  it('dismissById removes a foreground-hidden signal and its global server count', async () => {
    const api = makeAPI();
    const store = new NotificationStore(api);
    store.signalNotifications = [mention('hidden-signal')];
    store.signalNotificationCount = 1;

    await expect(store.dismissById('hidden-signal')).resolves.toBe(true);

    expect(store.notifications).toEqual([]);
    expect(store.signalNotifications).toEqual([]);
    expect(store.signalNotificationCount).toBe(0);
  });

  it('restores a foreground-hidden signal count when dismissal fails', async () => {
    const api = makeAPI({ dismissNotification: () => false });
    const store = new NotificationStore(api);
    store.signalNotifications = [mention('restore-signal')];
    store.signalNotificationCount = 1;

    await expect(store.dismissById('restore-signal')).resolves.toBe(false);

    expect(store.signalNotifications.map((notification) => notification.id)).toEqual([
      'restore-signal'
    ]);
    expect(store.signalNotificationCount).toBe(1);
  });

  it('fetchRoomNotification caches the newest room signal without leaking it into the center', async () => {
    const roomMention = mention('room-mention');
    const store = new NotificationStore(makeAPI({ roomNotifications: page([roomMention], 4) }));

    const result = await store.fetchRoomNotification('r1');

    expect(result).toEqual({
      ok: true,
      totalCount: 4,
      notification: roomMention
    });
    expect(store.notifications).toEqual([]);
    expect(store.signalNotifications.map((n) => n.id)).toEqual(['room-mention']);
  });

  it('fetchRoomNotification reports an empty room-scoped notification result', async () => {
    const store = new NotificationStore(makeAPI({ roomNotifications: page([], 0) }));

    const result = await store.fetchRoomNotification('r1');

    expect(result).toEqual({
      ok: true,
      totalCount: 0,
      notification: null
    });
    expect(store.notifications).toHaveLength(0);
  });

  it('resolveRoomNotification uses the cached room notification before querying', async () => {
    const cached = mention('cached');
    const api = makeAPI({ roomNotifications: page([mention('remote')], 1) });
    const store = new NotificationStore(api);
    store.notifications = [cached];

    const result = await store.resolveRoomNotification('r1');

    expect(result).toEqual({
      ok: true,
      totalCount: null,
      notification: cached
    });
    expect(api.listRoomNotifications).not.toHaveBeenCalled();
  });

  it('routes notification targets to the same room/thread/event used by push payloads', () => {
    const store = new NotificationStore(makeAPI());
    const threadMention = {
      kind: NotificationItemKind.Mention,
      id: 'thread-mention',
      createdAt: new Date().toISOString(),
      actor: {
        id: 'a',
        login: 't',
        displayName: 't',
        avatarUrl: null,
        presenceStatus: 'OFFLINE'
      },
      summary: 'mentioned you',
      mentionRoom: { id: 'room-2', name: 'general' },
      mentionEventId: 'mention-event',
      mentionInThread: 'thread-root'
    } as unknown as NotificationItem;
    const threadReply = {
      kind: NotificationItemKind.Reply,
      id: 'thread-reply',
      createdAt: new Date().toISOString(),
      actor: {
        id: 'a',
        login: 't',
        displayName: 't',
        avatarUrl: null,
        presenceStatus: 'OFFLINE'
      },
      summary: 'replied to you',
      replyRoom: { id: 'room-2', name: 'general' },
      replyEventId: 'reply-event',
      inReplyToId: 'mid-thread-msg',
      replyInThread: 'thread-root'
    } as unknown as NotificationItem;
    const roomMessage = {
      kind: NotificationItemKind.RoomMessage,
      id: 'room-message',
      createdAt: new Date().toISOString(),
      actor: {
        id: 'a',
        login: 't',
        displayName: 't',
        avatarUrl: null,
        presenceStatus: 'OFFLINE'
      },
      summary: 'posted a message',
      roomMsgRoom: { id: 'room-news', name: 'news' },
      roomMsgEventId: 'room-event',
      roomMsgInThread: 'thread-root'
    } as unknown as NotificationItem;

    expect(notificationTarget(threadMention)).toMatchObject({
      roomId: 'room-2',
      eventId: 'mention-event',
      threadRootId: 'thread-root'
    });
    expect(store.getNavigationPath('origin', threadMention)).toBe(
      '/chat/-/room-2/thread-root?highlight=mention-event'
    );

    expect(notificationTarget(threadReply)).toMatchObject({
      roomId: 'room-2',
      eventId: 'reply-event',
      threadRootId: 'thread-root'
    });
    expect(store.getNavigationPath('origin', threadReply)).toBe(
      '/chat/-/room-2/thread-root?highlight=reply-event'
    );

    expect(notificationTarget(roomMessage)).toMatchObject({
      roomId: 'room-news',
      eventId: 'room-event',
      threadRootId: 'thread-root'
    });
    expect(store.getNavigationPath('origin', roomMessage)).toBe(
      '/chat/-/room-news/thread-root?highlight=room-event'
    );
  });

  it('routes notifications using notification item kind', () => {
    const threadReply = {
      kind: NotificationItemKind.Reply,
      id: 'thread-reply-kind',
      createdAt: new Date().toISOString(),
      actor: null,
      summary: 'replied to you',
      replyRoom: { id: 'room-kind', name: 'general' },
      replyEventId: 'reply-event',
      inReplyToId: 'parent-message',
      replyInThread: 'thread-root'
    } as unknown as NotificationItem;
    const dm = {
      kind: NotificationItemKind.DirectMessage,
      id: 'dm-kind',
      createdAt: new Date().toISOString(),
      actor: null,
      summary: 'sent you a message',
      room: { id: 'dm-room' },
      eventId: 'dm-event',
      dmInThread: 'dm-thread-root'
    } as unknown as NotificationItem;
    const call = {
      kind: NotificationItemKind.CallStarted,
      id: 'call-kind',
      createdAt: new Date().toISOString(),
      actor: null,
      summary: 'started a call',
      callRoom: { id: 'call-room', name: 'general' },
      callEventId: 'call-event',
      callId: 'C1',
      isPrivate: false
    } as unknown as NotificationItem;

    const store = new NotificationStore(makeAPI());
    store.notifications = [threadReply, dm, call];

    expect(notificationTarget(threadReply)).toMatchObject({
      isDM: false,
      roomId: 'room-kind',
      eventId: 'reply-event',
      threadRootId: 'thread-root'
    });
    expect(store.hasThreadNotification('thread-root')).toBe(true);
    expect(store.hasDMRoomNotification('dm-room')).toBe(true);
    expect(notificationTarget(dm)).toMatchObject({
      isDM: true,
      roomId: 'dm-room',
      eventId: 'dm-event',
      threadRootId: 'dm-thread-root'
    });
    expect(store.getCleanPath('origin', dm)).toBe('/chat/-/dm-room/dm-thread-root');
    expect(store.getNavigationPath('origin', dm)).toBe(
      '/chat/-/dm-room/dm-thread-root?highlight=dm-event'
    );
    expect(notificationTarget(call)).toMatchObject({
      isDM: false,
      roomId: 'call-room',
      eventId: null,
      threadRootId: null
    });
    expect(store.getCleanPath('origin', call)).toBe('/chat/-/call-room');
    expect(store.getNavigationPath('origin', call)).toBe('/chat/-/call-room');
  });

  it('marks threads for mentions, replies, and all-message notifications', () => {
    const threadMention = {
      ...mention('thread-mention-indicator'),
      mentionInThread: 'thread-mention-root'
    } as NotificationItem;
    const threadReply = {
      kind: NotificationItemKind.Reply,
      id: 'thread-reply-indicator',
      createdAt: new Date().toISOString(),
      actor: null,
      summary: 'replied to you',
      replyRoom: { id: 'r1', name: 'general' },
      replyEventId: 'reply-event',
      inReplyToId: 'parent-event',
      replyInThread: 'thread-reply-root'
    } as NotificationItem;
    const threadRoomMessage = {
      kind: NotificationItemKind.RoomMessage,
      id: 'thread-room-message-indicator',
      createdAt: new Date().toISOString(),
      actor: null,
      summary: 'posted a message',
      roomMsgRoom: { id: 'r1', name: 'general' },
      roomMsgEventId: 'room-message-event',
      roomMsgInThread: 'thread-room-message-root'
    } as NotificationItem;
    const store = new NotificationStore(makeAPI());
    store.notifications = [threadMention, threadReply, threadRoomMessage];

    expect([...store.threadsWithNotifications]).toEqual([
      'thread-mention-root',
      'thread-reply-root',
      'thread-room-message-root'
    ]);
    expect(store.hasThreadNotification('thread-mention-root')).toBe(true);
    expect(store.hasThreadNotification('thread-reply-root')).toBe(true);
    expect(store.hasThreadNotification('thread-room-message-root')).toBe(true);
    expect(store.hasThreadNotification('unrelated-thread')).toBe(false);
  });

  it('retains existing notifications when the server returns an API error', async () => {
    const store = new NotificationStore(
      makeAPI({
        notificationsError: new Error('Cannot query field "threadRootEventId"')
      })
    );
    // Pre-populate as if a previous fetch had succeeded.
    store.notifications = [mention('original')];

    await store.fetch();

    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0].id).toBe('original');
    expect(store.error).toContain('Cannot query field');
    expect(store.hasLoaded).toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  it('does not throw on API error', async () => {
    const store = new NotificationStore(
      makeAPI({ notificationsError: new Error('something broke') })
    );
    await expect(store.fetch()).resolves.toBeUndefined();
    expect(store.error).toBe('something broke');
  });

  it('does not throw on network/transport error', async () => {
    const store = new NotificationStore(makeAPI({ notificationsError: new Error('network down') }));
    store.notifications = [mention('keepme')];
    await expect(store.fetch()).resolves.toBeUndefined();
    // Existing notifications survive a network blip too.
    expect(store.notifications).toHaveLength(1);
    expect(store.error).toBe('network down');
  });

  it('suppresses live echo refreshes for locally dismissed notifications', async () => {
    const store = new NotificationStore(makeAPI());
    store.notifications = [mention('local')];

    await store.dismiss('local');

    expect(store.consumeLocalDismissal('local')).toBe(true);
    expect(store.consumeLocalDismissal('local')).toBe(false);
  });

  // The DM list dot uses hasDMRoomNotification per conversation. It must
  // match DM notifications by room, and ignore non-DM notifications even if
  // they happen to share a room id.
  it('hasDMRoomNotification / getDMRoomNotification scope to DM notifications by room', () => {
    const dmA = {
      kind: NotificationItemKind.DirectMessage,
      id: 'dm-a',
      createdAt: new Date('2026-04-29T12:00:00Z').toISOString(),
      actor: {
        id: 'u',
        login: 't',
        displayName: 't',
        avatarUrl: null,
        presenceStatus: 'OFFLINE'
      },
      summary: 'hi',
      room: { id: 'roomA' }
    } as unknown as NotificationItem;
    const dmB = {
      kind: NotificationItemKind.DirectMessage,
      id: 'dm-b',
      createdAt: new Date('2026-04-29T13:00:00Z').toISOString(),
      actor: {
        id: 'u',
        login: 't',
        displayName: 't',
        avatarUrl: null,
        presenceStatus: 'OFFLINE'
      },
      summary: 'later',
      room: { id: 'roomA' }
    } as unknown as NotificationItem;
    const roomMention = {
      kind: NotificationItemKind.Mention,
      id: 'mention-same-id',
      createdAt: new Date().toISOString(),
      actor: {
        id: 'u',
        login: 't',
        displayName: 't',
        avatarUrl: null,
        presenceStatus: 'OFFLINE'
      },
      summary: 'mention',
      mentionSpace: { id: 's', name: 'S' },
      mentionRoom: { id: 'roomA', name: 'r' },
      mentionEventId: 'e'
    } as unknown as NotificationItem;

    const store = new NotificationStore(makeAPI());
    // Most-recent-first ordering, as fetch() would produce.
    store.notifications = [dmB, dmA, roomMention];

    expect(store.hasDMRoomNotification('roomA')).toBe(true);
    expect(store.hasDMRoomNotification('roomB')).toBe(false);

    // getDMRoomNotification returns the freshest DM, not the mention,
    // even when the mention's roomId matches.
    expect(store.getDMRoomNotification('roomA')?.id).toBe('dm-b');

    // hasRoomNotification (the non-DM variant) must NOT see DM notifications
    // — that's how the regular sidebar dot stays orthogonal to the DM dot.
    expect(store.hasRoomNotification('roomA')).toBe(true); // matched by mention
    // If we drop the mention, hasRoomNotification goes false even though
    // DMs still target that room id.
    store.notifications = [dmB, dmA];
    expect(store.hasRoomNotification('roomA')).toBe(false);
    expect(store.hasDMRoomNotification('roomA')).toBe(true);
  });

  // Per-instance isolation: each instance has its own NotificationStore, and
  // an error in one must not affect notifications loaded on another.
  it('one store failing does not affect a sibling store', async () => {
    const homeStore = new NotificationStore(makeAPI({ notifications: page([mention('h1')]) }));
    const remoteStore = new NotificationStore(
      makeAPI({ notificationsError: new Error('Cannot query field "threadRootEventId"') })
    );

    await Promise.all([homeStore.fetch(), remoteStore.fetch()]);

    expect(homeStore.notifications).toHaveLength(1);
    expect(homeStore.error).toBeNull();
    expect(remoteStore.notifications).toHaveLength(0);
    expect(remoteStore.error).toContain('Cannot query field');
  });
});
