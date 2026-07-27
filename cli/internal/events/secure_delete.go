package events

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const secureDeleteBatchSize = 500

var exactEntityIDPattern = regexp.MustCompile(`^[A-Za-z][0-9A-Za-z]{14}$`)

// ValidateSecureDeleteAggregate rejects every wildcard, singleton, and malformed
// aggregate before a destructive EVT mutation can be attempted. Permanent room
// purge only needs exact room, room-scoped RBAC, and asset aggregates.
func ValidateSecureDeleteAggregate(aggregate Aggregate) error {
	if !exactEntityIDPattern.MatchString(aggregate.ID) {
		return fmt.Errorf("invalid aggregate id for secure deletion")
	}

	switch aggregate.Type {
	case AggregateRoom:
		if aggregate.ID[0] != 'R' {
			return fmt.Errorf("room aggregate id must start with R")
		}
	case AggregateAsset:
		if aggregate.ID[0] != 'A' {
			return fmt.Errorf("asset aggregate id must start with A")
		}
	case AggregateRBAC:
		if aggregate.ID[0] != 'R' && aggregate.ID[0] != 'G' {
			return fmt.Errorf("scoped RBAC aggregate id must start with R or G")
		}
	default:
		return fmt.Errorf("aggregate type %q is not eligible for secure deletion", aggregate.Type)
	}
	return nil
}

// SecureDeleteAggregate overwrites and removes the messages currently stored for
// one exact aggregate. It deliberately does not accept a raw subject string, so
// callers cannot accidentally pass evt.>, evt.room.>, or another broad filter.
//
// The operation deletes a bounded snapshot. Callers that must exclude late
// writers should append an OCC-protected tombstone and use
// SecureDeleteAggregateThroughExcept so messages that land after it remain
// available for the next reconciliation pass.
func (p *Publisher) SecureDeleteAggregate(ctx context.Context, aggregate Aggregate) (int, error) {
	return p.secureDeleteAggregate(ctx, aggregate, 0, nil)
}

// SecureDeleteAggregateExcept is SecureDeleteAggregate with an exact stream
// sequence allow-list. Permanent purge appends a tombstone first and preserves
// its sequence while overwriting older facts, so a process crash can never leave
// the aggregate without a durable deletion marker.
func (p *Publisher) SecureDeleteAggregateExcept(
	ctx context.Context,
	aggregate Aggregate,
	keepSequences map[uint64]struct{},
) (int, error) {
	return p.secureDeleteAggregate(ctx, aggregate, 0, keepSequences)
}

// SecureDeleteAggregateThroughExcept overwrites matching messages whose stream
// sequence is at most throughSequence, preserving the exact sequences in
// keepSequences. Messages appended after throughSequence are intentionally left
// intact so a caller can inspect their references before a later pass erases
// them. This is the race-safe primitive used by permanent room purge.
func (p *Publisher) SecureDeleteAggregateThroughExcept(
	ctx context.Context,
	aggregate Aggregate,
	throughSequence uint64,
	keepSequences map[uint64]struct{},
) (int, error) {
	if throughSequence == 0 {
		return 0, fmt.Errorf("secure-delete upper sequence must be positive")
	}
	return p.secureDeleteAggregate(ctx, aggregate, throughSequence, keepSequences)
}

