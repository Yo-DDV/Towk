package core

import (
	"context"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// ============================================================================
// Push Subscription Key Helpers
// ============================================================================

const (
	pushEndpointOwnerKeyPrefix  = "push_endpoint_owner."
	pushEndpointOwnerMaxRetries = 8
	defaultPushLocale           = "en"
)

type pushEndpointOwner struct {
	UserID               string `json:"user_id"`
	SubscriptionRevision uint64 `json:"subscription_revision"`
}

// pushSubscriptionKey returns the KV key for a push subscription.
// Format: push_subscription.{userId}.{hash}
// The hash is derived from the endpoint URL to allow multiple devices per user.
func pushSubscriptionKey(userID, endpoint string) string {
	hash := hashEndpoint(endpoint)
	return fmt.Sprintf("push_subscription.%s.%s", userID, hash)
}

// pushSubscriptionKeyFilter returns the NATS subject filter for all push subscriptions for a user.
func pushSubscriptionKeyFilter(userID string) string {
	return "push_subscription." + userID + ".*"
}

// pushEndpointOwnerKey returns the KV key that exclusively assigns a browser
// push endpoint to the account that most recently registered it.
func pushEndpointOwnerKey(endpoint string) string {
	h := sha256.Sum256([]byte(endpoint))
	return pushEndpointOwnerKeyPrefix + hex.EncodeToString(h[:])
}

// hashEndpoint returns a short hash of the endpoint URL for use in the key.
func hashEndpoint(endpoint string) string {
	h := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(h[:8]) // First 8 bytes = 16 hex chars
}

// ============================================================================
// Push Subscription CRUD Operations
// ============================================================================

// SavePushSubscription stores or updates a push subscription for a user.
// Authorization: Caller must verify userID matches authenticated user.
func (c *ChattoCore) SavePushSubscription(
	ctx context.Context,
	userID string,
	endpoint, p256dh, auth, userAgent string,
) (*corev1.PushSubscription, error) {
	return c.SavePushSubscriptionWithLocale(ctx, userID, endpoint, p256dh, auth, userAgent, defaultPushLocale)
}

// SavePushSubscriptionWithLocale stores or updates a browser subscription and
// its device-local Towk language. Existing callers remain English by default.
func (c *ChattoCore) SavePushSubscriptionWithLocale(
	ctx context.Context,
	userID string,
	endpoint, p256dh, auth, userAgent, locale string,
) (*corev1.PushSubscription, error) {
	return c.SavePushSubscriptionWithMetadata(ctx, userID, endpoint, p256dh, auth, userAgent, locale, "", "")
}

// SavePushSubscriptionWithMetadata stores or updates a browser subscription and
// replaces older endpoints for the same Towk browser installation. The client ID
// is intentionally scoped to Towk, not inferred from user-agent, so real devices
// and separate browsers for the same account keep independent subscriptions.
func (c *ChattoCore) SavePushSubscriptionWithMetadata(
	ctx context.Context,
	userID string,
	endpoint, p256dh, auth, userAgent, locale, clientID, applicationOrigin string,
) (*corev1.PushSubscription, error) {
	clientID, err := normalizePushClientID(clientID)
	if err != nil {
		return nil, err
	}
	applicationOrigin, err = normalizePushApplicationOrigin(applicationOrigin)
	if err != nil {
		return nil, err
	}
	if err := validatePushSubscription(endpoint, p256dh, auth, userAgent); err != nil {
		return nil, err
	}

	subscription := &corev1.PushSubscription{
		Endpoint:          endpoint,
		P256Dh:            p256dh,
		Auth:              auth,
		CreatedAt:         timestamppb.New(time.Now()),
		UserAgent:         userAgent,
		Locale:            normalizePushLocale(locale),
		ClientId:          clientID,
		ApplicationOrigin: applicationOrigin,
	}

	data, err := proto.Marshal(subscription)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal push subscription: %w", err)
	}

	key := pushSubscriptionKey(userID, endpoint)
	_, err = c.storage.runtimeStateKV.Put(ctx, key, data)
	if err != nil {
		return nil, fmt.Errorf("failed to store push subscription: %w", err)
	}
	if err := c.claimPushEndpointOwnership(ctx, userID, endpoint); err != nil {
		return nil, err
	}
	if err := c.deleteSupersededPushSubscriptions(ctx, userID, subscription); err != nil {
		c.logger.Warn("Failed to delete superseded push subscriptions",
			"user_id", userID,
			"endpoint_hash", hashEndpoint(endpoint),
			"error", err)
	}

	c.logger.Debug("Push subscription saved",
		"user_id", userID,
		"endpoint_hash", hashEndpoint(endpoint))

	return subscription, nil
}

