package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/nats-io/nats.go/jetstream"
)

const (
	dmHistoryStateVersion      = 1
	maxDMHistoryUpdateRetries  = 5
)

type dmHistoryState struct {
	Version       int    `json:"version"`
	CutoffEventID string `json:"cutoff_event_id,omitempty"`
	Hidden        bool   `json:"hidden"`
}

func dmHistoryStateKey(userID, roomID string) string {
	return fmt.Sprintf("privacy.dm_history.%s.%s", userID, roomID)
}

// ForgetOneToOneDM hides a direct-message conversation for one participant and
// advances that participant's durable history cutoff. The shared room,
// membership set, and event log remain unchanged for the other participant.
func (c *ChattoCore) ForgetOneToOneDM(ctx context.Context, actorID, roomID string) error {
	if err := c.requireOneToOneDMParticipant(ctx, actorID, roomID); err != nil {
		return err
	}

	cutoffEventID := ""
	if entry, ok := c.rooms().lastVisibleRoomEntry(roomID, nil); ok && entry.Event != nil {
		cutoffEventID = entry.Event.GetId()
	}
	if err := c.updateDMHistoryState(ctx, actorID, roomID, func(current dmHistoryState) (dmHistoryState, error) {
		current.Version = dmHistoryStateVersion
		current.Hidden = true
		if cutoffEventID == "" {
			return current, nil
		}
		currentSeq, err := c.dmHistoryEventSequence(roomID, current.CutoffEventID)
		if err != nil {
			return dmHistoryState{}, err
		}
		nextSeq, err := c.dmHistoryEventSequence(roomID, cutoffEventID)
		if err != nil {
			return dmHistoryState{}, err
		}
		if current.CutoffEventID == "" || nextSeq >= currentSeq {
			current.CutoffEventID = cutoffEventID
		}
		return current, nil
	}); err != nil {
		return err
	}

	lastRootID, _, exists, err := c.GetRoomLastEvent(ctx, KindDM, roomID)
	if err != nil {
		return err
	}
	if exists {
		if _, err := c.AdvanceLastReadEventID(ctx, KindDM, actorID, roomID, lastRootID); err != nil {
			return fmt.Errorf("advance DM read marker during private deletion: %w", err)
		}
	} else if err := c.SetLastReadEventID(ctx, KindDM, actorID, roomID, ""); err != nil {
		return fmt.Errorf("initialize DM read marker during private deletion: %w", err)
	}
	c.DismissRoomNotifications(ctx, actorID, roomID)
	c.NotifyRoomMarkedAsRead(ctx, actorID, KindDM, roomID)
	return nil
}

// RestoreOneToOneDMVisibility makes an existing one-to-one DM visible again
// without moving or clearing the participant's private history cutoff.
func (c *ChattoCore) RestoreOneToOneDMVisibility(ctx context.Context, actorID, roomID string) error {
	if err := c.requireOneToOneDMParticipant(ctx, actorID, roomID); err != nil {
		return err
	}
	return c.updateDMHistoryState(ctx, actorID, roomID, func(current dmHistoryState) (dmHistoryState, error) {
		current.Version = dmHistoryStateVersion
		current.Hidden = false
		return current, nil
	})
}

// CanAccessDMConversation reports whether a DM is currently visible to a
// participant. A hidden conversation becomes visible when a new root message
// lands after the participant's cutoff; replies in an old thread do not restore
// it.
func (c *ChattoCore) CanAccessDMConversation(ctx context.Context, actorID, roomID string) (bool, error) {
	isMember, err := c.RoomMembershipExists(ctx, KindDM, actorID, roomID)
	if err != nil || !isMember {
		return false, err
	}
	state, _, exists, err := c.getDMHistoryState(ctx, actorID, roomID)
	if err != nil {
		return false, err
	}
	if !exists || !state.Hidden {
		return true, nil
	}
	cutoffSeq, err := c.dmHistoryEventSequence(roomID, state.CutoffEventID)
	if err != nil {
		return false, err
	}
	lastRootID, _, rootExists, err := c.GetRoomLastEvent(ctx, KindDM, roomID)
	if err != nil || !rootExists {
		return false, err
	}
	lastRootSeq, err := c.dmHistoryEventSequence(roomID, lastRootID)
	if err != nil {
		return false, err
	}
	return lastRootSeq > cutoffSeq, nil
}

// CanAccessDMEvent enforces the participant-specific history boundary for a
// concrete room event.
func (c *ChattoCore) CanAccessDMEvent(ctx context.Context, actorID, roomID, eventID string) (bool, error) {
	isMember, err := c.RoomMembershipExists(ctx, KindDM, actorID, roomID)
	if err != nil || !isMember {
		return false, err
	}
	entry, ok := c.rooms().timelineEntry(eventID)
	if !ok || entry.Event == nil || roomIDOfEvent(entry.Event) != roomID {
		return false, nil
	}
	cutoffSeq, _, err := c.DMHistoryCutoffSequence(ctx, actorID, roomID)
	if err != nil {
		return false, err
	}
	return entry.StreamSeq > cutoffSeq, nil
}

