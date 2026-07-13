package core

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"hmans.de/chatto/internal/core/subjects"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestNotificationCallbackDispatchIsBoundedWithoutDroppingWork(t *testing.T) {
	core, _ := setupTestCore(t)
	const callbackCount = maxConcurrentNotificationCallbacks + 32

	release := make(chan struct{})
	var active atomic.Int32
	var peak atomic.Int32
	var executed atomic.Int32
	var callers sync.WaitGroup
	callers.Add(callbackCount)

	for range callbackCount {
		go func() {
			defer callers.Done()
			core.dispatchNotificationCallback(func() {
				current := active.Add(1)
				for {
					observed := peak.Load()
					if current <= observed || peak.CompareAndSwap(observed, current) {
						break
					}
				}
				<-release
				active.Add(-1)
				executed.Add(1)
			})
		}()
	}

	deadline := time.Now().Add(5 * time.Second)
	for active.Load() != maxConcurrentNotificationCallbacks && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := active.Load(); got != maxConcurrentNotificationCallbacks {
		close(release)
		callers.Wait()
		t.Fatalf("active callbacks = %d, want bounded pool saturation at %d", got, maxConcurrentNotificationCallbacks)
	}
	if got := peak.Load(); got > maxConcurrentNotificationCallbacks {
		close(release)
		callers.Wait()
		t.Fatalf("peak callbacks = %d, limit %d", got, maxConcurrentNotificationCallbacks)
	}

	close(release)
	callers.Wait()
	deadline = time.Now().Add(5 * time.Second)
	for executed.Load() != callbackCount && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := executed.Load(); got != callbackCount {
		t.Fatalf("executed callbacks = %d, want %d", got, callbackCount)
	}
}

func TestNotificationCallbackDispatchInitializesSlotsSafely(t *testing.T) {
	core := &ChattoCore{}
	const callbackCount = maxConcurrentNotificationCallbacks * 2

	var callers sync.WaitGroup
	var callbacks sync.WaitGroup
	callbacks.Add(callbackCount)
	for range callbackCount {
		callers.Add(1)
		go func() {
			defer callers.Done()
			core.dispatchNotificationCallback(callbacks.Done)
		}()
	}

	callers.Wait()
	callbacks.Wait()
	if core.notificationCallbackSlots == nil {
		t.Fatal("notification callback slots were not initialized")
	}
	if got := cap(core.notificationCallbackSlots); got != maxConcurrentNotificationCallbacks {
		t.Fatalf("notification callback slot capacity = %d, want %d", got, maxConcurrentNotificationCallbacks)
	}
}

func TestCreateNotification(t *testing.T) {
	core, nc := setupTestCore(t)
	ctx := context.Background()

	recipientID := "recipient-user"
	actorID := "actor-user"

	t.Run("creates DM notification", func(t *testing.T) {
		subject := subjects.LiveSyncUserEvent(recipientID, "notification_created")
		sub, err := nc.SubscribeSync(subject)
		if err != nil {
			t.Fatalf("SubscribeSync(%s): %v", subject, err)
		}
		defer sub.Unsubscribe()
		if err := nc.Flush(); err != nil {
			t.Fatalf("Flush subscription: %v", err)
		}

		notif := &corev1.Notification{
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{
					RoomId:  "dm-room-123",
					EventId: "dm-event-456",
				},
			},
		}

		created, err := core.CreateNotification(ctx, recipientID, actorID, notif)
		if err != nil {
			t.Fatalf("CreateNotification error: %v", err)
		}
		if created == nil {
			t.Fatal("Expected notification to be non-nil")
		}
		if created.Id == "" {
			t.Error("Expected notification to have an ID")
		}
		if created.RecipientId != recipientID {
			t.Errorf("Expected recipient %s, got %s", recipientID, created.RecipientId)
		}
		if created.ActorId != actorID {
			t.Errorf("Expected actor %s, got %s", actorID, created.ActorId)
		}
		if created.CreatedAt == nil {
			t.Error("Expected CreatedAt to be set")
		}

		// Verify it's a DM notification
		dmNotif := created.GetDmMessage()
		if dmNotif == nil {
			t.Error("Expected DM notification payload")
		}
		if dmNotif.RoomId != "dm-room-123" {
			t.Errorf("Expected room ID dm-room-123, got %s", dmNotif.RoomId)
		}
		if dmNotif.EventId != "dm-event-456" {
			t.Errorf("Expected event ID dm-event-456, got %s", dmNotif.EventId)
		}
		if _, err := core.storage.runtimeStateKV.Get(ctx, notificationKey(recipientID, created.Id)); err != nil {
			t.Fatalf("expected notification in RUNTIME_STATE: %v", err)
		}

		msg, err := sub.NextMsg(2 * time.Second)
		if err != nil {
			t.Fatalf("waiting for notification_created live event: %v", err)
		}
		var live corev1.LiveEvent
		if err := proto.Unmarshal(msg.Data, &live); err != nil {
			t.Fatalf("unmarshal live event: %v", err)
		}
		event := live.GetNotificationCreated()
		if event == nil {
			t.Fatalf("expected NotificationCreatedEvent, got %T", live.Event)
		}
		if event.RoomId != "dm-room-123" || event.EventId != "dm-event-456" {
			t.Fatalf("DM navigation context = (%q, %q), want (%q, %q)", event.RoomId, event.EventId, "dm-room-123", "dm-event-456")
		}
	})

	t.Run("creates mention notification", func(t *testing.T) {
		notif := &corev1.Notification{
			Notification: &corev1.Notification_Mention{
				Mention: &corev1.MentionNotification{
					RoomId:  "room-456",
					EventId: "event-789",
				},
			},
		}

		created, err := core.CreateNotification(ctx, recipientID, actorID, notif)
		if err != nil {
			t.Fatalf("CreateNotification error: %v", err)
		}

		mentionNotif := created.GetMention()
		if mentionNotif == nil {
			t.Fatal("Expected mention notification payload")
		}
		if mentionNotif.RoomId != "room-456" {
			t.Errorf("Expected room ID room-456, got %s", mentionNotif.RoomId)
		}
		if mentionNotif.EventId != "event-789" {
			t.Errorf("Expected event ID event-789, got %s", mentionNotif.EventId)
		}
	})

	t.Run("creates reply notification", func(t *testing.T) {
		notif := &corev1.Notification{
			Notification: &corev1.Notification_Reply{
				Reply: &corev1.ReplyNotification{
					RoomId:      "room-456",
					EventId:     "reply-event",
					InReplyToId: "root-event",
				},
			},
		}

		created, err := core.CreateNotification(ctx, recipientID, actorID, notif)
		if err != nil {
			t.Fatalf("CreateNotification error: %v", err)
		}

		replyNotif := created.GetReply()
		if replyNotif == nil {
			t.Fatal("Expected reply notification payload")
		}
		if replyNotif.InReplyToId != "root-event" {
			t.Errorf("Expected in reply to ID root-event, got %s", replyNotif.InReplyToId)
		}
	})

	t.Run("publishes room message notification routing context", func(t *testing.T) {
		subject := subjects.LiveSyncUserEvent(recipientID, "notification_created")
		sub, err := nc.SubscribeSync(subject)
		if err != nil {
			t.Fatalf("SubscribeSync(%s): %v", subject, err)
		}
		defer sub.Unsubscribe()
		if err := nc.Flush(); err != nil {
			t.Fatalf("Flush subscription: %v", err)
		}

		created, err := core.CreateNotification(ctx, recipientID, actorID, &corev1.Notification{
			Notification: &corev1.Notification_RoomMessage{
				RoomMessage: &corev1.RoomMessageNotification{
					RoomId:  "all-messages-room",
					EventId: "all-messages-event",
				},
			},
		})
		if err != nil {
			t.Fatalf("CreateNotification error: %v", err)
		}

		msg, err := sub.NextMsg(2 * time.Second)
		if err != nil {
			t.Fatalf("waiting for notification_created live event: %v", err)
		}

		var live corev1.LiveEvent
		if err := proto.Unmarshal(msg.Data, &live); err != nil {
			t.Fatalf("unmarshal live event: %v", err)
		}
		event := live.GetNotificationCreated()
		if event == nil {
			t.Fatalf("expected NotificationCreatedEvent, got %T", live.Event)
		}
		if event.NotificationId != created.Id {
			t.Errorf("NotificationId = %q, want %q", event.NotificationId, created.Id)
		}
		if event.RoomId != "all-messages-room" {
			t.Errorf("RoomId = %q, want all-messages-room", event.RoomId)
		}
		if event.EventId != "all-messages-event" {
			t.Errorf("EventId = %q, want all-messages-event", event.EventId)
		}
		if event.Silent {
			t.Fatal("NotificationCreatedEvent.Silent = true, want false")
		}
	})

	t.Run("creates silent notifications for do not disturb recipients", func(t *testing.T) {
		dndRecipientID := "dnd-recipient-user"
		if err := core.SetPresence(ctx, dndRecipientID, PresenceStatusDoNotDisturb); err != nil {
			t.Fatalf("SetPresence: %v", err)
		}
		pushCalls := make(chan *corev1.Notification, 1)
		core.OnNotificationCreated = func(ctx context.Context, notification *corev1.Notification) {
			pushCalls <- notification
		}
		t.Cleanup(func() {
			core.OnNotificationCreated = nil
		})

		subject := subjects.LiveSyncUserEvent(dndRecipientID, "notification_created")
		sub, err := nc.SubscribeSync(subject)
		if err != nil {
			t.Fatalf("SubscribeSync(%s): %v", subject, err)
		}
		defer sub.Unsubscribe()
		if err := nc.Flush(); err != nil {
			t.Fatalf("Flush subscription: %v", err)
		}

		created, err := core.CreateNotification(ctx, dndRecipientID, actorID, &corev1.Notification{
			Notification: &corev1.Notification_Mention{
				Mention: &corev1.MentionNotification{
					RoomId:  "dnd-room",
					EventId: "dnd-event",
				},
			},
		})
		if err != nil {
			t.Fatalf("CreateNotification error: %v", err)
		}
		if created == nil {
			t.Fatal("created notification = nil, want stored silent notification")
		}

		notifs, err := core.GetNotifications(ctx, dndRecipientID)
		if err != nil {
			t.Fatalf("GetNotifications: %v", err)
		}
		if len(notifs) != 1 {
			t.Fatalf("notifications = %d, want 1", len(notifs))
		}

		msg, err := sub.NextMsg(2 * time.Second)
		if err != nil {
			t.Fatalf("waiting for notification_created live event: %v", err)
		}
		var live corev1.LiveEvent
		if err := proto.Unmarshal(msg.Data, &live); err != nil {
			t.Fatalf("unmarshal live event: %v", err)
		}
		event := live.GetNotificationCreated()
		if event == nil {
			t.Fatalf("expected NotificationCreatedEvent, got %T", live.Event)
		}
		if !event.Silent {
			t.Fatal("NotificationCreatedEvent.Silent = false, want true")
		}

		select {
		case notification := <-pushCalls:
			t.Fatalf("push callback called with %+v, want no push for DND", notification)
		case <-time.After(50 * time.Millisecond):
		}
	})
}