func normalizePushClientID(clientID string) (string, error) {
	clientID = strings.TrimSpace(clientID)
	if err := validateStringMaxLength("push client ID", clientID, MaxPushClientIDLength); err != nil {
		return "", err
	}
	if clientID == "" {
		return "", nil
	}
	for _, r := range clientID {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_' || r == '.' || r == ':':
		default:
			return "", invalidArgument("push client ID contains unsupported characters")
		}
	}
	return clientID, nil
}

func normalizePushApplicationOrigin(applicationOrigin string) (string, error) {
	applicationOrigin = strings.TrimSpace(applicationOrigin)
	if err := validateStringMaxLength("push application origin", applicationOrigin, MaxPushApplicationOriginLength); err != nil {
		return "", err
	}
	if applicationOrigin == "" {
		return "", nil
	}
	parsedOrigin, err := url.Parse(applicationOrigin)
	if err != nil || (parsedOrigin.Scheme != "https" && parsedOrigin.Scheme != "http") || parsedOrigin.Host == "" || parsedOrigin.User != nil {
		return "", invalidArgument("push application origin must be an HTTP(S) origin without credentials")
	}
	if parsedOrigin.Path != "" || parsedOrigin.RawQuery != "" || parsedOrigin.Fragment != "" {
		return "", invalidArgument("push application origin must not contain a path, query, or fragment")
	}
	return parsedOrigin.Scheme + "://" + parsedOrigin.Host, nil
}

func (c *ChattoCore) deleteSupersededPushSubscriptions(ctx context.Context, userID string, current *corev1.PushSubscription) error {
	if current.GetClientId() == "" || current.GetCreatedAt() == nil {
		return nil
	}
	subscriptions, err := c.GetUserPushSubscriptions(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to list push subscriptions for deduplication: %w", err)
	}

	currentCreatedAt := current.GetCreatedAt().AsTime()
	for _, subscription := range subscriptions {
		if subscription.GetEndpoint() == current.GetEndpoint() || subscription.GetClientId() != current.GetClientId() || subscription.GetCreatedAt() == nil {
			continue
		}
		// Only the newest registration for a Towk browser installation should
		// remove older endpoints. This prevents two concurrent refreshes from
		// deleting each other if they race.
		if !subscription.GetCreatedAt().AsTime().Before(currentCreatedAt) {
			continue
		}
		if err := c.DeletePushSubscription(ctx, userID, subscription.GetEndpoint()); err != nil {
			return fmt.Errorf("failed to delete superseded push subscription: %w", err)
		}
	}
	return nil
}

func normalizePushLocale(locale string) string {
	switch strings.ToLower(strings.TrimSpace(locale)) {
	case "de", "fr", "es", "pt":
		return strings.ToLower(strings.TrimSpace(locale))
	default:
		return defaultPushLocale
	}
}