// CanAccessDMAsset applies the same boundary to an asset by resolving its
// owning message event. Pending assets that are not yet attached to a message
// remain accessible to their uploader through the upload flow.
func (c *ChattoCore) CanAccessDMAsset(ctx context.Context, actorID, roomID, assetID string) (bool, error) {
	if room, err := c.GetRoom(ctx, KindDM, roomID); err != nil || room == nil {
		return false, err
	}
	cutoffSeq, hasCutoff, err := c.DMHistoryCutoffSequence(ctx, actorID, roomID)
	if err != nil || !hasCutoff {
		return !hasCutoff, err
	}
	for _, owner := range c.assetLifecycle().MessageAssetOwners() {
		if owner.RoomID != roomID || owner.AssetID != assetID {
			continue
		}
		seq, err := c.dmHistoryEventSequence(roomID, owner.MessageEventID)
		if err != nil {
			return false, err
		}
		return seq > cutoffSeq, nil
	}
	declared, ok := c.assetLifecycle().AssetCreation(assetID)
	if !ok || declared == nil {
		return false, nil
	}
	parentID := declared.GetParentAssetId()
	if parentID != "" && parentID != assetID {
		return c.CanAccessDMAsset(ctx, actorID, roomID, parentID)
	}
	return false, nil
}

// DMHistoryCutoffSequence resolves the durable event-ID cutoff against the
// current projection sequence. Event IDs survive stream rebuilds; sequence
// numbers intentionally do not persist in RUNTIME_STATE.
func (c *ChattoCore) DMHistoryCutoffSequence(ctx context.Context, actorID, roomID string) (uint64, bool, error) {
	state, _, exists, err := c.getDMHistoryState(ctx, actorID, roomID)
	if err != nil || !exists || state.CutoffEventID == "" {
		return 0, false, err
	}
	seq, err := c.dmHistoryEventSequence(roomID, state.CutoffEventID)
	if err != nil {
		return 0, true, err
	}
	return seq, true, nil
}

func (c *ChattoCore) requireOneToOneDMParticipant(ctx context.Context, actorID, roomID string) error {
	if err := requireAuthenticatedActor(actorID); err != nil {
		return err
	}
	room, err := c.GetRoom(ctx, KindDM, roomID)
	if err != nil {
		return err
	}
	if room == nil || KindOfRoom(room) != KindDM {
		return invalidArgument("room is not a direct-message conversation")
	}
	members := c.RoomMembership.Members(roomID)
	if len(members) != 2 {
		return invalidArgument("private conversation deletion is only available for one-to-one DMs")
	}
	for _, memberID := range members {
		if memberID == actorID {
			return nil
		}
	}
	return ErrPermissionDenied
}

func (c *ChattoCore) dmHistoryEventSequence(roomID, eventID string) (uint64, error) {
	if eventID == "" {
		return 0, nil
	}
	entry, ok := c.rooms().timelineEntry(eventID)
	if !ok || entry.Event == nil || roomIDOfEvent(entry.Event) != roomID {
		return 0, fmt.Errorf("DM history cutoff event %s is unavailable: %w", eventID, ErrNotFound)
	}
	return entry.StreamSeq, nil
}

func (c *ChattoCore) getDMHistoryState(ctx context.Context, userID, roomID string) (dmHistoryState, uint64, bool, error) {
	entry, err := c.storage.runtimeStateKV.Get(ctx, dmHistoryStateKey(userID, roomID))
	if errors.Is(err, jetstream.ErrKeyNotFound) {
		return dmHistoryState{Version: dmHistoryStateVersion}, 0, false, nil
	}
	if err != nil {
		return dmHistoryState{}, 0, false, fmt.Errorf("read DM history state: %w", err)
	}
	state := dmHistoryState{}
	if err := json.Unmarshal(entry.Value(), &state); err != nil {
		return dmHistoryState{}, 0, false, fmt.Errorf("decode DM history state: %w", err)
	}
	if state.Version != dmHistoryStateVersion {
		return dmHistoryState{}, 0, false, fmt.Errorf("unsupported DM history state version %d", state.Version)
	}
	return state, entry.Revision(), true, nil
}

func (c *ChattoCore) updateDMHistoryState(ctx context.Context, userID, roomID string, update func(dmHistoryState) (dmHistoryState, error)) error {
	bucket := c.storage.runtimeStateKV
	key := dmHistoryStateKey(userID, roomID)
	for attempt := 0; attempt < maxDMHistoryUpdateRetries; attempt++ {
		current, revision, exists, err := c.getDMHistoryState(ctx, userID, roomID)
		if err != nil {
			return err
		}
		next, err := update(current)
		if err != nil {
			return err
		}
		payload, err := json.Marshal(next)
		if err != nil {
			return fmt.Errorf("encode DM history state: %w", err)
		}
		if !exists {
			if _, err := bucket.Create(ctx, key, payload); err != nil {
				if errors.Is(err, jetstream.ErrKeyExists) {
					continue
				}
				return fmt.Errorf("create DM history state: %w", err)
			}
			return nil
		}
		if _, err := bucket.Update(ctx, key, payload, revision); err != nil {
			if errors.Is(err, jetstream.ErrKeyExists) {
				continue
			}
			return fmt.Errorf("update DM history state: %w", err)
		}
		return nil
	}
	return fmt.Errorf("DM history state update failed after %d retries", maxDMHistoryUpdateRetries)
}

