package core

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const MaxUserBiographyBytes = 16 * 1024

// GetUserBiography returns the current decrypted biography. An unset biography
// is represented by an empty string.
func (c *ChattoCore) GetUserBiography(ctx context.Context, userID string) (string, error) {
	if _, err := c.GetUser(ctx, userID); err != nil {
		return "", err
	}
	biography, _ := c.Users.Biography(userID)
	return biography, nil
}

// UpdateUserBiography stores or clears the authenticated user's Markdown
// biography under the existing user-PII envelope.
func (c *ChattoCore) UpdateUserBiography(ctx context.Context, userID, biography string) error {
	if _, err := c.GetUser(ctx, userID); err != nil {
		return fmt.Errorf("user not found: %w", err)
	}
	biography = normalizeUserBiography(biography)
	if !utf8.ValidString(biography) {
		return fmt.Errorf("%w: biography is not valid UTF-8", ErrInvalidArgument)
	}
	if len([]byte(biography)) > MaxUserBiographyBytes {
		return fmt.Errorf("%w: biography exceeds %d bytes", ErrInvalidArgument, MaxUserBiographyBytes)
	}
	if strings.IndexByte(biography, 0) >= 0 {
		return fmt.Errorf("%w: biography contains a null character", ErrInvalidArgument)
	}

	current, _ := c.Users.Biography(userID)
	if current == biography {
		return nil
	}

	var event *corev1.Event
	if biography == "" {
		event = newEvent(userID, &corev1.Event{Event: &corev1.Event_UserBiographyCleared{
			UserBiographyCleared: &corev1.UserBiographyClearedEvent{UserId: userID},
		}})
	} else {
		event = newEvent(userID, &corev1.Event{Event: &corev1.Event_UserBiographyChanged{
			UserBiographyChanged: &corev1.UserBiographyChangedEvent{UserId: userID},
		}})
		encrypted, err := c.encryptUserPIIString(
			ctx,
			event.GetId(),
			userID,
			events.EventUserBiographyChanged,
			"biography",
			biography,
		)
		if err != nil {
			return fmt.Errorf("encrypt biography: %w", err)
		}
		event.GetUserBiographyChanged().EncryptedBiography = encrypted
	}

	if _, err := c.appendUserEvent(ctx, userID, event, "", func() error {
		if _, err := c.GetUser(ctx, userID); err != nil {
			return fmt.Errorf("user not found: %w", err)
		}
		return nil
	}); err != nil {
		return fmt.Errorf("store biography: %w", err)
	}

	c.logger.Info("Updated user biography", "user_id", userID, "cleared", biography == "")
	c.publishUserProfileDetailsUpdate(ctx, userID)
	return nil
}

func normalizeUserBiography(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	return strings.ReplaceAll(value, "\r", "\n")
}

// IsModerationRole classifies a role for profile presentation. Position is not
// consulted because it is a display order, not an authorization rank.
func IsModerationRole(role RoleWithPermissions) bool {
	switch role.Name {
	case RoleOwner, RoleAdmin, RoleModerator:
		return true
	}
	for _, permission := range role.Permissions {
		for _, moderationPermission := range adminPermissions {
			if permission == moderationPermission {
				return true
			}
		}
		if permission == PermMessageManage {
			return true
		}
	}
	return false
}
