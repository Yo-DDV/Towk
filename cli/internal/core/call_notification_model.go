package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const (
	callNotificationFreshness       = time.Minute
	callNotificationPollInterval    = time.Second
	callNotificationFutureTolerance = time.Minute
	missedCallNotificationIDPrefix  = "M"
)

// CallNotificationModel derives short-lived, idempotent notifications from
// durable call lifecycle facts. Each replica may run the consumer: the
// deterministic KV key makes fanout exactly-once per recipient and call.
type CallNotificationModel struct {
	core    *ChattoCore
	started *events.IncrementalEffectConsumer
	ended   *events.IncrementalEffectConsumer
	wake    chan struct{}
}

func NewCallNotificationModel(core *ChattoCore) *CallNotificationModel {
	model := &CallNotificationModel{
		core: core,
		wake: make(chan struct{}, 1),
	}
	model.started = events.NewIncrementalEffectConsumerWithSubject(
		core.EventPublisher,
		events.RoomEventTypeFilter(events.EventCallStarted),
		model.handleCallStarted,
	)
	model.ended = events.NewIncrementalEffectConsumerWithSubject(
		core.EventPublisher,
		events.RoomEventTypeFilter(events.EventCallEnded),
		model.handleCallEnded,
	)
	return model
}

func (m *CallNotificationModel) Wake() {
	if m == nil {
		return
	}
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

func (m *CallNotificationModel) Run(ctx context.Context) error {
	m.consumeBestEffort(ctx)
	ticker := time.NewTicker(callNotificationPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-m.wake:
			m.consumeBestEffort(ctx)
		case <-ticker.C:
			m.consumeBestEffort(ctx)
		}
	}
}

func (m *CallNotificationModel) consumeBestEffort(ctx context.Context) {
	if err := m.consume(ctx); err != nil && m.core != nil && m.core.logger != nil {
		m.core.logger.Warn("Failed to process call notifications; will retry", "error", err)
	}
}

func (m *CallNotificationModel) consume(ctx context.Context) error {
	if m == nil || m.started == nil || m.ended == nil {
		return fmt.Errorf("call notification model is not configured")
	}
	return errors.Join(m.started.Consume(ctx), m.ended.Consume(ctx))
}

func (m *CallNotificationModel) handleCallStarted(ctx context.Context, subjectEvent *events.SubjectEvent) error {
	event := subjectEvent.Event
	started := event.GetVoiceCallStarted()
	if started == nil || event.GetId() == "" || event.GetActorId() == "" || started.GetRoomId() == "" || started.GetCallId() == "" {
		return nil
	}
	if subjectEvent.Subject != events.RoomAggregate(started.GetRoomId()).Subject(events.EventCallStarted) {
		return nil
	}
	createdAt := event.GetCreatedAt()
	if createdAt == nil {
		return nil
	}
	eventTime := createdAt.AsTime()
	now := time.Now()
	if now.Sub(eventTime) > callNotificationFreshness || eventTime.Sub(now) > callNotificationFutureTolerance {
		return nil
	}
	notificationTime := eventTime
	if notificationTime.After(now) {
		// A small positive clock skew between replicas must not make a valid call
		// live for longer than the one-minute delivery window.
		notificationTime = now
	}
	if err := m.waitForRoomState(ctx, started.GetRoomId()); err != nil {
		return err
	}
	active, ok := m.core.CallState.ActiveCall(started.GetRoomId())
	if !ok || active.CallID != started.GetCallId() {
		return nil
	}
	room, err := m.core.FindRoomByID(ctx, started.GetRoomId())
	if err != nil {
		return fmt.Errorf("resolve call notification room: %w", err)
	}
	members, err := m.core.GetRoomMembersList(ctx, KindOfRoom(room), started.GetRoomId())
	if err != nil {
		return fmt.Errorf("resolve current call notification members: %w", err)
	}

	for _, membership := range members {
		recipientID := membership.GetUserId()
		if recipientID == event.GetActorId() {
			continue
		}
		level, err := m.core.GetEffectiveNotificationLevel(ctx, recipientID, started.GetRoomId())
		if err != nil {
			return fmt.Errorf("resolve call notification preference for %s: %w", recipientID, err)
		}
		if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES {
			continue
		}
		_, err = m.core.createNotification(ctx, recipientID, event.GetActorId(), &corev1.Notification{
			Notification: &corev1.Notification_CallStarted{
				CallStarted: &corev1.CallStartedNotification{
					RoomId:  started.GetRoomId(),
					EventId: event.GetId(),
					CallId:  started.GetCallId(),
				},
			},
		}, notificationCreateOptions{
			id:        callNotificationID(started.GetCallId()),
			createdAt: notificationTime,
			// Keep the hidden backing record long enough to emit a tagged native
			// dismissal when a call lasts beyond the one-minute alert window.
			ttl:        notificationTTL,
			idempotent: true,
		})
		if err != nil {
			return fmt.Errorf("create call notification for %s: %w", recipientID, err)
		}
	}
	return nil
}

