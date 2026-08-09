package core

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

const (
	nativeWakeCounterKeyPrefix    = "native_notification_counter."
	nativeWakeAssignmentKeyPrefix = "native_notification_wake."
)

func nativeWakeCounterKey(endpointID string) string {
	return nativeWakeCounterKeyPrefix + endpointID
}

func nativeWakeAssignmentKey(endpointID, outboxID string) string {
	return nativeWakeAssignmentKeyPrefix + endpointID + "." + outboxID
}

// NativeWakeCounter returns one stable anti-replay counter for an outbox item.
// Concurrent workers either observe the existing assignment or allocate the
// next endpoint counter through CAS. The assignment expires with the wake
// envelope and therefore does not grow without bound.
func (c *ChattoCore) NativeWakeCounter(
	ctx context.Context,
	endpointID string,
	outboxID string,
	expiresAt time.Time,
) (uint64, error) {
	if err := validateNativeIdentifier("endpoint ID", endpointID, 16, 64, false); err != nil {
		return 0, err
	}
	if err := validateNativeIdentifier("outbox ID", outboxID, 16, 64, false); err != nil {
		return 0, err
	}
	if !expiresAt.After(time.Now()) {
		return 0, invalidArgument("native wake assignment is already expired")
	}
	assignmentKey := nativeWakeAssignmentKey(endpointID, outboxID)
	if existing, err := c.storage.runtimeStateKV.Get(ctx, assignmentKey); err == nil {
		return decodeNativeCounter(existing.Value())
	} else if !isRuntimeStateKeyAbsent(err) {
		return 0, fmt.Errorf("load native wake counter assignment: %w", err)
	}

	for range maxNativeEndpointMutationRetries {
		counter, err := c.incrementNativeEndpointCounter(ctx, endpointID)
		if err != nil {
			return 0, err
		}
		encoded := encodeNativeCounter(counter)
		_, err = c.storage.runtimeStateKV.Create(
			ctx,
			assignmentKey,
			encoded,
			jetstream.KeyTTL(time.Until(expiresAt)),
		)
		if err == nil {
			return counter, nil
		}
		if errors.Is(err, jetstream.ErrKeyExists) {
			existing, loadErr := c.storage.runtimeStateKV.Get(ctx, assignmentKey)
			if loadErr == nil {
				return decodeNativeCounter(existing.Value())
			}
			if isRuntimeStateKeyAbsent(loadErr) {
				continue
			}
			return 0, fmt.Errorf("load concurrent native wake assignment: %w", loadErr)
		}
		return 0, fmt.Errorf("store native wake counter assignment: %w", err)
	}
	return 0, ErrNativeEndpointConflict
}

func (c *ChattoCore) incrementNativeEndpointCounter(ctx context.Context, endpointID string) (uint64, error) {
	key := nativeWakeCounterKey(endpointID)
	for range maxNativeEndpointMutationRetries {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			if _, createErr := c.storage.runtimeStateKV.Create(ctx, key, encodeNativeCounter(1)); createErr == nil {
				return 1, nil
			} else if errors.Is(createErr, jetstream.ErrKeyExists) {
				continue
			} else {
				return 0, fmt.Errorf("create native endpoint counter: %w", createErr)
			}
		}
		if err != nil {
			return 0, fmt.Errorf("load native endpoint counter: %w", err)
		}
		current, err := decodeNativeCounter(entry.Value())
		if err != nil {
			return 0, err
		}
		if current == ^uint64(0) {
			return 0, fmt.Errorf("native endpoint counter exhausted")
		}
		next := current + 1
		if _, err := c.storage.runtimeStateKV.Update(ctx, key, encodeNativeCounter(next), entry.Revision()); err == nil {
			return next, nil
		} else if errors.Is(err, jetstream.ErrKeyExists) {
			continue
		} else {
			return 0, fmt.Errorf("update native endpoint counter: %w", err)
		}
	}
	return 0, ErrNativeEndpointConflict
}

func encodeNativeCounter(counter uint64) []byte {
	encoded := make([]byte, 8)
	binary.BigEndian.PutUint64(encoded, counter)
	return encoded
}

func decodeNativeCounter(encoded []byte) (uint64, error) {
	if len(encoded) != 8 {
		return 0, fmt.Errorf("native endpoint counter encoding is invalid")
	}
	counter := binary.BigEndian.Uint64(encoded)
	if counter == 0 {
		return 0, fmt.Errorf("native endpoint counter must be positive")
	}
	return counter, nil
}
