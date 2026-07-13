package core

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"hmans.de/chatto/internal/core/subjects"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// ============================================================================
// Notification Key Helpers
// ============================================================================

const (
	notificationTTL                    = 90 * 24 * time.Hour
	notificationKeyPrefix              = "notification."
	maxConcurrentNotificationCallbacks = 64
)

// notificationKey returns the KV key for a notification.
// Format: notification.{userId}.{notificationId}
func notificationKey(userID, notificationID string) string {
	return fmt.Sprintf("%s%s.%s", notificationKeyPrefix, userID, notificationID)
}

// notificationKeyFilter returns the NATS subject filter for all notifications for a user.
// Uses NATS subject wildcard syntax: "notification.userID.*" matches all keys for the user.
func notificationKeyFilter(userID string) string {
	return notificationKeyPrefix + userID + ".*"
}

// ============================================================================
// Notification CRUD Operations
// ============================================================================

// CreateNotification creates a new notification and publishes a sync event.
// The notification is stored in RUNTIME_STATE with a per-key TTL.
// Authorization: Internal use only - called by message posting logic.
//
// The notification parameter should already have its oneof payload set.
// Example: &corev1.Notification{Notification: &corev1.Notification_DmMessage{...}}
func (c *ChattoCore) CreateNotification(
	ctx context.Context,
	recipientID, actorID string,
	notification *corev1.Notification,
) (*corev1.Notification, error) {
	if err := validateNotificationInput(recipientID, notification); err != nil {
		return nil, err
	}

	// Keep ownership of the value stored and later passed to asynchronous push
	// callbacks. Mutating the caller's proto here allowed a caller to race the
	// callback or accidentally change the persisted notification after return.
	notification = proto.Clone(notification).(*corev1.Notification)
	silent := c.suppressesNotificationAlertsForPresence(ctx, recipientID)

	notificationID := NewNotificationID()
	now := time.Now()

	// Set/override common fields
	notification.Id = notificationID
	notification.RecipientId = recipientID
	notification.CreatedAt = timestamppb.New(now)
	notification.ActorId = actorID

	// Store in KV
	data, err := proto.Marshal(notification)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal notification: %w", err)
	}

	key := notificationKey(recipientID, notificationID)
	_, err = c.storage.runtimeStateKV.Create(ctx, key, data, jetstream.KeyTTL(notificationTTL))
	if err != nil {
		return nil, fmt.Errorf("failed to store notification: %w", err)
	}

	// Preference, message, membership, room lifecycle, and read-marker changes
	// can all race fanout. Their cleanup paths remove existing notifications;
	// this post-create check closes the inverse ordering where cleanup completed
	// immediately before this KV entry was stored. Fail closed on an unresolved
	// current state: a best-effort notification must never leak an inaccessible
	// target or contradict the user's latest preference.
	visible, visibilityErr := c.notificationVisibleInCurrentState(ctx, recipientID, notification)
	if visibilityErr != nil || !visible {
		if err := c.discardCreatedNotification(ctx, key); err != nil {
			return nil, err
		}
		if visibilityErr != nil {
			return nil, fmt.Errorf("failed to revalidate newly created notification: %w", visibilityErr)
		}
		return nil, nil
	}

	// Publish sync event to recipient for real-time delivery
	c.publishNotificationCreatedEvent(ctx, notification, silent)

	// Call the notification callback for push notifications (if set)
	// Run asynchronously to avoid blocking notification creation if push is slow
	if c.OnNotificationCreated != nil && !silent {
		callback := c.OnNotificationCreated
		c.dispatchNotificationCallback(func() {
			callback(withoutCancelOrBackground(ctx), notification)
		})
	}

	c.logger.Debug("Notification created",
		"notification_id", notificationID,
		"recipient_id", recipientID,
		"type", notificationTypeName(notification),
		"silent", silent)

	return notification, nil
}

func (c *ChattoCore) discardCreatedNotification(ctx context.Context, key string) error {
	entry, err := c.storage.runtimeStateKV.Get(ctx, key)
	if isRuntimeStateKeyAbsent(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to revalidate newly created notification: %w", err)
	}
	if err := c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(entry.Revision())); err != nil &&
		!errors.Is(err, jetstream.ErrKeyExists) && !isRuntimeStateKeyAbsent(err) {
		return fmt.Errorf("failed to discard newly created notification: %w", err)
	}
	return nil
}

func (c *ChattoCore) suppressesNotificationAlertsForPresence(ctx context.Context, userID string) bool {
	status, err := c.GetUserPresence(ctx, userID)
	if err != nil {
		c.logger.Warn("Failed to get presence for notification suppression",
			"user_id", userID, "error", err)
		return false
	}
	return status == PresenceStatusDoNotDisturb
}

