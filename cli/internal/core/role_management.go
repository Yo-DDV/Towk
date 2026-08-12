package core

import (
	"context"
	"fmt"

	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

type RoleUserSummary struct {
	ID           string
	Login        string
	DisplayName  string
	Deleted      bool
	CustomStatus *corev1.CustomUserStatus
}

type RoleCatalog struct {
	Roles                []RoleWithPermissions
	ViewerCanManageRoles bool
	ViewerCanAssignRoles bool
}

type RoleDetails struct {
	Role                 *RoleWithPermissions
	Users                []RoleUserSummary
	ViewerCanManageRoles bool
	ViewerCanAssignRoles bool
}

type AdminRoleInput struct {
	Name        string
	DisplayName string
	Description string
	Pingable    *bool
	Color       *string
}

type AdminRoleUpdateInput struct {
	Name        string
	DisplayName *string
	Description *string
	Pingable    *bool
	Color       *string
}

func markDefaultSystemGrades(roles []RoleWithPermissions) {
	for i := range roles {
		roles[i].IsSystem = IsDefaultSystemGrade(roles[i].Name)
	}
}

func (c *ChattoCore) ListServerRolesForUser(ctx context.Context, actorID string) (*RoleCatalog, error) {
	if actorID == "" {
		return nil, ErrNotAuthenticated
	}
	roles, err := c.ListServerRoles(ctx)
	if err != nil {
		return nil, err
	}
	markDefaultSystemGrades(roles)
	canManage, err := c.CanManageRoles(ctx, actorID)
	if err != nil {
		return nil, err
	}
	canAssign, err := c.CanAssignRoles(ctx, actorID)
	if err != nil {
		return nil, err
	}
	return &RoleCatalog{
		Roles:                roles,
		ViewerCanManageRoles: canManage,
		ViewerCanAssignRoles: canAssign,
	}, nil
}

func (c *ChattoCore) GetServerRoleDetails(ctx context.Context, actorID, roleName string) (*RoleDetails, error) {
	if actorID == "" {
		return nil, ErrNotAuthenticated
	}
	if roleName == "" {
		return nil, fmt.Errorf("%w: role name is required", ErrInvalidArgument)
	}
	role, err := c.GetServerRole(ctx, roleName)
	if err != nil {
		return nil, err
	}
	role.IsSystem = IsDefaultSystemGrade(role.Name)
	canManage, err := c.CanManageRoles(ctx, actorID)
	if err != nil {
		return nil, err
	}
	canAssign, err := c.CanAssignRoles(ctx, actorID)
	if err != nil {
		return nil, err
	}
	details := &RoleDetails{
		Role:                 role,
		ViewerCanManageRoles: canManage,
		ViewerCanAssignRoles: canAssign,
	}
	if canAssign {
		users, err := c.serverRoleUsers(ctx, roleName)
		if err != nil {
			return nil, err
		}
		details.Users = users
	}
	return details, nil
}

func (c *ChattoCore) AdminCreateServerRole(ctx context.Context, actorID string, input AdminRoleInput) (*RoleWithPermissions, error) {
	if err := c.requireCanManageAdminRoles(ctx, actorID); err != nil {
		return nil, err
	}
	pingable := false
	if input.Pingable != nil {
		pingable = *input.Pingable
	}
	return c.createServerRole(ctx, actorID, input.Name, input.DisplayName, input.Description, pingable, input.Color)
}

// AdminCreateServerRoleFromTemplate creates a custom role and its versioned
// server-scope baseline in one OCC-protected RBAC batch. No observer can see a
// role without its baseline, and a mention-handle collision aborts the complete
// command before any durable event is appended.
func (c *ChattoCore) AdminCreateServerRoleFromTemplate(ctx context.Context, actorID string, input AdminRoleInput, templateID string) (*RoleWithPermissions, error) {
	if err := c.requireCanManageAdminRoles(ctx, actorID); err != nil {
		return nil, err
	}
	template, ok := GradeTemplateByID(templateID)
	if !ok || (template.ID != GradeTemplateHelperV1 && template.ID != GradeTemplateModeratorV1) {
		return nil, fmt.Errorf("%w: unsupported role template %q", ErrInvalidArgument, templateID)
	}
	if err := ValidateRoleName(input.Name); err != nil {
		return nil, ErrInvalidRoleName
	}
	if IsSystemRole(input.Name) {
		return nil, ErrRoleAlreadyExists
	}
	if err := validateRoleMetadata(input.DisplayName, input.Description); err != nil {
		return nil, err
	}

	pingable := template.Pingable
	if input.Pingable != nil {
		pingable = *input.Pingable
	}
	color := template.Color
	if input.Color != nil {
		var err error
		color, err = normalizeRoleColor(*input.Color)
		if err != nil {
			return nil, err
		}
	}

	if _, err := c.appendRBACBatchWithMentionableCheck(ctx, func() ([]events.BatchEntry, error) {
		if err := c.requireCanManageAdminRoles(ctx, actorID); err != nil {
			return nil, err
		}
		if c.RBAC.RoleExists(input.Name) || c.roleNameConflictsWithMentionHandle(input.Name) {
			return nil, ErrRoleAlreadyExists
		}
		if err := c.requireRoleMentionHandleAvailable(input.Name); err != nil {
			return nil, err
		}
		position := c.RBAC.NextAvailablePosition()
		resolvedColor := color
		if resolvedColor == "" {
			resolvedColor = defaultRoleColor(input.Name, position)
		}
		roleEvent := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacRoleCreated{
			RbacRoleCreated: &corev1.RbacRoleCreatedEvent{
				RoleName: input.Name, DisplayName: input.DisplayName, Description: input.Description,
				Rank: position, Pingable: pingable, Color: resolvedColor,
			},
		}})
		entries := []events.BatchEntry{{Subject: rbacSubjectForEvent(roleEvent), Event: roleEvent}}
		for _, permission := range template.Permissions {
			if err := validatePermissionScope(permission, ScopeServer); err != nil {
				return nil, fmt.Errorf("template %s permission %s: %w", template.ID, permission, err)
			}
			permissionEvent := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionGranted{
				RbacPermissionGranted: rbacRolePermissionGrantedEvent(ScopeServer, "", input.Name, permission),
			}})
			entries = append(entries, events.BatchEntry{Subject: rbacSubjectForEvent(permissionEvent), Event: permissionEvent})
		}
		return entries, nil
	}); err != nil {
		return nil, err
	}
	return c.GetServerRole(ctx, input.Name)
}

