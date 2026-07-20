package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const notificationCenterSuppressionKeyPrefix = "notification_center_suppression."

// SuppressNotificationCenterForClient records that a non-call notification was
// delivered while this exact browser installation was in the foreground. The
// notification itself remains pending for every other installation belonging
// to the same account.
func (c *ChattoCore) SuppressNotificationCenterForClient(
	ctx context.Context,
	userID, notificationID, clientID string,
) (bool, error) {
	clientID, err := normalizePushClientID(clientID)
	if err != nil {
		return false, err
	}
	if clientID == "" {
		return false, nil
	}

	notification, err := c.GetNotification(ctx, userID, notificationID)
	if err != nil {
		return false, err
	}
	if notification == nil || notification.GetCallStarted() != nil {
		return false, nil
	}

	key := notificationCenterSuppressionKey(userID, notificationID, clientID)
	if _, err := c.storage.runtimeStateKV.Get(ctx, key); err == nil {
		return true, nil
	} else if !isRuntimeStateKeyAbsent(err) {
		return false, fmt.Errorf("failed to inspect notification-center suppression: %w", err)
	}

	ttl := notificationTTL
	if createdAt := notification.GetCreatedAt(); createdAt != nil && createdAt.IsValid() {
		ttl = time.Until(createdAt.AsTime().Add(notificationTTL))
		if ttl <= 0 {
			return false, nil
		}
	}
	if _, err := c.storage.runtimeStateKV.Create(ctx, key, []byte{1}, jetstream.KeyTTL(ttl)); err != nil {
		if errors.Is(err, jetstream.ErrKeyExists) {
			return true, nil
		}
		return false, fmt.Errorf("failed to store notification-center suppression: %w", err)
	}
	return true, nil
}

// GetNotificationsForClient returns the pending notification-center rows for
// one browser installation. An empty client ID retains the legacy global view.
func (c *ChattoCore) GetNotificationsForClient(
	ctx context.Context,
	userID, clientID string,
) ([]*corev1.Notification, error) {
	clientID, err := normalizePushClientID(clientID)
	if err != nil {
		return nil, err
	}
	notifications, err := c.GetNotifications(ctx, userID)
	if err != nil {
		return nil, err
	}
	if clientID == "" || len(notifications) == 0 {
		return notifications, nil
	}

	suppressed, err := c.notificationCenterSuppressedIDs(ctx, userID, clientID)
	if err != nil {
		return nil, err
	}
	filtered := make([]*corev1.Notification, 0, len(notifications))
	for _, notification := range notifications {
		if notification.GetCallStarted() == nil {
			if _, hidden := suppressed[notification.GetId()]; hidden {
				continue
			}
		}
		filtered = append(filtered, notification)
	}
	return filtered, nil
}

// GetNotificationForClient returns nil when a notification-center row is
// hidden for this browser installation. Call notifications are always visible.
func (c *ChattoCore) GetNotificationForClient(
	ctx context.Context,
	userID, notificationID, clientID string,
) (*corev1.Notification, error) {
	clientID, err := normalizePushClientID(clientID)
	if err != nil {
		return nil, err
	}
	notification, err := c.GetNotification(ctx, userID, notificationID)
	if err != nil || notification == nil || notification.GetCallStarted() != nil {
		return notification, err
	}
	if clientID == "" {
		return notification, nil
	}
	_, err = c.storage.runtimeStateKV.Get(ctx, notificationCenterSuppressionKey(userID, notificationID, clientID))
	if err == nil {
		return nil, nil
	}
	if isRuntimeStateKeyAbsent(err) {
		return notification, nil
	}
	return nil, fmt.Errorf("failed to read notification-center suppression: %w", err)
}

// HasUnreadNotificationsForClient reports whether this installation has any
// visible notification-center rows.
func (c *ChattoCore) HasUnreadNotificationsForClient(ctx context.Context, userID, clientID string) (bool, error) {
	notifications, err := c.GetNotificationsForClient(ctx, userID, clientID)
	if err != nil {
		return false, fmt.Errorf("failed to check notifications for client: %w", err)
	}
	return len(notifications) > 0, nil
}

func (c *ChattoCore) notificationCenterSuppressedIDs(ctx context.Context, userID, clientID string) (map[string]struct{}, error) {
	hash := notificationCenterClientHash(clientID)
	prefix := notificationCenterSuppressionUserPrefix(userID)
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, prefix+"*."+hash)
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return map[string]struct{}{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to list notification-center suppressions for client: %w", err)
	}

	result := make(map[string]struct{})
	suffix := "." + hash
	for key := range lister.Keys() {
		if !strings.HasPrefix(key, prefix) || !strings.HasSuffix(key, suffix) {
			continue
		}
		notificationID := strings.TrimSuffix(strings.TrimPrefix(key, prefix), suffix)
		if notificationID != "" {
			result[notificationID] = struct{}{}
		}
	}
	return result, nil
}

func (c *ChattoCore) deleteNotificationCenterSuppressions(ctx context.Context, userID, notificationID string) error {
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, notificationCenterSuppressionNotificationFilter(userID, notificationID))
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to list notification-center suppressions for deletion: %w", err)
	}
	keys := make([]string, 0)
	for key := range lister.Keys() {
		keys = append(keys, key)
	}
	for _, key := range keys {
		if err := c.storage.runtimeStateKV.Delete(ctx, key); err != nil && !isRuntimeStateKeyAbsent(err) {
			return fmt.Errorf("failed to delete notification-center suppression: %w", err)
		}
	}
	return nil
}

func notificationCenterSuppressionKey(userID, notificationID, clientID string) string {
	return notificationCenterSuppressionUserPrefix(userID) + notificationID + "." + notificationCenterClientHash(clientID)
}

func notificationCenterSuppressionNotificationFilter(userID, notificationID string) string {
	return notificationCenterSuppressionUserPrefix(userID) + notificationID + ".*"
}

func notificationCenterSuppressionUserPrefix(userID string) string {
	hash := sha256.Sum256([]byte(userID))
	return notificationCenterSuppressionKeyPrefix + hex.EncodeToString(hash[:]) + "."
}

func notificationCenterClientHash(clientID string) string {
	hash := sha256.Sum256([]byte(clientID))
	return hex.EncodeToString(hash[:])
}