// GetNotifications returns all notifications for a user, ordered by creation time (newest first).
// Authorization: Caller must verify userID matches authenticated user.
func (c *ChattoCore) GetNotifications(ctx context.Context, userID string) ([]*corev1.Notification, error) {
	prefix := notificationKeyFilter(userID)
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, prefix)
	if err != nil {
		if errors.Is(err, jetstream.ErrNoKeysFound) {
			return []*corev1.Notification{}, nil
		}
		return nil, fmt.Errorf("failed to list notification keys: %w", err)
	}

	var notifications []*corev1.Notification
	for key := range lister.Keys() {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if err != nil {
			c.logger.Warn("Failed to get notification", "key", key, "error", err)
			continue
		}

		var notif corev1.Notification
		if err := proto.Unmarshal(entry.Value(), &notif); err != nil {
			c.logger.Warn("Failed to unmarshal notification", "key", key, "error", err)
			continue
		}
		if !storedNotificationMatchesKey(userID, key, &notif) {
			c.logger.Warn("Ignored notification whose stored identity does not match its key", "key", key)
			continue
		}
		visible, err := c.notificationVisibleInCurrentState(ctx, userID, &notif)
		if err != nil {
			c.logger.Warn("Ignored notification whose current state could not be revalidated", "key", key, "error", err)
			continue
		}
		if !visible {
			continue
		}
		notifications = append(notifications, &notif)
	}

	// Sort by created_at descending (newest first)
	sort.Slice(notifications, func(i, j int) bool {
		return notifications[i].CreatedAt.AsTime().After(notifications[j].CreatedAt.AsTime())
	})

	return notifications, nil
}

// GetNotification retrieves a single notification.
// Returns nil if the notification doesn't exist.
// Authorization: Caller must verify userID matches authenticated user.
func (c *ChattoCore) GetNotification(ctx context.Context, userID, notificationID string) (*corev1.Notification, error) {
	key := notificationKey(userID, notificationID)
	entry, err := c.storage.runtimeStateKV.Get(ctx, key)
	if err != nil {
		if errors.Is(err, jetstream.ErrKeyNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get notification: %w", err)
	}

	var notif corev1.Notification
	if err := proto.Unmarshal(entry.Value(), &notif); err != nil {
		return nil, fmt.Errorf("failed to unmarshal notification: %w", err)
	}
	if !storedNotificationMatchesKey(userID, key, &notif) {
		return nil, nil
	}
	visible, err := c.notificationVisibleInCurrentState(ctx, userID, &notif)
	if err != nil {
		return nil, fmt.Errorf("failed to revalidate notification: %w", err)
	}
	if !visible {
		return nil, nil
	}

	return &notif, nil
}

// DismissNotification deletes a notification and publishes a sync event.
// Returns true if notification existed and was deleted, false if already dismissed.
// Authorization: Caller must verify userID matches authenticated user.
func (c *ChattoCore) DismissNotification(ctx context.Context, userID, notificationID string) (bool, error) {
	key := notificationKey(userID, notificationID)

	// Fetch notification before deleting (needed for push dismissal callback)
	entry, err := c.storage.runtimeStateKV.Get(ctx, key)
	if err != nil {
		if errors.Is(err, jetstream.ErrKeyNotFound) {
			return false, nil // Already dismissed
		}
		return false, fmt.Errorf("failed to get notification: %w", err)
	}

	var notif corev1.Notification
	if err := proto.Unmarshal(entry.Value(), &notif); err != nil {
		return false, fmt.Errorf("failed to unmarshal notification: %w", err)
	}
	validForCallback := storedNotificationMatchesKey(userID, key, &notif)

	// Delete only the revision we fetched. Concurrent dismissals on another
	// replica then become an idempotent no-op instead of publishing duplicate
	// live events and push-dismiss callbacks.
	err = c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(entry.Revision()))
	if errors.Is(err, jetstream.ErrKeyExists) || errors.Is(err, jetstream.ErrKeyNotFound) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to delete notification: %w", err)
	}

	// Publish sync event for cross-device sync (WebSocket)
	c.publishNotificationDismissedEvent(ctx, userID, notificationID)

	// Call the notification callback for push dismissal (if set)
	// Run asynchronously to avoid blocking notification dismissal
	if validForCallback && c.OnNotificationDismissed != nil {
		callback := c.OnNotificationDismissed
		c.dispatchNotificationCallback(func() {
			callback(withoutCancelOrBackground(ctx), userID, &notif)
		})
	}

	c.logger.Debug("Notification dismissed",
		"notification_id", notificationID,
		"user_id", userID)

	return true, nil
}

