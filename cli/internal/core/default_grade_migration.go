package core

import (
	"context"
	"errors"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// EnsureHelperSystemGrade provisions the Helper grade on upgraded instances.
// Existing roles named helper are preserved verbatim and become protected by
// the system-grade boundary. A pre-existing user handle collision is reported
// as a warning without preventing the server from starting; the owner can
// rename that account and restart to complete provisioning.
func (c *ChattoCore) EnsureHelperSystemGrade(ctx context.Context) error {
	if c.RBAC.RoleExists(RoleHelper) {
		return nil
	}
	if c.roleNameConflictsWithMentionHandle(RoleHelper) {
		c.logger.Warn("Helper grade not provisioned because its mention handle is already in use")
		return nil
	}

	var handleConflict bool
	event := newEvent(SystemActorID, &corev1.Event{})
	_, err := c.appendRBACEventWithMentionableCheck(ctx, event, func() error {
		if c.RBAC.RoleExists(RoleHelper) {
			return errRBACNoop
		}
		if err := c.requireRoleMentionHandleAvailable(RoleHelper); err != nil {
			handleConflict = true
			return err
		}
		event.Event = &corev1.Event_RbacRoleCreated{
			RbacRoleCreated: &corev1.RbacRoleCreatedEvent{
				RoleName:    RoleHelper,
				DisplayName: "Helper", // i18n-audit-ignore -- system role text is localized by stable role ID
				Description: "Community assistance without moderation or administration powers", // i18n-audit-ignore -- system role text is localized by stable role ID
				Rank:        PositionHelper,
				Pingable:    true,
				Color:       RoleColorHelper,
			},
		}
		return nil
	})
	if errors.Is(err, errRBACNoop) {
		return nil
	}
	if handleConflict {
		c.logger.Warn("Helper grade not provisioned because its mention handle became unavailable")
		return nil
	}
	if err != nil {
		return err
	}
	c.logger.Info("Provisioned Helper system grade")
	return nil
}
