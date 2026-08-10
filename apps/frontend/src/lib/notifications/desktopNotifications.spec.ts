import { describe, expect, it } from 'vitest';
import {
  NotificationItemKind,
  type CallStartedNotificationItem,
  type DirectMessageNotificationItem
} from '$lib/api-client/notifications';
import { PresenceStatus } from '$lib/render/types';
import {
  desktopNotificationPayload,
  nativeDesktopNotificationId,
  parseNativeDesktopNotificationId
} from './desktopNotifications';

const actor = {
  id: 'user-1',
  login: 'alice',
  displayName: 'Alice',
  deleted: false,
  presenceStatus: PresenceStatus.Online
};

const messageNotification: DirectMessageNotificationItem = {
  kind: NotificationItemKind.DirectMessage,
  id: 'notification-1',
  createdAt: '2026-08-10T00:00:00.000Z',
  actor,
  summary: 'Alice sent you a message',
  room: { id: 'room-1' },
  eventId: 'event-1'
};

const callNotification: CallStartedNotificationItem = {
  kind: NotificationItemKind.CallStarted,
  id: 'notification-2',
  createdAt: '2026-08-10T00:00:00.000Z',
  actor,
  summary: 'Alice started a call',
  callRoom: { id: 'room-2', name: 'General' },
  callEventId: 'event-2',
  callId: 'call-1',
  isPrivate: false
};

describe('desktop notification bridge', () => {
  it('round-trips scoped notification identifiers', () => {
    const nativeId = nativeDesktopNotificationId('chat-example-org', 'notification-1');
    expect(nativeId).toBe('chat-example-org:notification-1');
    expect(parseNativeDesktopNotificationId(nativeId!)).toEqual({
      serverId: 'chat-example-org',
      notificationId: 'notification-1'
    });
  });

  it('maps message and call notifications to same-origin resident payloads', () => {
    expect(
      desktopNotificationPayload(
        'chat-example-org',
        'https://chat.example.org',
        '/chat/chat-example-org/room-1',
        messageNotification,
        true
      )
    ).toMatchObject({
      notificationId: 'chat-example-org:notification-1',
      title: 'Alice',
      kind: 'message',
      silent: true,
      url: 'https://chat.example.org/chat/chat-example-org/room-1'
    });

    expect(
      desktopNotificationPayload(
        'chat-example-org',
        'https://chat.example.org',
        '/chat/chat-example-org/room-2',
        callNotification,
        false
      )
    ).toMatchObject({ kind: 'call', silent: false });
  });

  it('rejects unsafe identifiers and cross-origin activation URLs', () => {
    expect(nativeDesktopNotificationId('unsafe:server', 'notification-1')).toBeNull();
    expect(parseNativeDesktopNotificationId('missing-separator')).toBeNull();
    expect(
      desktopNotificationPayload(
        'chat-example-org',
        'https://chat.example.org',
        'https://attacker.example/room-1',
        messageNotification,
        false
      )
    ).toBeNull();
  });
});