// DismissAllNotifications deletes all notifications for a user.
// Returns the count of deleted notifications.
// Authorization: Caller must verify userID matches authenticated user.
func (c *ChattoCore) DismissAllNotifications(ctx context.Context, userID string) (int, error) {
	return c.dismissAllNotifications(ctx, userID, false)
}

// dismissAllNotificationsBeforePushSubscriptionRemoval waits for the push
// dismissal callbacks created by this operation. Account deletion uses this
// ordering so native notifications can be closed while the user's device
// endpoints still exist; ordinary UI dismissal remains asynchronous.
func (c *ChattoCore) dismissAllNotificationsBeforePushSubscriptionRemoval(ctx context.Context, userID string) (int, error) {
	return c.dismissAllNotifications(ctx, userID, true)
}

func (c *ChattoCore) dismissAllNotifications(ctx context.Context, userID string, waitForCallbacks bool) (int, error) {
	var callbacks sync.WaitGroup
	if waitForCallbacks {
		defer callbacks.Wait()
	}

	prefix := notificationKeyFilter(userID)
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, prefix)
	if err != nil {
		if errors.Is(err, jetstream.ErrNoKeysFound) {
			return 0, nil
		}
		return 0, fmt.Errorf("failed to list notification keys: %w", err)
	}

	// Collect keys first to avoid modifying while iterating
	var keys []string
	for key := range lister.Keys() {
		keys = append(keys, key)
	}

	deleted := 0
	dismissedNotifications := make([]*corev1.Notification, 0, len(keys))
	for _, key := range keys {
		var notif *corev1.Notification
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if err != nil {
			if errors.Is(err, jetstream.ErrKeyNotFound) {
				continue
			}
			return deleted, fmt.Errorf("failed to get notification before dismissing: %w", err)
		}

		var decoded corev1.Notification
		if err := proto.Unmarshal(entry.Value(), &decoded); err != nil {
			c.logger.Warn("Failed to unmarshal notification before dismissing", "key", key, "error", err)
		} else if storedNotificationMatchesKey(userID, key, &decoded) {
			notif = &decoded
		} else {
			c.logger.Warn("Skipped push dismissal for notification with mismatched stored identity", "key", key)
		}

		if err := c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(entry.Revision())); err != nil {
			if errors.Is(err, jetstream.ErrKeyExists) || errors.Is(err, jetstream.ErrKeyNotFound) {
				continue
			}
			return deleted, fmt.Errorf("failed to delete notification: %w", err)
		}

		keyPrefix := notificationKeyPrefix + userID + "."
		notificationID := strings.TrimPrefix(key, keyPrefix)
		if notificationID == key {
			return deleted, fmt.Errorf("invalid notification key %q", key)
		}
		if notificationID == "" {
			continue
		}
		deleted++

		c.publishNotificationDismissedEvent(ctx, userID, notificationID)

		if notif != nil {
			dismissedNotifications = append(dismissedNotifications, notif)
		}
	}

	dispatch := func(callback func()) {
		if waitForCallbacks {
			callbacks.Add(1)
		}
		c.dispatchNotificationCallback(func() {
			if waitForCallbacks {
				defer callbacks.Done()
			}
			callback()
		})
	}
	if deleted > 0 && c.OnNotificationsDismissed != nil {
		callback := c.OnNotificationsDismissed
		dispatch(func() {
			callback(withoutCancelOrBackground(ctx), userID)
		})
	} else if c.OnNotificationDismissed != nil {
		callback := c.OnNotificationDismissed
		for _, notification := range dismissedNotifications {
			notification := notification
			dispatch(func() {
				callback(withoutCancelOrBackground(ctx), userID, notification)
			})
		}
	}

	c.logger.Debug("Dismissed all notifications",
		"user_id", userID,
		"count", deleted)

	return deleted, nil
}

func withoutCancelOrBackground(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return context.WithoutCancel(ctx)
}

// dispatchNotificationCallback preserves the existing non-blocking callback
// execution while bounding how many callback goroutines can exist at once.
// Once the process is at capacity, producers apply backpressure rather than
// silently dropping a native notification or allocating an unbounded backlog.
func (c *ChattoCore) dispatchNotificationCallback(callback func()) {
	if callback == nil {
		return
	}
	c.notificationCallbackSlotsOnce.Do(func() {
		if c.notificationCallbackSlots == nil {
			// Keep manually-constructed cores safe in focused tests and embeddings.
			c.notificationCallbackSlots = make(chan struct{}, maxConcurrentNotificationCallbacks)
		}
	})
	slots := c.notificationCallbackSlots
	slots <- struct{}{}
	go func() {
		defer func() { <-slots }()
		callback()
	}()
}