func TestCreateNotificationRejectsInvalidInputWithoutMutatingCaller(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	for name, testCase := range map[string]struct {
		recipientID  string
		notification *corev1.Notification
	}{
		"missing recipient": {
			notification: &corev1.Notification{Notification: &corev1.Notification_Mention{Mention: &corev1.MentionNotification{RoomId: "room", EventId: "event"}}},
		},
		"missing notification": {recipientID: "recipient"},
		"missing payload": {
			recipientID:  "recipient",
			notification: &corev1.Notification{},
		},
		"missing room": {
			recipientID:  "recipient",
			notification: &corev1.Notification{Notification: &corev1.Notification_DmMessage{DmMessage: &corev1.DMMessageNotification{EventId: "event"}}},
		},
		"missing event": {
			recipientID:  "recipient",
			notification: &corev1.Notification{Notification: &corev1.Notification_RoomMessage{RoomMessage: &corev1.RoomMessageNotification{RoomId: "room"}}},
		},
	} {
		t.Run(name, func(t *testing.T) {
			created, err := core.CreateNotification(ctx, testCase.recipientID, "actor", testCase.notification)
			if !errors.Is(err, ErrInvalidArgument) {
				t.Fatalf("CreateNotification error = %v, want ErrInvalidArgument", err)
			}
			if created != nil {
				t.Fatalf("CreateNotification = %+v, want nil", created)
			}
		})
	}

	input := &corev1.Notification{
		Notification: &corev1.Notification_Mention{
			Mention: &corev1.MentionNotification{RoomId: "synthetic-room", EventId: "synthetic-event"},
		},
	}
	created, err := core.CreateNotification(ctx, "recipient", "actor", input)
	if err != nil {
		t.Fatalf("CreateNotification valid input: %v", err)
	}
	if created == nil {
		t.Fatal("CreateNotification valid input = nil")
	}
	if input.GetId() != "" || input.GetRecipientId() != "" || input.GetActorId() != "" || input.GetCreatedAt() != nil {
		t.Fatalf("caller-owned notification was mutated: %+v", input)
	}
}

func TestNotificationLifecycleRevalidationRejectsInaccessibleTargets(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	author, err := core.CreateUser(ctx, SystemActorID, "lifecycle-author", "Lifecycle Author", "password")
	if err != nil {
		t.Fatalf("CreateUser author: %v", err)
	}
	recipient, err := core.CreateUser(ctx, SystemActorID, "lifecycle-recipient", "Lifecycle Recipient", "password")
	if err != nil {
		t.Fatalf("CreateUser recipient: %v", err)
	}
	room, err := core.CreateRoom(ctx, author.Id, KindChannel, "", "notification-lifecycle", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, author.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	posted, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "lifecycle", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if _, err := core.DismissAllNotifications(ctx, recipient.Id); err != nil {
		t.Fatalf("DismissAllNotifications: %v", err)
	}

	left := newEvent(recipient.Id, &corev1.Event{Event: &corev1.Event_UserLeftRoom{
		UserLeftRoom: &corev1.UserLeftRoomEvent{RoomId: room.Id},
	}})
	if err := core.RoomMembership.Apply(left, 0); err != nil {
		t.Fatalf("apply projected membership loss: %v", err)
	}
	created, err := core.CreateNotification(ctx, recipient.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: posted.Id},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification after membership loss: %v", err)
	}
	if created != nil {
		t.Fatalf("CreateNotification after membership loss = %+v, want nil", created)
	}

	if err := core.RoomMembership.Apply(newEvent(recipient.Id, &corev1.Event{Event: &corev1.Event_UserJoinedRoom{
		UserJoinedRoom: &corev1.UserJoinedRoomEvent{RoomId: room.Id},
	}}), 0); err != nil {
		t.Fatalf("restore projected membership: %v", err)
	}
	created, err = core.CreateNotification(ctx, recipient.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: posted.Id},
		},
	})
	if err != nil || created == nil {
		t.Fatalf("CreateNotification before membership loss = (%+v, %v), want stored notification", created, err)
	}
	if err := core.RoomMembership.Apply(left, 0); err != nil {
		t.Fatalf("reapply projected membership loss: %v", err)
	}
	got, err := core.GetNotification(ctx, recipient.Id, created.Id)
	if err != nil {
		t.Fatalf("GetNotification after membership loss: %v", err)
	}
	if got != nil {
		t.Fatalf("GetNotification after membership loss = %+v, want nil", got)
	}
	listed, err := core.GetNotifications(ctx, recipient.Id)
	if err != nil {
		t.Fatalf("GetNotifications after membership loss: %v", err)
	}
	if len(listed) != 0 {
		t.Fatalf("GetNotifications after membership loss = %d, want 0", len(listed))
	}

	if err := core.DeleteRoom(ctx, author.Id, KindChannel, room.Id); err != nil {
		t.Fatalf("DeleteRoom: %v", err)
	}
	created, err = core.CreateNotification(ctx, recipient.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: posted.Id},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification after room deletion: %v", err)
	}
	if created != nil {
		t.Fatalf("CreateNotification after room deletion = %+v, want nil", created)
	}
}