func (c *ChattoCore) AdminUpdateServerRole(ctx context.Context, actorID string, input AdminRoleUpdateInput) (*RoleWithPermissions, error) {
	if err := c.requireCanManageAdminRoles(ctx, actorID); err != nil {
		return nil, err
	}
	if input.DisplayName == nil && input.Description == nil && input.Pingable == nil && input.Color == nil {
		return nil, fmt.Errorf("%w: provide at least one role field to update", ErrInvalidArgument)
	}
	if IsDefaultSystemGrade(input.Name) && (input.DisplayName != nil || input.Description != nil) {
		return nil, fmt.Errorf("%w: system grade names and descriptions are localized and cannot be edited", ErrInvalidArgument)
	}
	if input.Name == RoleEveryone && input.Pingable != nil && *input.Pingable {
		return nil, fmt.Errorf("%w: everyone is implicit and cannot be mentioned", ErrInvalidArgument)
	}
	if input.Color != nil {
		normalized, err := normalizeRoleColor(*input.Color)
		if err != nil {
			return nil, err
		}
		input.Color = &normalized
	}
	role, err := c.GetServerRole(ctx, input.Name)
	if err != nil {
		return nil, err
	}
	displayName := role.DisplayName
	if input.DisplayName != nil {
		displayName = *input.DisplayName
	}
	description := role.Description
	if input.Description != nil {
		description = *input.Description
	}
	updated := role
	if input.DisplayName != nil || input.Description != nil || input.Pingable != nil {
		if input.Pingable != nil {
			updated, err = c.UpdateServerRole(ctx, actorID, input.Name, displayName, description, *input.Pingable)
		} else {
			updated, err = c.UpdateServerRole(ctx, actorID, input.Name, displayName, description)
		}
		if err != nil {
			return nil, err
		}
	}
	if input.Color != nil {
		updated, err = c.UpdateServerRoleColor(ctx, actorID, input.Name, *input.Color)
		if err != nil {
			return nil, err
		}
	}
	updated.IsSystem = IsDefaultSystemGrade(updated.Name)
	return updated, nil
}