// HasUnreadNotifications checks if a user has any notifications.
// Used for the bell icon indicator.
// Authorization: Caller must verify userID matches authenticated user.
func (c *ChattoCore) HasUnreadNotifications(ctx context.Context, userID string) (bool, error) {
	notifications, err := c.GetNotifications(ctx, userID)
	if err != nil {
		return false, fmt.Errorf("failed to check notifications: %w", err)
	}
	return len(notifications) > 0, nil
}

// GetNotificationCount returns the count of notifications for a user.
// Authorization: Caller must verify userID matches authenticated user.
func (c *ChattoCore) GetNotificationCount(ctx context.Context, userID string) (int, error) {
	notifications, err := c.GetNotifications(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("failed to count notifications: %w", err)
	}
	return len(notifications), nil
}

func (c *ChattoCore) GetRoomNotificationsForMember(ctx context.Context, actorID, roomID string) ([]*corev1.Notification, error) {
	if err := requireAuthenticatedActor(actorID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(roomID) == "" {
		return nil, invalidArgument("room_id is required")
	}
	room, err := c.FindRoomByID(ctx, roomID)
	if err != nil {
		return nil, err
	}
	isMember, err := c.RoomMembershipExists(ctx, KindOfRoom(room), actorID, room.GetId())
	if err != nil || !isMember {
		return []*corev1.Notification{}, nil
	}

	notifications, err := c.GetNotifications(ctx, actorID)
	if err != nil {
		return nil, err
	}
	filtered := make([]*corev1.Notification, 0, len(notifications))
	for _, notification := range notifications {
		if notificationTargetRoomID(notification) == room.GetId() {
			filtered = append(filtered, notification)
		}
	}
	return filtered, nil
}

// DismissRoomReadNotifications clears pending room-level notifications covered
// by a room read marker and emits the same cross-device dismissal side effects
// as explicit notification dismissal.
func (c *ChattoCore) DismissRoomReadNotifications(ctx context.Context, kind RoomKind, userID, roomID string, readThrough time.Time) int {
	if readThrough.IsZero() {
		return 0
	}
	count, err := c.dismissMatchingNotifications(ctx, userID, func(notification *corev1.Notification) bool {
		switch payload := notification.GetNotification().(type) {
		case *corev1.Notification_DmMessage:
			return payload.DmMessage.GetRoomId() == roomID &&
				payload.DmMessage.GetInThread() == "" &&
				c.notificationEventAtOrBefore(ctx, kind, roomID, payload.DmMessage.GetEventId(), readThrough)
		case *corev1.Notification_Mention:
			return payload.Mention.GetRoomId() == roomID &&
				payload.Mention.GetInThread() == "" &&
				c.notificationEventAtOrBefore(ctx, kind, roomID, payload.Mention.GetEventId(), readThrough)
		case *corev1.Notification_Reply:
			return payload.Reply.GetRoomId() == roomID &&
				payload.Reply.GetInThread() == "" &&
				c.notificationEventAtOrBefore(ctx, kind, roomID, payload.Reply.GetEventId(), readThrough)
		case *corev1.Notification_RoomMessage:
			return payload.RoomMessage.GetRoomId() == roomID &&
				payload.RoomMessage.GetInThread() == "" &&
				c.notificationEventAtOrBefore(ctx, kind, roomID, payload.RoomMessage.GetEventId(), readThrough)
		default:
			return false
		}
	})
	if err != nil {
		c.logger.Warn("Failed to dismiss read room notifications",
			"user_id", userID,
			"room_id", roomID,
			"error", err)
	}
	return count
}

// DismissThreadReadNotifications clears pending thread-scoped notifications
// covered by a thread read marker and emits the same cross-device dismissal
// side effects as explicit notification dismissal.
func (c *ChattoCore) DismissThreadReadNotifications(ctx context.Context, kind RoomKind, userID, roomID, threadRootEventID string, readThrough time.Time) int {
	if readThrough.IsZero() {
		return 0
	}
	count, err := c.dismissMatchingNotifications(ctx, userID, func(notification *corev1.Notification) bool {
		switch payload := notification.GetNotification().(type) {
		case *corev1.Notification_DmMessage:
			return payload.DmMessage.GetRoomId() == roomID &&
				payload.DmMessage.GetInThread() == threadRootEventID &&
				c.notificationEventAtOrBefore(ctx, kind, roomID, payload.DmMessage.GetEventId(), readThrough)
		case *corev1.Notification_Mention:
			return payload.Mention.GetRoomId() == roomID &&
				payload.Mention.GetInThread() == threadRootEventID &&
				c.notificationEventAtOrBefore(ctx, kind, roomID, payload.Mention.GetEventId(), readThrough)
		case *corev1.Notification_Reply:
			return payload.Reply.GetRoomId() == roomID &&
				payload.Reply.GetInThread() == threadRootEventID &&
				c.notificationEventAtOrBefore(ctx, kind, roomID, payload.Reply.GetEventId(), readThrough)
		case *corev1.Notification_RoomMessage:
			return payload.RoomMessage.GetRoomId() == roomID &&
				payload.RoomMessage.GetInThread() == threadRootEventID &&
				c.notificationEventAtOrBefore(ctx, kind, roomID, payload.RoomMessage.GetEventId(), readThrough)
		default:
			return false
		}
	})
	if err != nil {
		c.logger.Warn("Failed to dismiss read thread notifications",
			"user_id", userID,
			"room_id", roomID,
			"thread_root_event_id", threadRootEventID,
			"error", err)
	}
	return count
}

// DismissRoomNotifications removes every pending notification targeting a room.
// Room lifecycle transitions call this after membership loss or deletion so
// notification-center entries and native pushes cannot point at an inaccessible
// destination.
func (c *ChattoCore) DismissRoomNotifications(ctx context.Context, userID, roomID string) int {
	if userID == "" || roomID == "" {
		return 0
	}
	count, err := c.dismissMatchingNotifications(ctx, userID, func(notification *corev1.Notification) bool {
		return notificationTargetRoomID(notification) == roomID
	})
	if err != nil {
		c.logger.Warn("Failed to dismiss room notifications",
			"user_id", userID,
			"room_id", roomID,
			"error", err)
	}
	return count
}

// DismissRoomNotificationsForAllUsers removes every pending notification that
// targets a room, including residual records for former members. Room deletion
// cannot rely on a membership snapshot because a previous partial cleanup may
// have left exactly such a record behind.
func (c *ChattoCore) DismissRoomNotificationsForAllUsers(ctx context.Context, roomID string) int {
	if roomID == "" {
		return 0
	}
	count, err := c.dismissNotificationsAcrossUsers(ctx, func(notification *corev1.Notification) bool {
		return notificationTargetRoomID(notification) == roomID
	})
	if err != nil {
		c.logger.Warn("Failed to dismiss room notifications for all users",
			"room_id", roomID,
			"error", err)
	}
	return count
}

// DismissMessageNotifications removes notifications targeting any of the
// supplied message events across all recipients. Message deletion uses this for
// the retracted event and its linked channel echoes. The global notification
// scan intentionally includes former members left behind by an earlier partial
// membership cleanup.
func (c *ChattoCore) DismissMessageNotifications(ctx context.Context, kind RoomKind, roomID string, eventIDs ...string) int {
	if roomID == "" || len(eventIDs) == 0 {
		return 0
	}
	targets := make(map[string]struct{}, len(eventIDs))
	for _, eventID := range eventIDs {
		if eventID != "" {
			targets[eventID] = struct{}{}
		}
	}
	if len(targets) == 0 {
		return 0
	}

	dismissed, err := c.dismissNotificationsAcrossUsers(ctx, func(notification *corev1.Notification) bool {
		if notificationTargetRoomID(notification) != roomID {
			return false
		}
		_, matches := targets[notificationTargetEventID(notification)]
		return matches
	})
	if err != nil {
		c.logger.Warn("Failed to dismiss notifications for retracted message",
			"kind", kind,
			"room_id", roomID,
			"error", err)
	}
	return dismissed
}

// DismissIneligibleNotifications reconciles pending notification-center entries
// after a server or room preference change. An empty roomID checks every room;
// a non-empty roomID scopes the cleanup to that room.
func (c *ChattoCore) DismissIneligibleNotifications(ctx context.Context, userID, roomID string) int {
	if userID == "" {
		return 0
	}
	count, err := c.dismissMatchingNotifications(ctx, userID, func(notification *corev1.Notification) bool {
		if roomID != "" && notificationTargetRoomID(notification) != roomID {
			return false
		}
		eligible, err := c.notificationEligibleForCurrentPreference(ctx, userID, notification)
		if err != nil {
			c.logger.Warn("Failed to resolve notification preference during cleanup",
				"user_id", userID,
				"room_id", notificationTargetRoomID(notification),
				"error", err)
			return false
		}
		return !eligible
	})
	if err != nil {
		c.logger.Warn("Failed to dismiss notifications incompatible with current preferences",
			"user_id", userID,
			"room_id", roomID,
			"error", err)
	}
	return count
}

func validateNotificationInput(recipientID string, notification *corev1.Notification) error {
	if strings.TrimSpace(recipientID) == "" {
		return invalidArgument("notification recipient is required")
	}
	if notification == nil {
		return invalidArgument("notification is required")
	}
	switch payload := notification.GetNotification().(type) {
	case *corev1.Notification_DmMessage:
		if payload.DmMessage == nil {
			return invalidArgument("DM notification payload is required")
		}
	case *corev1.Notification_Mention:
		if payload.Mention == nil {
			return invalidArgument("mention notification payload is required")
		}
	case *corev1.Notification_Reply:
		if payload.Reply == nil {
			return invalidArgument("reply notification payload is required")
		}
	case *corev1.Notification_RoomMessage:
		if payload.RoomMessage == nil {
			return invalidArgument("room-message notification payload is required")
		}
	default:
		return invalidArgument("notification payload is required")
	}
	if strings.TrimSpace(notificationTargetRoomID(notification)) == "" {
		return invalidArgument("notification room is required")
	}
	if strings.TrimSpace(notificationTargetEventID(notification)) == "" {
		return invalidArgument("notification event is required")
	}
	return nil
}

func storedNotificationMatchesKey(userID, key string, notification *corev1.Notification) bool {
	if notification == nil || notification.GetRecipientId() != userID || notification.GetId() == "" {
		return false
	}
	if notificationKey(userID, notification.GetId()) != key {
		return false
	}
	return validateNotificationInput(userID, notification) == nil
}

// notificationVisibleInCurrentState is the authoritative delivery predicate
// for stored notifications. Creation, API reads, realtime hydration, and the
// native-push callback all pass through it, so a failed cleanup cannot expose a
// stale notification after a preference, read marker, membership, room, or
// message lifecycle transition.
func (c *ChattoCore) notificationVisibleInCurrentState(ctx context.Context, userID string, notification *corev1.Notification) (bool, error) {
	if err := validateNotificationInput(userID, notification); err != nil {
		return false, nil
	}
	eligible, err := c.notificationEligibleForCurrentPreference(ctx, userID, notification)
	if err != nil {
		return false, fmt.Errorf("resolve notification preference: %w", err)
	}
	if !eligible {
		return false, nil
	}
	if _, deleted := c.RoomTimeline.MessageDeletedAt(notificationTargetEventID(notification)); deleted {
		return false, nil
	}
	accessible, realTarget, err := c.notificationRecipientCanAccessCurrentRoom(ctx, userID, notification)
	if err != nil {
		return false, err
	}
	if !accessible {
		return false, nil
	}
	// Synthetic low-level records used by storage tests predate room catalog
	// enforcement. Unknown targets remain readable for compatibility, while any
	// target backed by a real timeline entry must pass current room/read checks.
	if !realTarget {
		return true, nil
	}
	covered, err := c.notificationCoveredByCurrentReadState(ctx, userID, notification)
	if err != nil {
		return false, err
	}
	return !covered, nil
}

func (c *ChattoCore) notificationRecipientCanAccessCurrentRoom(ctx context.Context, userID string, notification *corev1.Notification) (accessible, realTarget bool, err error) {
	roomID := notificationTargetRoomID(notification)
	eventID := notificationTargetEventID(notification)
	entry, eventKnown := c.RoomTimeline.Get(eventID)
	if eventKnown && roomIDOfEvent(entry.Event) != roomID {
		return false, true, nil
	}

	room, err := c.FindRoomByID(ctx, roomID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			// Deleted rooms disappear from the catalog while their audit timeline is
			// intentionally retained. A matching timeline entry therefore proves
			// that this is a real but no-longer-accessible target.
			if eventKnown {
				return false, true, nil
			}
			return true, false, nil
		}
		return false, false, fmt.Errorf("resolve notification room: %w", err)
	}
	isMember, err := c.RoomMembershipExists(ctx, KindOfRoom(room), userID, roomID)
	if err != nil {
		return false, true, fmt.Errorf("resolve notification room membership: %w", err)
	}
	return isMember, true, nil
}

