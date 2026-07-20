package core

import (
	"errors"
	"strings"
	"testing"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestNotificationCenterSuppressionValidatesAndHashesClientIdentity(t *testing.T) {
	chattoCore, _ := setupTestCore(t)
	ctx := testContext(t)
	if _, err := chattoCore.GetNotificationsForClient(ctx, "user", "bad client"); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("GetNotificationsForClient error = %v, want ErrInvalidArgument", err)
	}
	key := notificationCenterSuppressionKey("user", "notification", "private-client-id")
	if strings.Contains(key, "user") || strings.Contains(key, "private-client-id") {
		t.Fatalf("suppression key exposes an unhashed identity: %q", key)
	}
}

func TestNotificationCenterSuppressionIsDeletedWithNotification(t *testing.T) {
	chattoCore, _ := setupTestCore(t)
	ctx := testContext(t)
	userID := "bounded-suppression-user"
	notification, err := chattoCore.CreateNotification(ctx, userID, "actor", &corev1.Notification{
		Notification: &corev1.Notification_RoomMessage{RoomMessage: &corev1.RoomMessageNotification{
			RoomId: "room", EventId: "event",
		}},
	})
	if err != nil {
		t.Fatalf("CreateNotification: %v", err)
	}

	clientID := "client-0"
	suppressed, err := chattoCore.SuppressNotificationCenterForClient(ctx, userID, notification.Id, clientID)
	if err != nil {
		t.Fatalf("SuppressNotificationCenterForClient: %v", err)
	}
	if !suppressed {
		t.Fatal("SuppressNotificationCenterForClient = false, want true")
	}

	markerKey := notificationCenterSuppressionKey(userID, notification.Id, clientID)
	if _, err := chattoCore.storage.runtimeStateKV.Get(ctx, markerKey); err != nil {
		t.Fatalf("suppression marker before dismissal: %v", err)
	}
	dismissed, err := chattoCore.DismissNotification(ctx, userID, notification.Id)
	if err != nil || !dismissed {
		t.Fatalf("DismissNotification = %v, %v", dismissed, err)
	}
	if _, err := chattoCore.storage.runtimeStateKV.Get(ctx, markerKey); !isRuntimeStateKeyAbsent(err) {
		t.Fatalf("suppression marker after dismissal: %v, want absent", err)
	}
}
