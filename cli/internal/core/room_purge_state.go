package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/nats-io/nats.go/jetstream"
	"hmans.de/chatto/internal/events"
	"hmans.de/chatto/internal/lease"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"slices"
	"time"
)

func (c *ChattoCore) withRoomPurgeLease(ctx context.Context, roomID string, work func(context.Context) error) error {
	roomLease, err := lease.New(c.js, c.storage.memoryCacheKV, lease.Options{
		Name:       "room-purge-" + roomID,
		Bucket:     "MEMORY_CACHE",
		TTL:        roomPurgeLeaseTTL,
		RenewEvery: roomPurgeLeaseRenewEvery,
		Logger:     c.logger.WithPrefix("core.RoomPurgeLease"),
	})
	if err != nil {
		return fmt.Errorf("initialize room purge lease: %w", err)
	}
	acquired, err := roomLease.TryAcquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire room purge lease: %w", err)
	}
	if !acquired {
		return ErrRoomPurgeInProgress
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := roomLease.Release(releaseCtx); err != nil {
			c.logger.Warn("Failed to release room purge lease", "room_id", roomID, "error", err)
		}
	}()

	operationCtx, cancelOperation := context.WithCancelCause(ctx)
	stopRenew := make(chan struct{})
	renewDone := make(chan error, 1)
	go func() {
		ticker := time.NewTicker(roomPurgeLeaseRenewEvery)
		defer ticker.Stop()
		for {
			select {
			case <-stopRenew:
				renewDone <- nil
				return
			case <-ctx.Done():
				cancelOperation(ctx.Err())
				renewDone <- nil
				return
			case <-ticker.C:
				if err := roomLease.Renew(ctx); err != nil {
					cancelOperation(fmt.Errorf("room purge lease lost: %w", err))
					renewDone <- err
					return
				}
			}
		}
	}()

	workErr := work(operationCtx)
	close(stopRenew)
	renewErr := <-renewDone
	cancelOperation(context.Canceled)
	if renewErr != nil {
		return fmt.Errorf("renew room purge lease: %w", renewErr)
	}
	return workErr
}

func (c *ChattoCore) prepareRoomPurge(ctx context.Context, roomID, confirmation string) (roomPurgeState, uint64, error) {
	key := roomPurgeStateKey(roomID)
	entry, err := c.storage.runtimeStateKV.Get(ctx, key)
	if err == nil {
		state, decodeErr := decodeRoomPurgeState(entry.Value())
		if decodeErr != nil {
			return roomPurgeState{}, 0, decodeErr
		}

		room, roomErr := c.GetRoom(ctx, KindChannel, roomID)
		switch {
		case roomErr == nil:
			if room.GetKind() != corev1.RoomKind_ROOM_KIND_CHANNEL {
				return roomPurgeState{}, 0, invalidArgument("only channel rooms can be permanently deleted")
			}
			if !room.GetArchived() {
				return roomPurgeState{}, 0, ErrRoomPurgeNotArchived
			}
			if room.GetName() != confirmation {
				return roomPurgeState{}, 0, ErrRoomPurgeConfirmationMismatch
			}

			// If a previous attempt stopped before publishing its first
			// RoomDeleted tombstone, the room can still be renamed, moved, or
			// recreated. The current archived room is authoritative in that
			// pre-destructive state, so replace a stale/completed marker instead
			// of allowing its old confirmation digest to deny service forever.
			if state.Status == roomPurgeStatusComplete ||
				!c.roomPurgeConfirmationMatches(state, confirmation) ||
				state.GroupID != room.GetGroupId() {
				restarted, newErr := c.newRoomPurgeState(confirmation, room.GetGroupId())
				if newErr != nil {
					return roomPurgeState{}, 0, newErr
				}
				updatedRevision, updateErr := c.updateRoomPurgeState(ctx, roomID, restarted, entry.Revision())
				return restarted, updatedRevision, updateErr
			}
			return state, entry.Revision(), nil

		case errors.Is(roomErr, jetstream.ErrKeyNotFound):
			// Once the first durable RoomDeleted tombstone has removed the
			// catalog entry, only the original exact confirmation may resume the
			// destructive operation. At this point resetting the marker would
			// make an interrupted purge unrecoverable and weaken authorization.
			if !c.roomPurgeConfirmationMatches(state, confirmation) {
				return roomPurgeState{}, 0, ErrRoomPurgeConfirmationMismatch
			}
			return state, entry.Revision(), nil
		default:
			return roomPurgeState{}, 0, roomErr
		}
	}
	if !isRuntimeStateKeyAbsent(err) {
		return roomPurgeState{}, 0, fmt.Errorf("read room purge state: %w", err)
	}

	room, err := c.GetRoom(ctx, KindChannel, roomID)
	if err != nil {
		return roomPurgeState{}, 0, err
	}
	if room.GetKind() != corev1.RoomKind_ROOM_KIND_CHANNEL {
		return roomPurgeState{}, 0, invalidArgument("only channel rooms can be permanently deleted")
	}
	if !room.GetArchived() {
		return roomPurgeState{}, 0, ErrRoomPurgeNotArchived
	}
	if room.GetName() != confirmation {
		return roomPurgeState{}, 0, ErrRoomPurgeConfirmationMismatch
	}

	state, err := c.newRoomPurgeState(confirmation, room.GetGroupId())
	if err != nil {
		return roomPurgeState{}, 0, err
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		return roomPurgeState{}, 0, fmt.Errorf("encode room purge state: %w", err)
	}
	revision, err := c.storage.runtimeStateKV.Create(ctx, key, encoded)
	if errors.Is(err, jetstream.ErrKeyExists) {
		return c.prepareRoomPurge(ctx, roomID, confirmation)
	}
	if err != nil {
		return roomPurgeState{}, 0, fmt.Errorf("create room purge state: %w", err)
	}
	return state, revision, nil
}