func (c *ChattoCore) notificationEligibleForCurrentPreference(ctx context.Context, userID string, notification *corev1.Notification) (bool, error) {
	roomID := notificationTargetRoomID(notification)
	if roomID == "" {
		return true, nil
	}
	level, err := c.GetEffectiveNotificationLevel(ctx, userID, roomID)
	if err != nil {
		return true, err
	}
	return notificationEligibleForLevel(notification, level), nil
}

func notificationEligibleForLevel(notification *corev1.Notification, level corev1.NotificationLevel) bool {
	if notification == nil || level == corev1.NotificationLevel_NOTIFICATION_LEVEL_MUTED {
		return false
	}
	switch notification.GetNotification().(type) {
	case *corev1.Notification_DmMessage:
		return true
	case *corev1.Notification_Mention:
		return level == corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL ||
			level == corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES
	case *corev1.Notification_Reply, *corev1.Notification_RoomMessage:
		return level == corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES
	default:
		return false
	}
}

func (c *ChattoCore) dismissMatchingNotifications(ctx context.Context, userID string, match func(*corev1.Notification) bool) (int, error) {
	prefix := notificationKeyFilter(userID)
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, prefix)
	if err != nil {
		if errors.Is(err, jetstream.ErrNoKeysFound) {
			return 0, nil
		}
		return 0, fmt.Errorf("failed to list notification keys: %w", err)
	}

	notificationIDs := []string{}
	for key := range lister.Keys() {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if err != nil {
			if errors.Is(err, jetstream.ErrKeyNotFound) {
				continue
			}
			return len(notificationIDs), fmt.Errorf("failed to get notification: %w", err)
		}

		var notification corev1.Notification
		if err := proto.Unmarshal(entry.Value(), &notification); err != nil {
			c.logger.Warn("Ignored corrupt notification during cleanup", "key", key, "error", err)
			continue
		}
		if !storedNotificationMatchesKey(userID, key, &notification) {
			c.logger.Warn("Ignored notification with mismatched stored identity during cleanup", "key", key)
			continue
		}
		if match(&notification) {
			notificationIDs = append(notificationIDs, notification.GetId())
		}
	}

	dismissed := 0
	for _, notificationID := range notificationIDs {
		ok, err := c.DismissNotification(ctx, userID, notificationID)
		if err != nil {
			return dismissed, err
		}
		if ok {
			dismissed++
		}
	}
	return dismissed, nil
}

