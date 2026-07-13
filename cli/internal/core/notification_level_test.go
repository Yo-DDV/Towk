package core

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/protobuf/proto"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestPrefsProtoRoundTrip(t *testing.T) {
	levels := []corev1.NotificationLevel{
		corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED,
		corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED,
		corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL,
		corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES,
	}

	t.Run("UserPreferences", func(t *testing.T) {
		for _, level := range levels {
			t.Run(level.String(), func(t *testing.T) {
				prefs := &corev1.UserPreferences{NotificationLevel: level}
				data, err := proto.Marshal(prefs)
				if err != nil {
					t.Fatalf("Marshal failed: %v", err)
				}
				got := &corev1.UserPreferences{}
				if err := proto.Unmarshal(data, got); err != nil {
					t.Fatalf("Unmarshal failed: %v", err)
				}
				if got.NotificationLevel != level {
					t.Errorf("Round trip failed: %v -> %v", level, got.NotificationLevel)
				}
			})
		}
	})

	t.Run("RoomUserPreferences", func(t *testing.T) {
		for _, level := range levels {
			t.Run(level.String(), func(t *testing.T) {
				prefs := &corev1.RoomUserPreferences{NotificationLevel: level}
				data, err := proto.Marshal(prefs)
				if err != nil {
					t.Fatalf("Marshal failed: %v", err)
				}
				got := &corev1.RoomUserPreferences{}
				if err := proto.Unmarshal(data, got); err != nil {
					t.Fatalf("Unmarshal failed: %v", err)
				}
				if got.NotificationLevel != level {
					t.Errorf("Round trip failed: %v -> %v", level, got.NotificationLevel)
				}
			})
		}
	})
}

// ============================================================================
// Integration Tests: Space-Level
// ============================================================================

func TestChattoCore_GetSpaceNotificationLevel_NoPreference(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	// Create space (needed for config bucket)

	level, err := core.GetSpaceNotificationLevel(ctx, "test-user")
	if err != nil {
		t.Fatalf("GetSpaceNotificationLevel failed: %v", err)
	}
	if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED {
		t.Errorf("Expected DEFAULT for no preference, got %v", level)
	}
}

func TestChattoCore_SetSpaceNotificationLevel(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	tests := []struct {
		name     string
		level    corev1.NotificationLevel
		expected corev1.NotificationLevel
	}{
		{"set muted", corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED, corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED},
		{"set normal", corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL, corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL},
		{"set all_messages", corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES, corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES},
		{"set default (clears)", corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED, corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := core.SetSpaceNotificationLevel(ctx, "test-user", tt.level)
			if err != nil {
				t.Fatalf("SetSpaceNotificationLevel failed: %v", err)
			}

			got, err := core.GetSpaceNotificationLevel(ctx, "test-user")
			if err != nil {
				t.Fatalf("GetSpaceNotificationLevel failed: %v", err)
			}
			if got != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, got)
			}
		})
	}
}

func TestChattoCore_SetSpaceNotificationLevel_DefaultDeletesKey(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	// Set to MUTED first
	err := core.SetSpaceNotificationLevel(ctx, "test-user", corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED)
	if err != nil {
		t.Fatalf("SetSpaceNotificationLevel failed: %v", err)
	}

	// Verify it's MUTED
	level, err := core.GetSpaceNotificationLevel(ctx, "test-user")
	if err != nil {
		t.Fatalf("GetSpaceNotificationLevel failed: %v", err)
	}
	if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED {
		t.Fatalf("Expected MUTED, got %v", level)
	}

	// Set to DEFAULT (should delete the key)
	err = core.SetSpaceNotificationLevel(ctx, "test-user", corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED)
	if err != nil {
		t.Fatalf("SetSpaceNotificationLevel (DEFAULT) failed: %v", err)
	}

	// Verify it returns DEFAULT (key was deleted)
	level, err = core.GetSpaceNotificationLevel(ctx, "test-user")
	if err != nil {
		t.Fatalf("GetSpaceNotificationLevel failed: %v", err)
	}
	if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED {
		t.Errorf("Expected DEFAULT after clearing, got %v", level)
	}
}

