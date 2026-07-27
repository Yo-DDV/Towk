package events

import (
	"errors"
	"testing"

	"github.com/nats-io/nats.go/jetstream"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestValidateSecureDeleteAggregateRejectsBroadAndForgedTargets(t *testing.T) {
	t.Parallel()

	tests := []Aggregate{
		{},
		{Type: AggregateRoom, ID: ">"},
		{Type: AggregateRoom, ID: "*"},
		{Type: AggregateRoom, ID: "R0000000000000.>"},
		{Type: AggregateRoom, ID: "A00000000000000"},
		{Type: AggregateAsset, ID: "R00000000000000"},
		{Type: AggregateRBAC, ID: RBACServerID},
		{Type: AggregateConfig, ID: "R00000000000000"},
	}
	for _, aggregate := range tests {
		aggregate := aggregate
		t.Run(aggregate.Type+"/"+aggregate.ID, func(t *testing.T) {
			t.Parallel()
			if err := ValidateSecureDeleteAggregate(aggregate); err == nil {
				t.Fatalf("ValidateSecureDeleteAggregate(%+v) = nil, want rejection", aggregate)
			}
		})
	}
}

func TestPublisherSecureDeleteAggregateIsolatesExactRoom(t *testing.T) {
	js, stream := setupTestStream(t)
	publisher := NewPublisher(js, stream, testLogger())
	ctx := testContext(t)

	targetID := "R00000000000000"
	controlID := "R11111111111111"
	for _, userID := range []string{"U00000000000000", "U11111111111111"} {
		if _, err := publisher.Append(ctx, RoomAggregate(targetID).Subject(EventUserJoinedRoom), makeEvent(targetID, userID)); err != nil {
			t.Fatalf("append target: %v", err)
		}
		if _, err := publisher.Append(ctx, RoomAggregate(controlID).Subject(EventUserJoinedRoom), makeEvent(controlID, userID)); err != nil {
			t.Fatalf("append control: %v", err)
		}
	}

	deleted, err := publisher.SecureDeleteAggregate(ctx, RoomAggregate(targetID))
	if err != nil {
		t.Fatalf("SecureDeleteAggregate: %v", err)
	}
	if deleted != 2 {
		t.Fatalf("deleted = %d, want 2", deleted)
	}

	targetEvents, _, err := publisher.SubjectEvents(ctx, RoomAggregate(targetID).AllEventsFilter())
	if err != nil {
		t.Fatalf("read target events: %v", err)
	}
	if len(targetEvents) != 0 {
		t.Fatalf("target events after secure delete = %d, want 0", len(targetEvents))
	}
	controlEvents, _, err := publisher.SubjectEvents(ctx, RoomAggregate(controlID).AllEventsFilter())
	if err != nil {
		t.Fatalf("read control events: %v", err)
	}
	if len(controlEvents) != 2 {
		t.Fatalf("control events after target secure delete = %d, want 2", len(controlEvents))
	}

	if _, err := stream.GetLastMsgForSubject(ctx, RoomAggregate(targetID).AllEventsFilter()); !errors.Is(err, jetstream.ErrMsgNotFound) {
		t.Fatalf("last target message error = %v, want ErrMsgNotFound", err)
	}
}

func TestPublisherSecureDeleteAggregateExceptPreservesExactTombstone(t *testing.T) {
	js, stream := setupTestStream(t)
	publisher := NewPublisher(js, stream, testLogger())
	ctx := testContext(t)
	targetID := "R00000000000000"

	if _, err := publisher.Append(ctx, RoomAggregate(targetID).Subject(EventUserJoinedRoom), makeEvent(targetID, "U00000000000000")); err != nil {
		t.Fatalf("append historical event: %v", err)
	}
	tombstone := makeEvent(targetID, "U11111111111111")
	tombstone.Id = "E00000000000000"
	tombstoneSeq, err := publisher.Append(ctx, RoomAggregate(targetID).Subject(EventUserJoinedRoom), tombstone)
	if err != nil {
		t.Fatalf("append tombstone stand-in: %v", err)
	}

	deleted, err := publisher.SecureDeleteAggregateExcept(ctx, RoomAggregate(targetID), map[uint64]struct{}{tombstoneSeq: {}})
	if err != nil {
		t.Fatalf("SecureDeleteAggregateExcept: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}
	events, _, err := publisher.SubjectEvents(ctx, RoomAggregate(targetID).AllEventsFilter())
	if err != nil {
		t.Fatalf("read preserved events: %v", err)
	}
	if len(events) != 1 || events[0].GetId() != tombstone.GetId() {
		t.Fatalf("preserved events = %+v, want only %s", events, tombstone.GetId())
	}
}

func TestPublisherSecureDeleteAggregateExceptRejectsUnknownKeepSequence(t *testing.T) {
	js, stream := setupTestStream(t)
	publisher := NewPublisher(js, stream, testLogger())
	ctx := testContext(t)

	_, err := publisher.SecureDeleteAggregateExcept(ctx, RoomAggregate("R00000000000000"), map[uint64]struct{}{42: {}})
	if err == nil {
		t.Fatal("SecureDeleteAggregateExcept accepted an unknown keep sequence")
	}
}

func TestPublisherSecureDeleteAggregateIsRetrySafe(t *testing.T) {
	js, stream := setupTestStream(t)
	publisher := NewPublisher(js, stream, testLogger())
	ctx := testContext(t)
	targetID := "A00000000000000"

	deleted, err := publisher.SecureDeleteAggregate(ctx, AssetAggregate(targetID))
	if err != nil {
		t.Fatalf("first empty secure delete: %v", err)
	}
	if deleted != 0 {
		t.Fatalf("first empty secure delete deleted = %d, want 0", deleted)
	}
	deleted, err = publisher.SecureDeleteAggregate(ctx, AssetAggregate(targetID))
	if err != nil {
		t.Fatalf("second empty secure delete: %v", err)
	}
	if deleted != 0 {
		t.Fatalf("second empty secure delete deleted = %d, want 0", deleted)
	}
}

func TestPublisherSecureDeleteAggregateThroughExceptLeavesLaterMessages(t *testing.T) {
	js, stream := setupTestStream(t)
	publisher := NewPublisher(js, stream, testLogger())
	ctx := testContext(t)
	targetID := "R00000000000000"
	aggregate := RoomAggregate(targetID)

	if _, err := publisher.Append(ctx, aggregate.Subject(EventUserJoinedRoom), makeEvent(targetID, "U00000000000000")); err != nil {
		t.Fatalf("append historical event: %v", err)
	}
	tombstone := makeEvent(targetID, "U11111111111111")
	tombstone.Id = "E00000000000000"
	tombstoneSeq, err := publisher.Append(ctx, aggregate.Subject(EventUserJoinedRoom), tombstone)
	if err != nil {
		t.Fatalf("append tombstone stand-in: %v", err)
	}
	late := makeEvent(targetID, "U22222222222222")
	late.Id = "E11111111111111"
	if _, err := publisher.Append(ctx, aggregate.Subject(EventUserJoinedRoom), late); err != nil {
		t.Fatalf("append late event: %v", err)
	}

	deleted, err := publisher.SecureDeleteAggregateThroughExcept(
		ctx,
		aggregate,
		tombstoneSeq,
		map[uint64]struct{}{tombstoneSeq: {}},
	)
	if err != nil {
		t.Fatalf("SecureDeleteAggregateThroughExcept: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}
	events, _, err := publisher.SubjectEvents(ctx, aggregate.AllEventsFilter())
	if err != nil {
		t.Fatalf("read retained events: %v", err)
	}
	if len(events) != 2 || events[0].GetId() != tombstone.GetId() || events[1].GetId() != late.GetId() {
		t.Fatalf("retained event IDs = [%v, %v], want tombstone then late event", events[0].GetId(), events[1].GetId())
	}
}

func TestPublisherSecureDeleteRoomNotificationPreferenceEventsIsolatesTargetRoom(t *testing.T) {
	js, stream := setupTestStream(t)
	publisher := NewPublisher(js, stream, testLogger())
	ctx := testContext(t)

	targetRoomID := "R00000000000000"
	controlRoomID := "R11111111111111"
	userOne := "U00000000000000"
	userTwo := "U11111111111111"

	appendSet := func(eventID, userID, roomID string) {
		t.Helper()
		event := &corev1.Event{
			Id: eventID,
			Event: &corev1.Event_UserRoomNotificationLevelSet{
				UserRoomNotificationLevelSet: &corev1.UserRoomNotificationLevelSetEvent{
					UserId: userID,
					RoomId: roomID,
					Level:  corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES,
				},
			},
		}
		if _, err := publisher.Append(ctx, ConfigSubjectAggregate(userID).Subject(EventUserRoomNotificationLevelSet), event); err != nil {
			t.Fatalf("append preference: %v", err)
		}
	}
	appendSet("E00000000000000", userOne, targetRoomID)
	appendSet("E11111111111111", userOne, controlRoomID)
	appendSet("E22222222222222", userTwo, targetRoomID)

	before, err := publisher.RoomNotificationPreferenceEventCount(ctx, targetRoomID)
	if err != nil {
		t.Fatalf("count target preferences before delete: %v", err)
	}
	if before != 2 {
		t.Fatalf("target preference count before = %d, want 2", before)
	}

	deleted, err := publisher.SecureDeleteRoomNotificationPreferenceEvents(ctx, targetRoomID)
	if err != nil {
		t.Fatalf("SecureDeleteRoomNotificationPreferenceEvents: %v", err)
	}
	if deleted != 2 {
		t.Fatalf("deleted = %d, want 2", deleted)
	}
	remaining, err := publisher.RoomNotificationPreferenceEventCount(ctx, targetRoomID)
	if err != nil {
		t.Fatalf("count target preferences after delete: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("target preference count after = %d, want 0", remaining)
	}

	control, _, err := publisher.SubjectEvents(ctx, ConfigSubjectAggregate(userOne).Subject(EventUserRoomNotificationLevelSet))
	if err != nil {
		t.Fatalf("read control preference subject: %v", err)
	}
	if len(control) != 1 || control[0].GetUserRoomNotificationLevelSet().GetRoomId() != controlRoomID {
		t.Fatalf("control preferences = %+v, want one untouched control-room event", control)
	}
}

func TestPublisherSecureDeleteRoomNotificationPreferenceEventsRejectsSubjectPayloadMismatch(t *testing.T) {
	js, stream := setupTestStream(t)
	publisher := NewPublisher(js, stream, testLogger())
	ctx := testContext(t)

	targetRoomID := "R00000000000000"
	payloadUserID := "U00000000000000"
	forgedSubjectUserID := "U11111111111111"
	event := &corev1.Event{
		Id: "E00000000000000",
		Event: &corev1.Event_UserRoomNotificationLevelSet{
			UserRoomNotificationLevelSet: &corev1.UserRoomNotificationLevelSetEvent{
				UserId: payloadUserID,
				RoomId: targetRoomID,
				Level:  corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL,
			},
		},
	}
	forgedSubject := ConfigSubjectAggregate(forgedSubjectUserID).Subject(EventUserRoomNotificationLevelSet)
	if _, err := publisher.Append(ctx, forgedSubject, event); err != nil {
		t.Fatalf("append forged preference: %v", err)
	}

	if _, err := publisher.SecureDeleteRoomNotificationPreferenceEvents(ctx, targetRoomID); err == nil {
		t.Fatal("secure delete accepted a preference whose subject disagrees with its payload")
	}
	stored, _, err := publisher.SubjectEvents(ctx, forgedSubject)
	if err != nil {
		t.Fatalf("read forged preference after rejection: %v", err)
	}
	if len(stored) != 1 || stored[0].GetId() != event.GetId() {
		t.Fatalf("forged preference was mutated despite rejection: %+v", stored)
	}
}
