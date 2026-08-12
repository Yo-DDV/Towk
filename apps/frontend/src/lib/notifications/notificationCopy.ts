import * as m from '$lib/i18n/messages';

export const NotificationCopyKind = {
  DirectMessage: 'directMessage',
  Mention: 'mention',
  Reply: 'reply',
  RoomMessage: 'roomMessage',
  CallStarted: 'callStarted'
} as const;

export type NotificationCopyKind = (typeof NotificationCopyKind)[keyof typeof NotificationCopyKind];

export function notificationSummary(
  actorName: string | null | undefined,
  kind: NotificationCopyKind,
  isPrivate = false,
  isMissed = false
): string {
  switch (kind) {
    case NotificationCopyKind.DirectMessage:
      return actorName
        ? m['chat.notifications.direct_message']({ actor: actorName })
        : m['chat.notifications.direct_message_unknown']();
    case NotificationCopyKind.Mention:
      return actorName
        ? m['chat.notifications.mention']({ actor: actorName })
        : m['chat.notifications.mention_unknown']();
    case NotificationCopyKind.Reply:
      return actorName
        ? m['chat.notifications.reply']({ actor: actorName })
        : m['chat.notifications.reply_unknown']();
    case NotificationCopyKind.RoomMessage:
      return actorName
        ? m['chat.notifications.room_message']({ actor: actorName })
        : m['chat.notifications.room_message_unknown']();
    case NotificationCopyKind.CallStarted:
      if (isMissed) {
        if (isPrivate) {
          return actorName
            ? m['chat.notifications.private_call_missed']({ actor: actorName })
            : m['chat.notifications.private_call_missed_unknown']();
        }
        return actorName
          ? m['chat.notifications.call_missed']({ actor: actorName })
          : m['chat.notifications.call_missed_unknown']();
      }
      if (isPrivate) {
        return actorName
          ? m['chat.notifications.private_call_started']({ actor: actorName })
          : m['chat.notifications.private_call_started_unknown']();
      }
      return actorName
        ? m['chat.notifications.call_started']({ actor: actorName })
        : m['chat.notifications.call_started_unknown']();
  }
}

export function notificationLocation(
  roomName: string | null | undefined,
  serverName?: string | null
): string | null {
  if (!roomName) return null;
  if (!serverName) return `#${roomName}`;
  return m['chat.notifications.location_in_server']({ room: roomName, server: serverName });
}
