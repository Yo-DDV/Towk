import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { q } from '$lib/test-utils';
import { RoomType } from '$lib/render/types';
import type { EventEnvelope, EventHandler } from '$lib/eventBus.svelte';
import { RoomEventKind } from '$lib/render/eventKinds';
import { NotificationItemKind } from '$lib/api-client/notifications';
import type { RoomsListGroup } from '$lib/state/server/rooms.svelte';
import { useEvent } from '$lib/hooks';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    activeCallRoomIds: new Set<string>(),
    callParticipants: new Map<string, unknown[]>(),
    unreadRoomIds: new Set<string>(),
    pushState: vi.fn(),
    goto: vi.fn(),
    requestCallJoin: vi.fn().mockResolvedValue({ status: 'joined' }),
    appUi: {
      roomPrimarySurfaceFor: vi.fn().mockReturnValue('messages'),
      selectRoomPrimarySurface: vi.fn()
    },
    store: {
      currentUser: { user: { id: 'me' } },
      notifications: {
        hasDMRoomNotification: vi.fn().mockReturnValue(false),
        hasRoomNotification: vi.fn().mockReturnValue(false),
        getDMRoomNotification: vi.fn().mockReturnValue(null),
        getRoomNotification: vi.fn().mockReturnValue(null),
        fetchRoomNotification: vi.fn().mockResolvedValue({
          ok: true,
          totalCount: 0,
          notification: null
        }),
        resolveRoomNotification: vi.fn().mockResolvedValue({
          ok: true,
          totalCount: 0,
          notification: null
        }),
        dismiss: vi.fn(),
        dismissById: vi.fn(),
        getCleanPath: vi.fn().mockReturnValue('/chat/-/room')
      },
      notificationLevels: {
        isRoomMuted: vi.fn().mockReturnValue(false)
      },
      roomUnread: {
        roomIsUnread: vi.fn((roomId: string) => mocks.unreadRoomIds.has(roomId)),
        setRoomUnread: vi.fn((roomId: string, unread: boolean) => {
          if (unread) mocks.unreadRoomIds.add(roomId);
          else mocks.unreadRoomIds.delete(roomId);
        })
      },
      activeCallRooms: {
        load: vi.fn().mockResolvedValue(undefined),
        has: vi.fn((roomId: string) => mocks.activeCallRoomIds.has(roomId)),
        getCallId: vi.fn((roomId: string) => `call-${roomId}`),
        getParticipants: vi.fn((roomId: string) => mocks.callParticipants.get(roomId) ?? []),
        handleJoin: vi.fn(),
        handleLeave: vi.fn(),
        handleEnd: vi.fn()
      },
      voiceCall: {
        join: vi.fn().mockResolvedValue(undefined),
        handleParticipantLeftEvent: vi.fn(),
        handleCallEndedEvent: vi.fn()
      },
      serverInfo: {
        livekitUrl: null
      },
      rooms: {
        rooms: [],
        roomGroups: null as RoomsListGroup[] | null,
        isInitialLoading: false,
        currentUserId: 'me',
        bumpRoom: vi.fn(),
        clearUnreadNotifications: vi.fn(),
        decrementUnreadNotification: vi.fn(),
        incrementUnreadNotification: vi.fn(),
        refreshNotificationCounts: vi.fn().mockResolvedValue(undefined)
      },
      pendingHighlights: {
        set: vi.fn()
      },
      handleVoiceCallJoinFailed: vi.fn()
    }
  }
}));

vi.mock('$app/state', () => ({
  navigating: { complete: null },
  page: {
    params: {
      serverId: '-',
      roomId: undefined
    }
  }
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto,
  pushState: mocks.pushState
}));

vi.mock('$app/paths', () => ({
  resolve: (path: string, params?: Record<string, string>) =>
    path.replace('[serverId]', params?.serverId ?? '').replace('[roomId]', params?.roomId ?? '')
}));