func (c *ChattoCore) claimPushEndpointOwnership(ctx context.Context, userID, endpoint string) error {
	ownerKey := pushEndpointOwnerKey(endpoint)
	subscriptionKey := pushSubscriptionKey(userID, endpoint)
	for range pushEndpointOwnerMaxRetries {
		subscriptionEntry, err := c.storage.runtimeStateKV.Get(ctx, subscriptionKey)
		if isRuntimeStateKeyAbsent(err) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("failed to get current push subscription: %w", err)
		}

		owner := pushEndpointOwner{UserID: userID, SubscriptionRevision: subscriptionEntry.Revision()}
		value, err := json.Marshal(owner)
		if err != nil {
			return fmt.Errorf("failed to marshal push endpoint owner: %w", err)
		}
		entry, err := c.storage.runtimeStateKV.Get(ctx, ownerKey)
		if isRuntimeStateKeyAbsent(err) {
			if _, err := c.storage.runtimeStateKV.Create(ctx, ownerKey, value); err == nil {
				if current, err := c.storage.runtimeStateKV.Get(ctx, subscriptionKey); err == nil && current.Revision() == owner.SubscriptionRevision {
					return nil
				}
				continue
			} else if errors.Is(err, jetstream.ErrKeyExists) {
				continue
			} else {
				return fmt.Errorf("failed to create push endpoint owner: %w", err)
			}
		}
		if err != nil {
			return fmt.Errorf("failed to get push endpoint owner: %w", err)
		}
		var current pushEndpointOwner
		if err := json.Unmarshal(entry.Value(), &current); err != nil {
			return fmt.Errorf("failed to unmarshal push endpoint owner: %w", err)
		}
		if current == owner {
			if latest, err := c.storage.runtimeStateKV.Get(ctx, subscriptionKey); err == nil && latest.Revision() == owner.SubscriptionRevision {
				return nil
			}
			continue
		}
		if _, err := c.storage.runtimeStateKV.Update(ctx, ownerKey, value, entry.Revision()); err == nil {
			if latest, err := c.storage.runtimeStateKV.Get(ctx, subscriptionKey); err == nil && latest.Revision() == owner.SubscriptionRevision {
				return nil
			}
			continue
		} else if errors.Is(err, jetstream.ErrKeyExists) {
			continue
		} else {
			return fmt.Errorf("failed to update push endpoint owner: %w", err)
		}
	}
	return fmt.Errorf("failed to claim push endpoint ownership after %d concurrent updates", pushEndpointOwnerMaxRetries)
}

// PushSubscriptionOwnedByUser reports whether the endpoint is currently claimed
// by userID.
func (c *ChattoCore) PushSubscriptionOwnedByUser(ctx context.Context, userID, endpoint string) (bool, error) {
	owner, err := c.getPushEndpointOwner(ctx, endpoint)
	if err != nil {
		return false, err
	}
	return owner != nil && owner.UserID == userID, nil
}

// PushSubscriptionCurrentForUser reports whether subscription is still the
// exact active record for userID. Callers should recheck this immediately before
// delivery because browsers can transfer or rotate a subscription while a push
// is being prepared.
func (c *ChattoCore) PushSubscriptionCurrentForUser(ctx context.Context, userID string, subscription *corev1.PushSubscription) (bool, error) {
	key := pushSubscriptionKey(userID, subscription.Endpoint)
	entry, err := c.storage.runtimeStateKV.Get(ctx, key)
	if isRuntimeStateKeyAbsent(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to get push subscription: %w", err)
	}

	var current corev1.PushSubscription
	if err := proto.Unmarshal(entry.Value(), &current); err != nil {
		return false, fmt.Errorf("failed to unmarshal push subscription: %w", err)
	}
	if !proto.Equal(&current, subscription) {
		return false, nil
	}
	return c.pushSubscriptionRevisionOwnedByUser(ctx, userID, subscription.Endpoint, entry.Revision())
}

// DismissNotificationFromPushSubscription dismisses a notification using only
// the browser PushSubscription proof available to a service worker. This keeps
// native notification-center closes synchronized even when no authenticated app
// window is open, without storing bearer tokens in the worker.
func (c *ChattoCore) DismissNotificationFromPushSubscription(ctx context.Context, endpoint, auth, notificationID string) (bool, error) {
	endpoint = strings.TrimSpace(endpoint)
	auth = strings.TrimSpace(auth)
	notificationID = strings.TrimSpace(notificationID)
	if err := validatePushDismissalCredential(endpoint, auth, notificationID); err != nil {
		return false, err
	}

	owner, err := c.getPushEndpointOwner(ctx, endpoint)
	if err != nil {
		return false, err
	}
	if owner == nil || owner.UserID == "" {
		return false, nil
	}

	key := pushSubscriptionKey(owner.UserID, endpoint)
	entry, err := c.storage.runtimeStateKV.Get(ctx, key)
	if isRuntimeStateKeyAbsent(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to get push subscription: %w", err)
	}
	if entry.Revision() != owner.SubscriptionRevision {
		return false, nil
	}

	var current corev1.PushSubscription
	if err := proto.Unmarshal(entry.Value(), &current); err != nil {
		return false, fmt.Errorf("failed to unmarshal push subscription: %w", err)
	}
	if current.GetEndpoint() != endpoint {
		return false, nil
	}
	if subtle.ConstantTimeCompare([]byte(current.GetAuth()), []byte(auth)) != 1 {
		return false, nil
	}

	if _, err := c.DismissNotification(ctx, owner.UserID, notificationID); err != nil {
		return false, err
	}
	return true, nil
}

