import { beforeEach, describe, expect, it, vi } from 'vitest';

const translations = vi.hoisted(() => ({
  directMessage: vi.fn(({ actor }: { actor: string }) => `dm:${actor}`),
  directMessageUnknown: vi.fn(() => 'dm:unknown'),
  mention: vi.fn(({ actor }: { actor: string }) => `mention:${actor}`),
  mentionUnknown: vi.fn(() => 'mention:unknown'),
  reply: vi.fn(({ actor }: { actor: string }) => `reply:${actor}`),
  replyUnknown: vi.fn(() => 'reply:unknown'),
  roomMessage: vi.fn(({ actor }: { actor: string }) => `room:${actor}`),
  roomMessageUnknown: vi.fn(() => 'room:unknown'),
  callStarted: vi.fn(({ actor }: { actor: string }) => `call:${actor}`),
  callStartedUnknown: vi.fn(() => 'call:unknown'),
  privateCallStarted: vi.fn(({ actor }: { actor: string }) => `private-call:${actor}`),
  privateCallStartedUnknown: vi.fn(() => 'private-call:unknown'),
  locationInServer: vi.fn(
    ({ room, server }: { room: string; server: string }) => `location:${room}:${server}`
  )
}));

vi.mock('$lib/i18n/messages', () => ({
  'chat.notifications.direct_message': translations.directMessage,
  'chat.notifications.direct_message_unknown': translations.directMessageUnknown,
  'chat.notifications.mention': translations.mention,
  'chat.notifications.mention_unknown': translations.mentionUnknown,
  'chat.notifications.reply': translations.reply,
  'chat.notifications.reply_unknown': translations.replyUnknown,
  'chat.notifications.room_message': translations.roomMessage,
  'chat.notifications.room_message_unknown': translations.roomMessageUnknown,
  'chat.notifications.call_started': translations.callStarted,
  'chat.notifications.call_started_unknown': translations.callStartedUnknown,
  'chat.notifications.private_call_started': translations.privateCallStarted,
  'chat.notifications.private_call_started_unknown': translations.privateCallStartedUnknown,
  'chat.notifications.location_in_server': translations.locationInServer
}));

import {
  NotificationCopyKind,
  notificationLocation,
  notificationSummary
} from './notificationCopy';

describe('notificationSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [NotificationCopyKind.DirectMessage, 'dm:Alice', 'dm:unknown'],
    [NotificationCopyKind.Mention, 'mention:Alice', 'mention:unknown'],
    [NotificationCopyKind.Reply, 'reply:Alice', 'reply:unknown'],
    [NotificationCopyKind.RoomMessage, 'room:Alice', 'room:unknown']
  ] as const)('localizes %s with and without an actor', (kind, actorCopy, unknownCopy) => {
    expect(notificationSummary('Alice', kind)).toBe(actorCopy);
    expect(notificationSummary(null, kind)).toBe(unknownCopy);
  });

  it('uses distinct public and private call copy', () => {
    expect(notificationSummary('Alice', NotificationCopyKind.CallStarted)).toBe('call:Alice');
    expect(notificationSummary(null, NotificationCopyKind.CallStarted)).toBe('call:unknown');
    expect(notificationSummary('Alice', NotificationCopyKind.CallStarted, true)).toBe(
      'private-call:Alice'
    );
    expect(notificationSummary(null, NotificationCopyKind.CallStarted, true)).toBe(
      'private-call:unknown'
    );
  });
});

describe('notificationLocation', () => {
  it('returns null when the room is unknown or represents a DM', () => {
    expect(notificationLocation(null, 'Towk')).toBeNull();
    expect(notificationLocation('', 'Towk')).toBeNull();
  });

  it('keeps the room marker when no server name is available', () => {
    expect(notificationLocation('general')).toBe('#general');
  });

  it('localizes the relation between room and server', () => {
    expect(notificationLocation('general', 'Towk')).toBe('location:general:Towk');
    expect(translations.locationInServer).toHaveBeenCalledWith({
      room: 'general',
      server: 'Towk'
    });
  });
});