vi.mock('$lib/navigation', () => ({
  serverIdToSegment: () => '-',
  segmentToServerId: () => 'origin'
}));

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'origin'
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    getStore: vi.fn(() => mocks.store),
    isOriginServer: vi.fn(() => true),
    getServer: vi.fn(() => ({ id: 'origin', url: 'https://chat.example.test' })),
    originServer: { id: 'origin' },
    servers: [{ id: 'origin', url: 'https://chat.example.test' }]
  }
}));

vi.mock('$lib/hooks', () => ({
  useEvent: vi.fn(),
  useRoomMarkedAsRead: vi.fn(),
  useTabResumeCallback: vi.fn()
}));

vi.mock('$lib/state/appUi.svelte', () => ({
  getAppUiState: () => mocks.appUi
}));

vi.mock('$lib/state/callJoinController.svelte', () => ({
  getCallJoinController: () => ({
    request: mocks.requestCallJoin
  })
}));

vi.mock('$lib/state/presenceCache.svelte', () => ({
  getPresenceCache: () => ({
    get: (_scope: { serverId: string; userId: string }, fallback: string) => fallback
  })
}));

vi.mock('$lib/state/userProfiles.svelte', () => ({
  getLiveDisplayName: (_userId: string, fallback: string) => fallback,
  getLiveAvatarUrl: (_userId: string, fallback: string | null) => fallback,
  getLiveCustomStatus: (_userId: string, fallback: unknown) => fallback
}));

import RoomList from './RoomList.svelte';

function notification(id: string, roomId: string, isDM = false) {
  if (isDM) {
    return {
      kind: NotificationItemKind.DirectMessage,
      id,
      createdAt: '2026-06-18T10:00:00Z',
      actor: null,
      summary: 'new direct message',
      room: { id: roomId },
      eventId: `${id}-event`
    };
  }

  return {
    kind: NotificationItemKind.Mention,
    id,
    createdAt: '2026-06-18T10:00:00Z',
    actor: null,
    summary: 'mentioned you',
    mentionRoom: { id: roomId, name: 'general' },
    mentionEventId: 'event-1',
    mentionInThread: 'thread-1'
  };
}

function user(id: string, login: string, displayName: string) {
  return {
    id,
    login,
    displayName,
    avatarUrl: null,
    presenceStatus: 'ONLINE'
  };
}

function callParticipant(userId: string, displayName: string, deviceIndex = 1) {
  return {
    participantId: `${userId}-device-${deviceIndex}`,
    userId,
    deviceIndex,
    login: userId,
    displayName,
    avatarUrl: null
  };
}

function setRooms() {
  mocks.store.rooms.rooms = [
    {
      id: 'channel-1',
      name: 'general',
      type: RoomType.Channel,
      isUniversal: false,
      viewerIsMember: true,
      viewerCanJoinRoom: true,
      viewerNotificationCount: 0,
      members: []
    },
    {
      id: 'joinable-channel',
      name: 'joinable',
      type: RoomType.Channel,
      isUniversal: false,
      viewerIsMember: false,
      viewerCanJoinRoom: true,
      viewerNotificationCount: 0,
      members: []
    },
    {
      id: 'restricted-channel',
      name: 'restricted',
      type: RoomType.Channel,
      isUniversal: false,
      viewerIsMember: false,
      viewerCanJoinRoom: false,
      viewerNotificationCount: 0,
      members: []
    },
    {
      id: 'dm-with-participants',
      name: '',
      type: RoomType.Dm,
      isUniversal: false,
      viewerIsMember: true,
      viewerCanJoinRoom: true,
      viewerNotificationCount: 0,
      members: [user('me', 'me', 'Me'), user('teal', 'teal', 'Teal')]
    },
    {
      id: 'dm-phone-only',
      name: '',
      type: RoomType.Dm,
      isUniversal: false,
      viewerIsMember: true,
      viewerCanJoinRoom: true,
      viewerNotificationCount: 0,
      members: [user('me', 'me', 'Me'), user('river', 'river', 'River')]
    }
  ] as never;
}

function setRoomNotificationCount(roomId: string, count: number) {
  const rooms = mocks.store.rooms.rooms as Array<{
    id: string;
    viewerNotificationCount: number;
  }>;
  const room = rooms.find((item) => item.id === roomId);
  if (!room) throw new Error(`Missing mocked room ${roomId}`);
  room.viewerNotificationCount = count;
}