func (c *ChattoCore) GetRoomEventsAfterDMHistoryCutoff(ctx context.Context, kind RoomKind, roomID string, limit int, beforeSeq *uint64, cutoffSeq uint64) (*RoomEventsResult, error) {
	limit = clampHistoricalMessageLimit(limit)
	var before uint64
	if beforeSeq != nil {
		before = *beforeSeq
		if before <= cutoffSeq+1 {
			return &RoomEventsResult{}, nil
		}
	}
	raw := c.rooms().visibleRoomTimeline(roomID, limit+1, before, nil)
	filtered := raw[:0]
	for _, entry := range raw {
		if entry.StreamSeq > cutoffSeq {
			filtered = append(filtered, entry)
		}
	}
	hasOlder := len(filtered) > limit
	if hasOlder {
		filtered = filtered[:limit]
	}
	visible := make([]*RoomEvent, len(filtered))
	for i, entry := range filtered {
		visible[i] = &RoomEvent{Event: entry.Event, Sequence: entry.StreamSeq}
	}
	for i, j := 0, len(visible)-1; i < j; i, j = i+1, j-1 {
		visible[i], visible[j] = visible[j], visible[i]
	}
	result := &RoomEventsResult{Events: visible, HasOlder: hasOlder, HasNewer: beforeSeq != nil}
	if len(visible) > 0 {
		result.StartCursorSeq = visible[0].Sequence
		result.EndCursorSeq = visible[len(visible)-1].Sequence
	}
	return result, nil
}

func (c *ChattoCore) GetRoomEventsAfterCursorAndDMHistoryCutoff(ctx context.Context, kind RoomKind, roomID string, afterSeq uint64, limit int, cutoffSeq uint64) (*RoomEventsResult, error) {
	limit = clampHistoricalMessageLimit(limit)
	startSeq := afterSeq
	if startSeq < cutoffSeq {
		startSeq = cutoffSeq
	}
	raw := c.rooms().visibleRoomTimelineAfter(roomID, limit+1, startSeq, nil)
	hasNewer := len(raw) > limit
	if hasNewer {
		raw = raw[:limit]
	}
	events := make([]*RoomEvent, 0, len(raw))
	for _, entry := range raw {
		events = append(events, &RoomEvent{Event: entry.Event, Sequence: entry.StreamSeq})
	}
	result := &RoomEventsResult{Events: events, HasOlder: afterSeq > cutoffSeq, HasNewer: hasNewer}
	if len(events) > 0 {
		result.StartCursorSeq = events[0].Sequence
		result.EndCursorSeq = events[len(events)-1].Sequence
	}
	return result, nil
}

func (c *ChattoCore) GetRoomEventsAroundAfterDMHistoryCutoff(ctx context.Context, kind RoomKind, roomID, eventID string, limit int, cutoffSeq uint64) (*RoomEventsAroundResult, error) {
	target, ok := c.rooms().timelineEntry(eventID)
	if !ok || target.Event == nil || roomIDOfEvent(target.Event) != roomID || target.StreamSeq <= cutoffSeq {
		return nil, ErrMessageNotFound
	}
	result, err := c.GetRoomEventsAround(ctx, kind, roomID, eventID, limit)
	if err != nil {
		return nil, err
	}
	filtered := make([]*RoomEvent, 0, len(result.Events))
	targetIndex := -1
	for _, event := range result.Events {
		if event.Sequence <= cutoffSeq {
			continue
		}
		if event.Event != nil && event.Event.GetId() == eventID {
			targetIndex = len(filtered)
		}
		filtered = append(filtered, event)
	}
	if targetIndex < 0 {
		return nil, ErrMessageNotFound
	}
	hasOlder := false
	if len(filtered) > 0 {
		older := c.rooms().visibleRoomTimeline(roomID, 1, filtered[0].Sequence, nil)
		hasOlder = len(older) > 0 && older[0].StreamSeq > cutoffSeq
	}
	hasNewer := false
	if len(filtered) > 0 {
		newer := c.rooms().visibleRoomTimelineAfter(roomID, 1, filtered[len(filtered)-1].Sequence, nil)
		hasNewer = len(newer) > 0
	}
	return &RoomEventsAroundResult{Events: filtered, TargetIndex: targetIndex, HasOlder: hasOlder, HasNewer: hasNewer}, nil
}