func (c *ChattoCore) dismissNotificationsAcrossUsers(ctx context.Context, match func(*corev1.Notification) bool) (int, error) {
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, notificationKeyPrefix+">")
	if err != nil {
		if errors.Is(err, jetstream.ErrNoKeysFound) {
			return 0, nil
		}
		return 0, fmt.Errorf("failed to list notifications: %w", err)
	}

	type target struct {
		userID         string
		notificationID string
	}
	targets := []target{}
	for key := range lister.Keys() {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if err != nil {
			if isRuntimeStateKeyAbsent(err) {
				continue
			}
			return 0, fmt.Errorf("failed to get notification: %w", err)
		}

		var notification corev1.Notification
		if err := proto.Unmarshal(entry.Value(), &notification); err != nil {
			c.logger.Warn("Ignored corrupt notification during global cleanup", "key", key, "error", err)
			continue
		}
		if !storedNotificationMatchesKey(notification.GetRecipientId(), key, &notification) {
			c.logger.Warn("Ignored notification with mismatched stored identity during global cleanup", "key", key)
			continue
		}
		if match(&notification) {
			targets = append(targets, target{
				userID:         notification.GetRecipientId(),
				notificationID: notification.GetId(),
			})
		}
	}

	dismissed := 0
	for _, target := range targets {
		ok, err := c.DismissNotification(ctx, target.userID, target.notificationID)
		if err != nil {
			return dismissed, err
		}
		if ok {
			dismissed++
		}
	}
	return dismissed, nil
}