func (m *CallNotificationModel) handleCallEnded(ctx context.Context, subjectEvent *events.SubjectEvent) error {
	event := subjectEvent.Event
	ended := event.GetVoiceCallEnded()
	if ended == nil || ended.GetRoomId() == "" || ended.GetCallId() == "" {
		return nil
	}
	if subjectEvent.Subject != events.RoomAggregate(ended.GetRoomId()).Subject(events.EventCallEnded) {
		return nil
	}
	createdAt := event.GetCreatedAt()
	if createdAt == nil {
		return nil
	}
	eventTime := createdAt.AsTime()
	now := time.Now()
	if now.Sub(eventTime) > callNotificationFreshness || eventTime.Sub(now) > callNotificationFutureTolerance {
		// Incremental consumers replay durable facts after a restart. A missed
		// call is an immediate delivery signal, not a retrospective import.
		return nil
	}
	joinedUsers, callerID, startedEventID, err := m.joinedUsersForCall(ctx, ended.GetRoomId(), ended.GetCallId())
	if err != nil {
		return err
	}
	if callerID == "" {
		callerID = event.GetActorId()
	}
	if startedEventID == "" {
		startedEventID = event.GetId()
	}

	notificationTime := eventTime
	if notificationTime.After(now) {
		notificationTime = now
	}

	recipients, err := m.missedCallRecipients(ctx, ended.GetRoomId(), callerID, joinedUsers)
	if err != nil {
		return err
	}
	_, err = m.core.dismissNotificationsAcrossUsers(ctx, func(notification *corev1.Notification) bool {
		call := notification.GetCallStarted()
		return call != nil && !call.GetMissed() && call.GetRoomId() == ended.GetRoomId() && call.GetCallId() == ended.GetCallId()
	})
	if err != nil {
		return err
	}
	for _, recipientID := range recipients {
		_, err = m.core.createNotification(ctx, recipientID, callerID, &corev1.Notification{
			Notification: &corev1.Notification_CallStarted{
				CallStarted: &corev1.CallStartedNotification{
					RoomId:  ended.GetRoomId(),
					EventId: startedEventID,
					CallId:  ended.GetCallId(),
					Missed:  true,
				},
			},
		}, notificationCreateOptions{
			id:         missedCallNotificationID(ended.GetCallId()),
			createdAt:  notificationTime,
			ttl:        notificationTTL,
			idempotent: true,
		})
		if err != nil {
			return fmt.Errorf("create missed-call notification for %s: %w", recipientID, err)
		}
	}
	return nil
}

func (m *CallNotificationModel) joinedUsersForCall(ctx context.Context, roomID, callID string) (map[string]struct{}, string, string, error) {
	startedEvents, _, err := m.core.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(roomID).Subject(events.EventCallStarted))
	if err != nil {
		return nil, "", "", fmt.Errorf("list call starts: %w", err)
	}
	callerID := ""
	startedEventID := ""
	for _, roomEvent := range startedEvents {
		if started := roomEvent.GetVoiceCallStarted(); started != nil && started.GetRoomId() == roomID && started.GetCallId() == callID {
			callerID = roomEvent.GetActorId()
			startedEventID = roomEvent.GetId()
			break
		}
	}

	joinedEvents, _, err := m.core.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(roomID).Subject(events.EventCallParticipantJoined))
	if err != nil {
		return nil, "", "", fmt.Errorf("list call participants: %w", err)
	}
	joinedUsers := make(map[string]struct{})
	for _, roomEvent := range joinedEvents {
		joined := roomEvent.GetVoiceCallParticipantJoined()
		if joined == nil || joined.GetRoomId() != roomID || joined.GetCallId() != callID {
			continue
		}
		if userID := roomEvent.GetActorId(); userID != "" {
			joinedUsers[userID] = struct{}{}
		}
	}
	return joinedUsers, callerID, startedEventID, nil
}

func (m *CallNotificationModel) missedCallRecipients(ctx context.Context, roomID, actorID string, joinedUsers map[string]struct{}) ([]string, error) {
	room, err := m.core.FindRoomByID(ctx, roomID)
	if err != nil {
		return nil, fmt.Errorf("load missed-call room: %w", err)
	}
	members, err := m.core.GetRoomMembersList(ctx, KindOfRoom(room), roomID)
	if err != nil {
		return nil, fmt.Errorf("list missed-call recipients: %w", err)
	}

	recipients := make([]string, 0, len(members))
	seen := make(map[string]struct{}, len(members))
	for _, membership := range members {
		recipientID := membership.GetUserId()
		if recipientID == "" || recipientID == actorID {
			continue
		}
		if _, joined := joinedUsers[recipientID]; joined {
			continue
		}
		if _, duplicate := seen[recipientID]; duplicate {
			continue
		}
		level, err := m.core.GetEffectiveNotificationLevel(ctx, recipientID, roomID)
		if err != nil {
			return nil, fmt.Errorf("resolve missed-call notification preference %s: %w", recipientID, err)
		}
		if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES {
			continue
		}
		seen[recipientID] = struct{}{}
		recipients = append(recipients, recipientID)
	}
	return recipients, nil
}

func missedCallNotificationID(callID string) string {
	sum := sha256.Sum256([]byte("missed-call-notification:" + callID))
	return missedCallNotificationIDPrefix + hex.EncodeToString(sum[:])
}

func (m *CallNotificationModel) waitForRoomState(ctx context.Context, roomID string) error {
	tail, err := m.core.EventPublisher.LastSubjectPosition(ctx, events.RoomAggregate(roomID).AllEventsFilter())
	if err != nil {
		return fmt.Errorf("read call room tail: %w", err)
	}
	if tail.IsZero() {
		return nil
	}
	if err := m.core.RoomDirectoryProjector.WaitFor(ctx, tail); err != nil {
		return fmt.Errorf("wait for call room membership: %w", err)
	}
	if err := m.core.CallStateProjector.WaitFor(ctx, tail); err != nil {
		return fmt.Errorf("wait for active call: %w", err)
	}
	return nil
}

func callNotificationID(callID string) string {
	sum := sha256.Sum256([]byte("call-notification:" + callID))
	return "N" + hex.EncodeToString(sum[:])
}