func (p *Publisher) secureDeleteAggregate(
	ctx context.Context,
	aggregate Aggregate,
	throughSequence uint64,
	keepSequences map[uint64]struct{},
) (int, error) {
	if err := ValidateSecureDeleteAggregate(aggregate); err != nil {
		return 0, err
	}
	if p == nil || p.stream == nil {
		return 0, fmt.Errorf("event publisher stream is unavailable")
	}
	for seq := range keepSequences {
		if seq == 0 {
			return 0, fmt.Errorf("secure-delete keep sequence must be positive")
		}
		if throughSequence > 0 && seq > throughSequence {
			return 0, fmt.Errorf("secure-delete keep sequence exceeds upper sequence")
		}
	}

	filter := aggregate.AllEventsFilter()
	consumer, cleanup, err := p.secureDeleteConsumer(ctx, filter)
	if err != nil {
		return 0, err
	}
	defer cleanup()

	info, err := consumer.Info(ctx)
	if err != nil {
		return 0, fmt.Errorf("inspect secure-delete consumer for %s: %w", filter, err)
	}

	remaining := int(info.NumPending)
	deleted := 0
	kept := make(map[uint64]struct{}, len(keepSequences))
	for remaining > 0 {
		batchSize := remaining
		if batchSize > secureDeleteBatchSize {
			batchSize = secureDeleteBatchSize
		}
		batch, err := consumer.Fetch(batchSize, jetstream.FetchMaxWait(10*time.Second))
		if err != nil {
			if errors.Is(err, jetstream.ErrNoMessages) {
				break
			}
			return deleted, fmt.Errorf("fetch secure-delete batch for %s: %w", filter, err)
		}

		fetched := 0
		for msg := range batch.Messages() {
			fetched++
			metadata, err := msg.Metadata()
			if err != nil {
				return deleted, fmt.Errorf("read secure-delete message metadata for %s: %w", filter, err)
			}
			seq := metadata.Sequence.Stream
			if throughSequence > 0 && seq > throughSequence {
				continue
			}
			if _, preserve := keepSequences[seq]; preserve {
				kept[seq] = struct{}{}
				continue
			}
			if err := p.stream.SecureDeleteMsg(ctx, seq); err != nil {
				if errors.Is(err, jetstream.ErrMsgNotFound) {
					continue
				}
				return deleted, fmt.Errorf("secure-delete %s sequence %d: %w", filter, seq, err)
			}
			deleted++
		}
		if fetched == 0 {
			break
		}
		remaining -= fetched
	}
	if len(kept) != len(keepSequences) {
		return deleted, fmt.Errorf("secure-delete preserved sequence was not present in %s", filter)
	}
	return deleted, nil
}

// SecureDeleteRoomNotificationPreferenceEvents removes only room-level
// notification preference facts whose payload names roomID. The scan is limited
// to the two narrow config event families, and every matched event must agree
// with its exact user aggregate subject before its stream sequence can be
// securely deleted. Preferences for every other room remain byte-for-byte
// untouched.
func (p *Publisher) SecureDeleteRoomNotificationPreferenceEvents(ctx context.Context, roomID string) (int, error) {
	return p.roomNotificationPreferenceEvents(ctx, roomID, true)
}

// RoomNotificationPreferenceEventCount reports how many durable room-level
// notification preference facts still target roomID. It is used by permanent
// purge quiescence checks and performs no mutation.
func (p *Publisher) RoomNotificationPreferenceEventCount(ctx context.Context, roomID string) (int, error) {
	return p.roomNotificationPreferenceEvents(ctx, roomID, false)
}

func (p *Publisher) roomNotificationPreferenceEvents(ctx context.Context, roomID string, remove bool) (int, error) {
	if err := ValidateSecureDeleteAggregate(RoomAggregate(roomID)); err != nil {
		return 0, err
	}
	if p == nil || p.stream == nil {
		return 0, fmt.Errorf("event publisher stream is unavailable")
	}

	filters := []string{
		ConfigEventTypeFilter(EventUserRoomNotificationLevelSet),
		ConfigEventTypeFilter(EventUserRoomNotificationLevelCleared),
	}
	matched := 0
	for _, filter := range filters {
		consumer, cleanup, err := p.secureDeleteConsumer(ctx, filter)
		if err != nil {
			return matched, err
		}
		count, consumeErr := p.consumeRoomNotificationPreferenceEvents(ctx, consumer, filter, roomID, remove)
		cleanup()
		matched += count
		if consumeErr != nil {
			return matched, consumeErr
		}
	}
	return matched, nil
}

