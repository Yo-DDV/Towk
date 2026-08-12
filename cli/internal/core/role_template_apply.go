package core

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// RoleTemplateStateToken serializes the complete explicit server-scope policy
// observed by clients. It includes permission identifiers unknown to this
// version so a mixed-version client cannot overwrite a future write.
func RoleTemplateStateToken(role *RoleWithPermissions) string {
	if role == nil {
		return ""
	}
	allows := make([]string, len(role.Permissions))
	for i, permission := range role.Permissions {
		allows[i] = string(permission)
	}
	denies := make([]string, len(role.PermissionDenials))
	for i, permission := range role.PermissionDenials {
		denies[i] = string(permission)
	}
	sort.Strings(allows)
	sort.Strings(denies)
	return "allow=" + strings.Join(allows, ",") + ";deny=" + strings.Join(denies, ",")
}

func validateRoleTemplateTarget(roleName string, template GradeTemplate) error {
	if roleName == "" {
		return fmt.Errorf("%w: role name is required", ErrInvalidArgument)
	}
	switch roleName {
	case RoleOwner:
		return fmt.Errorf("%w: owner permissions are virtual and cannot use templates", ErrInvalidArgument)
	case RoleEveryone, RoleAdmin, RoleModerator, RoleHelper:
		if roleName != template.RoleName {
			return fmt.Errorf("%w: template %s does not apply to system grade %s", ErrInvalidArgument, template.ID, roleName)
		}
	default:
		if template.ID != GradeTemplateHelperV1 && template.ID != GradeTemplateModeratorV1 {
			return fmt.Errorf("%w: template %s cannot be applied to a custom role", ErrInvalidArgument, template.ID)
		}
	}
	return nil
}

// AdminApplyServerRoleTemplate atomically replaces one role's explicit,
// server-scope decisions for permissions known to this server version.
// Group and room decisions, assignments, and unknown permission identifiers
// are preserved. expectedState binds the write to the preview the owner saw.
func (c *ChattoCore) AdminApplyServerRoleTemplate(
	ctx context.Context,
	actorID string,
	roleName string,
	templateID string,
	expectedState string,
) (*RoleWithPermissions, error) {
	if err := c.requireCanManageAdminRoles(ctx, actorID); err != nil {
		return nil, err
	}
	template, ok := GradeTemplateByID(templateID)
	if !ok {
		return nil, fmt.Errorf("%w: unknown role template %q", ErrInvalidArgument, templateID)
	}
	if err := validateRoleTemplateTarget(roleName, template); err != nil {
		return nil, err
	}
	if expectedState == "" {
		return nil, fmt.Errorf("%w: expected role template state is required", ErrInvalidArgument)
	}
	current, err := c.GetServerRole(ctx, roleName)
	if err != nil {
		return nil, err
	}
	if RoleTemplateStateToken(current) != expectedState {
		return nil, fmt.Errorf("role template preview is stale: %w", events.ErrConflict)
	}

	desiredAllows := make(map[Permission]struct{}, len(template.Permissions))
	for _, permission := range template.Permissions {
		if err := validatePermissionScope(permission, ScopeServer); err != nil {
			return nil, fmt.Errorf("template %s permission %s: %w", template.ID, permission, err)
		}
		desiredAllows[permission] = struct{}{}
	}

	entries := make([]events.BatchEntry, 0, len(PermissionsForScope(ScopeServer)))
	for _, metadata := range PermissionsForScope(ScopeServer) {
		permission := metadata.Permission
		currentDecision := c.RBAC.GetDecision(ScopeServer, "", roleName, permission)
		_, shouldAllow := desiredAllows[permission]
		if shouldAllow && currentDecision == DecisionAllow {
			continue
		}
		if !shouldAllow && currentDecision == DecisionNone {
			continue
		}

		var event *corev1.Event
		if shouldAllow {
			event = newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionGranted{
				RbacPermissionGranted: rbacRolePermissionGrantedEvent(ScopeServer, "", roleName, permission),
			}})
		} else {
			event = newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionCleared{
				RbacPermissionCleared: rbacRolePermissionClearedEvent(ScopeServer, "", roleName, permission),
			}})
		}
		entries = append(entries, events.BatchEntry{Subject: rbacSubjectForEvent(event), Event: event})
	}

	if len(entries) == 0 {
		return current, nil
	}
	if _, err := c.appendRBACBatch(ctx, entries, func() error {
		if err := c.requireCanManageAdminRoles(ctx, actorID); err != nil {
			return err
		}
		if err := c.requirePermissionRole(roleName); err != nil {
			return err
		}
		latest, err := c.GetServerRole(ctx, roleName)
		if err != nil {
			return err
		}
		if RoleTemplateStateToken(latest) != expectedState {
			return fmt.Errorf("role template preview is stale: %w", events.ErrConflict)
		}
		return validateRoleTemplateTarget(roleName, template)
	}); err != nil {
		return nil, err
	}

	return c.GetServerRole(ctx, roleName)
}