// ============================================================================
// Integration Tests: Room-Level
// ============================================================================

func TestChattoCore_GetRoomNotificationLevel_NoPreference(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	level, err := core.GetRoomNotificationLevel(ctx, "test-user", "room123")
	if err != nil {
		t.Fatalf("GetRoomNotificationLevel failed: %v", err)
	}
	if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED {
		t.Errorf("Expected DEFAULT for no preference, got %v", level)
	}
}

func TestChattoCore_SetRoomNotificationLevel(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	room, err := core.CreateRoom(ctx, "test-user", KindChannel, "", "General", "")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	tests := []struct {
		name     string
		level    corev1.NotificationLevel
		expected corev1.NotificationLevel
	}{
		{"set muted", corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED, corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED},
		{"set all_messages", corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES, corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES},
		{"set default (clears)", corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED, corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := core.SetRoomNotificationLevel(ctx, "test-user", room.Id, tt.level)
			if err != nil {
				t.Fatalf("SetRoomNotificationLevel failed: %v", err)
			}

			got, err := core.GetRoomNotificationLevel(ctx, "test-user", room.Id)
			if err != nil {
				t.Fatalf("GetRoomNotificationLevel failed: %v", err)
			}
			if got != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, got)
			}
		})
	}
}

func TestNotificationPreferencesModel_SetRoomNotificationLevelAuthorization(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	member, err := core.CreateUser(ctx, SystemActorID, "notification-member", "Notification Member", "password")
	if err != nil {
		t.Fatalf("CreateUser(member): %v", err)
	}
	other, err := core.CreateUser(ctx, SystemActorID, "notification-other", "Notification Other", "password")
	if err != nil {
		t.Fatalf("CreateUser(other): %v", err)
	}
	room, err := core.CreateRoom(ctx, member.Id, KindChannel, "", "notification-service-room", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, member.Id, KindChannel, member.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom(member): %v", err)
	}

	service := core.NotificationPreferences()

	if _, err := service.SetRoomNotificationLevel(ctx, "", room.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED); !errors.Is(err, ErrNotAuthenticated) {
		t.Fatalf("SetRoomNotificationLevel unauthenticated err = %v, want ErrNotAuthenticated", err)
	}

	if _, err := service.SetRoomNotificationLevel(ctx, other.Id, room.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("SetRoomNotificationLevel non-member err = %v, want ErrPermissionDenied", err)
	}

	pref, err := service.SetRoomNotificationLevel(ctx, member.Id, room.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED)
	if err != nil {
		t.Fatalf("SetRoomNotificationLevel(member): %v", err)
	}
	if pref.RoomID != room.Id {
		t.Fatalf("RoomID = %q, want %q", pref.RoomID, room.Id)
	}
	if pref.Level != corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED {
		t.Fatalf("Level = %v, want muted", pref.Level)
	}
	if pref.EffectiveLevel != corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED {
		t.Fatalf("EffectiveLevel = %v, want muted", pref.EffectiveLevel)
	}
}

// ============================================================================
// Integration Tests: Effective Level (Inheritance)
// ============================================================================

