package core

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"hmans.de/chatto/internal/core/subjects"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const (
	maxReadReceiptUpdateRetries = 5
	maxReadReceiptMessageBatch  = 100
	maxReadReceiptMemberScan    = 5000
	maxReadReceiptIntervals     = 128
	readReceiptPreviewLimit     = 3
)

// ReadReceiptAdvance describes an advance-only public receipt mutation.
type ReadReceiptAdvance struct {
	Updated       bool
	EventID       string
	EventSequence uint64
	ReadAt        time.Time
}

// ReadReceiptReaderRecord is a public receipt hydrated by the API layer.
type ReadReceiptReaderRecord struct {
	UserID string
	ReadAt time.Time
}

// ReadReceiptSummaryRecord is the bounded summary for one rendered message.
type ReadReceiptSummaryRecord struct {
	MessageEventID string
	ReaderCount    int
	PreviewUserIDs []string
	LatestReadAt   time.Time
}

type readReceiptTarget struct {
	eventID   string
	actorID   string
	sequence  uint64
	createdAt time.Time
}

// ReadReceipts returns the operation model for reciprocal public read receipts.
func (c *ChattoCore) ReadReceipts() *ReadReceiptModel {
	return &ReadReceiptModel{core: c}
}

// ReadReceiptModel owns public receipt authorization, monotonic storage and
// bounded reader queries. Private unread markers remain independent.
type ReadReceiptModel struct {
	core *ChattoCore
}

func roomReadReceiptKey(roomID, userID string) string {
	return fmt.Sprintf("receipt.room.%s.%s", roomID, userID)
}

func threadReadReceiptKey(roomID, threadRootEventID, userID string) string {
	return fmt.Sprintf("receipt.thread.%s.%s.%s", roomID, threadRootEventID, userID)
}

func readReceiptPrefix(roomID, threadRootEventID string) string {
	if threadRootEventID == "" {
		return fmt.Sprintf("receipt.room.%s.", roomID)
	}
	return fmt.Sprintf("receipt.thread.%s.%s.", roomID, threadRootEventID)
}

func readReceiptKey(roomID, threadRootEventID, userID string) string {
	if threadRootEventID == "" {
		return roomReadReceiptKey(roomID, userID)
	}
	return threadReadReceiptKey(roomID, threadRootEventID, userID)
}

// Policy returns whether actorID may publish and inspect public receipts, plus
// the latest server-side opt-in boundary. The boundary identifies an explicit
// policy generation and prevents cursor advances from crossing an opt-out gap.
func (s *ReadReceiptModel) Policy(actorID string) (bool, time.Time) {
	if s == nil || s.core == nil || s.core.ServerConfig == nil {
		return true, time.Time{}
	}
	serverEnabled, serverSince := s.core.ServerConfig.ReadReceiptServerPolicy()
	userEnabled, userSince := s.core.ServerConfig.ReadReceiptUserPolicy(actorID)
	if !serverEnabled || !userEnabled {
		return false, time.Time{}
	}
	if userSince.After(serverSince) {
		return true, userSince
	}
	return true, serverSince
}

