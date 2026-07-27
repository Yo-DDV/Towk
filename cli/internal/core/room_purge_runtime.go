package core

import (
	"context"
	"errors"
	"fmt"
	"github.com/nats-io/nats.go/jetstream"
	"hmans.de/chatto/internal/events"
	"hmans.de/chatto/internal/kms"
	"strings"
)

type roomRuntimeStateFilter struct {
	filter string
	match  func([]string) bool
}

func roomRuntimeStateFilters(roomID string) []roomRuntimeStateFilter {
	return []roomRuntimeStateFilter{
		{
			filter: "read.room.*." + roomID,
			match: func(parts []string) bool {
				return len(parts) == 4 && parts[0] == "read" && parts[1] == "room" && parts[3] == roomID
			},
		},
		{
			filter: "read.thread.*." + roomID + ".*",
			match: func(parts []string) bool {
				return len(parts) == 5 && parts[0] == "read" && parts[1] == "thread" && parts[3] == roomID
			},
		},
		{
			filter: "thread_follow.*." + roomID + ".*",
			match: func(parts []string) bool {
				return len(parts) == 4 && parts[0] == "thread_follow" && parts[2] == roomID
			},
		},
	}
}

func (c *ChattoCore) purgeRoomRuntimeState(ctx context.Context, roomID string) (int, error) {
	return c.roomRuntimeStateKeys(ctx, roomID, true)
}

func (c *ChattoCore) roomRuntimeStateKeyCount(ctx context.Context, roomID string) (int, error) {
	return c.roomRuntimeStateKeys(ctx, roomID, false)
}

func (c *ChattoCore) roomRuntimeStateKeys(ctx context.Context, roomID string, remove bool) (int, error) {
	if err := events.ValidateSecureDeleteAggregate(events.RoomAggregate(roomID)); err != nil {
		return 0, ErrRoomPurgeInvalidRoomID
	}
	count := 0
	for _, target := range roomRuntimeStateFilters(roomID) {
		lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, target.filter)
		if err != nil {
			if errors.Is(err, jetstream.ErrNoKeysFound) {
				continue
			}
			return count, fmt.Errorf("list room runtime state: %w", err)
		}
		for key := range lister.Keys() {
			parts := strings.Split(key, ".")
			if !target.match(parts) {
				return count, fmt.Errorf("room runtime-state key escaped exact scope")
			}
			count++
			if !remove {
				continue
			}
			if err := c.storage.runtimeStateKV.Purge(ctx, key); err != nil && !isRuntimeStateKeyAbsent(err) {
				return count - 1, fmt.Errorf("purge room runtime state: %w", err)
			}
		}
	}
	return count, nil
}

func validRoomPurgeCallKeyRef(keyRef string) bool {
	const prefix = "call.e2ee."
	if !strings.HasPrefix(keyRef, prefix) {
		return false
	}
	callID := strings.TrimPrefix(keyRef, prefix)
	if len(callID) != 15 || callID[0] != 'C' || keyRef != kms.CallKeyRef(callID) {
		return false
	}
	for i := 1; i < len(callID); i++ {
		b := callID[i]
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '_' || b == '-' {
			continue
		}
		return false
	}
	return true
}

func (c *ChattoCore) purgeRoomCallKeys(ctx context.Context, references *roomPurgeReferences) error {
	if references == nil || len(references.callKeyRefs) == 0 {
		return nil
	}
	if c.callModel == nil {
		return fmt.Errorf("call model is not initialized")
	}
	keyRefs := sortedSetKeys(references.callKeyRefs)
	for _, keyRef := range keyRefs {
		if _, cleaned := references.cleanedCallKeyRefs[keyRef]; cleaned {
			continue
		}
		if !validRoomPurgeCallKeyRef(keyRef) {
			return fmt.Errorf("invalid room call key reference")
		}
		if err := c.callModel.cleanupQueuedCallKey(ctx, keyRef); err != nil {
			return fmt.Errorf("shred room call key: %w", err)
		}
		references.cleanedCallKeyRefs[keyRef] = struct{}{}
	}
	return nil
}