func TestChattoCore_GetEffectiveNotificationLevel_Inheritance(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	room, err := core.CreateRoom(ctx, "test-user", KindChannel, "", "General", "")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	// No preferences set: should return ALL_MESSAGES (system default)
	t.Run("no preferences returns ALL_MESSAGES", func(t *testing.T) {
		level, err := core.GetEffectiveNotificationLevel(ctx, "test-user", room.Id)
		if err != nil {
			t.Fatalf("GetEffectiveNotificationLevel failed: %v", err)
		}
		if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES {
			t.Errorf("Expected ALL_MESSAGES, got %v", level)
		}
	})

	// Set space-level to MUTED: room should inherit
	t.Run("room inherits from space", func(t *testing.T) {
		err := core.SetSpaceNotificationLevel(ctx, "test-user", corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED)
		if err != nil {
			t.Fatalf("SetSpaceNotificationLevel failed: %v", err)
		}

		level, err := core.GetEffectiveNotificationLevel(ctx, "test-user", room.Id)
		if err != nil {
			t.Fatalf("GetEffectiveNotificationLevel failed: %v", err)
		}
		if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED {
			t.Errorf("Expected MUTED (inherited from space), got %v", level)
		}
	})

	// Set room-level to ALL_MESSAGES: should override space-level
	t.Run("room overrides space", func(t *testing.T) {
		err := core.SetRoomNotificationLevel(ctx, "test-user", room.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES)
		if err != nil {
			t.Fatalf("SetRoomNotificationLevel failed: %v", err)
		}

		level, err := core.GetEffectiveNotificationLevel(ctx, "test-user", room.Id)
		if err != nil {
			t.Fatalf("GetEffectiveNotificationLevel failed: %v", err)
		}
		if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES {
			t.Errorf("Expected ALL_MESSAGES (room override), got %v", level)
		}
	})

	// Clear room-level: should fall back to space-level (MUTED)
	t.Run("room cleared falls back to space", func(t *testing.T) {
		err := core.SetRoomNotificationLevel(ctx, "test-user", room.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED)
		if err != nil {
			t.Fatalf("SetRoomNotificationLevel failed: %v", err)
		}

		level, err := core.GetEffectiveNotificationLevel(ctx, "test-user", room.Id)
		if err != nil {
			t.Fatalf("GetEffectiveNotificationLevel failed: %v", err)
		}
		if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED {
			t.Errorf("Expected MUTED (from space after clearing room), got %v", level)
		}
	})

	// Clear space-level: should fall back to ALL_MESSAGES
	t.Run("all cleared falls back to ALL_MESSAGES", func(t *testing.T) {
		err := core.SetSpaceNotificationLevel(ctx, "test-user", corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED)
		if err != nil {
			t.Fatalf("SetSpaceNotificationLevel failed: %v", err)
		}

		level, err := core.GetEffectiveNotificationLevel(ctx, "test-user", room.Id)
		if err != nil {
			t.Fatalf("GetEffectiveNotificationLevel failed: %v", err)
		}
		if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES {
			t.Errorf("Expected ALL_MESSAGES (system default), got %v", level)
		}
	})
}

func TestChattoCore_DefaultAllMessagesNotifiesJoinedChannelMembers(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	recipient, err := core.CreateUser(ctx, SystemActorID, "default-notify-recipient", "Default Notify Recipient", "password123")
	if err != nil {
		t.Fatalf("CreateUser(recipient): %v", err)
	}
	author, err := core.CreateUser(ctx, SystemActorID, "default-notify-author", "Default Notify Author", "password123")
	if err != nil {
		t.Fatalf("CreateUser(author): %v", err)
	}
	room, err := core.CreateRoom(ctx, author.Id, KindChannel, "", "default-notify-room", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	for _, userID := range []string{recipient.Id, author.Id} {
		if _, err := core.JoinRoom(ctx, userID, KindChannel, userID, room.Id); err != nil {
			t.Fatalf("JoinRoom(%s): %v", userID, err)
		}
	}

	effective, err := core.GetEffectiveNotificationLevel(ctx, recipient.Id, room.Id)
	if err != nil {
		t.Fatalf("GetEffectiveNotificationLevel: %v", err)
	}
	if effective != corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES {
		t.Fatalf("default effective level = %v, want ALL_MESSAGES", effective)
	}

	posted, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "plain default notification", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(default): %v", err)
	}
	notifications, err := core.GetNotifications(ctx, recipient.Id)
	if err != nil {
		t.Fatalf("GetNotifications(default): %v", err)
	}
	if len(notifications) != 1 {
		t.Fatalf("default notifications = %d, want 1", len(notifications))
	}
	roomMessage := notifications[0].GetRoomMessage()
	if roomMessage == nil || roomMessage.GetRoomId() != room.Id || roomMessage.GetEventId() != posted.Id {
		t.Fatalf("default notification = %+v, want room %s event %s", notifications[0], room.Id, posted.Id)
	}

	threadReply, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "plain thread notification", nil, posted.Id, "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(thread reply): %v", err)
	}
	notifications, err = core.GetNotifications(ctx, recipient.Id)
	if err != nil {
		t.Fatalf("GetNotifications(thread reply): %v", err)
	}
	if len(notifications) != 2 {
		t.Fatalf("notifications after thread reply = %d, want 2", len(notifications))
	}
	threadNotification := notifications[0].GetRoomMessage()
	if threadNotification == nil || threadNotification.GetRoomId() != room.Id || threadNotification.GetEventId() != threadReply.Id || threadNotification.GetInThread() != posted.Id {
		t.Fatalf("thread notification = %+v, want room %s event %s thread %s", notifications[0], room.Id, threadReply.Id, posted.Id)
	}

	threadReplyTime, err := core.GetEventTimestamp(ctx, KindChannel, room.Id, threadReply.Id)
	if err != nil {
		t.Fatalf("GetEventTimestamp(thread reply): %v", err)
	}
	if got := core.DismissRoomReadNotifications(ctx, KindChannel, recipient.Id, room.Id, threadReplyTime); got != 1 {
		t.Fatalf("DismissRoomReadNotifications = %d, want root notification only", got)
	}
	notifications, err = core.GetNotifications(ctx, recipient.Id)
	if err != nil {
		t.Fatalf("GetNotifications(after room read): %v", err)
	}
	if len(notifications) != 1 || notifications[0].GetRoomMessage().GetInThread() != posted.Id {
		t.Fatalf("notifications after room read = %+v, want thread notification only", notifications)
	}
	if got := core.DismissThreadReadNotifications(ctx, KindChannel, recipient.Id, room.Id, posted.Id, threadReplyTime); got != 1 {
		t.Fatalf("DismissThreadReadNotifications = %d, want thread notification", got)
	}

	if err := core.SetSpaceNotificationLevel(ctx, recipient.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(NORMAL): %v", err)
	}
	if _, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "plain opt-down notification", nil, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage(opt-down): %v", err)
	}
	notifications, err = core.GetNotifications(ctx, recipient.Id)
	if err != nil {
		t.Fatalf("GetNotifications(opt-down): %v", err)
	}
	if len(notifications) != 0 {
		t.Fatalf("notifications after explicit NORMAL = %d, want none", len(notifications))
	}
}

