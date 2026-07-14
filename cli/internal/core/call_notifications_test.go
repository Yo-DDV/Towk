package core

import (
	"context"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestCallNotificationsOnlyReachCurrentAllMessagesMembers(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	starter := createCallNotificationUser(t, core, ctx, "call-starter")
	allMessages := createCallNotificationUser(t, core, ctx, "call-all")
	normal := createCallNotificationUser(t, core, ctx, "call-normal")
	muted := createCallNotificationUser(t, core, ctx, "call-muted")
	outsider := createCallNotificationUser(t, core, ctx, "call-outsider")
	room, err := core.CreateRoom(ctx, starter.Id, KindChannel, "", "call-notifications", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	for _, member := range []*corev1.User{allMessages, normal, muted} {
		if _, err := core.AddMember(ctx, starter.Id, KindChannel, room.Id, member.Id); err != nil {
			t.Fatalf("AddMember(%s): %v", member.Login, err)
		}
	}
	if err := core.SetSpaceNotificationLevel(ctx, normal.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(normal): %v", err)
	}
	if err := core.SetSpaceNotificationLevel(ctx, muted.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(muted): %v", err)
	}

	if err := core.RecordCallParticipantJoined(ctx, KindChannel, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantJoined: %v", err)
	}
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("consume call notifications: %v", err)
	}

	call, ok := core.CallState.ActiveCall(room.Id)
	if !ok || call.CallID == "" {
		t.Fatal("active call was not projected")
	}
	assertCallNotification(t, core, ctx, allMessages.Id, room.Id, call.CallID, starter.Id)
	assertNoCallNotifications(t, core, ctx, starter.Id)
	assertNoCallNotifications(t, core, ctx, normal.Id)
	assertNoCallNotifications(t, core, ctx, muted.Id)
	assertNoCallNotifications(t, core, ctx, outsider.Id)

	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("replay call notifications: %v", err)
	}
	assertCallNotification(t, core, ctx, allMessages.Id, room.Id, call.CallID, starter.Id)
}

func TestCallNotificationsApplyAllMessagesRuleToPrivateConversations(t *testing.T) {
	tests := []struct {
		name  string
		level corev1.NotificationLevel
		want  bool
	}{
		{name: "all messages", level: corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES, want: true},
		{name: "normal", level: corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL, want: false},
		{name: "muted", level: corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			core, _ := setupTestCore(t)
			ctx := testContext(t)
			starter := createCallNotificationUser(t, core, ctx, "private-starter")
			recipient := createCallNotificationUser(t, core, ctx, "private-recipient")
			room, _, err := core.FindOrCreateDM(ctx, starter.Id, []string{recipient.Id})
			if err != nil {
				t.Fatalf("FindOrCreateDM: %v", err)
			}
			if err := core.SetSpaceNotificationLevel(ctx, recipient.Id, tt.level); err != nil {
				t.Fatalf("SetSpaceNotificationLevel: %v", err)
			}

			if err := core.RecordCallParticipantJoined(ctx, KindDM, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
				t.Fatalf("RecordCallParticipantJoined: %v", err)
			}
			if err := core.callNotifications.consume(ctx); err != nil {
				t.Fatalf("consume call notifications: %v", err)
			}

			call, ok := core.CallState.ActiveCall(room.Id)
			if !ok {
				t.Fatal("active private call was not projected")
			}
			if tt.want {
				assertCallNotification(t, core, ctx, recipient.Id, room.Id, call.CallID, starter.Id)
			} else {
				assertNoCallNotifications(t, core, ctx, recipient.Id)
			}
		})
	}
}

func TestCallNotificationsIncludeEffectiveMembersOfUniversalRooms(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	starter := createCallNotificationUser(t, core, ctx, "universal-call-starter")
	recipient := createCallNotificationUser(t, core, ctx, "universal-call-recipient")
	room, err := core.CreateRoom(ctx, starter.Id, KindChannel, "", "universal-call", "", WithUniversalRoom(true))
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if core.RoomMembership.IsMember(room.Id, recipient.Id) {
		t.Fatal("recipient unexpectedly has an explicit universal-room membership")
	}
	effective, err := core.RoomMembershipExists(ctx, KindChannel, recipient.Id, room.Id)
	if err != nil || !effective {
		t.Fatalf("effective universal membership = %v, %v", effective, err)
	}

	if err := core.RecordCallParticipantJoined(ctx, KindChannel, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantJoined: %v", err)
	}
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("consume call notifications: %v", err)
	}
	active, ok := core.CallState.ActiveCall(room.Id)
	if !ok {
		t.Fatal("call did not become active")
	}
	assertCallNotification(t, core, ctx, recipient.Id, room.Id, active.CallID, starter.Id)
}

