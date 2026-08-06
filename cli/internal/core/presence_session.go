package core

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

const (
	presenceActiveSessionPrefix        = "presence-active"
	presenceRecentSessionPrefix        = "presence-recent"
	presenceSessionLockPrefix          = "presence-session-lock"
	maxPresenceSessionIDLength         = 96
	maxPresenceSessionsPerInstallation = 8
	maxPresenceSessionsPerUser         = 32
	presenceSessionLockTTL             = 2 * time.Second
	presenceSessionLockRetryInterval   = 25 * time.Millisecond
	presenceSessionLockMaxAttempts     = 40
)

var (
	presenceSessionLeaseValue = []byte{1}
	presenceSessionLockValue  = []byte{1}

	// ErrPresenceSessionLimit is returned when an authenticated account tries
	// to create more concurrent page leases than the bounded presence model
	// permits. Existing sessions can continue refreshing normally.
	ErrPresenceSessionLimit = errors.New("presence session limit reached")
	// ErrPresenceSessionBusy indicates short-lived contention on the distributed
	// per-user creation lock. Callers may retry without changing the request.
	ErrPresenceSessionBusy = errors.New("presence session registry is busy")
)

// PresenceSessionReport describes one authenticated browser page or installed
// PWA session. InstallationID is stable for the browser installation while
// SessionID is unique to the current page lifetime.
type PresenceSessionReport struct {
	InstallationID     string
	SessionID          string
	Status             string
	Active             bool
	UserSelected       bool
	MeaningfulActivity bool
}