func decodeRoomPurgeState(data []byte) (roomPurgeState, error) {
	var state roomPurgeState
	if err := json.Unmarshal(data, &state); err != nil {
		return roomPurgeState{}, fmt.Errorf("decode room purge state: %w", err)
	}
	if state.Version != roomPurgeStateVersion ||
		(state.Status != roomPurgeStatusInProgress && state.Status != roomPurgeStatusComplete) {
		return roomPurgeState{}, fmt.Errorf("unsupported room purge state")
	}
	return state, nil
}

func (c *ChattoCore) updateRoomPurgeState(ctx context.Context, roomID string, state roomPurgeState, revision uint64) (uint64, error) {
	encoded, err := json.Marshal(state)
	if err != nil {
		return 0, fmt.Errorf("encode room purge state: %w", err)
	}
	updatedRevision, err := c.storage.runtimeStateKV.Update(ctx, roomPurgeStateKey(roomID), encoded, revision)
	if err == nil {
		return updatedRevision, nil
	}
	entry, getErr := c.storage.runtimeStateKV.Get(ctx, roomPurgeStateKey(roomID))
	if getErr == nil {
		current, decodeErr := decodeRoomPurgeState(entry.Value())
		if decodeErr == nil && current.Status == roomPurgeStatusComplete {
			return entry.Revision(), nil
		}
	}
	return 0, fmt.Errorf("update room purge state: %w", err)
}

func (c *ChattoCore) ensureArchivedRoomPurgeTombstone(ctx context.Context, actorID, roomID, confirmation string) (uint64, error) {
	aggregate := events.RoomAggregate(roomID)
	filter := aggregate.AllEventsFilter()
	var lastErr error
	for attempt := 0; attempt < roomPurgeMaxOCCAttempts; attempt++ {
		expectedSeq, err := c.EventPublisher.LastSubjectSeq(ctx, filter)
		if err != nil {
			return 0, fmt.Errorf("read room purge OCC tail: %w", err)
		}
		room, roomErr := c.GetRoom(ctx, KindChannel, roomID)
		if roomErr == nil {
			if !room.GetArchived() {
				return 0, ErrRoomPurgeNotArchived
			}
			if room.GetName() != confirmation {
				return 0, ErrRoomPurgeConfirmationMismatch
			}
		} else if !errors.Is(roomErr, jetstream.ErrKeyNotFound) {
			return 0, roomErr
		} else {
			existing, seq, err := c.EventPublisher.LastSubjectEvent(ctx, aggregate.Subject(events.EventRoomDeleted))
			if err != nil {
				return 0, fmt.Errorf("read existing room purge tombstone: %w", err)
			}
			if existing != nil && existing.GetRoomDeleted().GetRoomId() == roomID {
				return seq, nil
			}
		}

		tombstone := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RoomDeleted{
			RoomDeleted: &corev1.RoomDeletedEvent{RoomId: roomID},
		}})
		subject := aggregate.SubjectFor(tombstone)
		seq, err := c.EventPublisher.AppendAtFilter(ctx, subject, tombstone, filter, expectedSeq)
		if err != nil {
			if errors.Is(err, events.ErrConflict) {
				lastErr = err
				if err := sleepRoomPurge(ctx, time.Duration(1<<attempt)*time.Millisecond); err != nil {
					return 0, err
				}
				continue
			}
			return 0, fmt.Errorf("publish room purge tombstone: %w", err)
		}
		if err := c.rooms().waitForDirectoryAndTimeline(ctx, events.SubjectPosition(subject, seq)); err != nil {
			return 0, err
		}
		return seq, nil
	}
	return 0, fmt.Errorf("publish room purge tombstone after %d attempts: %w", roomPurgeMaxOCCAttempts, lastErr)
}

func (c *ChattoCore) ensureRoomPurgeGroupCascade(ctx context.Context, actorID, roomID, originalGroupID string) error {
	groupIDs := make(map[string]struct{})
	if originalGroupID != "" {
		groupIDs[originalGroupID] = struct{}{}
	}
	for _, group := range c.RoomGroups.All() {
		if group == nil || group.GetId() == "" || !slices.Contains(group.GetRoomIds(), roomID) {
			continue
		}
		groupIDs[group.GetId()] = struct{}{}
	}

	orderedGroupIDs := sortedSetKeys(groupIDs)
	changed := false
	for _, groupID := range orderedGroupIDs {
		if err := events.ValidateSecureDeleteAggregate(events.RBACScopedAggregate(groupID)); err != nil {
			return fmt.Errorf("invalid room purge group id")
		}
		snapshot := c.RoomGroups.Snapshot(groupID)
		if !snapshot.Exists || snapshot.Group == nil || !slices.Contains(snapshot.Group.GetRoomIds(), roomID) {
			continue
		}
		removed := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RoomRemovedFromGroup{
			RoomRemovedFromGroup: &corev1.RoomRemovedFromGroupEvent{
				GroupId: groupID,
				RoomId:  roomID,
			},
		}})
		if _, err := c.rooms().appendGroupLayoutEventually(ctx, c.EventPublisher, events.GroupAggregate(groupID), removed); err != nil {
			return fmt.Errorf("publish room purge group cascade: %w", err)
		}
		changed = true
	}
	if changed {
		c.notifyRoomLayoutChanged(ctx, actorID, "purge_room")
	}
	return nil
}