// Advance stores public receipt coverage only for a message selected by the
// client visibility controller. The server revalidates membership, timeline,
// policy and ordering and never trusts a client timestamp. A re-enabled policy
// starts a new interval, so messages created while receipts were disabled are
// not marked by a later monotonic advance.
func (s *ReadReceiptModel) Advance(ctx context.Context, actorID, roomID, threadRootEventID, eventID string) (*ReadReceiptAdvance, error) {
	room, kind, err := s.core.requireRoomMember(ctx, actorID, roomID)
	if err != nil {
		return nil, err
	}
	if threadRootEventID != "" {
		if _, err := s.core.requireThreadRoot(ctx, kind, room.GetId(), threadRootEventID); err != nil {
			return nil, err
		}
	}
	enabled, generationStartedAt := s.Policy(actorID)
	if !enabled {
		return nil, ErrReadReceiptsDisabled
	}
	target, err := s.target(ctx, kind, room.GetId(), threadRootEventID, eventID)
	if err != nil {
		return nil, err
	}
	if target.actorID == actorID {
		return &ReadReceiptAdvance{EventID: target.eventID, EventSequence: target.sequence}, nil
	}
	// The first interval after an opt-in may cover only messages created after
	// the effective policy boundary. This prevents a stale tab or replayed
	// request from publishing reads made while receipts were disabled.
	if !generationStartedAt.IsZero() && target.createdAt.Before(generationStartedAt) {
		return &ReadReceiptAdvance{EventID: target.eventID, EventSequence: target.sequence}, nil
	}

	bucket := s.core.storage.runtimeStateKV
	key := readReceiptKey(room.GetId(), threadRootEventID, actorID)
	for attempt := 0; attempt < maxReadReceiptUpdateRetries; attempt++ {
		entry, err := bucket.Get(ctx, key)
		if err != nil && !errors.Is(err, jetstream.ErrKeyNotFound) {
			return nil, fmt.Errorf("get public read receipt cursor: %w", err)
		}

		cursor := &corev1.PublicReadReceiptCursor{}
		if err == nil {
			if err := proto.Unmarshal(entry.Value(), cursor); err != nil {
				return nil, fmt.Errorf("decode public read receipt cursor: %w", err)
			}
		}
		cursor.Intervals = compactReadReceiptIntervals(cursor.GetIntervals())
		intervals := cursor.GetIntervals()
		generationMatches := false
		if len(intervals) > 0 {
			current := intervals[len(intervals)-1]
			generationMatches = sameReadReceiptGeneration(current.GetGenerationStartedAt(), generationStartedAt)
			if generationMatches && current.GetEndEventSequence() >= target.sequence {
				return &ReadReceiptAdvance{
					EventID:       current.GetEndEventId(),
					EventSequence: current.GetEndEventSequence(),
					ReadAt:        timestampTime(current.GetReadAt()),
				}, nil
			}
		}

		now := time.Now().UTC()
		if generationMatches {
			current := intervals[len(intervals)-1]
			current.EndEventId = target.eventID
			current.EndEventSequence = target.sequence
			current.ReadAt = timestamppb.New(now)
		} else {
			if len(intervals) >= maxReadReceiptIntervals {
				return nil, fmt.Errorf("public read receipt history exceeds %d opt-in intervals: %w", maxReadReceiptIntervals, ErrLimitExceeded)
			}
			startSequence := target.sequence
			if generationStartedAt.IsZero() {
				startSequence = 1
			}
			interval := &corev1.PublicReadReceiptInterval{
				StartEventSequence: startSequence,
				EndEventId:         target.eventID,
				EndEventSequence:   target.sequence,
				ReadAt:             timestamppb.New(now),
			}
			if !generationStartedAt.IsZero() {
				interval.GenerationStartedAt = timestamppb.New(generationStartedAt)
			}
			cursor.Intervals = append(cursor.Intervals, interval)
		}

		data, err := proto.Marshal(cursor)
		if err != nil {
			return nil, fmt.Errorf("encode public read receipt cursor: %w", err)
		}
		if entry == nil {
			if _, err := bucket.Create(ctx, key, data); err != nil {
				if errors.Is(err, jetstream.ErrKeyExists) {
					continue
				}
				return nil, fmt.Errorf("create public read receipt cursor: %w", err)
			}
		} else if _, err := bucket.Update(ctx, key, data, entry.Revision()); err != nil {
			if errors.Is(err, jetstream.ErrKeyExists) {
				continue
			}
			return nil, fmt.Errorf("advance public read receipt cursor: %w", err)
		}

		advance := &ReadReceiptAdvance{Updated: true, EventID: target.eventID, EventSequence: target.sequence, ReadAt: now}
		s.publishAdvance(ctx, actorID, kind, room.GetId(), threadRootEventID, advance)
		return advance, nil
	}
	return nil, fmt.Errorf("public read receipt cursor update failed after %d retries", maxReadReceiptUpdateRetries)
}

func sameReadReceiptGeneration(stored *timestamppb.Timestamp, current time.Time) bool {
	storedTime := timestampTime(stored)
	if storedTime.IsZero() || current.IsZero() {
		return storedTime.IsZero() && current.IsZero()
	}
	return storedTime.Equal(current.UTC())
}