func (c *ChattoCore) AdminDeleteServerRole(ctx context.Context, actorID, roleName string) error {
	if err := c.requireCanManageAdminRoles(ctx, actorID); err != nil {
		return err
	}
	if roleName == "" {
		return fmt.Errorf("%w: role name is required", ErrInvalidArgument)
	}
	if IsDefaultSystemGrade(roleName) {
		return ErrCannotDeleteSystemRole
	}
	return c.DeleteServerRole(ctx, actorID, roleName)
}

// AdminReorderServerRoles owns the custom-role definition for the admin API so
// newly introduced system grades cannot accidentally enter the custom reorder
// set through legacy IsSystemRole callers.
func (c *ChattoCore) AdminReorderServerRoles(ctx context.Context, actorID string, roleNames []string) ([]RoleWithPermissions, error) {
	if roleNames == nil {
		roleNames = []string{}
	}
	event := newEvent(actorID, &corev1.Event{})
	if _, err := c.appendRBACEvent(ctx, event, func() error {
		if err := c.requireCanManageAdminRoles(ctx, actorID); err != nil {
			return err
		}
		customRoles := make(map[string]struct{})
		for _, role := range c.RBAC.ListRoles() {
			if role.GetName() == "" || IsDefaultSystemGrade(role.GetName()) {
				continue
			}
			customRoles[role.GetName()] = struct{}{}
		}
		if len(roleNames) != len(customRoles) {
			return fmt.Errorf("%w: role reorder must include every custom role exactly once", ErrInvalidArgument)
		}
		seen := make(map[string]struct{}, len(roleNames))
		for _, roleName := range roleNames {
			if IsDefaultSystemGrade(roleName) {
				return fmt.Errorf("%w: cannot reorder system grade %s", ErrInvalidArgument, roleName)
			}
			if _, duplicate := seen[roleName]; duplicate {
				return fmt.Errorf("%w: duplicate role in reorder: %s", ErrInvalidArgument, roleName)
			}
			seen[roleName] = struct{}{}
			if _, exists := customRoles[roleName]; !exists {
				return fmt.Errorf("role %s: %w", roleName, ErrRoleNotFound)
			}
		}
		event.Event = &corev1.Event_RbacRolesReordered{
			RbacRolesReordered: &corev1.RbacRolesReorderedEvent{RoleNames: roleNames},
		}
		return nil
	}); err != nil {
		return nil, err
	}
	roles, err := c.ListServerRoles(ctx)
	if err != nil {
		return nil, err
	}
	markDefaultSystemGrades(roles)
	return roles, nil
}

func (c *ChattoCore) requireCanManageAdminRoles(ctx context.Context, actorID string) error {
	if actorID == "" {
		return ErrNotAuthenticated
	}
	canManage, err := c.CanManageRoles(ctx, actorID)
	if err != nil {
		return fmt.Errorf("check role.manage: %w", err)
	}
	if !canManage {
		return ErrPermissionDenied
	}
	return nil
}

func (c *ChattoCore) serverRoleUsers(ctx context.Context, roleName string) ([]RoleUserSummary, error) {
	userIDs, err := c.GetRoleUsers(ctx, roleName)
	if err != nil {
		return nil, err
	}
	users := make([]RoleUserSummary, 0, len(userIDs))
	for _, userID := range userIDs {
		user, err := c.GetUser(ctx, userID)
		if err != nil {
			continue
		}
		users = append(users, RoleUserSummary{
			ID:           user.GetId(),
			Login:        user.GetLogin(),
			DisplayName:  user.GetDisplayName(),
			Deleted:      user.GetDeleted(),
			CustomStatus: user.GetCustomStatus(),
		})
	}
	return users, nil
}
