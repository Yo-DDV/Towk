package core

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// Presence status constants used by public API and storage mappings.
const (
	PresenceStatusOffline      = "OFFLINE"
	PresenceStatusOnline       = "ONLINE"
	PresenceStatusAway         = "AWAY"
	PresenceStatusDoNotDisturb = "DO_NOT_DISTURB"
)

// Presence configuration constants.
const (
	// PresenceTTL bounds stale Online state and legacy client presence.
	PresenceTTL = 60 * time.Second

	// PresenceRecentTTL is the server-side Away window retained after the last
	// active session stops refreshing. It absorbs PWA suspension, app switching,
	// screen locking, process eviction and short network outages without keeping
	// a user visible indefinitely.
	PresenceRecentTTL = 45 * time.Minute

	// PresenceRefreshInterval is how often active clients refresh their presence.
	// It must remain below PresenceTTL.
	PresenceRefreshInterval = 30 * time.Second
)

// presenceStatusFromString converts a stored presence status string to protobuf enum.
// Note: OFFLINE should never be stored - callers should delete the key instead.
func presenceStatusFromString(s string) corev1.UserPresenceStatus {
	switch s {
	case PresenceStatusAway:
		return corev1.UserPresenceStatus_USER_PRESENCE_STATUS_AWAY
	case PresenceStatusDoNotDisturb:
		return corev1.UserPresenceStatus_USER_PRESENCE_STATUS_DO_NOT_DISTURB
	default:
		return corev1.UserPresenceStatus_USER_PRESENCE_STATUS_ONLINE
	}
}

// presenceStatusToString converts a protobuf UserPresenceStatus enum to storage string.
func presenceStatusToString(status corev1.UserPresenceStatus) string {
	switch status {
	case corev1.UserPresenceStatus_USER_PRESENCE_STATUS_AWAY:
		return PresenceStatusAway
	case corev1.UserPresenceStatus_USER_PRESENCE_STATUS_DO_NOT_DISTURB:
		return PresenceStatusDoNotDisturb
	default:
		return PresenceStatusOnline
	}
}

// ============================================================================
// Key Helpers
// ============================================================================

const maxPresenceWriteRetries = 5

// presenceKey returns the MEMORY_CACHE key for a user's aggregated live presence state.
func presenceKey(userID string) string {
	return fmt.Sprintf("presence.%s", userID)
}

// parsePresenceKey extracts userID from a public aggregate key.
// Key format: presence.{userId}
func parsePresenceKey(key string) (userID string, ok bool) {
	const prefix = "presence."
	if len(key) <= len(prefix) || key[:len(prefix)] != prefix {
		return "", false
	}
	userID = key[len(prefix):]
	if userID == "" {
		return "", false
	}
	return userID, true
}

func validPresenceUserID(userID string) bool {
	return userID != "" && !strings.ContainsAny(userID, ".*>")
}

// ============================================================================
// Presence Operations
// ============================================================================

// GetUserPresence retrieves a user's current aggregated presence status.
// Returns OFFLINE if the user has no presence entry (never connected or TTL expired).
func (s *PresenceModel) GetUserPresence(ctx context.Context, userID string) (string, error) {
	presence, _, ok, err := s.getPresenceRecord(ctx, userID)
	if err != nil || !ok {
		return PresenceStatusOffline, err
	}
	return presenceStatusToString(presence.Status), nil
}

func (s *PresenceModel) getPresenceRecord(ctx context.Context, userID string) (*corev1.UserPresence, uint64, bool, error) {
	if !validPresenceUserID(userID) {
		return nil, 0, false, nil
	}
	entry, err := s.memoryCacheKV.Get(ctx, presenceKey(userID))
	if err != nil {
		if errors.Is(err, jetstream.ErrKeyNotFound) ||
			errors.Is(err, jetstream.ErrInvalidKey) ||
			errors.Is(err, jetstream.ErrKeyDeleted) {
			return nil, 0, false, nil
		}
		return nil, 0, false, fmt.Errorf("failed to get presence: %w", err)
	}
	if entry.Operation() == jetstream.KeyValueDelete || entry.Operation() == jetstream.KeyValuePurge {
		return nil, 0, false, nil
	}
	presence := &corev1.UserPresence{}
	if err := proto.Unmarshal(entry.Value(), presence); err != nil {
		s.logger.Warn("Failed to unmarshal presence, treating user as offline",
			"error", err, "user_id", userID)
		return nil, 0, false, nil
	}
	return presence, entry.Revision(), true, nil
}

// SetPresence writes/refreshes a legacy user's live presence in MEMORY_CACHE.
// Authorization: Caller must verify the user is authenticated before calling.
func (s *PresenceModel) SetPresence(ctx context.Context, userID string, status string) error {
	return s.SetPresenceWithOptions(ctx, userID, status, false)
}

// SetPresenceWithOptions writes/refreshes a legacy user's live presence.
// manuallySet marks explicit user-selected Away/DND so automatic reports from
// other legacy clients do not overwrite the user's chosen availability.
func (s *PresenceModel) SetPresenceWithOptions(ctx context.Context, userID string, status string, manuallySet bool) error {
	return s.setPresenceRecordWithTTL(ctx, userID, status, manuallySet, manuallySet, PresenceTTL)
}

func (s *PresenceModel) setPresenceRecordWithTTL(
	ctx context.Context,
	userID string,
	status string,
	manuallySet bool,
	forceOverwrite bool,
	ttl time.Duration,
) error {
	if !validPresenceUserID(userID) {
		return fmt.Errorf("invalid presence user id")
	}
	if ttl <= 0 {
		return fmt.Errorf("presence TTL must be positive")
	}
	presence := &corev1.UserPresence{
		Status:      presenceStatusFromString(status),
		ManuallySet: manuallySet && status != PresenceStatusOnline,
	}
	data, err := proto.Marshal(presence)
	if err != nil {
		return fmt.Errorf("failed to marshal presence: %w", err)
	}
	return s.writePresence(ctx, presenceKey(userID), data, forceOverwrite, ttl)
}