function setRoomUnread(roomId: string, hasUnread: boolean) {
  if (hasUnread) mocks.unreadRoomIds.add(roomId);
  else mocks.unreadRoomIds.delete(roomId);
}

function dispatchRoomListEvent(handlerIndex: number, event: Record<string, unknown>) {
  const handler = vi.mocked(useEvent).mock.calls[handlerIndex]?.[0] as EventHandler | undefined;
  if (!handler) throw new Error(`RoomList useEvent handler ${handlerIndex} was not registered`);
  handler({
    id: 'event-1',
    createdAt: new Date().toISOString(),
    actorId: 'other-user',
    actor: null,
    event
  } as EventEnvelope);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.activeCallRoomIds = new Set();
  mocks.callParticipants = new Map();
  mocks.unreadRoomIds = new Set();
  mocks.store.rooms.roomGroups = null;
  mocks.store.rooms.isInitialLoading = false;
  mocks.store.rooms.currentUserId = 'me';
  setRooms();
  vi.clearAllMocks();
  mocks.store.notificationLevels.isRoomMuted.mockReturnValue(false);
  mocks.store.notifications.fetchRoomNotification.mockResolvedValue({
    ok: true,
    totalCount: 0,
    notification: null
  });
  mocks.store.notifications.resolveRoomNotification.mockResolvedValue({
    ok: true,
    totalCount: 0,
    notification: null
  });
  mocks.store.notifications.getCleanPath.mockReturnValue('/chat/-/room');
  mocks.store.rooms.refreshNotificationCounts.mockResolvedValue(undefined);
  mocks.appUi.roomPrimarySurfaceFor.mockReturnValue('messages');
  mocks.requestCallJoin.mockResolvedValue({ status: 'joined' });
});