func TestGetNotifications(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "get-notifs-user"

	t.Run("returns empty list when no notifications", func(t *testing.T) {
		notifs, err := core.GetNotifications(ctx, userID)
		if err != nil {
			t.Fatalf("GetNotifications error: %v", err)
		}
		if len(notifs) != 0 {
			t.Errorf("Expected 0 notifications, got %d", len(notifs))
		}
	})

	t.Run("returns notifications in reverse chronological order", func(t *testing.T) {
		// Create three notifications with small delays
		for i := 0; i < 3; i++ {
			notif := &corev1.Notification{
				Notification: &corev1.Notification_DmMessage{
					DmMessage: &corev1.DMMessageNotification{
						RoomId:  "room-" + string(rune('a'+i)),
						EventId: "event-" + string(rune('a'+i)),
					},
				},
			}
			_, err := core.CreateNotification(ctx, userID, "actor", notif)
			if err != nil {
				t.Fatalf("CreateNotification error: %v", err)
			}
			time.Sleep(10 * time.Millisecond) // Small delay to ensure different timestamps
		}

		notifs, err := core.GetNotifications(ctx, userID)
		if err != nil {
			t.Fatalf("GetNotifications error: %v", err)
		}
		if len(notifs) != 3 {
			t.Fatalf("Expected 3 notifications, got %d", len(notifs))
		}

		// Verify order (newest first)
		for i := 1; i < len(notifs); i++ {
			if notifs[i-1].CreatedAt.AsTime().Before(notifs[i].CreatedAt.AsTime()) {
				t.Error("Notifications not in descending chronological order")
			}
		}
	})
}

func TestGetNotification(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "single-notif-user"

	t.Run("returns nil for non-existent notification", func(t *testing.T) {
		notif, err := core.GetNotification(ctx, userID, "non-existent-id")
		if err != nil {
			t.Fatalf("GetNotification error: %v", err)
		}
		if notif != nil {
			t.Error("Expected nil for non-existent notification")
		}
	})

	t.Run("returns existing notification", func(t *testing.T) {
		created, _ := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "test-room", EventId: "test-event"},
			},
		})

		retrieved, err := core.GetNotification(ctx, userID, created.Id)
		if err != nil {
			t.Fatalf("GetNotification error: %v", err)
		}
		if retrieved == nil {
			t.Fatal("Expected notification to be found")
		}
		if retrieved.Id != created.Id {
			t.Errorf("Expected ID %s, got %s", created.Id, retrieved.Id)
		}
	})
}

func TestDismissNotification(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "dismiss-user"

	t.Run("returns false for non-existent notification", func(t *testing.T) {
		dismissed, err := core.DismissNotification(ctx, userID, "non-existent-id")
		if err != nil {
			t.Fatalf("DismissNotification error: %v", err)
		}
		if dismissed {
			t.Error("Expected false for non-existent notification")
		}
	})

	t.Run("dismisses existing notification", func(t *testing.T) {
		created, _ := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "test-room", EventId: "test-event"},
			},
		})

		dismissed, err := core.DismissNotification(ctx, userID, created.Id)
		if err != nil {
			t.Fatalf("DismissNotification error: %v", err)
		}
		if !dismissed {
			t.Error("Expected notification to be dismissed")
		}

		// Verify it's gone
		retrieved, _ := core.GetNotification(ctx, userID, created.Id)
		if retrieved != nil {
			t.Error("Expected notification to be deleted")
		}
	})

	t.Run("returns false when dismissing same notification twice", func(t *testing.T) {
		created, _ := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "double-dismiss", EventId: "double-dismiss-event"},
			},
		})

		// First dismiss
		_, _ = core.DismissNotification(ctx, userID, created.Id)

		// Second dismiss should return false
		dismissed, err := core.DismissNotification(ctx, userID, created.Id)
		if err != nil {
			t.Fatalf("Second DismissNotification error: %v", err)
		}
		if dismissed {
			t.Error("Expected false when dismissing already dismissed notification")
		}
	})

	t.Run("concurrent dismissals publish side effects once", func(t *testing.T) {
		created, err := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "concurrent-dismiss", EventId: "concurrent-dismiss-event"},
			},
		})
		if err != nil {
			t.Fatalf("CreateNotification: %v", err)
		}

		callbacks := make(chan struct{}, 2)
		core.OnNotificationDismissed = func(context.Context, string, *corev1.Notification) {
			callbacks <- struct{}{}
		}
		t.Cleanup(func() { core.OnNotificationDismissed = nil })

		const attempts = 8
		start := make(chan struct{})
		results := make(chan bool, attempts)
		errs := make(chan error, attempts)
		var wg sync.WaitGroup
		wg.Add(attempts)
		for range attempts {
			go func() {
				defer wg.Done()
				<-start
				dismissed, err := core.DismissNotification(ctx, userID, created.Id)
				results <- dismissed
				errs <- err
			}()
		}
		close(start)
		wg.Wait()
		close(results)
		close(errs)

		for err := range errs {
			if err != nil {
				t.Fatalf("DismissNotification: %v", err)
			}
		}
		dismissedCount := 0
		for dismissed := range results {
			if dismissed {
				dismissedCount++
			}
		}
		if dismissedCount != 1 {
			t.Fatalf("successful dismissals = %d, want 1", dismissedCount)
		}

		select {
		case <-callbacks:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for dismissal callback")
		}
		select {
		case <-callbacks:
			t.Fatal("dismissal callback ran more than once")
		case <-time.After(100 * time.Millisecond):
		}
	})
}

func TestDismissAllNotifications(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "dismiss-all-user"

	t.Run("returns 0 when no notifications", func(t *testing.T) {
		callbacks := make(chan *corev1.Notification, 1)
		core.OnNotificationDismissed = func(ctx context.Context, userID string, notification *corev1.Notification) {
			callbacks <- notification
		}

		count, err := core.DismissAllNotifications(ctx, userID)
		if err != nil {
			t.Fatalf("DismissAllNotifications error: %v", err)
		}
		if count != 0 {
			t.Errorf("Expected 0, got %d", count)
		}

		select {
		case notification := <-callbacks:
			t.Fatalf("Expected no dismiss callback, got notification %s", notification.Id)
		default:
		}
	})

	t.Run("dismisses all notifications for user and sends dismiss callbacks", func(t *testing.T) {
		callbacks := make(chan *corev1.Notification, 3)
		core.OnNotificationDismissed = func(ctx context.Context, userID string, notification *corev1.Notification) {
			callbacks <- notification
		}

		// Create 3 notifications
		expectedRoomsByID := map[string]string{}
		roomIDs := []string{"room-a", "room-b", "room-c"}
		for i := 0; i < 3; i++ {
			created, err := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
				Notification: &corev1.Notification_DmMessage{
					DmMessage: &corev1.DMMessageNotification{RoomId: roomIDs[i], EventId: "event-" + roomIDs[i]},
				},
			})
			if err != nil {
				t.Fatalf("CreateNotification error: %v", err)
			}
			expectedRoomsByID[created.Id] = created.GetDmMessage().RoomId
		}

		count, err := core.DismissAllNotifications(ctx, userID)
		if err != nil {
			t.Fatalf("DismissAllNotifications error: %v", err)
		}
		if count != 3 {
			t.Errorf("Expected 3 dismissed, got %d", count)
		}

		// Verify all are gone
		remaining, _ := core.GetNotifications(ctx, userID)
		if len(remaining) != 0 {
			t.Errorf("Expected 0 remaining, got %d", len(remaining))
		}

		received := map[string]string{}
		for i := 0; i < 3; i++ {
			select {
			case notification := <-callbacks:
				dm := notification.GetDmMessage()
				if dm == nil {
					t.Fatalf("Expected DM notification callback, got %T", notification.Notification)
				}
				received[notification.Id] = dm.RoomId
			case <-time.After(time.Second):
				t.Fatalf("Timed out waiting for dismiss callback %d", i+1)
			}
		}
		if len(received) != len(expectedRoomsByID) {
			t.Fatalf("Expected %d callbacks, got %d", len(expectedRoomsByID), len(received))
		}
		for id, expectedRoom := range expectedRoomsByID {
			if received[id] != expectedRoom {
				t.Errorf("Expected callback for %s with room %s, got %s", id, expectedRoom, received[id])
			}
		}
		select {
		case notification := <-callbacks:
			t.Fatalf("Expected no extra dismiss callback, got notification %s", notification.Id)
		default:
		}
	})
}

