package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const (
	roomHistoryPurgeKeyPrefix = "room_history_purge."
	roomHistoryPurgeScanEvery = time.Second
)

type RoomHistoryPurgeStatus string

const (
	RoomHistoryPurgeRunning   RoomHistoryPurgeStatus = "running"
	RoomHistoryPurgeCompleted RoomHistoryPurgeStatus = "completed"
	RoomHistoryPurgeFailed    RoomHistoryPurgeStatus = "failed"
)

type RoomHistoryPurgeOperation struct {
	ID           string
	RoomID       string
	HistoryEpoch uint64
	Status       RoomHistoryPurgeStatus
	FailureCode  string
}

type roomHistoryPurgeState struct {
	Version      int                    `json:"version"`
	ID           string                 `json:"id"`
	RoomID       string                 `json:"room_id"`
	ActorID      string                 `json:"actor_id"`
	HistoryEpoch uint64                 `json:"history_epoch"`
	BarrierSeq   uint64                 `json:"barrier_seq"`
	Status       RoomHistoryPurgeStatus `json:"status"`
	FailureCode  string                 `json:"failure_code,omitempty"`
	StartedAt    time.Time              `json:"started_at"`
	CompletedAt  *time.Time             `json:"completed_at,omitempty"`
}

func (s roomHistoryPurgeState) operation() *RoomHistoryPurgeOperation {
	return &RoomHistoryPurgeOperation{
		ID:           s.ID,
		RoomID:       s.RoomID,
		HistoryEpoch: s.HistoryEpoch,
		Status:       s.Status,
		FailureCode:  s.FailureCode,
	}
}

func roomHistoryPurgeKey(operationID string) string {
	return roomHistoryPurgeKeyPrefix + operationID
}