// compactReadReceiptIntervals merges only overlapping or adjacent coverage.
// It never bridges a sequence gap, so opt-out periods containing messages stay
// excluded while repeated toggles without intervening messages remain bounded.
func compactReadReceiptIntervals(intervals []*corev1.PublicReadReceiptInterval) []*corev1.PublicReadReceiptInterval {
	result := make([]*corev1.PublicReadReceiptInterval, 0, len(intervals))
	for _, interval := range intervals {
		if interval == nil || interval.GetStartEventSequence() == 0 || interval.GetEndEventSequence() < interval.GetStartEventSequence() {
			continue
		}
		copyInterval := proto.Clone(interval).(*corev1.PublicReadReceiptInterval)
		if len(result) == 0 {
			result = append(result, copyInterval)
			continue
		}
		previous := result[len(result)-1]
		if copyInterval.GetStartEventSequence() <= previous.GetEndEventSequence()+1 {
			if copyInterval.GetEndEventSequence() > previous.GetEndEventSequence() {
				previous.EndEventId = copyInterval.GetEndEventId()
				previous.EndEventSequence = copyInterval.GetEndEventSequence()
			}
			if timestampTime(copyInterval.GetReadAt()).After(timestampTime(previous.GetReadAt())) {
				previous.ReadAt = copyInterval.GetReadAt()
			}
			continue
		}
		result = append(result, copyInterval)
	}
	return result
}

// Summaries returns compact receipt counts for up to 100 messages. The cursor
// set is loaded once and reused across all targets, avoiding per-message reads.
func (s *ReadReceiptModel) Summaries(ctx context.Context, actorID, roomID, threadRootEventID string, eventIDs []string) ([]*ReadReceiptSummaryRecord, error) {
	room, kind, err := s.core.requireRoomMember(ctx, actorID, roomID)
	if err != nil {
		return nil, err
	}
	if len(eventIDs) > maxReadReceiptMessageBatch {
		return nil, invalidArgument("message_event_ids cannot contain more than 100 items")
	}
	if threadRootEventID != "" {
		if _, err := s.core.requireThreadRoot(ctx, kind, room.GetId(), threadRootEventID); err != nil {
			return nil, err
		}
	}
	enabled, _ := s.Policy(actorID)
	if !enabled {
		return nil, ErrReadReceiptsDisabled
	}

	targets := make([]readReceiptTarget, 0, len(eventIDs))
	seen := make(map[string]struct{}, len(eventIDs))
	for _, eventID := range eventIDs {
		eventID = strings.TrimSpace(eventID)
		if eventID == "" {
			return nil, invalidArgument("message_event_ids must not contain empty values")
		}
		if _, duplicate := seen[eventID]; duplicate {
			continue
		}
		seen[eventID] = struct{}{}
		target, err := s.target(ctx, kind, room.GetId(), threadRootEventID, eventID)
		if err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}

	readersByTarget, err := s.readersForTargets(ctx, kind, room.GetId(), threadRootEventID, targets)
	if err != nil {
		return nil, err
	}
	result := make([]*ReadReceiptSummaryRecord, 0, len(targets))
	for _, target := range targets {
		readers := readersByTarget[target.eventID]
		summary := &ReadReceiptSummaryRecord{MessageEventID: target.eventID, ReaderCount: len(readers)}
		if len(readers) > 0 {
			summary.LatestReadAt = readers[0].ReadAt
			previewCount := len(readers)
			if previewCount > readReceiptPreviewLimit {
				previewCount = readReceiptPreviewLimit
			}
			summary.PreviewUserIDs = make([]string, 0, previewCount)
			for _, reader := range readers[:previewCount] {
				summary.PreviewUserIDs = append(summary.PreviewUserIDs, reader.UserID)
			}
		}
		result = append(result, summary)
	}
	return result, nil
}