describe('RoomList', () => {
  it('preloads only route code ahead of room navigation and leaves private data until tap', async () => {
    const { container } = render(RoomList);

    await expect.element(q(container, '[href="/chat/-/channel-1"]')).toBeInTheDocument();
    const channelRow = q(container, '[href="/chat/-/channel-1"]') as HTMLAnchorElement;
    const dmRow = q(container, '[href="/chat/-/dm-with-participants"]') as HTMLAnchorElement;

    expect(channelRow.getAttribute('data-sveltekit-preload-code')).toBe('hover');
    expect(channelRow.getAttribute('data-sveltekit-preload-data')).toBe('tap');
    expect(dmRow.getAttribute('data-sveltekit-preload-code')).toBe('hover');
    expect(dmRow.getAttribute('data-sveltekit-preload-data')).toBe('tap');
  });

  it('keeps channel and direct-message links at the compact sidebar density', async () => {
    const { container } = render(RoomList);

    const channelLink = q(container, '[href="/chat/-/channel-1"]') as HTMLAnchorElement;
    const dmLink = q(container, '[href="/chat/-/dm-with-participants"]') as HTMLAnchorElement;
    await expect.element(channelLink).toBeInTheDocument();
    await expect.element(dmLink).toBeInTheDocument();

    expect(channelLink.classList.contains('min-h-10')).toBe(false);
    expect(dmLink.classList.contains('min-h-10')).toBe(false);
    expect(channelLink.closest('[data-testid="room-list-row"]')).toHaveClass('sidebar-item');
    expect(dmLink.closest('[data-testid="dm-list-row"]')).toHaveClass('sidebar-item');
  });

  it('hides plain unread attention for a muted direct-message room', async () => {
    setRoomUnread('dm-with-participants', true);
    mocks.store.notificationLevels.isRoomMuted.mockImplementation(
      (roomId: string) => roomId === 'dm-with-participants'
    );

    const { container } = render(RoomList);
    await expect.element(q(container, '[href="/chat/-/dm-with-participants"]')).toBeInTheDocument();

    const dmRow = q(container, '[href="/chat/-/dm-with-participants"]');
    expect(dmRow?.querySelector('[data-testid="dm-unread-dot"]')).toBeNull();
    expect(dmRow?.classList.contains('font-semibold')).toBe(false);
  });

  it('renders active-call DM rows with the pulse icon and participant avatars', async () => {
    mocks.activeCallRoomIds.add('dm-with-participants');
    mocks.callParticipants.set('dm-with-participants', [callParticipant('teal', 'Teal')]);

    const { container } = render(RoomList);

    await expect.element(q(container, '[href="/chat/-/dm-with-participants"]')).toBeInTheDocument();
    const dmRow = q(container, '[data-testid="dm-list-row"]');
    const icon = dmRow?.querySelector('[data-testid="room-call-icon"]');
    const pulseIcon = icon?.querySelector('[data-testid="active-call-pulse-icon"]');
    expect(icon).not.toBeNull();
    expect(icon?.classList.contains('text-accent')).toBe(true);
    expect(icon?.querySelector('.uil--phone')).not.toBeNull();
    expect(pulseIcon).not.toBeNull();
    expect(pulseIcon?.classList.contains('animate-ping')).toBe(true);
    expect(dmRow?.querySelector('[data-testid="room-call-participants"]')).not.toBeNull();
    expect(dmRow?.querySelectorAll('[data-testid="room-call-participant-avatar"]')).toHaveLength(1);
    expect(dmRow?.querySelector('a [data-testid="room-call-icon"]')).toBeNull();
    expect(dmRow?.querySelector('button [data-testid="room-call-icon"]')).not.toBeNull();
  });

  it('renders multiple devices from the same account as distinct call participants', async () => {
    mocks.activeCallRoomIds.add('dm-with-participants');
    mocks.callParticipants.set('dm-with-participants', [
      callParticipant('teal', 'Teal'),
      callParticipant('teal', 'Teal', 2)
    ]);

    const { container } = render(RoomList);

    await expect.element(q(container, '[href="/chat/-/dm-with-participants"]')).toBeInTheDocument();
    const dmRow = q(container, '[data-testid="dm-list-row"]');
    expect(dmRow?.querySelectorAll('[data-testid="room-call-participant-avatar"]')).toHaveLength(2);
  });

  it('renders the active-call phone icon when participants are not loaded', async () => {
    mocks.activeCallRoomIds.add('dm-phone-only');

    const { container } = render(RoomList);

    await expect.element(q(container, '[href="/chat/-/dm-phone-only"]')).toBeInTheDocument();
    const dmRow = q(container, '[href="/chat/-/dm-phone-only"]')?.closest(
      '[data-testid="dm-list-row"]'
    );
    const icon = dmRow?.querySelector('[data-testid="room-call-icon"]');
    expect(icon).not.toBeNull();
    expect(icon?.querySelector('.uil--phone')).not.toBeNull();
    expect(icon?.querySelector('[data-testid="active-call-pulse-icon"]')).not.toBeNull();
    expect(dmRow?.querySelector('[data-testid="room-call-participants"]')).toBeNull();
  });

  it('renders active-call channel rows with the pulse icon and participant avatars', async () => {
    mocks.activeCallRoomIds.add('channel-1');
    mocks.callParticipants.set('channel-1', [callParticipant('teal', 'Teal')]);

    const { container } = render(RoomList);

    await expect.element(q(container, '[href="/chat/-/channel-1"]')).toBeInTheDocument();
    const channelRow = q(container, '[href="/chat/-/channel-1"]')?.closest(
      '[data-testid="room-list-row"]'
    );
    const icon = channelRow?.querySelector('[data-testid="room-call-icon"]');
    const pulseIcon = icon?.querySelector('[data-testid="active-call-pulse-icon"]');
    const leadingIcon = channelRow?.querySelector('.sidebar-icon');
    expect(icon).not.toBeNull();
    expect(icon?.querySelector('.uil--phone')).not.toBeNull();
    expect(pulseIcon).not.toBeNull();
    expect(pulseIcon?.classList.contains('animate-ping')).toBe(true);
    expect(leadingIcon?.textContent).toBe('#');
    expect(leadingIcon).not.toBe(icon);
    expect(channelRow?.querySelector('[data-testid="room-call-participants"]')).not.toBeNull();
    expect(
      channelRow?.querySelectorAll('[data-testid="room-call-participant-avatar"]')
    ).toHaveLength(1);
    expect(channelRow?.querySelector('a [data-testid="room-call-icon"]')).toBeNull();
    expect(channelRow?.querySelector('button [data-testid="room-call-icon"]')).not.toBeNull();
  });

  it('renders a compact overflow count for larger active calls', async () => {
    mocks.activeCallRoomIds.add('channel-1');
    mocks.callParticipants.set('channel-1', [
      callParticipant('teal', 'Teal'),
      callParticipant('river', 'River'),
      callParticipant('sage', 'Sage'),
      callParticipant('ash', 'Ash'),
      callParticipant('sol', 'Sol'),
      callParticipant('moon', 'Moon')
    ]);

    const { container } = render(RoomList);

    await expect.element(q(container, '[href="/chat/-/channel-1"]')).toBeInTheDocument();
    const channelRow = q(container, '[href="/chat/-/channel-1"]')?.closest(
      '[data-testid="room-list-row"]'
    );
    expect(
      channelRow?.querySelectorAll('[data-testid="room-call-participant-avatar"]')
    ).toHaveLength(4);
    await expect
      .element(q(channelRow!, '[data-testid="room-call-overflow"]'))
      .toHaveTextContent('+2');
  });

  it('routes an active channel call action through the central join controller', async () => {
    mocks.activeCallRoomIds.add('channel-1');

    const { container } = render(RoomList);

    const action = q(container, '[data-testid="room-call-action"]') as HTMLButtonElement;
    await expect.element(action).toBeInTheDocument();
    action.click();

    await vi.waitFor(() => {
      expect(mocks.requestCallJoin).toHaveBeenCalledWith({
        serverId: 'origin',
        roomId: 'channel-1',
        expectedCallId: 'call-channel-1',
        source: 'room-list'
      });
    });
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('routes an active DM call action through the central join controller', async () => {
    mocks.activeCallRoomIds.add('dm-with-participants');

    const { container } = render(RoomList);

    const action = q(container, '[data-testid="dm-call-action"]') as HTMLButtonElement;
    await expect.element(action).toBeInTheDocument();
    action.click();

    await vi.waitFor(() => {
      expect(mocks.requestCallJoin).toHaveBeenCalledWith({
        serverId: 'origin',
        roomId: 'dm-with-participants',
        expectedCallId: 'call-dm-with-participants',
        source: 'room-list'
      });
    });
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('marks inactive rooms unread from local message event kind', async () => {
    render(RoomList);

    dispatchRoomListEvent(1, {
      kind: RoomEventKind.MessagePosted,
      roomId: 'channel-1',
      threadRootEventId: null
    });

    expect(mocks.store.rooms.bumpRoom).toHaveBeenCalledWith('channel-1');
    expect(mocks.store.roomUnread.setRoomUnread).toHaveBeenCalledWith('channel-1', true);
  });

  it.each([
    ['Enter', 'Enter'],
    ['Space', ' ']
  ])(
    'opens Messages on %s when an active-call room link has keyboard focus',
    async (_label, key) => {
      mocks.activeCallRoomIds.add('channel-1');

      const { container } = render(RoomList);

      await expect.element(q(container, '[href="/chat/-/channel-1"]')).toBeInTheDocument();
      const channelRow = q(container, '[href="/chat/-/channel-1"]') as HTMLAnchorElement;

      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      const wasNotCanceled = channelRow.dispatchEvent(event);

      expect(wasNotCanceled).toBe(false);
      await vi.waitFor(() => {
        expect(mocks.goto).toHaveBeenCalledWith('/chat/-/channel-1');
      });
      expect(mocks.appUi.selectRoomPrimarySurface).toHaveBeenCalledWith(
        'origin',
        'channel-1',
        'messages'
      );
      expect(mocks.requestCallJoin).not.toHaveBeenCalled();
    }
  );

  it('lets faded joinable non-member channel rows navigate to the room route', async () => {
    const { container } = render(RoomList);

    const anchor = q(container, '[href="/chat/-/joinable-channel"]') as HTMLAnchorElement;
    const row = anchor.closest('[data-testid="room-list-row"]') as HTMLElement;
    await expect.element(anchor).toBeInTheDocument();
    expect(row.className).toContain('opacity-60');

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const wasNotCanceled = anchor.dispatchEvent(event);

    expect(wasNotCanceled).toBe(true);
    expect(mocks.pushState).not.toHaveBeenCalled();
  });

  it('lets faded non-joinable channel rows navigate to the inline access screen', async () => {
    const { container } = render(RoomList);

    const anchor = q(container, '[href="/chat/-/restricted-channel"]') as HTMLAnchorElement;
    const row = anchor.closest('[data-testid="room-list-row"]') as HTMLElement;
    await expect.element(anchor).toBeInTheDocument();
    expect(row.className).toContain('opacity-60');
    const icon = anchor.querySelector('.sidebar-icon');
    expect(icon?.classList.contains('uil--lock')).toBe(true);
    expect(anchor.querySelectorAll('.uil--lock')).toHaveLength(1);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const wasNotCanceled = anchor.dispatchEvent(event);

    expect(wasNotCanceled).toBe(true);
    expect(mocks.pushState).not.toHaveBeenCalled();
  });

  it('renders unread channel rows and icons in full-contrast text', async () => {
    setRoomUnread('channel-1', true);

    const { container } = render(RoomList);

    const anchor = q(container, '[href="/chat/-/channel-1"]') as HTMLAnchorElement;
    const row = anchor.closest('[data-testid="room-list-row"]') as HTMLElement;
    await expect.element(anchor).toBeInTheDocument();
    const icon = anchor.querySelector('.sidebar-icon');
    expect(row.classList.contains('font-semibold')).toBe(true);
    expect(row.classList.contains('text-text-top')).toBe(true);
    expect(row.classList.contains('hover:!text-text-top')).toBe(true);
    expect(icon?.classList.contains('text-text-top')).toBe(true);
    expect(icon?.classList.contains('text-muted')).toBe(false);
  });

  it('renders server-local sidebar links as same-tab anchors resolved against the active server', async () => {
    mocks.store.rooms.roomGroups = [
      {
        id: 'g1',
        name: 'Links',
        roomIds: [],
        items: [
          {
            id: 'link:docs',
            type: 'link',
            link: { id: 'docs', label: 'Docs', url: '/docs' }
          }
        ]
      }
    ];

    const { container } = render(RoomList);

    const link = q(container, '[href="https://chat.example.test/docs"]') as HTMLAnchorElement;
    await expect.element(link).toBeInTheDocument();
    expect(link.textContent).toContain('Docs');
    expect(link.getAttribute('target')).toBeNull();
    expect(link.getAttribute('rel')).toBeNull();
  });

  it('renders active-server host sidebar links as same-tab anchors', async () => {
    mocks.store.rooms.roomGroups = [
      {
        id: 'g1',
        name: 'Links',
        roomIds: [],
        items: [
          {
            id: 'link:admin',
            type: 'link',
            link: {
              id: 'admin',
              label: 'Admin',
              url: 'https://chat.example.test/admin'
            }
          }
        ]
      }
    ];

    const { container } = render(RoomList);

    const link = q(container, '[href="https://chat.example.test/admin"]') as HTMLAnchorElement;
    await expect.element(link).toBeInTheDocument();
    expect(link.getAttribute('target')).toBeNull();
    expect(link.getAttribute('rel')).toBeNull();
  });

  it('renders external sidebar links as new-tab anchors', async () => {
    mocks.store.rooms.roomGroups = [
      {
        id: 'g1',
        name: 'Links',
        roomIds: [],
        items: [
          {
            id: 'link:external',
            type: 'link',
            link: {
              id: 'external',
              label: 'External Docs',
              url: 'https://docs.example.test'
            }
          }
        ]
      }
    ];

    const { container } = render(RoomList);

    const link = q(container, '[href="https://docs.example.test/"]') as HTMLAnchorElement;
    await expect.element(link).toBeInTheDocument();
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('resolves a stale channel badge through the room-scoped notification query', async () => {
    setRoomNotificationCount('channel-1', 1);
    const roomNotification = notification('mention-1', 'channel-1');
    mocks.store.notifications.resolveRoomNotification.mockResolvedValue({
      ok: true,
      totalCount: 1,
      notification: roomNotification
    });
    mocks.store.notifications.getCleanPath.mockReturnValue('/chat/-/channel-1/thread-1');
    mocks.store.notifications.dismiss.mockResolvedValue(true);
    mocks.store.notifications.dismissById.mockResolvedValue(true);

    const { container } = render(RoomList);

    const badge = q(container, '[data-testid="room-notification-badge"]');
    await expect.element(badge).toBeInTheDocument();
    (badge?.closest('button') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(mocks.store.notifications.resolveRoomNotification).toHaveBeenCalledWith('channel-1', {
        isDM: false
      });
      expect(mocks.store.pendingHighlights.set).toHaveBeenCalledWith(
        'channel-1',
        'thread-1',
        'event-1'
      );
      expect(mocks.appUi.selectRoomPrimarySurface).toHaveBeenCalledWith(
        'origin',
        'channel-1',
        'messages'
      );
      expect(mocks.appUi.selectRoomPrimarySurface.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.goto.mock.invocationCallOrder[0]
      );
      expect(mocks.store.rooms.decrementUnreadNotification).toHaveBeenCalledWith('channel-1');
      expect(mocks.store.notifications.dismissById).toHaveBeenCalledWith('mention-1');
      expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
      expect(mocks.goto).toHaveBeenCalledWith('/chat/-/channel-1/thread-1');
    });
  });

  it('resolves a stale DM badge through the room-scoped notification query', async () => {
    setRoomNotificationCount('dm-with-participants', 1);
    const dmNotification = notification('dm-1', 'dm-with-participants', true);
    mocks.store.notifications.resolveRoomNotification.mockResolvedValue({
      ok: true,
      totalCount: 1,
      notification: dmNotification
    });
    mocks.store.notifications.getCleanPath.mockReturnValue('/chat/-/dm-with-participants');
    mocks.store.notifications.dismiss.mockResolvedValue(true);
    mocks.store.notifications.dismissById.mockResolvedValue(true);

    const { container } = render(RoomList);

    const badge = q(container, '[data-testid="dm-notification-badge"]');
    await expect.element(badge).toBeInTheDocument();
    (badge?.closest('button') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(mocks.store.notifications.resolveRoomNotification).toHaveBeenCalledWith(
        'dm-with-participants',
        { isDM: true }
      );
      expect(mocks.store.rooms.decrementUnreadNotification).toHaveBeenCalledWith(
        'dm-with-participants'
      );
      expect(mocks.appUi.selectRoomPrimarySurface).toHaveBeenCalledWith(
        'origin',
        'dm-with-participants',
        'messages'
      );
      expect(mocks.appUi.selectRoomPrimarySurface.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.goto.mock.invocationCallOrder[0]
      );
      expect(mocks.store.notifications.dismissById).toHaveBeenCalledWith('dm-1');
      expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalledOnce();
      expect(mocks.goto).toHaveBeenCalledWith('/chat/-/dm-with-participants');
    });
  });

  it('clears a stale room badge when the room-scoped query returns no notifications', async () => {
    setRoomNotificationCount('channel-1', 1);
    mocks.store.notifications.resolveRoomNotification.mockResolvedValue({
      ok: true,
      totalCount: 0,
      notification: null
    });

    const { container } = render(RoomList);

    const badge = q(container, '[data-testid="room-notification-badge"]');
    await expect.element(badge).toBeInTheDocument();
    (badge?.closest('button') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(mocks.store.notifications.resolveRoomNotification).toHaveBeenCalledWith('channel-1', {
        isDM: false
      });
      expect(mocks.store.rooms.clearUnreadNotifications).toHaveBeenCalledWith('channel-1');
      expect(mocks.goto).not.toHaveBeenCalled();
      expect(mocks.store.notifications.dismissById).not.toHaveBeenCalled();
    });
  });
});