func TestCallNotificationsDisappearOnEndMembershipLossAndPreferenceDowngrade(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	starter := createCallNotificationUser(t, core, ctx, "lifecycle-starter")
	recipient := createCallNotificationUser(t, core, ctx, "lifecycle-recipient")
	room, err := core.CreateRoom(ctx, starter.Id, KindChannel, "", "call-lifecycle", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, starter.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember: %v", err)
	}

	startCall := func() string {
		t.Helper()
		if err := core.RecordCallParticipantJoined(ctx, KindChannel, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
			t.Fatalf("RecordCallParticipantJoined: %v", err)
		}
		if err := core.callNotifications.consume(ctx); err != nil {
			t.Fatalf("consume call notifications: %v", err)
		}
		call, ok := core.CallState.ActiveCall(room.Id)
		if !ok {
			t.Fatal("active call was not projected")
		}
		assertCallNotification(t, core, ctx, recipient.Id, room.Id, call.CallID, starter.Id)
		return call.CallID
	}

	firstCallID := startCall()
	if err := core.RecordCallParticipantLeft(ctx, KindChannel, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantLeft: %v", err)
	}
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("consume call ending: %v", err)
	}
	assertNoCallNotifications(t, core, ctx, recipient.Id)
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("replay ended call: %v", err)
	}
	assertNoCallNotifications(t, core, ctx, recipient.Id)

	secondCallID := startCall()
	if secondCallID == firstCallID {
		t.Fatal("successive calls reused a call ID")
	}
	if err := core.SetSpaceNotificationLevel(ctx, recipient.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(normal): %v", err)
	}
	assertNoCallNotifications(t, core, ctx, recipient.Id)

	if err := core.SetSpaceNotificationLevel(ctx, recipient.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(all): %v", err)
	}
	if _, err := core.RemoveMember(ctx, starter.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}
	assertNoCallNotifications(t, core, ctx, recipient.Id)
}

func TestCallEndedBeforeNotificationDeliveryNeverEmitsAnAlert(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	starter := createCallNotificationUser(t, core, ctx, "ended-before-delivery-starter")
	recipient := createCallNotificationUser(t, core, ctx, "ended-before-delivery-recipient")
	room, err := core.CreateRoom(ctx, starter.Id, KindChannel, "", "ended-before-delivery", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, starter.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember: %v", err)
	}

	callbacks := make(chan string, 1)
	core.OnNotificationCreated = func(_ context.Context, notification *corev1.Notification) {
		if notification.GetCallStarted() != nil {
			callbacks <- notification.GetId()
		}
	}
	if err := core.RecordCallParticipantJoined(ctx, KindChannel, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantJoined: %v", err)
	}
	if err := core.RecordCallParticipantLeft(ctx, KindChannel, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantLeft: %v", err)
	}
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("consume completed call: %v", err)
	}

	assertNoCallNotifications(t, core, ctx, recipient.Id)
	select {
	case notificationID := <-callbacks:
		t.Fatalf("completed call emitted push callback %q", notificationID)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestActiveCallNotificationIsNotDismissedByRoomReadMarkers(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	starter := createCallNotificationUser(t, core, ctx, "read-marker-starter")
	recipient := createCallNotificationUser(t, core, ctx, "read-marker-recipient")
	room, err := core.CreateRoom(ctx, starter.Id, KindChannel, "", "read-marker-call", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, starter.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	if err := core.RecordCallParticipantJoined(ctx, KindChannel, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantJoined: %v", err)
	}
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("consume call notification: %v", err)
	}
	active, ok := core.CallState.ActiveCall(room.Id)
	if !ok {
		t.Fatal("call did not become active")
	}

	if dismissed := core.DismissRoomReadNotifications(ctx, KindChannel, recipient.Id, room.Id, time.Now().Add(time.Hour)); dismissed != 0 {
		t.Fatalf("room read marker dismissed %d active call notifications", dismissed)
	}
	assertCallNotification(t, core, ctx, recipient.Id, room.Id, active.CallID, starter.Id)
}

func TestCallNotificationsRejectExpiredStartEvents(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	starter := createCallNotificationUser(t, core, ctx, "stale-starter")
	recipient := createCallNotificationUser(t, core, ctx, "stale-recipient")
	room, err := core.CreateRoom(ctx, starter.Id, KindChannel, "", "stale-call", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, starter.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember: %v", err)
	}

	callID := NewCallID()
	event := newCallStartedEvent(room.Id, starter.Id, callID, "test-call-key", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER)
	event.CreatedAt = timestamppb.New(time.Now().Add(-callNotificationFreshness - time.Second))
	seq, err := core.EventPublisher.AppendEventually(ctx, events.RoomAggregate(room.Id).Subject(events.EventCallStarted), event)
	if err != nil {
		t.Fatalf("append stale call start: %v", err)
	}
	if err := core.CallStateProjector.WaitFor(ctx, events.SubjectPosition(events.RoomAggregate(room.Id).AllEventsFilter(), seq)); err != nil {
		t.Fatalf("wait stale call projection: %v", err)
	}
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("consume stale call start: %v", err)
	}
	assertNoCallNotifications(t, core, ctx, recipient.Id)
}