func TestChattoCore_NormalNotifiesOnlyMentionsInRoomsAndAlwaysNotifiesDMs(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	recipient, err := core.CreateUser(ctx, SystemActorID, "normal-mentions-recipient", "Normal Mentions Recipient", "password123")
	if err != nil {
		t.Fatalf("CreateUser(recipient): %v", err)
	}
	author, err := core.CreateUser(ctx, SystemActorID, "normal-mentions-author", "Normal Mentions Author", "password123")
	if err != nil {
		t.Fatalf("CreateUser(author): %v", err)
	}
	room, err := core.CreateRoom(ctx, author.Id, KindChannel, "", "normal-mentions-room", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	for _, userID := range []string{recipient.Id, author.Id} {
		if _, err := core.JoinRoom(ctx, userID, KindChannel, userID, room.Id); err != nil {
			t.Fatalf("JoinRoom(%s): %v", userID, err)
		}
	}
	if err := core.SetSpaceNotificationLevel(ctx, recipient.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL); err != nil {
		t.Fatalf("SetSpaceNotificationLevel(NORMAL): %v", err)
	}

	if _, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "plain room message", nil, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage(plain): %v", err)
	}
	assertNotificationKinds(t, core, ctx, recipient.Id)

	if _, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "hello @normal-mentions-recipient", nil, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage(mention): %v", err)
	}
	assertNotificationKinds(t, core, ctx, recipient.Id, "mention")
	if _, err := core.DismissAllNotifications(ctx, recipient.Id); err != nil {
		t.Fatalf("DismissAllNotifications(mention): %v", err)
	}

	root, err := core.PostMessage(ctx, KindChannel, room.Id, recipient.Id, "thread root", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(thread root): %v", err)
	}
	if _, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "plain thread reply", nil, root.Id, root.Id, nil, false); err != nil {
		t.Fatalf("PostMessage(thread reply): %v", err)
	}
	assertNotificationKinds(t, core, ctx, recipient.Id)
	if _, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "thread mention @normal-mentions-recipient", nil, root.Id, "", nil, false); err != nil {
		t.Fatalf("PostMessage(thread mention): %v", err)
	}
	assertNotificationKinds(t, core, ctx, recipient.Id, "mention")
	if _, err := core.DismissAllNotifications(ctx, recipient.Id); err != nil {
		t.Fatalf("DismissAllNotifications(thread mention): %v", err)
	}

	dm, _, err := core.FindOrCreateDM(ctx, author.Id, []string{recipient.Id})
	if err != nil {
		t.Fatalf("FindOrCreateDM: %v", err)
	}
	if _, err := core.PostMessage(ctx, KindDM, dm.Id, author.Id, "direct message", nil, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage(DM): %v", err)
	}
	assertNotificationKinds(t, core, ctx, recipient.Id, "dm_message")
}

