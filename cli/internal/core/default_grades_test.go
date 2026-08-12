package core

import (
	"slices"
	"testing"
)

func TestDefaultGradeTemplates(t *testing.T) {
	templates := DefaultGradeTemplates()
	if len(templates) != 4 {
		t.Fatalf("template count = %d, want 4", len(templates))
	}

	helper, ok := GradeTemplateByID(GradeTemplateHelperV1)
	if !ok {
		t.Fatal("helper template missing")
	}
	if helper.RoleName != RoleHelper || !helper.Pingable || helper.Color != RoleColorHelper {
		t.Fatalf("helper template = %#v", helper)
	}
	if len(helper.Permissions) != 0 {
		t.Fatalf("helper permissions = %v, want none", helper.Permissions)
	}

	moderator, ok := GradeTemplateByID(GradeTemplateModeratorV1)
	if !ok {
		t.Fatal("moderator template missing")
	}
	wantModerator := []Permission{
		PermRoomRemoveMember,
		PermRoomMemberBan,
		PermRoomLock,
		PermRoomBypassLock,
		PermMessageDeleteOthers,
	}
	if !slices.Equal(moderator.Permissions, wantModerator) {
		t.Fatalf("moderator permissions = %v, want %v", moderator.Permissions, wantModerator)
	}
	if slices.Contains(moderator.Permissions, PermMessageManage) ||
		slices.Contains(moderator.Permissions, PermRoomManage) ||
		slices.Contains(moderator.Permissions, PermRoomPurgeMessages) {
		t.Fatalf("moderator contains broad/destructive permission: %v", moderator.Permissions)
	}
}

func TestDefaultAdminPermissionsAreExplicitAndSafe(t *testing.T) {
	permissions := DefaultAdminPermissions()
	for _, required := range []Permission{PermRoomRemoveMember, PermRoomLock, PermRoomBypassLock, PermMessageManage, PermRoleManage} {
		if !slices.Contains(permissions, required) {
			t.Errorf("admin default missing %s", required)
		}
	}
	if slices.Contains(permissions, PermRoomPurgeMessages) {
		t.Fatal("admin default must not include room.purge-messages")
	}
	if slices.Contains(permissions, PermMessageDeleteOthers) {
		t.Fatal("admin should inherit message.delete-others from message.manage")
	}
}

func TestHelperIsDefaultSystemGrade(t *testing.T) {
	if !IsDefaultSystemGrade(RoleHelper) {
		t.Fatal("helper must be recognized as a default system grade")
	}
	if IsDefaultSystemGrade("community-helper") {
		t.Fatal("custom helper-derived role must remain custom")
	}
	if PositionHelper <= PositionEveryone || PositionHelper >= PositionModerator {
		t.Fatalf("helper position = %d, want between members and moderator", PositionHelper)
	}
}

func TestGranularModerationPermissionsStayInsideDMBoundary(t *testing.T) {
	for _, permission := range []Permission{PermRoomRemoveMember, PermMessageDeleteOthers} {
		if !dmBoundaryDenies(permission) {
			t.Errorf("DM boundary does not deny %s", permission)
		}
	}
}

func TestDefaultGradeTemplatesReturnDetachedPermissions(t *testing.T) {
	first := DefaultGradeTemplates()
	first[0].Permissions[0] = PermServerManage
	second := DefaultGradeTemplates()
	if second[0].Permissions[0] == PermServerManage {
		t.Fatal("template permissions share mutable backing storage")
	}
}