func TestCallNotificationsAcceptBoundedFutureClockSkewWithoutExtendingFreshness(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	starter := createCallNotificationUser(t, core, ctx, "skewed-starter")
	recipient := createCallNotificationUser(t, core, ctx, "skewed-recipient")
	room, err := core.CreateRoom(ctx, starter.Id, KindChannel, "", "skewed-call", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, starter.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember: %v", err)
	}

	eventTime := time.Now().Add(30 * time.Second)
	callID := NewCallID()
	event := newCallStartedEvent(room.Id, starter.Id, callID, "test-call-key", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER)
	event.CreatedAt = timestamppb.New(eventTime)
	seq, err := core.EventPublisher.AppendEventually(ctx, events.RoomAggregate(room.Id).Subject(events.EventCallStarted), event)
	if err != nil {
		t.Fatalf("append skewed call start: %v", err)
	}
	if err := core.CallStateProjector.WaitFor(ctx, events.SubjectPosition(events.RoomAggregate(room.Id).AllEventsFilter(), seq)); err != nil {
		t.Fatalf("wait skewed call projection: %v", err)
	}
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("consume skewed call start: %v", err)
	}

	notifications, err := core.GetNotifications(ctx, recipient.Id)
	if err != nil || len(notifications) != 1 {
		t.Fatalf("skewed call notifications = %d, %v", len(notifications), err)
	}
	if got := notifications[0].GetCreatedAt().AsTime(); got.After(time.Now().Add(time.Second)) {
		t.Fatalf("notification timestamp remained in the future: %s", got)
	}
}

func TestCallNotificationReplayDoesNotDuplicatePushSideEffects(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	starter := createCallNotificationUser(t, core, ctx, "replay-starter")
	recipient := createCallNotificationUser(t, core, ctx, "replay-recipient")
	room, err := core.CreateRoom(ctx, starter.Id, KindChannel, "", "replay-call", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, starter.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember: %v", err)
	}

	callbacks := make(chan string, 2)
	core.OnNotificationCreated = func(_ context.Context, notification *corev1.Notification) {
		if notification.GetCallStarted() != nil {
			callbacks <- notification.GetId()
		}
	}
	if err := core.RecordCallParticipantJoined(ctx, KindChannel, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantJoined: %v", err)
	}
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("consume call notification: %v", err)
	}

	var firstID string
	select {
	case firstID = <-callbacks:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for initial call push callback")
	}

	replayed := NewCallNotificationModel(core)
	if err := replayed.consume(ctx); err != nil {
		t.Fatalf("replay call notification history: %v", err)
	}
	select {
	case duplicateID := <-callbacks:
		t.Fatalf("replay emitted duplicate push callback %q after %q", duplicateID, firstID)
	case <-time.After(100 * time.Millisecond):
	}
	assertCallNotification(t, core, ctx, recipient.Id, room.Id, core.CallState.RoomSnapshot(room.Id).Call.CallID, starter.Id)
}