func (c *ChattoCore) getPushEndpointOwner(ctx context.Context, endpoint string) (*pushEndpointOwner, error) {
	entry, err := c.storage.runtimeStateKV.Get(ctx, pushEndpointOwnerKey(endpoint))
	if isRuntimeStateKeyAbsent(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get push endpoint owner: %w", err)
	}
	var owner pushEndpointOwner
	if err := json.Unmarshal(entry.Value(), &owner); err != nil {
		return nil, fmt.Errorf("failed to unmarshal push endpoint owner: %w", err)
	}
	return &owner, nil
}

func (c *ChattoCore) pushSubscriptionRevisionOwnedByUser(ctx context.Context, userID, endpoint string, subscriptionRevision uint64) (bool, error) {
	owner, err := c.getPushEndpointOwner(ctx, endpoint)
	if err != nil {
		return false, err
	}
	return owner != nil && owner.UserID == userID && owner.SubscriptionRevision == subscriptionRevision, nil
}

func (c *ChattoCore) releasePushEndpointOwnership(ctx context.Context, userID, endpoint string, subscriptionRevision uint64) error {
	key := pushEndpointOwnerKey(endpoint)
	for range pushEndpointOwnerMaxRetries {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("failed to get push endpoint owner: %w", err)
		}
		var owner pushEndpointOwner
		if err := json.Unmarshal(entry.Value(), &owner); err != nil {
			return fmt.Errorf("failed to unmarshal push endpoint owner: %w", err)
		}
		if owner.UserID != userID || owner.SubscriptionRevision != subscriptionRevision {
			return nil
		}
		err = c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(entry.Revision()))
		if err == nil || isRuntimeStateKeyAbsent(err) {
			return nil
		}
		if errors.Is(err, jetstream.ErrKeyExists) {
			continue
		}
		return fmt.Errorf("failed to delete push endpoint owner: %w", err)
	}
	return fmt.Errorf("failed to release push endpoint ownership after %d concurrent updates", pushEndpointOwnerMaxRetries)
}

func validatePushSubscription(endpoint, p256dh, auth, userAgent string) error {
	if err := validateStringMaxLength("push endpoint", endpoint, MaxPushEndpointLength); err != nil {
		return err
	}
	if err := validateStringMaxLength("push p256dh key", p256dh, MaxPushKeyLength); err != nil {
		return err
	}
	if err := validateStringMaxLength("push auth secret", auth, MaxPushAuthLength); err != nil {
		return err
	}
	if err := validateStringMaxLength("push user agent", userAgent, MaxPushUserAgentLength); err != nil {
		return err
	}
	if endpoint == "" || p256dh == "" || auth == "" {
		return invalidArgument("push endpoint, p256dh key, and auth secret are required")
	}
	p256dhBytes, err := decodePushBase64URL(p256dh)
	if err != nil || len(p256dhBytes) != 65 {
		return invalidArgument("push p256dh key must be a base64url-encoded uncompressed P-256 public key")
	}
	if x, y := elliptic.Unmarshal(elliptic.P256(), p256dhBytes); x == nil || y == nil {
		return invalidArgument("push p256dh key must contain a valid P-256 public point")
	}
	authBytes, err := decodePushBase64URL(auth)
	if err != nil || len(authBytes) != 16 {
		return invalidArgument("push auth secret must be a base64url-encoded 16-byte value")
	}
	parsedEndpoint, err := url.Parse(endpoint)
	if err != nil || parsedEndpoint.Scheme != "https" || parsedEndpoint.Hostname() == "" || parsedEndpoint.User != nil {
		return invalidArgument("push endpoint must be an absolute HTTPS URL without user credentials")
	}
	if parsedEndpoint.Fragment != "" {
		return invalidArgument("push endpoint must not contain a URL fragment")
	}
	if address := net.ParseIP(parsedEndpoint.Hostname()); address != nil && !isPublicPushEndpointIP(address) {
		return invalidArgument("push endpoint must not target a local or private address")
	}
	return nil
}