func (c *ChattoCore) notificationEventAtOrBefore(ctx context.Context, kind RoomKind, roomID, eventID string, cutoff time.Time) bool {
	if eventID == "" || cutoff.IsZero() {
		return false
	}
	eventTime, err := c.GetEventTimestamp(ctx, kind, roomID, eventID)
	if err != nil {
		c.logger.Warn("Failed to resolve notification event timestamp",
			"kind", kind,
			"room_id", roomID,
			"event_id", eventID,
			"error", err)
		return false
	}
	return !eventTime.IsZero() && !eventTime.After(cutoff)
}

func (c *ChattoCore) notificationCoveredByCurrentReadState(ctx context.Context, userID string, notification *corev1.Notification) (bool, error) {
	roomID := notificationTargetRoomID(notification)
	eventID := notificationTargetEventID(notification)
	if roomID == "" || eventID == "" {
		return false, nil
	}

	room, err := c.FindRoomByID(ctx, roomID)
	if err != nil {
		return false, fmt.Errorf("resolve notification room: %w", err)
	}
	kind := KindOfRoom(room)
	eventTime, err := c.GetEventTimestamp(ctx, kind, roomID, eventID)
	if err != nil {
		return false, fmt.Errorf("resolve notification event timestamp: %w", err)
	}
	if eventTime.IsZero() {
		return false, nil
	}

	if threadRootEventID := notificationTargetThreadRootID(notification); threadRootEventID != "" {
		readThrough, err := c.GetThreadLastOpened(ctx, kind, userID, roomID, threadRootEventID)
		if err != nil {
			return false, fmt.Errorf("resolve thread read marker: %w", err)
		}
		return !readThrough.IsZero() && !eventTime.After(readThrough), nil
	}

	readEventID, exists, err := c.PeekLastReadEventID(ctx, userID, roomID)
	if err != nil {
		return false, fmt.Errorf("resolve room read marker: %w", err)
	}
	if !exists || readEventID == "" {
		return false, nil
	}
	readThrough, err := c.GetEventTimestamp(ctx, kind, roomID, readEventID)
	if err != nil {
		return false, fmt.Errorf("resolve room read marker timestamp: %w", err)
	}
	return !readThrough.IsZero() && !eventTime.After(readThrough), nil
}

