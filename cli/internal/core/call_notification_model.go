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
	_, err := m.core.dismissNotificationsAcrossUsers(ctx, func(notification *corev1.Notification) bool {
		call := notification.GetCallStarted()
		return call != nil && call.GetRoomId() == ended.GetRoomId() && call.GetCallId() == ended.GetCallId()
	})
	return err
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