func TestDismissAllNotificationsPrefersOneBulkCallback(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()
	userID := "dismiss-all-bulk-user"

	for _, eventID := range []string{"bulk-event-a", "bulk-event-b", "bulk-event-c"} {
		if _, err := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "bulk-room", EventId: eventID},
			},
		}); err != nil {
			t.Fatalf("CreateNotification(%s): %v", eventID, err)
		}
	}
	if _, err := core.storage.runtimeStateKV.Put(
		ctx,
		notificationKey(userID, "bulk-corrupt-record"),
		[]byte("not-a-protobuf"),
	); err != nil {
		t.Fatalf("store corrupt notification: %v", err)
	}

	bulkCallbacks := make(chan string, 2)
	individualCallbacks := make(chan struct{}, 1)
	core.OnNotificationsDismissed = func(_ context.Context, callbackUserID string) {
		bulkCallbacks <- callbackUserID
	}
	core.OnNotificationDismissed = func(context.Context, string, *corev1.Notification) {
		individualCallbacks <- struct{}{}
	}

	count, err := core.DismissAllNotifications(ctx, userID)
	if err != nil {
		t.Fatalf("DismissAllNotifications: %v", err)
	}
	if count != 4 {
		t.Fatalf("DismissAllNotifications count = %d, want 4", count)
	}
	select {
	case callbackUserID := <-bulkCallbacks:
		if callbackUserID != userID {
			t.Fatalf("bulk callback user = %q, want %q", callbackUserID, userID)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for bulk dismissal callback")
	}
	select {
	case callbackUserID := <-bulkCallbacks:
		t.Fatalf("bulk callback ran more than once for %q", callbackUserID)
	case <-time.After(100 * time.Millisecond):
	}
	select {
	case <-individualCallbacks:
		t.Fatal("individual dismissal callback ran despite bulk callback")
	default:
	}
}

func TestDismissRoomNotifications(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()
	userID := "room-dismiss-user"

	for _, roomID := range []string{"room-a", "room-b"} {
		if _, err := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
			Notification: &corev1.Notification_RoomMessage{
				RoomMessage: &corev1.RoomMessageNotification{RoomId: roomID, EventId: "event-" + roomID},
			},
		}); err != nil {
			t.Fatalf("CreateNotification(%s): %v", roomID, err)
		}
	}

	if got := core.DismissRoomNotifications(ctx, userID, "room-a"); got != 1 {
		t.Fatalf("DismissRoomNotifications() = %d, want 1", got)
	}
	remaining, err := core.GetNotifications(ctx, userID)
	if err != nil {
		t.Fatalf("GetNotifications: %v", err)
	}
	if len(remaining) != 1 || notificationTargetRoomID(remaining[0]) != "room-b" {
		t.Fatalf("remaining notifications = %+v, want only room-b", remaining)
	}
}

func TestDismissRoomNotificationsForAllUsersDoesNotDependOnMembership(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	for _, target := range []struct {
		userID string
		roomID string
	}{
		{userID: "former-member-a", roomID: "deleted-room"},
		{userID: "former-member-b", roomID: "deleted-room"},
		{userID: "unrelated-user", roomID: "other-room"},
	} {
		if _, err := core.CreateNotification(ctx, target.userID, "actor", &corev1.Notification{
			Notification: &corev1.Notification_RoomMessage{
				RoomMessage: &corev1.RoomMessageNotification{
					RoomId:  target.roomID,
					EventId: "event-" + target.userID,
				},
			},
		}); err != nil {
			t.Fatalf("CreateNotification(%s): %v", target.userID, err)
		}
	}

	if got := core.DismissRoomNotificationsForAllUsers(ctx, "deleted-room"); got != 2 {
		t.Fatalf("DismissRoomNotificationsForAllUsers() = %d, want 2", got)
	}
	remaining, err := core.GetNotifications(ctx, "unrelated-user")
	if err != nil {
		t.Fatalf("GetNotifications(unrelated-user): %v", err)
	}
	if len(remaining) != 1 || notificationTargetRoomID(remaining[0]) != "other-room" {
		t.Fatalf("unrelated notifications = %+v, want other-room", remaining)
	}
}

func TestDismissMessageNotifications(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	owner, err := core.CreateUser(ctx, "system", "message-cleanup-owner", "Message Cleanup Owner", "password123")
	if err != nil {
		t.Fatalf("CreateUser owner: %v", err)
	}
	recipient, err := core.CreateUser(ctx, "system", "message-cleanup-recipient", "Message Cleanup Recipient", "password123")
	if err != nil {
		t.Fatalf("CreateUser recipient: %v", err)
	}
	room, err := core.CreateRoom(ctx, owner.Id, KindChannel, "", "message-cleanup", "Message cleanup")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, owner.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember recipient: %v", err)
	}

	for _, notification := range []*corev1.Notification{
		{Notification: &corev1.Notification_DmMessage{DmMessage: &corev1.DMMessageNotification{RoomId: room.Id, EventId: "target-event"}}},
		{Notification: &corev1.Notification_Mention{Mention: &corev1.MentionNotification{RoomId: room.Id, EventId: "target-event"}}},
		{Notification: &corev1.Notification_Reply{Reply: &corev1.ReplyNotification{RoomId: room.Id, EventId: "target-event"}}},
		{Notification: &corev1.Notification_RoomMessage{RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: "target-event"}}},
		{Notification: &corev1.Notification_RoomMessage{RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: "other-event"}}},
	} {
		created, err := core.CreateNotification(ctx, recipient.Id, owner.Id, notification)
		if err != nil {
			t.Fatalf("CreateNotification: %v", err)
		}
		if created == nil {
			t.Fatalf("CreateNotification unexpectedly discarded event %q", notificationTargetEventID(notification))
		}
	}
	before, err := core.GetNotifications(ctx, recipient.Id)
	if err != nil {
		t.Fatalf("GetNotifications before dismiss: %v", err)
	}
	if len(before) != 5 {
		t.Fatalf("notifications before dismiss = %d, want 5", len(before))
	}
	members, err := core.GetRoomMembersList(ctx, KindChannel, room.Id)
	if err != nil {
		t.Fatalf("GetRoomMembersList: %v", err)
	}
	if len(members) != 1 || members[0].GetUserId() != recipient.Id {
		t.Fatalf("room members = %+v, want recipient", members)
	}

	// Model a residual notification for a former member after an earlier
	// partial membership cleanup. It is intentionally inserted below the
	// public current-state guard so this deletion path proves it can remediate
	// already-corrupt operational state.
	staleNotificationID := "former-member-stale-target"
	staleNotification := &corev1.Notification{
		Id:          staleNotificationID,
		RecipientId: owner.Id,
		ActorId:     recipient.Id,
		CreatedAt:   timestamppb.Now(),
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{
				RoomId:  room.Id,
				EventId: "target-event",
			},
		},
	}
	staleData, err := proto.Marshal(staleNotification)
	if err != nil {
		t.Fatalf("marshal former-member notification: %v", err)
	}
	staleKey := notificationKey(owner.Id, staleNotificationID)
	if _, err := core.storage.runtimeStateKV.Put(ctx, staleKey, staleData); err != nil {
		t.Fatalf("store former-member notification: %v", err)
	}

	if got := core.DismissMessageNotifications(ctx, KindChannel, room.Id, "target-event"); got != 5 {
		t.Fatalf("DismissMessageNotifications = %d, want 5", got)
	}
	if _, err := core.storage.runtimeStateKV.Get(ctx, staleKey); err == nil {
		t.Fatal("former-member notification remains in runtime state")
	}
	remaining, err := core.GetNotifications(ctx, recipient.Id)
	if err != nil {
		t.Fatalf("GetNotifications: %v", err)
	}
	if len(remaining) != 1 || notificationTargetEventID(remaining[0]) != "other-event" {
		t.Fatalf("remaining notifications = %+v, want only other-event", remaining)
	}
}