func assertNotificationKinds(t *testing.T, core *ChattoCore, ctx context.Context, userID string, want ...string) {
	t.Helper()
	notifications, err := core.GetNotifications(ctx, userID)
	if err != nil {
		t.Fatalf("GetNotifications(%s): %v", userID, err)
	}
	got := make([]string, 0, len(notifications))
	for _, notification := range notifications {
		got = append(got, notificationTypeName(notification))
	}
	if len(got) != len(want) {
		t.Fatalf("notification kinds = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("notification kinds = %v, want %v", got, want)
		}
	}
}

func TestChattoCore_DefaultAllMessagesDoesNotDuplicateThreadEcho(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	recipient, err := core.CreateUser(ctx, SystemActorID, "default-echo-recipient", "Default Echo Recipient", "password123")
	if err != nil {
		t.Fatalf("CreateUser(recipient): %v", err)
	}
	author, err := core.CreateUser(ctx, SystemActorID, "default-echo-author", "Default Echo Author", "password123")
	if err != nil {
		t.Fatalf("CreateUser(author): %v", err)
	}
	room, err := core.CreateRoom(ctx, author.Id, KindChannel, "", "default-echo-room", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	for _, userID := range []string{recipient.Id, author.Id} {
		if _, err := core.JoinRoom(ctx, userID, KindChannel, userID, room.Id); err != nil {
			t.Fatalf("JoinRoom(%s): %v", userID, err)
		}
	}

	root, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "thread root", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(root): %v", err)
	}
	if _, err := core.DismissAllNotifications(ctx, recipient.Id); err != nil {
		t.Fatalf("DismissAllNotifications(recipient): %v", err)
	}

	reply, err := core.PostMessage(ctx, KindChannel, room.Id, author.Id, "thread reply with channel echo", nil, root.Id, "", nil, true)
	if err != nil {
		t.Fatalf("PostMessage(reply with echo): %v", err)
	}
	notifications, err := core.GetNotifications(ctx, recipient.Id)
	if err != nil {
		t.Fatalf("GetNotifications: %v", err)
	}
	if len(notifications) != 1 {
		t.Fatalf("notifications for one echoed reply = %d, want exactly 1: %+v", len(notifications), notifications)
	}
	roomMessage := notifications[0].GetRoomMessage()
	if roomMessage == nil || roomMessage.GetEventId() != reply.Id || roomMessage.GetInThread() != root.Id {
		t.Fatalf("notification = %+v, want original reply %s in thread %s", notifications[0], reply.Id, root.Id)
	}
}

// ============================================================================
// Integration Tests: User Isolation
// ============================================================================

func TestChattoCore_NotificationLevel_UserIsolation(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	// Set userA's space level to MUTED
	err := core.SetSpaceNotificationLevel(ctx, "userA", corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED)
	if err != nil {
		t.Fatalf("SetSpaceNotificationLevel failed: %v", err)
	}

	// userB's space level should still be DEFAULT
	level, err := core.GetSpaceNotificationLevel(ctx, "userB")
	if err != nil {
		t.Fatalf("GetSpaceNotificationLevel failed: %v", err)
	}
	if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED {
		t.Errorf("Expected DEFAULT for userB (isolated from userA), got %v", level)
	}
}

// ============================================================================
// Integration Tests: Cleanup
// ============================================================================

