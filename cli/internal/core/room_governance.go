package core

import (
	"context"
	"errors"
	"fmt"

	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

var (
	ErrRoomLocked                 = errors.New("room is locked")
	ErrRoomHistoryNameMismatch    = errors.New("room history purge confirmation does not match")
	ErrRoomHistoryPurgeNotFound   = errors.New("room history purge operation not found")
	ErrRoomHistoryPurgeInProgress = errors.New("room history purge is already in progress")
)

func effectiveRoomPostingPolicy(room *corev1.Room) corev1.RoomPostingPolicy {
	if room != nil && room.GetPostingPolicy() == corev1.RoomPostingPolicy_ROOM_POSTING_POLICY_LOCKED {
		return corev1.RoomPostingPolicy_ROOM_POSTING_POLICY_LOCKED
	}
	return corev1.RoomPostingPolicy_ROOM_POSTING_POLICY_OPEN
}

func (c *ChattoCore) SetRoomPostingPolicy(
	ctx context.Context,
	actorID string,
	roomID string,
	policy corev1.RoomPostingPolicy,
	expectedRevision uint64,
) (*corev1.Room, error) {
	if actorID == "" {
		return nil, ErrNotAuthenticated
	}
	if expectedRevision == 0 {
		return nil, invalidArgument("expected room revision is required")
	}
	if policy != corev1.RoomPostingPolicy_ROOM_POSTING_POLICY_OPEN &&
		policy != corev1.RoomPostingPolicy_ROOM_POSTING_POLICY_LOCKED {
		return nil, invalidArgument("posting policy must be OPEN or LOCKED")
	}
	room, err := c.GetRoom(ctx, KindChannel, roomID)
	if err != nil {
		return nil, err
	}
	if effectiveRoomPostingPolicy(room) == policy {
		return room, nil
	}

	event := newEvent(actorID, &corev1.Event{
		Event: &corev1.Event_RoomPostingPolicyChanged{
			RoomPostingPolicyChanged: &corev1.RoomPostingPolicyChangedEvent{
				RoomId:         roomID,
				PreviousPolicy: effectiveRoomPostingPolicy(room),
				PostingPolicy:  policy,
			},
		},
	})
	aggregate := events.RoomAggregate(roomID)
	subject := aggregate.SubjectFor(event)
	seq, err := c.EventPublisher.AppendAtFilter(
		ctx,
		subject,
		event,
		aggregate.AllEventsFilter(),
		expectedRevision,
	)
	if err != nil {
		if errors.Is(err, events.ErrConflict) {
			return nil, events.ErrConflict
		}
		return nil, fmt.Errorf("publish room posting policy: %w", err)
	}
	if err := c.rooms().waitForDirectoryAndTimeline(ctx, events.SubjectPosition(subject, seq)); err != nil {
		return nil, err
	}
	return c.GetRoom(ctx, KindChannel, roomID)
}

// CanAddContentToRoom applies the durable posting policy after ordinary RBAC.
// DMs never participate in channel locking.
func (c *ChattoCore) CanAddContentToRoom(ctx context.Context, actorID string, kind RoomKind, roomID string) (bool, error) {
	if kind == KindDM {
		return true, nil
	}
	room, err := c.GetRoom(ctx, kind, roomID)
	if err != nil {
		return false, err
	}
	if effectiveRoomPostingPolicy(room) != corev1.RoomPostingPolicy_ROOM_POSTING_POLICY_LOCKED {
		return true, nil
	}
	return c.CanBypassRoomLock(ctx, actorID, roomID)
}

func (c *ChattoCore) requireRoomAcceptsAdditiveContent(ctx context.Context, actorID string, kind RoomKind, roomID string) error {
	allowed, err := c.CanAddContentToRoom(ctx, actorID, kind, roomID)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrRoomLocked
	}
	return nil
}

func isMessageOwnedRoomEvent(event *corev1.Event) bool {
	if event == nil {
		return false
	}
	switch event.GetEvent().(type) {
	case *corev1.Event_MessagePosted,
		*corev1.Event_MessageEdited,
		*corev1.Event_MessageRetracted,
		*corev1.Event_MessageBody,
		*corev1.Event_MessageRequestClaimed,
		*corev1.Event_ThreadCreated,
		*corev1.Event_ThreadFollowed,
		*corev1.Event_ThreadUnfollowed,
		*corev1.Event_ReactionAdded,
		*corev1.Event_ReactionRemoved,
		*corev1.Event_AssetCreated,
		*corev1.Event_AssetProcessingStarted,
		*corev1.Event_AssetProcessingSucceeded,
		*corev1.Event_AssetProcessingFailed,
		*corev1.Event_AssetDeleted:
		return true
	default:
		return false
	}
}