func validatePushDismissalCredential(endpoint, auth, notificationID string) error {
	if err := validateStringMaxLength("push endpoint", endpoint, MaxPushEndpointLength); err != nil {
		return err
	}
	if err := validateStringMaxLength("push auth secret", auth, MaxPushAuthLength); err != nil {
		return err
	}
	if err := validateStringMaxLength("notification ID", notificationID, 128); err != nil {
		return err
	}
	if endpoint == "" || auth == "" || notificationID == "" {
		return invalidArgument("push endpoint, auth secret, and notification ID are required")
	}
	authBytes, err := decodePushBase64URL(auth)
	if err != nil || len(authBytes) != 16 {
		return invalidArgument("push auth secret must be a base64url-encoded 16-byte value")
	}
	parsedEndpoint, err := url.Parse(endpoint)
	if err != nil || parsedEndpoint.Scheme != "https" || parsedEndpoint.Hostname() == "" || parsedEndpoint.User != nil {
		return invalidArgument("push endpoint must be an absolute HTTPS URL without user credentials")
	}
	if parsedEndpoint.Fragment != "" {
		return invalidArgument("push endpoint must not contain a URL fragment")
	}
	if address := net.ParseIP(parsedEndpoint.Hostname()); address != nil && !isPublicPushEndpointIP(address) {
		return invalidArgument("push endpoint must not target a local or private address")
	}
	return nil
}

func decodePushBase64URL(value string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err == nil {
		return decoded, nil
	}
	return base64.URLEncoding.DecodeString(value)
}

func isPublicPushEndpointIP(address net.IP) bool {
	return address.IsGlobalUnicast() &&
		!address.IsPrivate() &&
		!address.IsLoopback() &&
		!address.IsLinkLocalUnicast() &&
		!address.IsUnspecified()
}

// DeletePushSubscription removes a push subscription by endpoint.
// Authorization: Caller must verify userID matches authenticated user.
func (c *ChattoCore) DeletePushSubscription(ctx context.Context, userID, endpoint string) error {
	key := pushSubscriptionKey(userID, endpoint)
	entry, err := c.storage.runtimeStateKV.Get(ctx, key)
	if err != nil && !isRuntimeStateKeyAbsent(err) {
		return fmt.Errorf("failed to get push subscription before deleting: %w", err)
	}

	if entry != nil {
		if err := c.releasePushEndpointOwnership(ctx, userID, endpoint, entry.Revision()); err != nil {
			return err
		}
	}

	if entry != nil {
		err = c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(entry.Revision()))
		if err != nil && !isRuntimeStateKeyAbsent(err) && !errors.Is(err, jetstream.ErrKeyExists) {
			return fmt.Errorf("failed to delete push subscription: %w", err)
		}
	}

	c.logger.Debug("Push subscription deleted",
		"user_id", userID,
		"endpoint_hash", hashEndpoint(endpoint))

	return nil
}

// GetUserPushSubscriptions returns all push subscriptions for a user.
// Authorization: Caller must verify userID matches authenticated user.
func (c *ChattoCore) GetUserPushSubscriptions(ctx context.Context, userID string) ([]*corev1.PushSubscription, error) {
	prefix := pushSubscriptionKeyFilter(userID)
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, prefix)
	if err != nil {
		if errors.Is(err, jetstream.ErrNoKeysFound) {
			return []*corev1.PushSubscription{}, nil
		}
		return nil, fmt.Errorf("failed to list push subscription keys: %w", err)
	}

	var subscriptions []*corev1.PushSubscription
	for key := range lister.Keys() {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if err != nil {
			c.logger.Warn("Failed to get push subscription", "key", key, "error", err)
			continue
		}

		var sub corev1.PushSubscription
		if err := proto.Unmarshal(entry.Value(), &sub); err != nil {
			c.logger.Warn("Failed to unmarshal push subscription", "key", key, "error", err)
			continue
		}
		owned, err := c.pushSubscriptionRevisionOwnedByUser(ctx, userID, sub.Endpoint, entry.Revision())
		if err != nil {
			return nil, err
		}
		if !owned {
			continue
		}
		subscriptions = append(subscriptions, &sub)
	}

	return subscriptions, nil
}