func validPresenceSessionID(value string) bool {
	if value == "" || len(value) > maxPresenceSessionIDLength {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') ||
			(r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') ||
			r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func presenceSessionKey(prefix, userID, installationID, sessionID string) string {
	return strings.Join([]string{prefix, userID, installationID, sessionID}, ".")
}

func presenceSessionFilter(prefix, userID string) string {
	return strings.Join([]string{prefix, userID, ">"}, ".")
}

func presenceInstallationFilter(prefix, userID, installationID string) string {
	return strings.Join([]string{prefix, userID, installationID, ">"}, ".")
}

func parsePresenceSessionKey(key string) (prefix, userID, installationID, sessionID string, ok bool) {
	parts := strings.Split(key, ".")
	if len(parts) != 4 {
		return "", "", "", "", false
	}
	if parts[0] != presenceActiveSessionPrefix && parts[0] != presenceRecentSessionPrefix {
		return "", "", "", "", false
	}
	if !validPresenceUserID(parts[1]) ||
		!validPresenceSessionID(parts[2]) ||
		!validPresenceSessionID(parts[3]) {
		return "", "", "", "", false
	}
	return parts[0], parts[1], parts[2], parts[3], true
}

func validPresenceReportStatus(status string) bool {
	switch status {
	case PresenceStatusOnline, PresenceStatusAway, PresenceStatusDoNotDisturb, PresenceStatusOffline:
		return true
	default:
		return false
	}
}

// ReportPresenceSession records liveness for one authenticated page and then
// projects all of the user's sessions into one public presence value.
func (c *ChattoCore) ReportPresenceSession(
	ctx context.Context,
	userID string,
	report PresenceSessionReport,
) (string, error) {
	if !validPresenceUserID(userID) {
		return PresenceStatusOffline, fmt.Errorf("invalid presence user id")
	}
	if !validPresenceSessionID(report.InstallationID) || !validPresenceSessionID(report.SessionID) {
		return PresenceStatusOffline, fmt.Errorf("invalid presence session id")
	}
	if !validPresenceReportStatus(report.Status) {
		return PresenceStatusOffline, fmt.Errorf("invalid presence status")
	}

	if report.Status == PresenceStatusOffline {
		if err := c.presenceModel.releasePresenceInstallation(ctx, userID, report.InstallationID); err != nil {
			return PresenceStatusOffline, err
		}
		return c.presenceModel.reconcilePresenceSessions(ctx, userID, false)
	}

	if err := c.presenceModel.putBoundedPresenceRecentLease(
		ctx,
		userID,
		report.InstallationID,
		report.SessionID,
	); err != nil {
		return PresenceStatusOffline, err
	}

	activeKey := presenceSessionKey(
		presenceActiveSessionPrefix,
		userID,
		report.InstallationID,
		report.SessionID,
	)
	if report.Active {
		if err := c.presenceModel.putPresenceSessionLease(ctx, activeKey, PresenceTTL); err != nil {
			return PresenceStatusOffline, err
		}
	} else if err := c.presenceModel.deletePresenceSessionLease(ctx, activeKey); err != nil {
		return PresenceStatusOffline, err
	}

	var (
		status string
		err    error
	)
	if report.UserSelected && report.Status != PresenceStatusOnline {
		err = c.presenceModel.setPresenceRecordWithTTL(
			ctx,
			userID,
			report.Status,
			true,
			true,
			PresenceRecentTTL,
		)
		status = report.Status
	} else {
		// Explicit Online clears a previous user-selected Away/DND before the
		// session aggregate is calculated. Automatic reports preserve it.
		status, err = c.presenceModel.reconcilePresenceSessions(
			ctx,
			userID,
			report.UserSelected && report.Status == PresenceStatusOnline,
		)
	}
	if err != nil {
		return PresenceStatusOffline, err
	}

	if report.MeaningfulActivity {
		c.RecordMeaningfulPresenceActivity(ctx, userID)
	}
	return status, nil
}

// ReleasePresenceInstallation removes all page leases associated with one
// browser installation. Other devices and browser profiles remain authoritative.
func (c *ChattoCore) ReleasePresenceInstallation(
	ctx context.Context,
	userID string,
	installationID string,
) (string, error) {
	if !validPresenceUserID(userID) || !validPresenceSessionID(installationID) {
		return PresenceStatusOffline, fmt.Errorf("invalid presence installation")
	}
	if err := c.presenceModel.releasePresenceInstallation(ctx, userID, installationID); err != nil {
		return PresenceStatusOffline, err
	}
	return c.presenceModel.reconcilePresenceSessions(ctx, userID, false)
}

func presenceSessionLockKey(userID string) string {
	return strings.Join([]string{presenceSessionLockPrefix, userID}, ".")
}

func (s *PresenceModel) putBoundedPresenceRecentLease(
	ctx context.Context,
	userID string,
	installationID string,
	sessionID string,
) error {
	key := presenceSessionKey(presenceRecentSessionPrefix, userID, installationID, sessionID)
	if _, err := s.memoryCacheKV.Get(ctx, key); err == nil {
		return s.putPresenceSessionLease(ctx, key, PresenceRecentTTL)
	} else if !errors.Is(err, jetstream.ErrKeyNotFound) && !errors.Is(err, jetstream.ErrKeyDeleted) {
		return fmt.Errorf("failed to inspect presence session lease: %w", err)
	}

	release, err := s.acquirePresenceSessionCreationLock(ctx, userID)
	if err != nil {
		return err
	}
	defer release()

	// Another replica may have created the same page lease while this caller
	// waited for the distributed lock.
	if _, err := s.memoryCacheKV.Get(ctx, key); err == nil {
		return s.putPresenceSessionLease(ctx, key, PresenceRecentTTL)
	} else if !errors.Is(err, jetstream.ErrKeyNotFound) && !errors.Is(err, jetstream.ErrKeyDeleted) {
		return fmt.Errorf("failed to recheck presence session lease: %w", err)
	}

	userKeys, err := s.listPresenceSessionKeys(ctx, presenceSessionFilter(presenceRecentSessionPrefix, userID))
	if err != nil {
		return err
	}
	if len(userKeys) >= maxPresenceSessionsPerUser {
		return fmt.Errorf("%w: at most %d concurrent sessions per user", ErrPresenceSessionLimit, maxPresenceSessionsPerUser)
	}
	installationKeys, err := s.listPresenceSessionKeys(
		ctx,
		presenceInstallationFilter(presenceRecentSessionPrefix, userID, installationID),
	)
	if err != nil {
		return err
	}
	if len(installationKeys) >= maxPresenceSessionsPerInstallation {
		return fmt.Errorf(
			"%w: at most %d concurrent sessions per installation",
			ErrPresenceSessionLimit,
			maxPresenceSessionsPerInstallation,
		)
	}
	return s.putPresenceSessionLease(ctx, key, PresenceRecentTTL)
}

func (s *PresenceModel) acquirePresenceSessionCreationLock(
	ctx context.Context,
	userID string,
) (func(), error) {
	key := presenceSessionLockKey(userID)
	for attempt := 0; attempt < presenceSessionLockMaxAttempts; attempt++ {
		revision, err := s.memoryCacheKV.Create(
			ctx,
			key,
			presenceSessionLockValue,
			jetstream.KeyTTL(presenceSessionLockTTL),
		)
		if err == nil {
			return func() {
				releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
				defer cancel()
				if err := s.memoryCacheKV.Delete(releaseCtx, key, jetstream.LastRevision(revision)); err != nil &&
					!errors.Is(err, jetstream.ErrKeyNotFound) &&
					!errors.Is(err, jetstream.ErrKeyDeleted) &&
					!errors.Is(err, jetstream.ErrKeyExists) {
					s.logger.Warn("Failed to release presence session creation lock", "user_id", userID, "error", err)
				}
			}, nil
		}
		if !errors.Is(err, jetstream.ErrKeyExists) {
			return nil, fmt.Errorf("failed to acquire presence session creation lock: %w", err)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(presenceSessionLockRetryInterval):
		}
	}
	return nil, fmt.Errorf("%w after %s", ErrPresenceSessionBusy, presenceSessionLockRetryInterval*time.Duration(presenceSessionLockMaxAttempts))
}

func (s *PresenceModel) putPresenceSessionLease(ctx context.Context, key string, ttl time.Duration) error {
	if _, _, _, _, ok := parsePresenceSessionKey(key); !ok {
		return fmt.Errorf("invalid presence session key")
	}
	if ttl <= 0 {
		return fmt.Errorf("presence session TTL must be positive")
	}
	_, err := s.js.Publish(
		ctx,
		"$KV.MEMORY_CACHE."+key,
		presenceSessionLeaseValue,
		jetstream.WithMsgTTL(ttl),
	)
	if err != nil {
		return fmt.Errorf("failed to write presence session lease: %w", err)
	}
	return nil
}

func (s *PresenceModel) deletePresenceSessionLease(ctx context.Context, key string) error {
	if _, _, _, _, ok := parsePresenceSessionKey(key); !ok {
		return fmt.Errorf("invalid presence session key")
	}
	if err := s.memoryCacheKV.Delete(ctx, key); err != nil &&
		!errors.Is(err, jetstream.ErrKeyNotFound) &&
		!errors.Is(err, jetstream.ErrKeyDeleted) {
		return fmt.Errorf("failed to delete presence session lease: %w", err)
	}
	return nil
}

func (s *PresenceModel) listPresenceSessionKeys(ctx context.Context, filter string) ([]string, error) {
	lister, err := s.memoryCacheKV.ListKeysFiltered(ctx, filter)
	if err != nil {
		if errors.Is(err, jetstream.ErrNoKeysFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to list presence session leases: %w", err)
	}
	defer lister.Stop()

	seen := make(map[string]struct{})
	keys := make([]string, 0, 4)
	for key := range lister.Keys() {
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys, nil
}

func (s *PresenceModel) hasPresenceSessionLease(ctx context.Context, prefix, userID string) (bool, error) {
	keys, err := s.listPresenceSessionKeys(ctx, presenceSessionFilter(prefix, userID))
	if err != nil {
		return false, err
	}
	return len(keys) > 0, nil
}

func (s *PresenceModel) deleteAllPresenceSessionLeases(ctx context.Context, userID string) error {
	for _, prefix := range []string{presenceActiveSessionPrefix, presenceRecentSessionPrefix} {
		keys, err := s.listPresenceSessionKeys(ctx, presenceSessionFilter(prefix, userID))
		if err != nil {
			return err
		}
		for _, key := range keys {
			if err := s.deletePresenceSessionLease(ctx, key); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *PresenceModel) releasePresenceInstallation(
	ctx context.Context,
	userID string,
	installationID string,
) error {
	for _, prefix := range []string{presenceActiveSessionPrefix, presenceRecentSessionPrefix} {
		keys, err := s.listPresenceSessionKeys(
			ctx,
			presenceInstallationFilter(prefix, userID, installationID),
		)
		if err != nil {
			return err
		}
		for _, key := range keys {
			if err := s.deletePresenceSessionLease(ctx, key); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *PresenceModel) reconcilePresenceSessions(
	ctx context.Context,
	userID string,
	clearManual bool,
) (string, error) {
	hasActive, err := s.hasPresenceSessionLease(ctx, presenceActiveSessionPrefix, userID)
	if err != nil {
		return PresenceStatusOffline, err
	}
	hasRecent, err := s.hasPresenceSessionLease(ctx, presenceRecentSessionPrefix, userID)
	if err != nil {
		return PresenceStatusOffline, err
	}

	current, _, hasCurrent, err := s.getPresenceRecord(ctx, userID)
	if err != nil {
		return PresenceStatusOffline, err
	}
	if hasCurrent && current.ManuallySet && !clearManual {
		if !hasRecent {
			if err := s.deletePresence(ctx, userID); err != nil {
				return PresenceStatusOffline, err
			}
			return PresenceStatusOffline, nil
		}
		status := presenceStatusToString(current.Status)
		if err := s.setPresenceRecordWithTTL(ctx, userID, status, true, true, PresenceRecentTTL); err != nil {
			return PresenceStatusOffline, err
		}
		return status, nil
	}

	switch {
	case hasActive:
		if err := s.setPresenceRecordWithTTL(
			ctx,
			userID,
			PresenceStatusOnline,
			false,
			true,
			PresenceTTL,
		); err != nil {
			return PresenceStatusOffline, err
		}
		return PresenceStatusOnline, nil
	case hasRecent:
		if err := s.setPresenceRecordWithTTL(
			ctx,
			userID,
			PresenceStatusAway,
			false,
			true,
			PresenceRecentTTL,
		); err != nil {
			return PresenceStatusOffline, err
		}
		return PresenceStatusAway, nil
	default:
		if err := s.deletePresence(ctx, userID); err != nil {
			return PresenceStatusOffline, err
		}
		return PresenceStatusOffline, nil
	}
}
