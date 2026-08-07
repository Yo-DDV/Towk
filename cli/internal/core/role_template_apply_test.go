package core

import (
	"errors"
	"slices"
	"testing"

	"hmans.de/chatto/internal/events"
)

func templateTestOwner(t *testing.T, core *ChattoCore) (string, error) {
	t.Helper()
	ctx := testContext(t)
	owner, err := core.CreateUser(ctx, SystemActorID, "template-test-owner", "Template Owner", "password123")
	if err != nil {
		return "", err
	}
	if err := core.AssignOwnerRole(ctx, owner.Id); err != nil {
		return "", err
	}
	return owner.Id, nil
}

func TestAdminCreateServerRoleFromTemplateIsComplete(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	ownerID, err := templateTestOwner(t, core)
	if err != nil {
		t.Fatalf("templateTestOwner: %v", err)
	}

	color := "#16a34a"
	role, err := core.AdminCreateServerRoleFromTemplate(ctx, ownerID, AdminRoleInput{
		Name: "safety-team", DisplayName: "Safety Team", Description: "Community moderation", Color: &color,
	}, GradeTemplateModeratorV1)
	if err != nil {
		t.Fatalf("AdminCreateServerRoleFromTemplate: %v", err)
	}
	gotPermissions := slices.Clone(role.Permissions)
	wantPermissions := slices.Clone(DefaultModeratorPermissions())
	slices.Sort(gotPermissions)
	slices.Sort(wantPermissions)
	if !slices.Equal(gotPermissions, wantPermissions) {
		t.Fatalf("created permissions = %v, want %v", role.Permissions, DefaultModeratorPermissions())
	}
	if role.Color != RoleColorModerator || !role.Pingable {
		t.Fatalf("created metadata = %+v", role)
	}
}

func TestAdminApplyServerRoleTemplatePreservesExceptionsAndRejectsStalePreview(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	ownerID, err := templateTestOwner(t, core)
	if err != nil {
		t.Fatalf("templateTestOwner: %v", err)
	}
	role, err := core.CreateServerRole(ctx, SystemActorID, "community-team", "Community Team", "Existing metadata", true)
	if err != nil {
		t.Fatalf("CreateServerRole: %v", err)
	}
	room, err := core.CreateRoom(ctx, SystemActorID, KindChannel, "", "template-room", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if err := core.GrantServerPermission(ctx, SystemActorID, role.Name, PermMessageManage); err != nil {
		t.Fatalf("GrantServerPermission: %v", err)
	}
	if err := core.GrantRoomPermission(ctx, SystemActorID, room.Id, role.Name, PermMessagePost); err != nil {
		t.Fatalf("GrantRoomPermission: %v", err)
	}
	before, err := core.GetServerRole(ctx, role.Name)
	if err != nil {
		t.Fatalf("GetServerRole: %v", err)
	}
	if _, err := core.AdminApplyServerRoleTemplate(ctx, ownerID, role.Name, GradeTemplateModeratorV1, RoleTemplateStateToken(before)); err != nil {
		t.Fatalf("AdminApplyServerRoleTemplate: %v", err)
	}
	for _, permission := range DefaultModeratorPermissions() {
		if got := core.RBAC.GetDecision(ScopeServer, "", role.Name, permission); got != DecisionAllow {
			t.Errorf("server decision %s = %s, want allow", permission, got)
		}
	}
	if got := core.RBAC.GetDecision(ScopeServer, "", role.Name, PermMessageManage); got != DecisionNone {
		t.Errorf("legacy server decision = %s, want none", got)
	}
	if got := core.RBAC.GetDecision(ScopeRoom, room.Id, role.Name, PermMessagePost); got != DecisionAllow {
		t.Errorf("room exception = %s, want allow", got)
	}

	stale, err := core.GetServerRole(ctx, role.Name)
	if err != nil {
		t.Fatalf("GetServerRole stale: %v", err)
	}
	if err := core.GrantServerPermission(ctx, SystemActorID, role.Name, PermMessageReact); err != nil {
		t.Fatalf("concurrent permission: %v", err)
	}
	if _, err := core.AdminApplyServerRoleTemplate(ctx, ownerID, role.Name, GradeTemplateHelperV1, RoleTemplateStateToken(stale)); !errors.Is(err, events.ErrConflict) {
		t.Fatalf("stale apply error = %v, want events.ErrConflict", err)
	}
}