func TestCreateNotificationDiscardsRetractedMessageTarget(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	author, err := core.CreateUser(ctx, "system", "stale-notification-author", "Stale Notification Author", "password123")
	if err != nil {
		t.Fatalf("CreateUser author: %v", err)
	}
	recipient, err := core.CreateUser(ctx, "system", "stale-notification-recipient", "Stale Notification Recipient", "password123")
	if err != nil {
		t.Fatalf("CreateUser recipient: %v", err)
	}
	room, err := core.CreateRoom(ctx, author.Id, KindChannel, "", "stale-notification", "Stale notification")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, author.Id, KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember recipient: %v", err)
	}
	posted, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "delete me", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if err := core.DeleteMessage(ctx, author.Id, KindChannel, room.Id, posted.Id); err != nil {
		t.Fatalf("DeleteMessage: %v", err)
	}

	created, err := core.CreateNotification(ctx, recipient.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: posted.Id},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification: %v", err)
	}
	if created != nil {
		t.Fatalf("CreateNotification returned %+v for a retracted message, want nil", created)
	}
	remaining, err := core.GetNotifications(ctx, recipient.Id)
	if err != nil {
		t.Fatalf("GetNotifications: %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("notifications after retracted target creation = %d, want 0", len(remaining))
	}
}

