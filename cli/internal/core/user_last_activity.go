package core

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"

	"hmans.de/chatto/internal/encryption"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const (
	UserLastActivityCoalesceInterval = 5 * time.Minute
	maxUserLastActivityWriteRetries  = 5
)

func userLastActivityKey(userID string) string {
	return fmt.Sprintf("profile_last_activity.%s", userID)
}

func userLastActivityAAD(userID string, epoch int32) []byte {
	return []byte(fmt.Sprintf("chatto:user-last-activity-context:v1\x00user_id=%s\x00content_key_epoch=%d", userID, epoch))
}

// GetUserLastActivity returns the single coalesced latest-value record. A zero
// time means the user has no recorded activity.
func (c *ChattoCore) GetUserLastActivity(ctx context.Context, userID string) (time.Time, error) {
	entry, err := c.storage.runtimeStateKV.Get(ctx, userLastActivityKey(userID))
	if err != nil {
		if isRuntimeStateKeyAbsent(err) {
			return time.Time{}, nil
		}
		return time.Time{}, fmt.Errorf("read user last activity: %w", err)
	}
	return c.decryptUserLastActivity(ctx, userID, entry.Value())
}

func (c *ChattoCore) decryptUserLastActivity(ctx context.Context, userID string, data []byte) (time.Time, error) {
	record := &corev1.EncryptedUserLastActivity{}
	if err := proto.Unmarshal(data, record); err != nil {
		return time.Time{}, fmt.Errorf("decode user last activity: %w", err)
	}
	epoch := record.GetContentKeyEpoch()
	if epoch <= 0 {
		return time.Time{}, fmt.Errorf("decode user last activity: content key epoch is missing")
	}
	keyEvent, ok := c.ContentKeys.Get(userID, corev1.UserDEKPurpose_USER_DEK_PURPOSE_USER_PII, epoch)
	if !ok {
		keyEvent, ok = c.ContentKeys.Get(userID, corev1.UserDEKPurpose_USER_DEK_PURPOSE_UNSPECIFIED, epoch)
	}
	if !ok {
		return time.Time{}, encryption.ErrKeyNotFound
	}
	dek, err := c.unwrapUserDEK(ctx, keyEvent, corev1.UserDEKPurpose_USER_DEK_PURPOSE_USER_PII)
	if err != nil {
		return time.Time{}, err
	}
	plaintext, err := encryption.DecryptXChaCha20Poly1305(
		dek.key,
		record.GetEncryptedValue(),
		record.GetNonce(),
		userLastActivityAAD(userID, epoch),
	)
	if err != nil {
		return time.Time{}, fmt.Errorf("decrypt user last activity: %w", err)
	}
	observedAt, err := time.Parse(time.RFC3339Nano, string(plaintext))
	if err != nil {
		return time.Time{}, fmt.Errorf("parse user last activity: %w", err)
	}
	return observedAt.UTC(), nil
}

// recordUserLastActivity updates the latest-value record monotonically and at
// most once per coalescing interval. It returns true only when storage changed.
func (c *ChattoCore) recordUserLastActivity(ctx context.Context, userID string, observedAt time.Time) (bool, error) {
	if userID == "" || observedAt.IsZero() {
		return false, fmt.Errorf("%w: user ID and observed time are required", ErrInvalidArgument)
	}
	observedAt = observedAt.UTC()
	key := userLastActivityKey(userID)

	for attempt := 0; attempt < maxUserLastActivityWriteRetries; attempt++ {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		missing := isRuntimeStateKeyAbsent(err)
		if err != nil && !missing {
			return false, fmt.Errorf("read user last activity for update: %w", err)
		}
		if !missing {
			current, err := c.decryptUserLastActivity(ctx, userID, entry.Value())
			if err != nil {
				return false, err
			}
			if !observedAt.After(current) || observedAt.Sub(current) < UserLastActivityCoalesceInterval {
				return false, nil
			}
		}

		dek, err := c.ensureActiveUserPIIDEK(ctx, userID)
		if err != nil {
			return false, fmt.Errorf("resolve user PII key for last activity: %w", err)
		}
		encrypted, err := encryption.EncryptXChaCha20Poly1305(
			dek.key,
			[]byte(observedAt.Format(time.RFC3339Nano)),
			userLastActivityAAD(userID, dek.epoch),
		)
		if err != nil {
			return false, fmt.Errorf("encrypt user last activity: %w", err)
		}
		data, err := proto.Marshal(&corev1.EncryptedUserLastActivity{
			EncryptedValue:  encrypted.Ciphertext,
			Nonce:           encrypted.Nonce,
			ContentKeyEpoch: dek.epoch,
		})
		if err != nil {
			return false, fmt.Errorf("encode user last activity: %w", err)
		}

		if missing {
			_, err = c.storage.runtimeStateKV.Create(ctx, key, data)
		} else {
			_, err = c.storage.runtimeStateKV.Update(ctx, key, data, entry.Revision())
		}
		if err == nil {
			c.publishUserProfileDetailsUpdate(ctx, userID)
			return true, nil
		}
		if isRuntimeStateRevisionConflict(err) || errors.Is(err, jetstream.ErrKeyExists) {
			continue
		}
		return false, fmt.Errorf("write user last activity: %w", err)
	}
	return false, fmt.Errorf("user last activity update failed after %d retries", maxUserLastActivityWriteRetries)
}

func (c *ChattoCore) touchUserLastActivity(ctx context.Context, userID string) {
	if _, err := c.recordUserLastActivity(ctx, userID, time.Now()); err != nil {
		c.logger.Warn("Failed to update user last activity", "user_id", userID, "error", err)
	}
}

func (c *ChattoCore) deleteUserLastActivity(ctx context.Context, userID string) error {
	err := c.storage.runtimeStateKV.Delete(ctx, userLastActivityKey(userID))
	if err == nil || isRuntimeStateKeyAbsent(err) {
		return nil
	}
	return fmt.Errorf("delete user last activity: %w", err)
}