// Readers returns all current authorized readers for one message. The API
// layer applies offset pagination after this bounded membership scan.
func (s *ReadReceiptModel) Readers(ctx context.Context, actorID, roomID, threadRootEventID, eventID string) ([]*ReadReceiptReaderRecord, error) {
	room, kind, err := s.core.requireRoomMember(ctx, actorID, roomID)
	if err != nil {
		return nil, err
	}
	if threadRootEventID != "" {
		if _, err := s.core.requireThreadRoot(ctx, kind, room.GetId(), threadRootEventID); err != nil {
			return nil, err
		}
	}
	enabled, _ := s.Policy(actorID)
	if !enabled {
		return nil, ErrReadReceiptsDisabled
	}
	target, err := s.target(ctx, kind, room.GetId(), threadRootEventID, eventID)
	if err != nil {
		return nil, err
	}
	byTarget, err := s.readersForTargets(ctx, kind, room.GetId(), threadRootEventID, []readReceiptTarget{target})
	if err != nil {
		return nil, err
	}
	return byTarget[target.eventID], nil
}

func (s *ReadReceiptModel) target(ctx context.Context, kind RoomKind, roomID, threadRootEventID, eventID string) (readReceiptTarget, error) {
	if strings.TrimSpace(eventID) == "" {
		return readReceiptTarget{}, invalidArgument("message event id is required")
	}
	event, err := s.core.GetRoomEventByEventID(ctx, kind, roomID, eventID)
	if err != nil {
		return readReceiptTarget{}, err
	}
	if event == nil || event.GetMessagePosted() == nil {
		return readReceiptTarget{}, fmt.Errorf("message event not found: %w", ErrNotFound)
	}
	message := event.GetMessagePosted()
	if threadRootEventID == "" {
		if message.GetInThread() != "" || message.GetEchoOfEventId() != "" {
			return readReceiptTarget{}, invalidArgument("message event must identify a root room message")
		}
	} else if event.GetId() == threadRootEventID {
		if message.GetInThread() != "" || message.GetEchoOfEventId() != "" {
			return readReceiptTarget{}, invalidArgument("thread root is invalid")
		}
	} else if message.GetInThread() != threadRootEventID {
		return readReceiptTarget{}, invalidArgument("message event does not belong to the requested thread")
	}
	sequence, err := s.core.GetEventSequence(ctx, kind, roomID, event.GetId())
	if err != nil {
		return readReceiptTarget{}, err
	}
	if sequence == 0 {
		return readReceiptTarget{}, fmt.Errorf("message event sequence not found: %w", ErrNotFound)
	}
	return readReceiptTarget{
		eventID:   event.GetId(),
		actorID:   event.GetActorId(),
		sequence:  sequence,
		createdAt: timestampTime(event.GetCreatedAt()),
	}, nil
}

func (s *ReadReceiptModel) readersForTargets(ctx context.Context, kind RoomKind, roomID, threadRootEventID string, targets []readReceiptTarget) (map[string][]*ReadReceiptReaderRecord, error) {
	result := make(map[string][]*ReadReceiptReaderRecord, len(targets))
	for _, target := range targets {
		result[target.eventID] = nil
	}
	if len(targets) == 0 {
		return result, nil
	}
	members, err := s.core.GetRoomMembersList(ctx, kind, roomID)
	if err != nil {
		return nil, err
	}
	if len(members) > maxReadReceiptMemberScan {
		return nil, fmt.Errorf("read receipt member scan exceeds %d members: %w", maxReadReceiptMemberScan, ErrLimitExceeded)
	}

	bucket := s.core.storage.runtimeStateKV
	for _, membership := range members {
		userID := membership.GetUserId()
		if userID == "" {
			continue
		}
		if _, err := s.core.GetUser(ctx, userID); err != nil {
			continue
		}
		entry, err := bucket.Get(ctx, readReceiptKey(roomID, threadRootEventID, userID))
		if errors.Is(err, jetstream.ErrKeyNotFound) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("get public read receipt cursor: %w", err)
		}
		cursor := &corev1.PublicReadReceiptCursor{}
		if err := proto.Unmarshal(entry.Value(), cursor); err != nil {
			return nil, fmt.Errorf("decode public read receipt cursor: %w", err)
		}
		for _, target := range targets {
			if userID == target.actorID {
				continue
			}
			readAt, ok := readReceiptIntervalTime(cursor.GetIntervals(), target)
			if !ok {
				continue
			}
			result[target.eventID] = append(result[target.eventID], &ReadReceiptReaderRecord{UserID: userID, ReadAt: readAt})
		}
	}
	for eventID := range result {
		sort.Slice(result[eventID], func(i, j int) bool {
			if result[eventID][i].ReadAt.Equal(result[eventID][j].ReadAt) {
				return result[eventID][i].UserID < result[eventID][j].UserID
			}
			return result[eventID][i].ReadAt.After(result[eventID][j].ReadAt)
		})
	}
	return result, nil
}