func TestExpiredCallAlertBackingRecordStillDismissesWhenLongCallEnds(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	starter := createCallNotificationUser(t, core, ctx, "long-call-starter")
	recipient := createCallNotificationUser(t, core, ctx, "long-call-recipient")
	room, err := core.CreateRoom(ctx, starter.Id, KindChannel, "", "long-call", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, starter.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	if err := core.RecordCallParticipantJoined(ctx, KindChannel, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantJoined: %v", err)
	}
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("consume call notification: %v", err)
	}
	active, ok := core.CallState.ActiveCall(room.Id)
	if !ok {
		t.Fatal("call did not become active")
	}

	backing := &corev1.Notification{
		Id:          callNotificationID(active.CallID),
		RecipientId: recipient.Id,
		ActorId:     starter.Id,
		CreatedAt:   timestamppb.New(time.Now().Add(-2 * callNotificationFreshness)),
		Notification: &corev1.Notification_CallStarted{CallStarted: &corev1.CallStartedNotification{
			RoomId:  room.Id,
			EventId: "E-long-call",
			CallId:  active.CallID,
		}},
	}
	data, err := proto.Marshal(backing)
	if err != nil {
		t.Fatalf("marshal backing notification: %v", err)
	}
	key := notificationKey(recipient.Id, backing.Id)
	if _, err := core.storage.runtimeStateKV.Put(ctx, key, data); err != nil {
		t.Fatalf("store expired backing notification: %v", err)
	}
	assertNoCallNotifications(t, core, ctx, recipient.Id)

	dismissed := make(chan string, 1)
	core.OnNotificationDismissed = func(_ context.Context, _ string, notification *corev1.Notification) {
		if notification.GetCallStarted() != nil {
			dismissed <- notification.GetId()
		}
	}
	if err := core.RecordCallParticipantLeft(ctx, KindChannel, room.Id, starter.Id, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantLeft: %v", err)
	}
	if err := core.callNotifications.consume(ctx); err != nil {
		t.Fatalf("consume call end: %v", err)
	}
	select {
	case got := <-dismissed:
		if got != backing.Id {
			t.Fatalf("dismissed notification = %q, want %q", got, backing.Id)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for long-call native dismissal callback")
	}
	if _, err := core.storage.runtimeStateKV.Get(ctx, key); !isRuntimeStateKeyAbsent(err) {
		t.Fatalf("backing notification still exists after call end: %v", err)
	}
}

func createCallNotificationUser(t *testing.T, core *ChattoCore, ctx context.Context, login string) *corev1.User {
	t.Helper()
	user, err := core.CreateUser(ctx, SystemActorID, login, login, "password123")
	if err != nil {
		t.Fatalf("CreateUser(%s): %v", login, err)
	}
	return user
}

func assertCallNotification(t *testing.T, core *ChattoCore, ctx context.Context, userID, roomID, callID, actorID string) {
	t.Helper()
	notifications, err := core.GetNotifications(ctx, userID)
	if err != nil {
		t.Fatalf("GetNotifications(%s): %v", userID, err)
	}
	if len(notifications) != 1 {
		t.Fatalf("call notifications for %s = %d, want 1", userID, len(notifications))
	}
	call := notifications[0].GetCallStarted()
	if call == nil || call.GetRoomId() != roomID || call.GetCallId() != callID || call.GetEventId() == "" {
		t.Fatalf("call notification = %#v, want room=%s call=%s", call, roomID, callID)
	}
	if notifications[0].GetActorId() != actorID {
		t.Fatalf("call notification actor = %q, want %q", notifications[0].GetActorId(), actorID)
	}
}

func assertNoCallNotifications(t *testing.T, core *ChattoCore, ctx context.Context, userID string) {
	t.Helper()
	notifications, err := core.GetNotifications(ctx, userID)
	if err != nil {
		t.Fatalf("GetNotifications(%s): %v", userID, err)
	}
	for _, notification := range notifications {
		if notification.GetCallStarted() != nil {
			t.Fatalf("unexpected call notification for %s: %s", userID, notification.GetId())
		}
	}
}
