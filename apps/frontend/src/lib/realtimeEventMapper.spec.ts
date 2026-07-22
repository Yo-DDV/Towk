import { timestampFromDate, timestampNow } from '@bufbuild/protobuf/wkt';
import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { realtimeEventToEventEnvelope } from '$lib/realtimeEventMapper';
import { RoomEventKind } from '$lib/render/eventKinds';

import {
  RealtimeCallEventSchema,
  RealtimeCallParticipantConnectionState,
  RealtimeEventEnvelopeSchema,
  RealtimeMentionNotificationEventSchema,
  RealtimeNewDirectMessageNotificationEventSchema,
  RealtimeNotificationCreatedEventSchema
} from '@towk/api-types/realtime/v1/realtime_pb';

describe('realtimeEventToEventEnvelope', () => {
  it('preserves the exact call connection on participant transitions', () => {
    const event = realtimeEventToEventEnvelope(
      create(RealtimeEventEnvelopeSchema, {
        id: 'evt-call-left',
        createdAt: timestampNow(),
        actorId: 'user-1',
        event: {
          case: 'callParticipantLeft',
          value: create(RealtimeCallEventSchema, {
            roomId: 'room-1',
            callId: 'call-1',
            participantId: 'device-2',
            deviceIndex: 2
          })
        }
      })
    ) as unknown as {
      event: {
        kind: string;
        roomId: string;
        callId: string;
        participantId: string;
        deviceIndex: number;
      };
    };

    expect(event.event).toEqual({
      kind: RoomEventKind.CallParticipantLeft,
      roomId: 'room-1',
      callId: 'call-1',
      participantId: 'device-2',
      deviceIndex: 2
    });
  });

  it('maps an interrupted call connection with its recovery deadline', () => {
    const deadline = timestampFromDate(new Date('2026-01-01T00:01:00.000Z'));
    const event = realtimeEventToEventEnvelope(
      create(RealtimeEventEnvelopeSchema, {
        id: 'evt-call-interrupted',
        createdAt: timestampNow(),
        actorId: 'user-1',
        event: {
          case: 'callParticipantConnectionChanged',
          value: create(RealtimeCallEventSchema, {
            roomId: 'room-1',
            callId: 'call-1',
            participantId: 'device-2',
            deviceIndex: 2,
            connectionState: RealtimeCallParticipantConnectionState.INTERRUPTED,
            interruptionDeadline: deadline
          })
        }
      })
    ) as unknown as {
      event: {
        kind: string;
        roomId: string;
        callId: string;
        participantId: string;
        deviceIndex: number;
        connectionState: string;
        interruptionDeadline: string | null;
      };
    };

    expect(event.event).toEqual({
      kind: RoomEventKind.CallParticipantConnectionChanged,
      roomId: 'room-1',
      callId: 'call-1',
      participantId: 'device-2',
      deviceIndex: 2,
      connectionState: 'interrupted',
      interruptionDeadline: '2026-01-01T00:01:00.000Z'
    });
  });

  it('preserves mention notification display data', () => {
    const event = realtimeEventToEventEnvelope(
      create(RealtimeEventEnvelopeSchema, {
        id: 'evt-mention',
        createdAt: timestampNow(),
        actorId: 'user-1',
        event: {
          case: 'mentionNotification',
          value: create(RealtimeMentionNotificationEventSchema, {
            roomId: 'room-1',
            actorUserId: 'user-1',
            roomName: 'General',
            actorDisplayName: 'Ada Lovelace'
          })
        }
      })
    ) as unknown as {
      event: {
        kind: string;
        room: { name: string };
        actor: { id: string; displayName: string } | null;
      };
    };

    expect(event.event.kind).toBe(RoomEventKind.MentionNotification);
    expect(event.event.room.name).toBe('General');
    expect(event.event.actor).toEqual({
      id: 'user-1',
      displayName: 'Ada Lovelace'
    });
  });

  it('preserves DM notification display data', () => {
    const event = realtimeEventToEventEnvelope(
      create(RealtimeEventEnvelopeSchema, {
        id: 'evt-dm',
        createdAt: timestampNow(),
        actorId: 'user-2',
        event: {
          case: 'newDirectMessageNotification',
          value: create(RealtimeNewDirectMessageNotificationEventSchema, {
            roomId: 'dm-1',
            senderId: 'user-2',
            senderDisplayName: 'Grace Hopper',
            senderAvatarUrl: '/assets/avatar.png',
            conversationName: 'Grace Hopper'
          })
        }
      })
    ) as unknown as {
      event: {
        kind: string;
        conversationName: string;
        sender: { id: string; displayName: string; avatarUrl: string | null } | null;
      };
    };

    expect(event.event.kind).toBe(RoomEventKind.NewDirectMessageNotification);
    expect(event.event.conversationName).toBe('Grace Hopper');
    expect(event.event.sender).toEqual({
      id: 'user-2',
      displayName: 'Grace Hopper',
      avatarUrl: '/assets/avatar.png'
    });
  });

  it('preserves per-client notification-center suppression', () => {
    const event = realtimeEventToEventEnvelope(
      create(RealtimeEventEnvelopeSchema, {
        id: 'evt-notification-created',
        createdAt: timestampNow(),
        event: {
          case: 'notificationCreated',
          value: create(RealtimeNotificationCreatedEventSchema, {
            notificationId: 'notification-1',
            roomId: 'room-1',
            notificationCenterSuppressed: true
          })
        }
      })
    ) as unknown as {
      event: {
        kind: string;
        notificationId: string;
        notificationCenterSuppressed: boolean;
      };
    };

    expect(event.event).toMatchObject({
      kind: RoomEventKind.NotificationCreated,
      notificationId: 'notification-1',
      notificationCenterSuppressed: true
    });
  });
});