// refreshPresence reads the current legacy presence value and renews its TTL.
// It deliberately does not update the profile latest-activity value: transport
// liveness is not meaningful user activity.
func (s *PresenceModel) refreshPresence(ctx context.Context, userID string) error {
	key := presenceKey(userID)
	entry, err := s.memoryCacheKV.Get(ctx, key)
	if err != nil {
		if errors.Is(err, jetstream.ErrKeyNotFound) || errors.Is(err, jetstream.ErrKeyDeleted) {
			return s.SetPresence(ctx, userID, PresenceStatusOnline)
		}
		return fmt.Errorf("failed to read presence for refresh: %w", err)
	}

	_, err = s.putPresenceWithTTL(ctx, key, entry.Value(), entry.Revision(), PresenceTTL)
	if err != nil {
		if errors.Is(err, jetstream.ErrKeyExists) {
			return nil
		}
		return fmt.Errorf("failed to refresh presence: %w", err)
	}
	return nil
}

func (s *PresenceModel) writePresence(
	ctx context.Context,
	key string,
	data []byte,
	forceOverwrite bool,
	ttl time.Duration,
) error {
	for attempt := 0; attempt < maxPresenceWriteRetries; attempt++ {
		entry, err := s.memoryCacheKV.Get(ctx, key)
		if err != nil {
			if errors.Is(err, jetstream.ErrKeyNotFound) || errors.Is(err, jetstream.ErrKeyDeleted) {
				_, err = s.memoryCacheKV.Create(ctx, key, data, jetstream.KeyTTL(ttl))
				if errors.Is(err, jetstream.ErrKeyExists) {
					continue
				}
				return err
			}
			return fmt.Errorf("failed to read presence: %w", err)
		}

		if !forceOverwrite && shouldIgnoreAutomaticPresenceWrite(entry.Value(), data) {
			return nil
		}

		_, err = s.putPresenceWithTTL(ctx, key, data, entry.Revision(), ttl)
		if err == nil {
			return nil
		}
		if errors.Is(err, jetstream.ErrKeyExists) {
			continue
		}
		return err
	}

	return fmt.Errorf("presence update failed after %d retries", maxPresenceWriteRetries)
}

func shouldIgnoreAutomaticPresenceWrite(existingData, incomingData []byte) bool {
	var existing corev1.UserPresence
	if err := proto.Unmarshal(existingData, &existing); err != nil {
		return false
	}
	if !existing.ManuallySet {
		return false
	}
	var incoming corev1.UserPresence
	if err := proto.Unmarshal(incomingData, &incoming); err != nil {
		return false
	}
	return !incoming.ManuallySet
}

func (s *PresenceModel) putPresenceWithTTL(
	ctx context.Context,
	key string,
	data []byte,
	revision uint64,
	ttl time.Duration,
) (uint64, error) {
	ack, err := s.js.Publish(
		ctx,
		"$KV.MEMORY_CACHE."+key,
		data,
		jetstream.WithExpectLastSequencePerSubject(revision),
		jetstream.WithMsgTTL(ttl),
	)
	if err != nil {
		return 0, err
	}
	return ack.Sequence, nil
}

func (s *PresenceModel) deletePresence(ctx context.Context, userID string) error {
	if !validPresenceUserID(userID) {
		return nil
	}
	if err := s.deleteAllPresenceSessionLeases(ctx, userID); err != nil {
		return fmt.Errorf("failed to delete presence session leases: %w", err)
	}
	if err := s.memoryCacheKV.Delete(ctx, presenceKey(userID)); err != nil &&
		!errors.Is(err, jetstream.ErrKeyNotFound) &&
		!errors.Is(err, jetstream.ErrKeyDeleted) {
		return fmt.Errorf("failed to delete presence: %w", err)
	}
	return nil
}

// GetUserPresence retrieves a user's current presence status.
func (c *ChattoCore) GetUserPresence(ctx context.Context, userID string) (string, error) {
	return c.presenceModel.GetUserPresence(ctx, userID)
}

// SetPresence writes/refreshes legacy live presence.
func (c *ChattoCore) SetPresence(ctx context.Context, userID string, status string) error {
	return c.presenceModel.SetPresence(ctx, userID, status)
}

func (c *ChattoCore) SetPresenceWithOptions(ctx context.Context, userID string, status string, manuallySet bool) error {
	return c.presenceModel.SetPresenceWithOptions(ctx, userID, status, manuallySet)
}

func (c *ChattoCore) refreshPresence(ctx context.Context, userID string) error {
	return c.presenceModel.refreshPresence(ctx, userID)
}

// RecordMeaningfulPresenceActivity advances the privacy-aware latest-activity
// value for a foreground transition or direct user interaction. Heartbeat and
// lease refresh paths must not call it.
func (c *ChattoCore) RecordMeaningfulPresenceActivity(ctx context.Context, userID string) {
	c.touchUserLastActivityIfKnown(ctx, userID)
}

func (c *ChattoCore) touchUserLastActivityIfKnown(ctx context.Context, userID string) {
	if c.Users == nil {
		return
	}
	if _, err := c.GetUser(ctx, userID); err != nil {
		return
	}
	settings, err := c.GetUserSettings(ctx, userID)
	if err != nil {
		c.logger.Warn("Failed to read last activity visibility", "user_id", userID, "error", err)
		return
	}
	if !effectiveShowLastActivity(settings) {
		return
	}
	c.touchUserLastActivity(ctx, userID)
}