func (p *Publisher) consumeRoomNotificationPreferenceEvents(
	ctx context.Context,
	consumer jetstream.Consumer,
	filter string,
	roomID string,
	remove bool,
) (int, error) {
	info, err := consumer.Info(ctx)
	if err != nil {
		return 0, fmt.Errorf("inspect room preference consumer for %s: %w", filter, err)
	}
	remaining := int(info.NumPending)
	matched := 0
	for remaining > 0 {
		batchSize := remaining
		if batchSize > secureDeleteBatchSize {
			batchSize = secureDeleteBatchSize
		}
		batch, err := consumer.Fetch(batchSize, jetstream.FetchMaxWait(10*time.Second))
		if err != nil {
			if errors.Is(err, jetstream.ErrNoMessages) {
				break
			}
			return matched, fmt.Errorf("fetch room preference events for %s: %w", filter, err)
		}
		fetched := 0
		for msg := range batch.Messages() {
			fetched++
			metadata, err := msg.Metadata()
			if err != nil {
				return matched, fmt.Errorf("read room preference event metadata: %w", err)
			}
			var event corev1.Event
			if err := proto.Unmarshal(msg.Data(), &event); err != nil {
				return matched, fmt.Errorf("decode room preference event at sequence %d: %w", metadata.Sequence.Stream, err)
			}
			eventRoomID, userID, eventType, ok := roomNotificationPreferenceIdentity(&event)
			if !ok || !exactEntityIDPattern.MatchString(userID) || userID[0] != 'U' {
				return matched, fmt.Errorf("invalid room preference event on %s", msg.Subject())
			}
			expectedSubject := ConfigSubjectAggregate(userID).Subject(eventType)
			if msg.Subject() != expectedSubject {
				return matched, fmt.Errorf("room preference subject/payload mismatch")
			}
			if eventRoomID != roomID {
				continue
			}
			matched++
			if !remove {
				continue
			}
			if err := p.stream.SecureDeleteMsg(ctx, metadata.Sequence.Stream); err != nil && !errors.Is(err, jetstream.ErrMsgNotFound) {
				return matched - 1, fmt.Errorf("secure-delete room preference sequence %d: %w", metadata.Sequence.Stream, err)
			}
		}
		if fetched == 0 {
			break
		}
		remaining -= fetched
	}
	return matched, nil
}

func roomNotificationPreferenceIdentity(event *corev1.Event) (roomID, userID, eventType string, ok bool) {
	if event == nil {
		return "", "", "", false
	}
	if set := event.GetUserRoomNotificationLevelSet(); set != nil {
		return set.GetRoomId(), set.GetUserId(), EventUserRoomNotificationLevelSet, true
	}
	if cleared := event.GetUserRoomNotificationLevelCleared(); cleared != nil {
		return cleared.GetRoomId(), cleared.GetUserId(), EventUserRoomNotificationLevelCleared, true
	}
	return "", "", "", false
}

func (p *Publisher) secureDeleteConsumer(
	ctx context.Context,
	filter string,
) (jetstream.Consumer, func(), error) {
	consumer, err := p.stream.CreateConsumer(ctx, jetstream.ConsumerConfig{
		FilterSubjects:    []string{filter},
		DeliverPolicy:     jetstream.DeliverAllPolicy,
		AckPolicy:         jetstream.AckNonePolicy,
		MemoryStorage:     true,
		InactiveThreshold: 30 * time.Second,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("create secure-delete consumer for %s: %w", filter, err)
	}
	consumerInfo, err := consumer.Info(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("inspect secure-delete consumer for %s: %w", filter, err)
	}
	if consumerInfo == nil || consumerInfo.Name == "" {
		return nil, nil, fmt.Errorf("secure-delete consumer for %s has no identity", filter)
	}
	consumerName := consumerInfo.Name
	cleanup := func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = p.stream.DeleteConsumer(cleanupCtx, consumerName)
	}
	return consumer, cleanup, nil
}