func readReceiptIntervalTime(intervals []*corev1.PublicReadReceiptInterval, target readReceiptTarget) (time.Time, bool) {
	for index := len(intervals) - 1; index >= 0; index-- {
		interval := intervals[index]
		if interval == nil || interval.GetStartEventSequence() == 0 || interval.GetEndEventSequence() < interval.GetStartEventSequence() {
			continue
		}
		if target.sequence > interval.GetEndEventSequence() {
			continue
		}
		generationStartedAt := timestampTime(interval.GetGenerationStartedAt())
		if !generationStartedAt.IsZero() && (target.createdAt.IsZero() || target.createdAt.Before(generationStartedAt)) {
			continue
		}
		return timestampTime(interval.GetReadAt()), true
	}
	return time.Time{}, false
}

func (s *ReadReceiptModel) publishAdvance(ctx context.Context, actorID string, kind RoomKind, roomID, threadRootEventID string, advance *ReadReceiptAdvance) {
	if advance == nil || !advance.Updated {
		return
	}
	event := newLiveEvent(actorID, &corev1.LiveEvent{Event: &corev1.LiveEvent_PublicReadReceiptAdvanced{
		PublicReadReceiptAdvanced: &corev1.PublicReadReceiptAdvancedEvent{
			RoomId:            roomID,
			ThreadRootEventId: optionalString(threadRootEventID),
			UserId:            actorID,
			EventId:           advance.EventID,
			EventSequence:     advance.EventSequence,
			ReadAt:            timestamppb.New(advance.ReadAt),
		},
	}})
	if err := s.core.publishLiveEvent(ctx, subjects.LiveSyncRoomEvent(string(kind), roomID, "read_receipt"), event); err != nil {
		s.core.logger.Warn("failed to publish public read receipt delta", "error", err)
	}
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func timestampTime(value *timestamppb.Timestamp) time.Time {
	if value == nil || !value.IsValid() {
		return time.Time{}
	}
	return value.AsTime().UTC()
}

// DeleteUserCursors removes bounded public cursor state during account
// deletion. Historical display never retains duplicated profile data.
func (s *ReadReceiptModel) DeleteUserCursors(ctx context.Context, userID string) error {
	return s.deleteMatchingCursors(ctx, "receipt.>", func(key string) bool {
		return strings.HasSuffix(key, "."+userID)
	})
}

// DeleteRoomCursors removes public cursor state after a room is deleted.
func (s *ReadReceiptModel) DeleteRoomCursors(ctx context.Context, roomID string) error {
	roomPrefix := "receipt.room." + roomID + "."
	threadPrefix := "receipt.thread." + roomID + "."
	return s.deleteMatchingCursors(ctx, "receipt.>", func(key string) bool {
		return strings.HasPrefix(key, roomPrefix) || strings.HasPrefix(key, threadPrefix)
	})
}

func (s *ReadReceiptModel) deleteMatchingCursors(ctx context.Context, filter string, match func(string) bool) error {
	lister, err := s.core.storage.runtimeStateKV.ListKeysFiltered(ctx, filter)
	if err != nil {
		if errors.Is(err, jetstream.ErrNoKeysFound) {
			return nil
		}
		return err
	}
	for key := range lister.Keys() {
		if !match(key) {
			continue
		}
		if err := s.core.storage.runtimeStateKV.Delete(ctx, key); err != nil && !errors.Is(err, jetstream.ErrKeyNotFound) {
			return err
		}
	}
	return nil
}

func (s *ReadReceiptModel) CursorPrefix(roomID, threadRootEventID string) string {
	return readReceiptPrefix(roomID, threadRootEventID)
}