// ============================================================================
// Real-time Sync Events
// ============================================================================

// publishNotificationCreatedEvent publishes a live event for cross-device sync.
func (c *ChattoCore) publishNotificationCreatedEvent(ctx context.Context, notif *corev1.Notification, silent bool) {
	// Extract navigation context from the notification payload
	var roomID, eventID, inReplyToID string
	switch n := notif.Notification.(type) {
	case *corev1.Notification_DmMessage:
		roomID = n.DmMessage.RoomId
		eventID = n.DmMessage.EventId
	case *corev1.Notification_Mention:
		roomID = n.Mention.RoomId
		eventID = n.Mention.EventId
	case *corev1.Notification_Reply:
		roomID = n.Reply.RoomId
		eventID = n.Reply.EventId
		inReplyToID = n.Reply.InReplyToId
	case *corev1.Notification_RoomMessage:
		roomID = n.RoomMessage.RoomId
		eventID = n.RoomMessage.EventId
	}

	event := newLiveEvent(notif.ActorId, &corev1.LiveEvent{
		CreatedAt: notif.CreatedAt,
		Event: &corev1.LiveEvent_NotificationCreated{
			NotificationCreated: &corev1.NotificationCreatedEvent{
				NotificationId: notif.Id,
				RoomId:         roomID,
				EventId:        eventID,
				InReplyToId:    inReplyToID,
				Silent:         silent,
			},
		},
	})

	subject := subjects.LiveSyncUserEvent(notif.RecipientId, "notification_created")
	if err := c.publishLiveEvent(ctx, subject, event); err != nil {
		c.logger.Warn("Failed to publish notification created event",
			"notification_id", notif.Id,
			"error", err)
	}
}

// publishNotificationDismissedEvent publishes a live event for cross-device sync.
func (c *ChattoCore) publishNotificationDismissedEvent(ctx context.Context, userID, notificationID string) {
	event := newLiveEvent(userID, &corev1.LiveEvent{
		Event: &corev1.LiveEvent_NotificationDismissed{
			NotificationDismissed: &corev1.NotificationDismissedEvent{
				NotificationId: notificationID,
			},
		},
	})

	subject := subjects.LiveSyncUserEvent(userID, "notification_dismissed")
	if err := c.publishLiveEvent(ctx, subject, event); err != nil {
		c.logger.Warn("Failed to publish notification dismissed event",
			"notification_id", notificationID,
			"error", err)
	}
}

// ============================================================================
// Helpers
// ============================================================================

// notificationTypeName returns a string name for the notification type.
func notificationTypeName(notif *corev1.Notification) string {
	switch notif.Notification.(type) {
	case *corev1.Notification_DmMessage:
		return "dm_message"
	case *corev1.Notification_Mention:
		return "mention"
	case *corev1.Notification_Reply:
		return "reply"
	case *corev1.Notification_RoomMessage:
		return "room_message"
	default:
		return "unknown"
	}
}

func notificationTargetRoomID(notification *corev1.Notification) string {
	if notification == nil {
		return ""
	}
	switch payload := notification.GetNotification().(type) {
	case *corev1.Notification_DmMessage:
		return payload.DmMessage.GetRoomId()
	case *corev1.Notification_Mention:
		return payload.Mention.GetRoomId()
	case *corev1.Notification_Reply:
		return payload.Reply.GetRoomId()
	case *corev1.Notification_RoomMessage:
		return payload.RoomMessage.GetRoomId()
	default:
		return ""
	}
}

func notificationTargetEventID(notification *corev1.Notification) string {
	if notification == nil {
		return ""
	}
	switch payload := notification.GetNotification().(type) {
	case *corev1.Notification_DmMessage:
		return payload.DmMessage.GetEventId()
	case *corev1.Notification_Mention:
		return payload.Mention.GetEventId()
	case *corev1.Notification_Reply:
		return payload.Reply.GetEventId()
	case *corev1.Notification_RoomMessage:
		return payload.RoomMessage.GetEventId()
	default:
		return ""
	}
}

func notificationTargetThreadRootID(notification *corev1.Notification) string {
	if notification == nil {
		return ""
	}
	switch payload := notification.GetNotification().(type) {
	case *corev1.Notification_DmMessage:
		return payload.DmMessage.GetInThread()
	case *corev1.Notification_Mention:
		return payload.Mention.GetInThread()
	case *corev1.Notification_Reply:
		return payload.Reply.GetInThread()
	case *corev1.Notification_RoomMessage:
		return payload.RoomMessage.GetInThread()
	default:
		return ""
	}
}
