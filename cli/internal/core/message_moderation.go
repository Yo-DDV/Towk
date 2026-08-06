package core

import (
	"context"
	"strings"
)

// DeleteMessageWithModeration retracts a message while separating the author's
// ordinary delete path from delegated moderation. Non-authors require the
// narrow message.delete-others permission or the broad legacy message.manage
// permission. Effective owners are never valid delegated moderation targets.
func (c *ChattoCore) DeleteMessageWithModeration(ctx context.Context, input MessageDeleteInput) error {
	room, kind, err := c.requireRoomMember(ctx, input.ActorID, input.RoomID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(input.EventID) == "" {
		return invalidArgument("event_id is required")
	}
	event, err := c.GetRoomEventByEventID(ctx, kind, room.Id, input.EventID)
	if err != nil {
		return err
	}
	if event == nil || event.GetMessagePosted() == nil {
		return ErrMessageNotFound
	}
	authorID, err := c.GetMessageAuthorID(ctx, kind, input.EventID)
	if err != nil {
		return err
	}
	if authorID != "" && authorID != input.ActorID {
		authorIsOwner, err := c.IsServerOwner(ctx, authorID)
		if err != nil {
			return err
		}
		if authorIsOwner {
			return ErrPermissionDenied
		}
		canDelete, err := c.CanDeleteOthersMessage(ctx, input.ActorID, kind, room.Id)
		if err != nil {
			return err
		}
		if !canDelete {
			return ErrPermissionDenied
		}
	}
	return c.DeleteMessage(ctx, input.ActorID, kind, room.Id, input.EventID)
}
