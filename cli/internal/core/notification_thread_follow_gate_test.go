package core

import (
	"testing"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestThreadRoomMessageNotificationsRequireThreadFollow(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	author, err := core.CreateUser(ctx, SystemActorID, "thread-notify-author", "Thread Notify Author", "password")
	if err != nil {
		t.Fatalf("CreateUser author: %v", err)
	}
	follower, err := core.CreateUser(ctx, SystemActorID, "thread-notify-follower", "Thread Notify Follower", "password")
	if err != nil {
		t.Fatalf("CreateUser follower: %v", err)
	}
	ambient, err := core.CreateUser(ctx, SystemActorID, "thread-notify-ambient", "Thread Notify Ambient", "password")
	if err != nil {
		t.Fatalf("CreateUser ambient: %v", err)
	}
	room, err := core.CreateRoom(ctx, author.Id, KindChannel, "", "thread-notification-gating", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.AddMember(ctx, author.Id, KindChannel, room.Id, follower.Id); err != nil {
		t.Fatalf("AddMember follower: %v", err)
	}
	if _, err := core.AddMember(ctx, author.Id, KindChannel, room.Id, ambient.Id); err != nil {
		t.Fatalf("AddMember ambient: %v", err)
	}

	root, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "thread root", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage root: %v", err)
	}
	if _, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "first thread reply", nil, root.Id, "", nil, false); err != nil {
		t.Fatalf("PostMessage first reply: %v", err)
	}
	if _, err := core.DismissAllNotifications(ctx, follower.Id); err != nil {
		t.Fatalf("DismissAllNotifications follower: %v", err)
	}
	if _, err := core.DismissAllNotifications(ctx, ambient.Id); err != nil {
		t.Fatalf("DismissAllNotifications ambient: %v", err)
	}
	if err := core.FollowThread(ctx, KindChannel, follower.Id, room.Id, root.Id); err != nil {
		t.Fatalf("FollowThread follower: %v", err)
	}

	secondReply, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "second thread reply", nil, root.Id, "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage second reply: %v", err)
	}

	followerNotifications, err := core.GetNotifications(ctx, follower.Id)
	if err != nil {
		t.Fatalf("GetNotifications follower: %v", err)
	}
	if len(followerNotifications) != 1 {
		t.Fatalf("follower notifications = %d, want 1", len(followerNotifications))
	}
	reply := followerNotifications[0].GetReply()
	if reply == nil {
		t.Fatalf("follower notification = %T, want reply notification", followerNotifications[0].GetNotification())
	}
	if reply.GetEventId() != secondReply.Id || reply.GetInThread() != root.Id {
		t.Fatalf("follower reply notification target = (%q, %q), want (%q, %q)", reply.GetEventId(), reply.GetInThread(), secondReply.Id, root.Id)
	}

	ambientNotifications, err := core.GetNotifications(ctx, ambient.Id)
	if err != nil {
		t.Fatalf("GetNotifications ambient: %v", err)
	}
	if len(ambientNotifications) != 0 {
		t.Fatalf("ambient notifications = %+v, want no thread notification for an unfollowed thread", ambientNotifications)
	}

	created, err := core.CreateNotification(ctx, ambient.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: secondReply.Id, InThread: root.Id},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification ambient unfollowed thread: %v", err)
	}
	if created != nil {
		t.Fatalf("CreateNotification ambient unfollowed thread = %+v, want nil", created)
	}
	if err := core.FollowThread(ctx, KindChannel, ambient.Id, room.Id, root.Id); err != nil {
		t.Fatalf("FollowThread ambient: %v", err)
	}
	created, err = core.CreateNotification(ctx, ambient.Id, author.Id, &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: room.Id, EventId: secondReply.Id, InThread: root.Id},
		},
	})
	if err != nil || created == nil {
		t.Fatalf("CreateNotification ambient followed thread = (%+v, %v), want stored notification", created, err)
	}
	if err := core.UnfollowThread(ctx, KindChannel, ambient.Id, room.Id, root.Id); err != nil {
		t.Fatalf("UnfollowThread ambient: %v", err)
	}
	got, err := core.GetNotification(ctx, ambient.Id, created.Id)
	if err != nil {
		t.Fatalf("GetNotification after unfollow: %v", err)
	}
	if got != nil {
		t.Fatalf("GetNotification after unfollow = %+v, want nil", got)
	}
}
