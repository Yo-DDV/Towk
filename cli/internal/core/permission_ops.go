package core

import (
	"context"
	"errors"
	"fmt"
	"strings"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// Permission mutation helpers append typed RBAC facts and wait for the local
// projection. Public callers remain responsible for authorization; these
// methods enforce catalog, scope and target validity at the durable boundary.

func (c *ChattoCore) requirePermissionRole(roleName string) error {
	if roleName == "" {
		return fmt.Errorf("%w: role name is required", ErrInvalidArgument)
	}
	if !c.RBAC.RoleExists(roleName) {
		return ErrRoleNotFound
	}
	if roleName == RoleOwner {
		return fmt.Errorf("%w: owner permissions are virtual and cannot be edited", ErrInvalidArgument)
	}
	return nil
}

func validatePermissionScope(perm Permission, scope PermissionScope) error {
	if err := ValidatePermission(perm); err != nil {
		return err
	}
	if !PermissionAppliesAtScope(perm, scope) {
		return fmt.Errorf("%w: permission %s does not apply at %s scope", ErrInvalidArgument, perm, scope)
	}
	return nil
}

func (c *ChattoCore) GrantServerPermission(ctx context.Context, actorID, roleName string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeServer); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionGranted{
		RbacPermissionGranted: rbacRolePermissionGrantedEvent(ScopeServer, "", roleName, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, func() error {
		if err := c.requirePermissionRole(roleName); err != nil {
			return err
		}
		if c.RBAC.GetDecision(ScopeServer, "", roleName, perm) == DecisionAllow {
			return errRBACNoop
		}
		return nil
	})
	if errors.Is(err, errRBACNoop) {
		return nil
	}
	return err
}

func (c *ChattoCore) DenyServerPermission(ctx context.Context, actorID, roleName string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeServer); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionDenied{
		RbacPermissionDenied: rbacRolePermissionDeniedEvent(ScopeServer, "", roleName, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, func() error { return c.requirePermissionRole(roleName) })
	return err
}

func (c *ChattoCore) ClearServerPermissionState(ctx context.Context, actorID, roleName string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeServer); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionCleared{
		RbacPermissionCleared: rbacRolePermissionClearedEvent(ScopeServer, "", roleName, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, func() error { return c.requirePermissionRole(roleName) })
	return err
}

// User-level decisions participate in the same deny-wins resolver as role
// decisions. Effective owners are resolved before stored decisions and cannot
// be restricted by these overrides.
func (c *ChattoCore) GrantUserPermission(ctx context.Context, actorID, userID string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeServer); err != nil {
		return err
	}
	if _, err := c.GetUser(ctx, userID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionGranted{
		RbacPermissionGranted: rbacUserPermissionGrantedEvent(ScopeServer, "", userID, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, nil)
	return err
}

func (c *ChattoCore) DenyUserPermission(ctx context.Context, actorID, userID string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeServer); err != nil {
		return err
	}
	if _, err := c.GetUser(ctx, userID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionDenied{
		RbacPermissionDenied: rbacUserPermissionDeniedEvent(ScopeServer, "", userID, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, nil)
	return err
}

func (c *ChattoCore) ClearUserPermissionState(ctx context.Context, actorID, userID string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeServer); err != nil {
		return err
	}
	if _, err := c.GetUser(ctx, userID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionCleared{
		RbacPermissionCleared: rbacUserPermissionClearedEvent(ScopeServer, "", userID, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, nil)
	return err
}

func (c *ChattoCore) GrantUserRoomPermission(ctx context.Context, actorID, roomID, userID string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeRoom); err != nil {
		return err
	}
	if _, err := c.GetUser(ctx, userID); err != nil {
		return err
	}
	if _, err := c.FindRoomByID(ctx, roomID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionGranted{
		RbacPermissionGranted: rbacUserPermissionGrantedEvent(ScopeRoom, roomID, userID, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, nil)
	return err
}

func (c *ChattoCore) DenyUserRoomPermission(ctx context.Context, actorID, roomID, userID string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeRoom); err != nil {
		return err
	}
	if _, err := c.GetUser(ctx, userID); err != nil {
		return err
	}
	if _, err := c.FindRoomByID(ctx, roomID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionDenied{
		RbacPermissionDenied: rbacUserPermissionDeniedEvent(ScopeRoom, roomID, userID, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, nil)
	return err
}

func (c *ChattoCore) ClearUserRoomPermissionState(ctx context.Context, actorID, roomID, userID string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeRoom); err != nil {
		return err
	}
	if _, err := c.GetUser(ctx, userID); err != nil {
		return err
	}
	if _, err := c.FindRoomByID(ctx, roomID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionCleared{
		RbacPermissionCleared: rbacUserPermissionClearedEvent(ScopeRoom, roomID, userID, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, nil)
	return err
}

func (c *ChattoCore) GrantUserGroupPermission(ctx context.Context, actorID, groupID, userID string, perm Permission) error {
	if err := ValidatePermission(perm); err != nil {
		return err
	}
	if !PermissionAppliesAtScope(perm, ScopeGroup) && !PermissionAppliesAtScope(perm, ScopeRoom) {
		return fmt.Errorf("%w: permission %s does not apply at group scope", ErrInvalidArgument, perm)
	}
	if _, err := c.GetUser(ctx, userID); err != nil {
		return err
	}
	if _, err := c.GetRoomGroup(ctx, groupID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionGranted{
		RbacPermissionGranted: rbacUserPermissionGrantedEvent(ScopeGroup, groupID, userID, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, nil)
	return err
}

func (c *ChattoCore) DenyUserGroupPermission(ctx context.Context, actorID, groupID, userID string, perm Permission) error {
	if err := ValidatePermission(perm); err != nil {
		return err
	}
	if !PermissionAppliesAtScope(perm, ScopeGroup) && !PermissionAppliesAtScope(perm, ScopeRoom) {
		return fmt.Errorf("%w: permission %s does not apply at group scope", ErrInvalidArgument, perm)
	}
	if _, err := c.GetUser(ctx, userID); err != nil {
		return err
	}
	if _, err := c.GetRoomGroup(ctx, groupID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionDenied{
		RbacPermissionDenied: rbacUserPermissionDeniedEvent(ScopeGroup, groupID, userID, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, nil)
	return err
}

func (c *ChattoCore) ClearUserGroupPermissionState(ctx context.Context, actorID, groupID, userID string, perm Permission) error {
	if err := ValidatePermission(perm); err != nil {
		return err
	}
	if !PermissionAppliesAtScope(perm, ScopeGroup) && !PermissionAppliesAtScope(perm, ScopeRoom) {
		return fmt.Errorf("%w: permission %s does not apply at group scope", ErrInvalidArgument, perm)
	}
	if _, err := c.GetUser(ctx, userID); err != nil {
		return err
	}
	if _, err := c.GetRoomGroup(ctx, groupID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionCleared{
		RbacPermissionCleared: rbacUserPermissionClearedEvent(ScopeGroup, groupID, userID, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, nil)
	return err
}

func (c *ChattoCore) GrantRoomPermission(ctx context.Context, actorID, roomID, roleName string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeRoom); err != nil {
		return err
	}
	if _, err := c.GetRoom(ctx, KindChannel, roomID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionGranted{
		RbacPermissionGranted: rbacRolePermissionGrantedEvent(ScopeRoom, roomID, roleName, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, func() error { return c.requirePermissionRole(roleName) })
	return err
}

func (c *ChattoCore) DenyRoomPermission(ctx context.Context, actorID, roomID, roleName string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeRoom); err != nil {
		return err
	}
	if _, err := c.GetRoom(ctx, KindChannel, roomID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionDenied{
		RbacPermissionDenied: rbacRolePermissionDeniedEvent(ScopeRoom, roomID, roleName, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, func() error { return c.requirePermissionRole(roleName) })
	return err
}

func (c *ChattoCore) ClearRoomPermissionState(ctx context.Context, actorID, roomID, roleName string, perm Permission) error {
	if err := validatePermissionScope(perm, ScopeRoom); err != nil {
		return err
	}
	if _, err := c.GetRoom(ctx, KindChannel, roomID); err != nil {
		return err
	}
	event := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RbacPermissionCleared{
		RbacPermissionCleared: rbacRolePermissionClearedEvent(ScopeRoom, roomID, roleName, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, func() error { return c.requirePermissionRole(roleName) })
	return err
}

func (c *ChattoCore) GetUserExplicitServerOverride(_ context.Context, userID string, perm Permission) (DecisionKind, error) {
	return c.RBAC.GetDecision(ScopeServer, "", userID, perm), nil
}

func (c *ChattoCore) GetUserExplicitGroupOverride(_ context.Context, groupID, userID string, perm Permission) (DecisionKind, error) {
	return c.RBAC.GetDecision(ScopeGroup, groupID, userID, perm), nil
}

func (c *ChattoCore) GetUserExplicitRoomOverride(_ context.Context, roomID, userID string, perm Permission) (DecisionKind, error) {
	return c.RBAC.GetDecision(ScopeRoom, roomID, userID, perm), nil
}

const AnnouncementsRoomName = "announcements"

func (c *ChattoCore) SetupAnnouncementsRoomPermissions(ctx context.Context, roomID string) error {
	if err := c.SeedDefaultChannelRoomPermissions(ctx, roomID, AnnouncementsRoomName); err != nil {
		return err
	}
	c.logger.Debug("Set up announcements room permissions", "room", roomID)
	return nil
}

func (c *ChattoCore) SeedDefaultChannelRoomPermissions(ctx context.Context, roomID, roomName string) error {
	if roomID == "" {
		return fmt.Errorf("roomID is required")
	}
	if strings.EqualFold(roomName, AnnouncementsRoomName) {
		for _, perm := range DefaultAnnouncementsEveryonePermissions() {
			if err := c.grantRoomPermissionIfMissing(ctx, roomID, RoleEveryone, perm); err != nil {
				return fmt.Errorf("seed announcements everyone %s: %w", perm, err)
			}
		}
		for _, perm := range DefaultAnnouncementsEveryoneDenials() {
			if err := c.denyRoomPermissionIfMissing(ctx, roomID, RoleEveryone, perm); err != nil {
				return fmt.Errorf("seed announcements everyone denial %s: %w", perm, err)
			}
		}
		return c.seedDefaultRoomStaffPermissions(ctx, roomID)
	}
	for _, perm := range DefaultRoomEveryonePermissions() {
		if err := c.grantRoomPermissionIfMissing(ctx, roomID, RoleEveryone, perm); err != nil {
			return fmt.Errorf("seed room everyone %s: %w", perm, err)
		}
	}
	return c.seedDefaultRoomStaffPermissions(ctx, roomID)
}

func (c *ChattoCore) EnsureDefaultChannelRoomPermissions(ctx context.Context) error {
	rooms, err := c.ListRooms(ctx, KindChannel)
	if err != nil {
		return fmt.Errorf("list channel rooms: %w", err)
	}
	for _, room := range rooms {
		if err := c.SeedDefaultChannelRoomPermissions(ctx, room.Id, room.Name); err != nil {
			return fmt.Errorf("ensure room permissions for %s: %w", room.Id, err)
		}
	}
	return nil
}

func (c *ChattoCore) seedDefaultRoomStaffPermissions(ctx context.Context, roomID string) error {
	for _, perm := range DefaultRoomModeratorPermissions() {
		if err := c.grantRoomPermissionIfMissing(ctx, roomID, RoleModerator, perm); err != nil {
			return fmt.Errorf("seed room moderator permission %s %s: %w", RoleModerator, perm, err)
		}
	}
	for _, perm := range DefaultRoomAdminPermissions() {
		if err := c.grantRoomPermissionIfMissing(ctx, roomID, RoleAdmin, perm); err != nil {
			return fmt.Errorf("seed room admin permission %s %s: %w", RoleAdmin, perm, err)
		}
	}
	for _, roleName := range []string{RoleModerator, RoleAdmin} {
		for _, perm := range DefaultAnnouncementsPosterPermissions() {
			if err := c.grantRoomPermissionIfMissing(ctx, roomID, roleName, perm); err != nil {
				return fmt.Errorf("seed room poster permission %s %s: %w", roleName, perm, err)
			}
		}
	}
	return nil
}

func (c *ChattoCore) InitDefaultPermissions(ctx context.Context) error {
	roleDefaults := []struct {
		role  string
		perms []Permission
	}{
		{RoleAdmin, DefaultAdminPermissions()},
		{RoleModerator, DefaultModeratorPermissions()},
		{RoleHelper, DefaultHelperPermissions()},
		{RoleEveryone, DefaultSeedEveryonePermissions()},
	}
	for _, spec := range roleDefaults {
		for _, perm := range spec.perms {
			if !PermissionAppliesAtScope(perm, ScopeServer) {
				continue
			}
			if err := c.GrantServerPermission(ctx, SystemActorID, spec.role, perm); err != nil {
				return fmt.Errorf("failed to grant %s permission %s: %w", spec.role, perm, err)
			}
		}
	}
	c.logger.Info("Initialized default permissions")
	return nil
}

// EnsureDefaultRolePermissions retains only the historical, already-supported
// boot backfills. Recommended templates are never injected during ordinary
// startup, so an upgrade cannot silently expand Moderator or Admin authority.
func (c *ChattoCore) EnsureDefaultRolePermissions(ctx context.Context) error {
	legacyAdmin := []Permission{
		PermServerManage,
		PermRoomCreate,
		PermRoomList,
		PermRoomJoin,
		PermRoomManage,
		PermRoomMemberBan,
		PermMessageManage,
		PermRoleManage,
		PermRoleAssign,
		PermAdminUsersView,
		PermAdminAuditView,
		PermUserDeleteAny,
		PermUserDeleteSelf,
		PermUserManageAccounts,
		PermUserManagePermissions,
	}
	legacyModerator := []Permission{PermMessageManage, PermRoomMemberBan}
	roleDefaults := []struct {
		role  string
		perms []Permission
	}{
		{RoleAdmin, legacyAdmin},
		{RoleModerator, legacyModerator},
		{RoleEveryone, DefaultEveryonePermissions()},
	}
	for _, spec := range roleDefaults {
		for _, perm := range spec.perms {
			if err := c.grantServerPermissionIfMissing(ctx, spec.role, perm); err != nil {
				return fmt.Errorf("ensure historical %s permission %s: %w", spec.role, perm, err)
			}
		}
	}
	return nil
}

func (c *ChattoCore) SeedDefaultRoomGroupPermissions(ctx context.Context, groupID string) error {
	roleDefaults := []struct {
		role  string
		perms []Permission
	}{
		{RoleAdmin, DefaultAdminPermissions()},
		{RoleModerator, DefaultModeratorPermissions()},
		{RoleHelper, DefaultHelperPermissions()},
		{RoleEveryone, DefaultEveryonePermissions()},
	}
	for _, spec := range roleDefaults {
		for _, perm := range spec.perms {
			if !PermissionAppliesAtScope(perm, ScopeGroup) {
				continue
			}
			if err := c.grantSetPermissionIfMissing(ctx, groupID, spec.role, perm); err != nil {
				return fmt.Errorf("seed %s on group %s for %s: %w", perm, groupID, spec.role, err)
			}
		}
	}
	c.logger.Info("Seeded default room-group permissions", "group_id", groupID)
	return nil
}

func (c *ChattoCore) grantSetPermissionIfMissing(ctx context.Context, groupID, roleName string, perm Permission) error {
	if c.RBAC.GetDecision(ScopeGroup, groupID, roleName, perm) != DecisionNone {
		return nil
	}
	return c.GrantGroupPermission(ctx, SystemActorID, groupID, roleName, perm)
}

func (c *ChattoCore) grantRoomPermissionIfMissing(ctx context.Context, roomID, roleName string, perm Permission) error {
	if c.RBAC.GetDecision(ScopeRoom, roomID, roleName, perm) != DecisionNone {
		return nil
	}
	return c.GrantRoomPermission(ctx, SystemActorID, roomID, roleName, perm)
}

func (c *ChattoCore) denyRoomPermissionIfMissing(ctx context.Context, roomID, roleName string, perm Permission) error {
	if c.RBAC.GetDecision(ScopeRoom, roomID, roleName, perm) != DecisionNone {
		return nil
	}
	return c.DenyRoomPermission(ctx, SystemActorID, roomID, roleName, perm)
}

func (c *ChattoCore) grantServerPermissionIfMissing(ctx context.Context, roleName string, perm Permission) error {
	if c.RBAC.GetDecision(ScopeServer, "", roleName, perm) != DecisionNone {
		return nil
	}
	event := newEvent(SystemActorID, &corev1.Event{Event: &corev1.Event_RbacPermissionGranted{
		RbacPermissionGranted: rbacRolePermissionGrantedEvent(ScopeServer, "", roleName, perm),
	}})
	_, err := c.appendRBACEvent(ctx, event, func() error {
		if err := c.requirePermissionRole(roleName); err != nil {
			return err
		}
		if c.RBAC.GetDecision(ScopeServer, "", roleName, perm) != DecisionNone {
			return errRBACNoop
		}
		return nil
	})
	if errors.Is(err, errRBACNoop) {
		return nil
	}
	return err
}