func (c *ChattoCore) StartRoomHistoryPurge(
	ctx context.Context,
	input RoomHistoryPurgeInput,
) (*corev1.Room, *RoomHistoryPurgeOperation, error) {
	if input.ExpectedRevision == 0 {
		return nil, nil, invalidArgument("expected room revision is required")
	}
	room, err := c.GetRoom(ctx, KindChannel, input.RoomID)
	if err != nil {
		return nil, nil, err
	}
	if input.ConfirmationName != room.GetName() {
		return nil, nil, ErrRoomHistoryNameMismatch
	}

	state := roomHistoryPurgeState{
		Version:      1,
		ID:           NewRoomHistoryPurgeOperationID(),
		RoomID:       input.RoomID,
		ActorID:      input.ActorID,
		HistoryEpoch: room.GetHistoryEpoch() + 1,
		Status:       RoomHistoryPurgeRunning,
		StartedAt:    time.Now().UTC(),
	}

	err = c.withRoomPurgeLease(ctx, input.RoomID, func(operationCtx context.Context) error {
		running, err := c.runningRoomHistoryPurge(operationCtx, input.RoomID)
		if err != nil {
			return err
		}
		if running != nil {
			return ErrRoomHistoryPurgeInProgress
		}
		if err := c.putRoomHistoryPurgeState(operationCtx, state, true); err != nil {
			return err
		}

		event := newEvent(input.ActorID, &corev1.Event{
			Event: &corev1.Event_RoomHistoryPurged{
				RoomHistoryPurged: &corev1.RoomHistoryPurgedEvent{
					RoomId:       input.RoomID,
					HistoryEpoch: state.HistoryEpoch,
					OperationId:  state.ID,
				},
			},
		})
		aggregate := events.RoomAggregate(input.RoomID)
		subject := aggregate.SubjectFor(event)
		seq, err := c.EventPublisher.AppendAtFilter(
			operationCtx,
			subject,
			event,
			aggregate.AllEventsFilter(),
			input.ExpectedRevision,
		)
		if err != nil {
			_ = c.storage.runtimeStateKV.Purge(operationCtx, roomHistoryPurgeKey(state.ID))
			if errors.Is(err, events.ErrConflict) {
				return events.ErrConflict
			}
			return fmt.Errorf("publish room history barrier: %w", err)
		}
		state.BarrierSeq = seq
		if err := c.putRoomHistoryPurgeState(operationCtx, state, false); err != nil {
			return err
		}
		if err := c.rooms().waitForDirectoryAndTimeline(operationCtx, events.SubjectPosition(subject, seq)); err != nil {
			return err
		}
		c.DismissRoomNotificationsForAllUsers(operationCtx, input.RoomID)
		if err := c.ReadReceipts().DeleteRoomCursors(operationCtx, input.RoomID); err != nil {
			c.logger.Warn("Failed to clear room read cursors at history barrier", "room_id", input.RoomID, "error", err)
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	room, err = c.GetRoom(ctx, KindChannel, input.RoomID)
	if err != nil {
		return nil, nil, err
	}
	return room, state.operation(), nil
}

func (c *ChattoCore) GetRoomHistoryPurgeOperation(ctx context.Context, operationID string) (*RoomHistoryPurgeOperation, string, error) {
	state, err := c.getRoomHistoryPurgeState(ctx, operationID)
	if err != nil {
		return nil, "", err
	}
	return state.operation(), state.ActorID, nil
}

func (c *ChattoCore) getRoomHistoryPurgeState(ctx context.Context, operationID string) (roomHistoryPurgeState, error) {
	if strings.TrimSpace(operationID) == "" {
		return roomHistoryPurgeState{}, invalidArgument("operation id is required")
	}
	entry, err := c.storage.runtimeStateKV.Get(ctx, roomHistoryPurgeKey(operationID))
	if isRuntimeStateKeyAbsent(err) {
		return roomHistoryPurgeState{}, ErrRoomHistoryPurgeNotFound
	}
	if err != nil {
		return roomHistoryPurgeState{}, fmt.Errorf("read room history purge operation: %w", err)
	}
	var state roomHistoryPurgeState
	if err := json.Unmarshal(entry.Value(), &state); err != nil {
		return roomHistoryPurgeState{}, fmt.Errorf("decode room history purge operation: %w", err)
	}
	if state.Version != 1 || state.ID != operationID || state.RoomID == "" {
		return roomHistoryPurgeState{}, fmt.Errorf("invalid room history purge operation")
	}
	return state, nil
}

func (c *ChattoCore) putRoomHistoryPurgeState(ctx context.Context, state roomHistoryPurgeState, create bool) error {
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode room history purge operation: %w", err)
	}
	key := roomHistoryPurgeKey(state.ID)
	if create {
		if _, err := c.storage.runtimeStateKV.Create(ctx, key, data); err != nil {
			return fmt.Errorf("create room history purge operation: %w", err)
		}
		return nil
	}
	if _, err := c.storage.runtimeStateKV.Put(ctx, key, data); err != nil {
		return fmt.Errorf("update room history purge operation: %w", err)
	}
	return nil
}

func (c *ChattoCore) runningRoomHistoryPurge(ctx context.Context, roomID string) (*roomHistoryPurgeState, error) {
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, roomHistoryPurgeKeyPrefix+"*")
	if err != nil {
		return nil, fmt.Errorf("list room history purge operations: %w", err)
	}
	for key := range lister.Keys() {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		var state roomHistoryPurgeState
		if json.Unmarshal(entry.Value(), &state) != nil {
			continue
		}
		if state.RoomID == roomID && state.Status == RoomHistoryPurgeRunning {
			return &state, nil
		}
	}
	return nil, nil
}

func (c *ChattoCore) runRoomHistoryPurgeWorker(ctx context.Context) error {
	ticker := time.NewTicker(roomHistoryPurgeScanEvery)
	defer ticker.Stop()
	for {
		if err := c.processPendingRoomHistoryPurges(ctx); err != nil && !errors.Is(err, context.Canceled) {
			c.logger.Error("Room history purge worker pass failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (c *ChattoCore) processPendingRoomHistoryPurges(ctx context.Context) error {
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, roomHistoryPurgeKeyPrefix+"*")
	if err != nil {
		return err
	}
	for key := range lister.Keys() {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			continue
		}
		if err != nil {
			return err
		}
		var state roomHistoryPurgeState
		if err := json.Unmarshal(entry.Value(), &state); err != nil {
			c.logger.Error("Skipped invalid room history purge state", "key", key, "error", err)
			continue
		}
		if state.Status != RoomHistoryPurgeRunning {
			continue
		}
		if err := c.processRoomHistoryPurge(ctx, state.ID); err != nil {
			c.logger.Error("Room history purge cleanup failed", "operation_id", state.ID, "room_id", state.RoomID, "error", err)
		}
	}
	return nil
}

func (c *ChattoCore) processRoomHistoryPurge(ctx context.Context, operationID string) error {
	state, err := c.getRoomHistoryPurgeState(ctx, operationID)
	if err != nil {
		return err
	}
	if state.Status != RoomHistoryPurgeRunning {
		return nil
	}
	if state.BarrierSeq == 0 {
		return c.failRoomHistoryPurge(ctx, state, "barrier_missing")
	}

	operationErr := c.withRoomPurgeLease(ctx, state.RoomID, func(operationCtx context.Context) error {
		current, err := c.getRoomHistoryPurgeState(operationCtx, operationID)
		if err != nil {
			return err
		}
		if current.Status != RoomHistoryPurgeRunning {
			return nil
		}
		if err := c.cleanupRoomHistoryThrough(operationCtx, current); err != nil {
			return err
		}
		now := time.Now().UTC()
		current.Status = RoomHistoryPurgeCompleted
		current.FailureCode = ""
		current.CompletedAt = &now
		return c.putRoomHistoryPurgeState(operationCtx, current, false)
	})
	if operationErr != nil {
		_ = c.failRoomHistoryPurge(ctx, state, "cleanup_failed")
		return operationErr
	}
	return nil
}

func (c *ChattoCore) failRoomHistoryPurge(ctx context.Context, state roomHistoryPurgeState, failureCode string) error {
	state.Status = RoomHistoryPurgeFailed
	state.FailureCode = failureCode
	return c.putRoomHistoryPurgeState(ctx, state, false)
}

func (c *ChattoCore) cleanupRoomHistoryThrough(ctx context.Context, state roomHistoryPurgeState) error {
	aggregate := events.RoomAggregate(state.RoomID)
	subjectEvents, _, err := c.EventPublisher.SubjectEventsWithSubjectsAfter(ctx, aggregate.AllEventsFilter(), 0)
	if err != nil {
		return fmt.Errorf("read channel history cleanup snapshot: %w", err)
	}

	references := newRoomPurgeReferences()
	keepSequences := make(map[uint64]struct{})
	postBarrierPreviewIDs := make(map[string]struct{})
	for _, subjectEvent := range subjectEvents {
		if subjectEvent == nil || subjectEvent.Event == nil {
			continue
		}
		event := subjectEvent.Event
		if subjectEvent.StreamSeq > state.BarrierSeq {
			if bodyEvent := event.GetMessageBody(); bodyEvent != nil {
				body := bodyEvent.GetBody()
				if body != nil && body.GetLinkPreview() != nil {
					assetID := body.GetLinkPreview().GetImageAssetId()
					if assetID == "" && body.GetLinkPreview().GetImageAsset() != nil {
						assetID = body.GetLinkPreview().GetImageAsset().GetId()
					}
					if assetID != "" {
						postBarrierPreviewIDs[assetID] = struct{}{}
					}
				}
			}
			continue
		}
		if !isMessageOwnedRoomEvent(event) {
			keepSequences[subjectEvent.StreamSeq] = struct{}{}
			continue
		}
		if event.GetMessagePosted() != nil && event.GetId() != "" {
			references.messageEventIDs[event.GetId()] = struct{}{}
		}
		if bodyEvent := event.GetMessageBody(); bodyEvent != nil {
			references.mergeBody(bodyEvent.GetBody())
		}
	}
	if _, ok := keepSequences[state.BarrierSeq]; !ok {
		return fmt.Errorf("room history purge barrier is not present")
	}
	for assetID := range postBarrierPreviewIDs {
		delete(references.linkPreviewIDs, assetID)
	}
	for assetID := range references.assetIDs {
		subtree := c.Assets.AssetSubtreeIDs(assetID)
		if len(subtree) == 0 {
			subtree = []string{assetID}
		}
		for _, descendantID := range subtree {
			references.assetIDs[descendantID] = struct{}{}
			references.provenAssetIDs[descendantID] = struct{}{}
		}
	}

	if _, _, err := c.purgeSelectedRoomAssets(ctx, state.ActorID, state.RoomID, references); err != nil {
		return err
	}
	if _, err := c.purgeRoomLinkPreviewAssets(ctx, state.RoomID, references); err != nil {
		return err
	}
	if _, err := c.EventPublisher.SecureDeleteAggregateThroughExcept(
		ctx,
		aggregate,
		state.BarrierSeq,
		keepSequences,
	); err != nil {
		return fmt.Errorf("secure-delete channel message history: %w", err)
	}
	return nil
}