func TestReadMarkerNotificationDismissalPublishesSyncAndPushDismissal(t *testing.T) {
	core, nc := setupTestCore(t)
	ctx := testContext(t)

	author, err := core.CreateUser(ctx, SystemActorID, "read-notification-author", "Read Notification Author", "password")
	if err != nil {
		t.Fatalf("CreateUser author: %v", err)
	}
	reader, err := core.CreateUser(ctx, SystemActorID, "read-notification-reader", "Read Notification Reader", "password")
	if err != nil {
		t.Fatalf("CreateUser reader: %v", err)
	}
	room, err := core.CreateRoom(ctx, author.Id, KindChannel, "", "read-notification-room", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, author.Id, KindChannel, author.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom author: %v", err)
	}
	if _, err := core.JoinRoom(ctx, reader.Id, KindChannel, reader.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom reader: %v", err)
	}
	if err := core.SetSpaceNotificationLevel(ctx, reader.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(NORMAL): %v", err)
	}

	root, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "root", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage root: %v", err)
	}
	reply1, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "reply one", nil, root.Id, "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage reply1: %v", err)
	}
	reply2, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "reply two", nil, root.Id, "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage reply2: %v", err)
	}
	reply3, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "reply three", nil, root.Id, "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage reply3: %v", err)
	}
	if err := core.SetSpaceNotificationLevel(ctx, reader.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(ALL_MESSAGES): %v", err)
	}

	dismissedPush := make(chan string, 3)
	core.OnNotificationDismissed = func(ctx context.Context, userID string, notification *corev1.Notification) {
		dismissedPush <- notification.GetId()
	}

	subject := subjects.LiveSyncUserEvent(reader.Id, "notification_dismissed")
	sub, err := nc.SubscribeSync(subject)
	if err != nil {
		t.Fatalf("SubscribeSync(%s): %v", subject, err)
	}
	defer sub.Unsubscribe()
	if err := nc.Flush(); err != nil {
		t.Fatalf("Flush subscription: %v", err)
	}

	coveredReply, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_Reply{
			Reply: &corev1.ReplyNotification{
				RoomId:      room.Id,
				EventId:     reply1.Id,
				InReplyToId: root.Id,
				InThread:    root.Id,
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification covered reply: %v", err)
	}
	coveredMention, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_Mention{
			Mention: &corev1.MentionNotification{
				RoomId:   room.Id,
				EventId:  reply2.Id,
				InThread: root.Id,
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification covered mention: %v", err)
	}
	futureReply, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_Reply{
			Reply: &corev1.ReplyNotification{
				RoomId:      room.Id,
				EventId:     reply3.Id,
				InReplyToId: root.Id,
				InThread:    root.Id,
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification future reply: %v", err)
	}

	cutoff, err := core.GetEventTimestamp(ctx, KindChannel, room.Id, reply2.Id)
	if err != nil {
		t.Fatalf("GetEventTimestamp: %v", err)
	}
	if got := core.DismissThreadReadNotifications(ctx, KindChannel, reader.Id, room.Id, root.Id, cutoff); got != 2 {
		t.Fatalf("DismissThreadReadNotifications = %d, want 2", got)
	}

	remaining, err := core.GetNotifications(ctx, reader.Id)
	if err != nil {
		t.Fatalf("GetNotifications: %v", err)
	}
	if len(remaining) != 1 || remaining[0].GetId() != futureReply.GetId() {
		t.Fatalf("remaining notifications = %+v, want only %s", remaining, futureReply.GetId())
	}

	wantIDs := map[string]bool{
		coveredReply.GetId():   true,
		coveredMention.GetId(): true,
	}
	for i := 0; i < 2; i++ {
		msg, err := sub.NextMsg(2 * time.Second)
		if err != nil {
			t.Fatalf("waiting for notification_dismissed live event %d: %v", i+1, err)
		}
		var live corev1.LiveEvent
		if err := proto.Unmarshal(msg.Data, &live); err != nil {
			t.Fatalf("unmarshal live event: %v", err)
		}
		event := live.GetNotificationDismissed()
		if event == nil {
			t.Fatalf("expected NotificationDismissedEvent, got %T", live.Event)
		}
		if !wantIDs[event.GetNotificationId()] {
			t.Fatalf("unexpected live dismissal id %s", event.GetNotificationId())
		}
		delete(wantIDs, event.GetNotificationId())
	}
	if len(wantIDs) != 0 {
		t.Fatalf("missing live dismissal ids: %v", wantIDs)
	}

	wantPushIDs := map[string]bool{
		coveredReply.GetId():   true,
		coveredMention.GetId(): true,
	}
	for i := 0; i < 2; i++ {
		select {
		case id := <-dismissedPush:
			if !wantPushIDs[id] {
				t.Fatalf("unexpected push dismissal id %s", id)
			}
			delete(wantPushIDs, id)
		case <-time.After(2 * time.Second):
			t.Fatalf("waiting for push dismissal callback %d", i+1)
		}
	}
	if len(wantPushIDs) != 0 {
		t.Fatalf("missing push dismissal ids: %v", wantPushIDs)
	}
}

func TestRoomReadNotificationDismissalPublishesSyncAndPushDismissal(t *testing.T) {
	core, nc := setupTestCore(t)
	ctx := testContext(t)

	author, err := core.CreateUser(ctx, SystemActorID, "room-read-notification-author", "Room Read Notification Author", "password")
	if err != nil {
		t.Fatalf("CreateUser author: %v", err)
	}
	reader, err := core.CreateUser(ctx, SystemActorID, "room-read-notification-reader", "Room Read Notification Reader", "password")
	if err != nil {
		t.Fatalf("CreateUser reader: %v", err)
	}
	room, err := core.CreateRoom(ctx, author.Id, KindChannel, "", "room-read-notification-room", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, author.Id, KindChannel, author.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom author: %v", err)
	}
	if _, err := core.JoinRoom(ctx, reader.Id, KindChannel, reader.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom reader: %v", err)
	}
	if err := core.SetSpaceNotificationLevel(ctx, reader.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(NORMAL): %v", err)
	}

	root, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "root", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage root: %v", err)
	}
	threadReply, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "thread reply", nil, root.Id, "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage thread reply: %v", err)
	}
	dmEvent, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "dm branch", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage dm branch: %v", err)
	}
	mentionEvent, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "mention branch", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage mention branch: %v", err)
	}
	replyEvent, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "reply branch", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage reply branch: %v", err)
	}
	roomMessageEvent, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "room message branch", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage room message branch: %v", err)
	}
	futureEvent, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "future room message", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage future room message: %v", err)
	}
	if err := core.SetSpaceNotificationLevel(ctx, reader.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(ALL_MESSAGES): %v", err)
	}

	dismissedPush := make(chan string, 4)
	core.OnNotificationDismissed = func(ctx context.Context, userID string, notification *corev1.Notification) {
		dismissedPush <- notification.GetId()
	}

	subject := subjects.LiveSyncUserEvent(reader.Id, "notification_dismissed")
	sub, err := nc.SubscribeSync(subject)
	if err != nil {
		t.Fatalf("SubscribeSync(%s): %v", subject, err)
	}
	defer sub.Unsubscribe()
	if err := nc.Flush(); err != nil {
		t.Fatalf("Flush subscription: %v", err)
	}

	coveredDM, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_DmMessage{
			DmMessage: &corev1.DMMessageNotification{RoomId: room.Id, EventId: dmEvent.Id},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification covered dm: %v", err)
	}
	coveredMention, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_Mention{
			Mention: &corev1.MentionNotification{RoomId: room.Id, EventId: mentionEvent.Id},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification covered mention: %v", err)
	}
	coveredReply, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_Reply{
			Reply: &corev1.ReplyNotification{RoomId: room.Id, EventId: replyEvent.Id, InReplyToId: root.Id},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification covered reply: %v", err)
	}
	coveredRoomMessage, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: roomMessageEvent.Id},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification covered room message: %v", err)
	}
	threadMention, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_Mention{
			Mention: &corev1.MentionNotification{RoomId: room.Id, EventId: threadReply.Id, InThread: root.Id},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification thread mention: %v", err)
	}
	futureRoomMessage, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: futureEvent.Id},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification future room message: %v", err)
	}

	cutoff, err := core.GetEventTimestamp(ctx, KindChannel, room.Id, roomMessageEvent.Id)
	if err != nil {
		t.Fatalf("GetEventTimestamp: %v", err)
	}
	if got := core.DismissRoomReadNotifications(ctx, KindChannel, reader.Id, room.Id, cutoff); got != 4 {
		t.Fatalf("DismissRoomReadNotifications = %d, want 4", got)
	}

	remaining, err := core.GetNotifications(ctx, reader.Id)
	if err != nil {
		t.Fatalf("GetNotifications: %v", err)
	}
	remainingIDs := map[string]bool{}
	for _, notification := range remaining {
		remainingIDs[notification.GetId()] = true
	}
	if !remainingIDs[threadMention.GetId()] || !remainingIDs[futureRoomMessage.GetId()] || len(remainingIDs) != 2 {
		t.Fatalf("remaining notifications = %v, want thread %s and future room %s", remainingIDs, threadMention.GetId(), futureRoomMessage.GetId())
	}

	wantIDs := map[string]bool{
		coveredDM.GetId():          true,
		coveredMention.GetId():     true,
		coveredReply.GetId():       true,
		coveredRoomMessage.GetId(): true,
	}
	for i := 0; i < 4; i++ {
		msg, err := sub.NextMsg(2 * time.Second)
		if err != nil {
			t.Fatalf("waiting for notification_dismissed live event %d: %v", i+1, err)
		}
		var live corev1.LiveEvent
		if err := proto.Unmarshal(msg.Data, &live); err != nil {
			t.Fatalf("unmarshal live event: %v", err)
		}
		event := live.GetNotificationDismissed()
		if event == nil {
			t.Fatalf("expected NotificationDismissedEvent, got %T", live.Event)
		}
		if !wantIDs[event.GetNotificationId()] {
			t.Fatalf("unexpected live dismissal id %s", event.GetNotificationId())
		}
		delete(wantIDs, event.GetNotificationId())
	}
	if len(wantIDs) != 0 {
		t.Fatalf("missing live dismissal ids: %v", wantIDs)
	}

	wantPushIDs := map[string]bool{
		coveredDM.GetId():          true,
		coveredMention.GetId():     true,
		coveredReply.GetId():       true,
		coveredRoomMessage.GetId(): true,
	}
	for i := 0; i < 4; i++ {
		select {
		case id := <-dismissedPush:
			if !wantPushIDs[id] {
				t.Fatalf("unexpected push dismissal id %s", id)
			}
			delete(wantPushIDs, id)
		case <-time.After(2 * time.Second):
			t.Fatalf("waiting for push dismissal callback %d", i+1)
		}
	}
	if len(wantPushIDs) != 0 {
		t.Fatalf("missing push dismissal ids: %v", wantPushIDs)
	}
}