func TestChattoCore_DeleteUserNotificationLevels(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	room1, err := core.CreateRoom(ctx, "test-user", KindChannel, "", "room-1", "")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	room2, err := core.CreateRoom(ctx, "test-user", KindChannel, "", "room-2", "")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	// Set space-level and room-level preferences
	err = core.SetSpaceNotificationLevel(ctx, "test-user", corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED)
	if err != nil {
		t.Fatalf("SetSpaceNotificationLevel failed: %v", err)
	}
	err = core.SetRoomNotificationLevel(ctx, "test-user", room1.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES)
	if err != nil {
		t.Fatalf("SetRoomNotificationLevel failed: %v", err)
	}
	err = core.SetRoomNotificationLevel(ctx, "test-user", room2.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL)
	if err != nil {
		t.Fatalf("SetRoomNotificationLevel failed: %v", err)
	}

	// Delete all notification levels
	err = core.deleteUserNotificationLevels(ctx, "test-user")
	if err != nil {
		t.Fatalf("deleteUserNotificationLevels failed: %v", err)
	}

	// Verify all levels are DEFAULT
	level, err := core.GetSpaceNotificationLevel(ctx, "test-user")
	if err != nil {
		t.Fatalf("GetSpaceNotificationLevel failed: %v", err)
	}
	if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED {
		t.Errorf("Expected DEFAULT for space after cleanup, got %v", level)
	}

	level, err = core.GetRoomNotificationLevel(ctx, "test-user", room1.Id)
	if err != nil {
		t.Fatalf("GetRoomNotificationLevel failed: %v", err)
	}
	if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED {
		t.Errorf("Expected DEFAULT for room1 after cleanup, got %v", level)
	}

	level, err = core.GetRoomNotificationLevel(ctx, "test-user", room2.Id)
	if err != nil {
		t.Fatalf("GetRoomNotificationLevel failed: %v", err)
	}
	if level != corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED {
		t.Errorf("Expected DEFAULT for room2 after cleanup, got %v", level)
	}
}

// ============================================================================
// Integration Tests: HasUnread respects mute
// ============================================================================

func TestChattoCore_HasUnread_MutedRoom(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	// Create user, space, room, and join
	user, err := core.CreateUser(ctx, "system", "muteduser", "Muted User", "password123")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	room, err := core.CreateRoom(ctx, user.Id, KindChannel, "", "General", "")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	// Join the room (CreateRoom does NOT auto-join the creator)
	_, err = core.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id)
	if err != nil {
		t.Fatalf("JoinRoom failed: %v", err)
	}

	// Create a second user who will post a message
	poster, err := core.CreateUser(ctx, "system", "poster", "Poster User", "password123")
	if err != nil {
		t.Fatalf("CreateUser (poster) failed: %v", err)
	}

	_, err = core.JoinRoom(ctx, poster.Id, KindChannel, poster.Id, room.Id)
	if err != nil {
		t.Fatalf("JoinRoom (poster) failed: %v", err)
	}

	// Post a message from the poster (spaceID, roomID, userID, body, attachments, inThread, inReplyTo)
	_, err = core.PostMessage(ctx, KindChannel, room.Id, poster.Id, "Hello!", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage failed: %v", err)
	}

	// Verify room has unread messages normally
	hasUnread, err := core.HasUnread(ctx, KindChannel, user.Id, room.Id)
	if err != nil {
		t.Fatalf("HasUnread failed: %v", err)
	}
	if !hasUnread {
		t.Error("Expected HasUnread=true before muting")
	}

	// Mute the room
	err = core.SetRoomNotificationLevel(ctx, user.Id, room.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED)
	if err != nil {
		t.Fatalf("SetRoomNotificationLevel failed: %v", err)
	}

	// HasUnread should now return false for muted room
	hasUnread, err = core.HasUnread(ctx, KindChannel, user.Id, room.Id)
	if err != nil {
		t.Fatalf("HasUnread failed: %v", err)
	}
	if hasUnread {
		t.Error("Expected HasUnread=false for muted room")
	}

	// Unmute the room
	err = core.SetRoomNotificationLevel(ctx, user.Id, room.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_UNSPECIFIED)
	if err != nil {
		t.Fatalf("SetRoomNotificationLevel failed: %v", err)
	}

	// HasUnread should return true again
	hasUnread, err = core.HasUnread(ctx, KindChannel, user.Id, room.Id)
	if err != nil {
		t.Fatalf("HasUnread failed: %v", err)
	}
	if !hasUnread {
		t.Error("Expected HasUnread=true after unmuting")
	}
}