// DeleteAllUserPushSubscriptions removes all push subscriptions for a user.
// Used when a user account is deleted.
// Authorization: Internal use only - called from user deletion flow.
func (c *ChattoCore) DeleteAllUserPushSubscriptions(ctx context.Context, userID string) (int, error) {
	prefix := pushSubscriptionKeyFilter(userID)
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, prefix)
	if err != nil {
		if errors.Is(err, jetstream.ErrNoKeysFound) {
			return 0, nil
		}
		return 0, fmt.Errorf("failed to list push subscription keys: %w", err)
	}

	// Collect keys first to avoid modifying while iterating
	var keys []string
	for key := range lister.Keys() {
		keys = append(keys, key)
	}

	deleted := 0
	for _, key := range keys {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			continue
		}
		if err != nil {
			c.logger.Warn("Failed to get push subscription before deleting", "key", key, "error", err)
			continue
		}

		var sub corev1.PushSubscription
		if err := proto.Unmarshal(entry.Value(), &sub); err != nil {
			c.logger.Warn("Failed to unmarshal push subscription before deleting", "key", key, "error", err)
		} else if err := c.releasePushEndpointOwnership(ctx, userID, sub.Endpoint, entry.Revision()); err != nil {
			c.logger.Warn("Failed to release push endpoint owner", "key", key, "error", err)
		}

		err = c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(entry.Revision()))
		if err != nil {
			if !isRuntimeStateKeyAbsent(err) && !errors.Is(err, jetstream.ErrKeyExists) {
				c.logger.Warn("Failed to delete push subscription", "key", key, "error", err)
			}
			continue
		}
		deleted++
	}

	c.logger.Debug("Deleted all push subscriptions for user",
		"user_id", userID,
		"count", deleted)

	return deleted, nil
}

// GetAllPushSubscriptions returns all push subscriptions in the system.
// Authorization: Internal use only.
//
// NOTE: Currently unused. Reserved for future admin dashboard feature to list
// all push subscriptions for monitoring/debugging purposes.
func (c *ChattoCore) GetAllPushSubscriptions(ctx context.Context) ([]*PushSubscriptionWithUser, error) {
	prefix := "push_subscription.>"
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, prefix)
	if err != nil {
		if errors.Is(err, jetstream.ErrNoKeysFound) {
			return []*PushSubscriptionWithUser{}, nil
		}
		return nil, fmt.Errorf("failed to list push subscription keys: %w", err)
	}

	var subscriptions []*PushSubscriptionWithUser
	for key := range lister.Keys() {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if err != nil {
			c.logger.Warn("Failed to get push subscription", "key", key, "error", err)
			continue
		}

		var sub corev1.PushSubscription
		if err := proto.Unmarshal(entry.Value(), &sub); err != nil {
			c.logger.Warn("Failed to unmarshal push subscription", "key", key, "error", err)
			continue
		}

		// Extract userID from key: push_subscription.{userId}.{hash}
		userID := extractUserIDFromPushKey(key)
		if userID == "" {
			continue
		}
		owned, err := c.pushSubscriptionRevisionOwnedByUser(ctx, userID, sub.Endpoint, entry.Revision())
		if err != nil {
			return nil, err
		}
		if !owned {
			continue
		}

		subscriptions = append(subscriptions, &PushSubscriptionWithUser{
			UserID:       userID,
			Subscription: &sub,
		})
	}

	return subscriptions, nil
}

// PushSubscriptionWithUser pairs a subscription with its owner's user ID.
type PushSubscriptionWithUser struct {
	UserID       string
	Subscription *corev1.PushSubscription
}

// extractUserIDFromPushKey extracts the user ID from a push subscription key.
// Key format: push_subscription.{userId}.{hash}
func extractUserIDFromPushKey(key string) string {
	parts := strings.Split(key, ".")
	if len(parts) != 3 || parts[0] != "push_subscription" {
		return ""
	}
	return parts[1]
}