func TestCreateNotificationReconcilesCurrentRoomAndThreadReadState(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	author, err := core.CreateUser(ctx, SystemActorID, "notification-read-race-author", "Notification Read Race Author", "password")
	if err != nil {
		t.Fatalf("CreateUser author: %v", err)
	}
	reader, err := core.CreateUser(ctx, SystemActorID, "notification-read-race-reader", "Notification Read Race Reader", "password")
	if err != nil {
		t.Fatalf("CreateUser reader: %v", err)
	}

	room, err := core.CreateRoom(ctx, author.Id, KindChannel, "", "notification-read-race-room", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, author.Id, KindChannel, author.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom author: %v", err)
	}
	if _, err := core.JoinRoom(ctx, reader.Id, KindChannel, reader.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom reader: %v", err)
	}

	root, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "channel root", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage channel root: %v", err)
	}
	threadReply, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "channel thread reply", nil, root.Id, "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage channel thread reply: %v", err)
	}
	futureRoot, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "channel future root", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage channel future root: %v", err)
	}
	if _, err := core.DismissAllNotifications(ctx, reader.Id); err != nil {
		t.Fatalf("DismissAllNotifications channel setup: %v", err)
	}
	if _, err := core.AdvanceLastReadEventID(ctx, KindChannel, reader.Id, room.Id, root.Id); err != nil {
		t.Fatalf("AdvanceLastReadEventID channel: %v", err)
	}
	if _, err := core.SetThreadLastReadEventID(ctx, KindChannel, reader.Id, room.Id, root.Id, threadReply.Id); err != nil {
		t.Fatalf("SetThreadLastReadEventID channel: %v", err)
	}

	readRoot, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_Mention{Mention: &corev1.MentionNotification{
			RoomId: room.Id, EventId: root.Id,
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification read channel root: %v", err)
	}
	if readRoot != nil {
		t.Fatalf("read channel root notification = %+v, want nil", readRoot)
	}

	readThread, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{RoomMessage: &corev1.RoomMessageNotification{
			RoomId: room.Id, EventId: threadReply.Id, InThread: root.Id,
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification read channel thread: %v", err)
	}
	if readThread != nil {
		t.Fatalf("read channel thread notification = %+v, want nil", readThread)
	}

	future, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{RoomMessage: &corev1.RoomMessageNotification{
			RoomId: room.Id, EventId: futureRoot.Id,
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification unread channel root: %v", err)
	}
	if future == nil {
		t.Fatal("unread channel root notification = nil, want pending notification")
	}

	dmRoom, _, err := core.FindOrCreateDM(ctx, author.Id, []string{reader.Id})
	if err != nil {
		t.Fatalf("FindOrCreateDM: %v", err)
	}
	dmRoot, err := core.PostMessage(ctx, KindDM, dmRoom.Id, author.Id, "DM root", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage DM root: %v", err)
	}
	dmThreadReply, err := core.PostMessage(ctx, KindDM, dmRoom.Id, author.Id, "DM thread reply", nil, dmRoot.Id, "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage DM thread reply: %v", err)
	}
	dmFutureThreadReply, err := core.PostMessage(ctx, KindDM, dmRoom.Id, author.Id, "DM future thread reply", nil, dmRoot.Id, "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage DM future thread reply: %v", err)
	}
	if _, err := core.DismissAllNotifications(ctx, reader.Id); err != nil {
		t.Fatalf("DismissAllNotifications DM setup: %v", err)
	}
	if _, err := core.AdvanceLastReadEventID(ctx, KindDM, reader.Id, dmRoom.Id, dmRoot.Id); err != nil {
		t.Fatalf("AdvanceLastReadEventID DM: %v", err)
	}
	if _, err := core.SetThreadLastReadEventID(ctx, KindDM, reader.Id, dmRoom.Id, dmRoot.Id, dmThreadReply.Id); err != nil {
		t.Fatalf("SetThreadLastReadEventID DM: %v", err)
	}

	readDMRoot, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_DmMessage{DmMessage: &corev1.DMMessageNotification{
			RoomId: dmRoom.Id, EventId: dmRoot.Id,
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification read DM root: %v", err)
	}
	if readDMRoot != nil {
		t.Fatalf("read DM root notification = %+v, want nil", readDMRoot)
	}

	readDMThread, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_DmMessage{DmMessage: &corev1.DMMessageNotification{
			RoomId: dmRoom.Id, EventId: dmThreadReply.Id, InThread: dmRoot.Id,
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification read DM thread: %v", err)
	}
	if readDMThread != nil {
		t.Fatalf("read DM thread notification = %+v, want nil", readDMThread)
	}

	unreadDMThread, err := core.CreateNotification(ctx, reader.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_DmMessage{DmMessage: &corev1.DMMessageNotification{
			RoomId: dmRoom.Id, EventId: dmFutureThreadReply.Id, InThread: dmRoot.Id,
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification unread DM thread: %v", err)
	}
	if unreadDMThread == nil {
		t.Fatal("unread DM thread notification = nil, want pending notification")
	}
	dmFutureTime, err := core.GetEventTimestamp(ctx, KindDM, dmRoom.Id, dmFutureThreadReply.Id)
	if err != nil {
		t.Fatalf("GetEventTimestamp DM future thread: %v", err)
	}
	if got := core.DismissRoomReadNotifications(ctx, KindDM, reader.Id, dmRoom.Id, dmFutureTime); got != 0 {
		t.Fatalf("DismissRoomReadNotifications DM thread = %d, want 0", got)
	}
	if got := core.DismissThreadReadNotifications(ctx, KindDM, reader.Id, dmRoom.Id, dmRoot.Id, dmFutureTime); got != 1 {
		t.Fatalf("DismissThreadReadNotifications DM thread = %d, want 1", got)
	}
}

func TestHasUnreadNotifications(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "has-unread-user"

	t.Run("returns false when no notifications", func(t *testing.T) {
		has, err := core.HasUnreadNotifications(ctx, userID)
		if err != nil {
			t.Fatalf("HasUnreadNotifications error: %v", err)
		}
		if has {
			t.Error("Expected false when no notifications")
		}
	})

	t.Run("returns true when has notifications", func(t *testing.T) {
		core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "room", EventId: "event"},
			},
		})

		has, err := core.HasUnreadNotifications(ctx, userID)
		if err != nil {
			t.Fatalf("HasUnreadNotifications error: %v", err)
		}
		if !has {
			t.Error("Expected true when has notifications")
		}
	})
}

func TestGetNotificationCount(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "count-user"

	t.Run("returns 0 when no notifications", func(t *testing.T) {
		count, err := core.GetNotificationCount(ctx, userID)
		if err != nil {
			t.Fatalf("GetNotificationCount error: %v", err)
		}
		if count != 0 {
			t.Errorf("Expected 0, got %d", count)
		}
	})

	t.Run("returns correct count", func(t *testing.T) {
		for i := 0; i < 5; i++ {
			core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
				Notification: &corev1.Notification_DmMessage{
					DmMessage: &corev1.DMMessageNotification{RoomId: "room", EventId: "event"},
				},
			})
		}

		count, err := core.GetNotificationCount(ctx, userID)
		if err != nil {
			t.Fatalf("GetNotificationCount error: %v", err)
		}
		if count != 5 {
			t.Errorf("Expected 5, got %d", count)
		}
	})
}

func TestNotificationSummaryReadsIgnoreCorruptRecords(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	userID := "corrupt-notification-user"

	if _, err := core.storage.runtimeStateKV.Put(ctx, notificationKey(userID, "corrupt"), []byte("not protobuf")); err != nil {
		t.Fatalf("Put corrupt notification: %v", err)
	}
	mismatched := &corev1.Notification{
		Id:          "different-id",
		RecipientId: userID,
		CreatedAt:   timestamppb.Now(),
		Notification: &corev1.Notification_DmMessage{
			DmMessage: &corev1.DMMessageNotification{RoomId: "room", EventId: "event"},
		},
	}
	mismatchedData, err := proto.Marshal(mismatched)
	if err != nil {
		t.Fatalf("Marshal mismatched notification: %v", err)
	}
	if _, err := core.storage.runtimeStateKV.Put(ctx, notificationKey(userID, "wrong-key-id"), mismatchedData); err != nil {
		t.Fatalf("Put mismatched notification: %v", err)
	}

	notifications, err := core.GetNotifications(ctx, userID)
	if err != nil {
		t.Fatalf("GetNotifications: %v", err)
	}
	if len(notifications) != 0 {
		t.Fatalf("GetNotifications = %+v, want no decodable notifications", notifications)
	}
	has, err := core.HasUnreadNotifications(ctx, userID)
	if err != nil {
		t.Fatalf("HasUnreadNotifications: %v", err)
	}
	if has {
		t.Fatal("HasUnreadNotifications = true for corrupt-only record")
	}
	count, err := core.GetNotificationCount(ctx, userID)
	if err != nil {
		t.Fatalf("GetNotificationCount: %v", err)
	}
	if count != 0 {
		t.Fatalf("GetNotificationCount = %d, want 0 for corrupt-only record", count)
	}
	got, err := core.GetNotification(ctx, userID, "wrong-key-id")
	if err != nil {
		t.Fatalf("GetNotification mismatched identity: %v", err)
	}
	if got != nil {
		t.Fatalf("GetNotification mismatched identity = %+v, want nil", got)
	}
}

func TestNotificationCleanupIgnoresMismatchedStoredIdentity(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	const userID = "cleanup-identity-user"

	first, err := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{RoomMessage: &corev1.RoomMessageNotification{
			RoomId: "cleanup-room-a", EventId: "cleanup-event-a",
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification(first): %v", err)
	}
	second, err := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{RoomMessage: &corev1.RoomMessageNotification{
			RoomId: "cleanup-room-b", EventId: "cleanup-event-b",
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification(second): %v", err)
	}

	mismatched := proto.Clone(first).(*corev1.Notification)
	mismatched.Id = second.Id
	data, err := proto.Marshal(mismatched)
	if err != nil {
		t.Fatalf("Marshal(mismatched): %v", err)
	}
	if _, err := core.storage.runtimeStateKV.Put(ctx, notificationKey(userID, first.Id), data); err != nil {
		t.Fatalf("store mismatched notification: %v", err)
	}

	if got := core.DismissRoomNotifications(ctx, userID, "cleanup-room-a"); got != 0 {
		t.Fatalf("DismissRoomNotifications(mismatched) = %d, want 0", got)
	}
	if _, err := core.storage.runtimeStateKV.Get(ctx, notificationKey(userID, second.Id)); err != nil {
		t.Fatalf("healthy notification was deleted by mismatched identity cleanup: %v", err)
	}
}

func TestNotificationDismissalDoesNotEmitCallbackForMismatchedStoredIdentity(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	const userID = "dismiss-identity-user"

	first, err := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{RoomMessage: &corev1.RoomMessageNotification{
			RoomId: "dismiss-room-a", EventId: "dismiss-event-a",
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification(first): %v", err)
	}
	second, err := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{RoomMessage: &corev1.RoomMessageNotification{
			RoomId: "dismiss-room-b", EventId: "dismiss-event-b",
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification(second): %v", err)
	}
	mismatched := proto.Clone(first).(*corev1.Notification)
	mismatched.Id = second.Id
	data, err := proto.Marshal(mismatched)
	if err != nil {
		t.Fatalf("Marshal(mismatched): %v", err)
	}
	if _, err := core.storage.runtimeStateKV.Put(ctx, notificationKey(userID, first.Id), data); err != nil {
		t.Fatalf("store mismatched notification: %v", err)
	}

	callback := make(chan *corev1.Notification, 1)
	core.OnNotificationDismissed = func(_ context.Context, _ string, notification *corev1.Notification) {
		callback <- notification
	}
	if dismissed, err := core.DismissNotification(ctx, userID, first.Id); err != nil || !dismissed {
		t.Fatalf("DismissNotification = %t, %v; want true, nil", dismissed, err)
	}
	select {
	case notification := <-callback:
		t.Fatalf("mismatched record emitted push dismissal callback: %+v", notification)
	case <-time.After(100 * time.Millisecond):
	}
	if _, err := core.storage.runtimeStateKV.Get(ctx, notificationKey(userID, second.Id)); err != nil {
		t.Fatalf("healthy notification was deleted by direct mismatched dismissal: %v", err)
	}
}

func TestNotificationReadsFailClosedForStalePreferenceAndReadState(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	author, err := core.CreateUser(ctx, SystemActorID, "stale-read-author", "Stale Read Author", "password")
	if err != nil {
		t.Fatalf("CreateUser author: %v", err)
	}
	reader, err := core.CreateUser(ctx, SystemActorID, "stale-read-reader", "Stale Read Reader", "password")
	if err != nil {
		t.Fatalf("CreateUser reader: %v", err)
	}
	room, err := core.CreateRoom(ctx, author.Id, KindChannel, "", "stale-read-room", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, author.Id, KindChannel, room.Id, reader.Id); err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	posted, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "stale", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if _, err := core.DismissAllNotifications(ctx, reader.Id); err != nil {
		t.Fatalf("DismissAllNotifications: %v", err)
	}

	putRaw := func(id string) {
		t.Helper()
		notification := &corev1.Notification{
			Id:          id,
			RecipientId: reader.Id,
			ActorId:     author.Id,
			CreatedAt:   timestamppb.Now(),
			Notification: &corev1.Notification_RoomMessage{
				RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: posted.Id},
			},
		}
		data, err := proto.Marshal(notification)
		if err != nil {
			t.Fatalf("Marshal raw notification: %v", err)
		}
		if _, err := core.storage.runtimeStateKV.Put(ctx, notificationKey(reader.Id, id), data); err != nil {
			t.Fatalf("Put raw notification: %v", err)
		}
	}

	if err := core.SetSpaceNotificationLevel(ctx, reader.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(MUTED): %v", err)
	}
	putRaw("stale-muted")
	if got, err := core.GetNotification(ctx, reader.Id, "stale-muted"); err != nil || got != nil {
		t.Fatalf("GetNotification muted stale = (%+v, %v), want (nil, nil)", got, err)
	}

	if err := core.SetSpaceNotificationLevel(ctx, reader.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(ALL_MESSAGES): %v", err)
	}
	if err := core.SetLastReadEventID(ctx, KindChannel, reader.Id, room.Id, posted.Id); err != nil {
		t.Fatalf("SetLastReadEventID: %v", err)
	}
	putRaw("stale-read")
	if got, err := core.GetNotification(ctx, reader.Id, "stale-read"); err != nil || got != nil {
		t.Fatalf("GetNotification read stale = (%+v, %v), want (nil, nil)", got, err)
	}
	listed, err := core.GetNotifications(ctx, reader.Id)
	if err != nil {
		t.Fatalf("GetNotifications: %v", err)
	}
	if len(listed) != 0 {
		t.Fatalf("GetNotifications stale state = %+v, want empty", listed)
	}
}

func TestNotificationIsolation(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userA := "user-a"
	userB := "user-b"

	t.Run("user cannot see other user's notifications", func(t *testing.T) {
		// Create notification for userA
		core.CreateNotification(ctx, userA, "actor", &corev1.Notification{
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "room", EventId: "event"},
			},
		})

		// userB should not see userA's notification
		userBNotifs, _ := core.GetNotifications(ctx, userB)
		if len(userBNotifs) != 0 {
			t.Error("userB should not see userA's notifications")
		}

		// userA should see their notification
		userANotifs, _ := core.GetNotifications(ctx, userA)
		if len(userANotifs) != 1 {
			t.Errorf("userA should have 1 notification, got %d", len(userANotifs))
		}
	})

	t.Run("dismissing does not affect other user's notifications", func(t *testing.T) {
		// Clear userA's notifications
		core.DismissAllNotifications(ctx, userA)

		// Create notifications for both users
		core.CreateNotification(ctx, userA, "actor", &corev1.Notification{
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "room", EventId: "event-a"},
			},
		})
		core.CreateNotification(ctx, userB, "actor", &corev1.Notification{
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "room", EventId: "event-b"},
			},
		})

		// Dismiss userA's notifications
		core.DismissAllNotifications(ctx, userA)

		// userB should still have their notification
		userBNotifs, _ := core.GetNotifications(ctx, userB)
		if len(userBNotifs) != 1 {
			t.Errorf("userB should still have 1 notification after userA dismisses, got %d", len(userBNotifs))
		}
	})
}

func TestNotificationTypeName(t *testing.T) {
	tests := []struct {
		name     string
		notif    *corev1.Notification
		expected string
	}{
		{
			name: "dm_message",
			notif: &corev1.Notification{
				Notification: &corev1.Notification_DmMessage{
					DmMessage: &corev1.DMMessageNotification{},
				},
			},
			expected: "dm_message",
		},
		{
			name: "mention",
			notif: &corev1.Notification{
				Notification: &corev1.Notification_Mention{
					Mention: &corev1.MentionNotification{},
				},
			},
			expected: "mention",
		},
		{
			name: "reply",
			notif: &corev1.Notification{
				Notification: &corev1.Notification_Reply{
					Reply: &corev1.ReplyNotification{},
				},
			},
			expected: "reply",
		},
		{
			name: "room_message",
			notif: &corev1.Notification{
				Notification: &corev1.Notification_RoomMessage{
					RoomMessage: &corev1.RoomMessageNotification{},
				},
			},
			expected: "room_message",
		},
		{
			name:     "unknown",
			notif:    &corev1.Notification{},
			expected: "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := notificationTypeName(tt.notif)
			if got != tt.expected {
				t.Errorf("notificationTypeName() = %s, want %s", got, tt.expected)
			}
		})
	}
}
