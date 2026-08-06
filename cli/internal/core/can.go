package core

import (
	"context"
	"time"
)

// can.go provides semantic helper functions for permission checks. These wrap
// the low-level permission resolver with business-meaningful names.

func (c *ChattoCore) CanAdminUsersView(ctx context.Context, userID string) (bool, error) {
	return c.HasServerPermission(ctx, userID, PermAdminUsersView)
}

func (c *ChattoCore) CanAssignRoles(ctx context.Context, userID string) (bool, error) {
	return c.HasServerPermission(ctx, userID, PermRoleAssign)
}

func (c *ChattoCore) CanManageRoles(ctx context.Context, userID string) (bool, error) {
	return c.HasServerPermission(ctx, userID, PermRoleManage)
}

func (c *ChattoCore) CanAdminSystemView(ctx context.Context, userID string) (bool, error) {
	return c.IsServerOwner(ctx, userID)
}

func (c *ChattoCore) CanAdminAuditView(ctx context.Context, userID string) (bool, error) {
	return c.HasServerPermission(ctx, userID, PermAdminAuditView)
}

func (c *ChattoCore) CanManageUserPermissions(ctx context.Context, userID string) (bool, error) {
	return c.HasServerPermission(ctx, userID, PermUserManagePermissions)
}

func (c *ChattoCore) CanManageUserAccounts(ctx context.Context, userID string) (bool, error) {
	return c.HasServerPermission(ctx, userID, PermUserManageAccounts)
}

func (c *ChattoCore) CanStartDM(ctx context.Context, userID string) (bool, error) {
	decision, err := c.ResolveUserPermission(ctx, userID, KindDM, "", PermMessagePost)
	if err != nil {
		return false, err
	}
	return decision != DecisionDeny, nil
}

// CanDeleteUser protects effective owners from delegated account deletion.
// Owners must first remove ownership through the dedicated fresh-auth flow.
func (c *ChattoCore) CanDeleteUser(ctx context.Context, actorID, targetUserID string) (bool, error) {
	if actorID != targetUserID {
		targetIsOwner, err := c.IsServerOwner(ctx, targetUserID)
		if err != nil {
			return false, err
		}
		if targetIsOwner {
			return false, nil
		}
		return c.HasServerPermission(ctx, actorID, PermUserDeleteAny)
	}
	return c.HasServerPermission(ctx, actorID, PermUserDeleteSelf)
}

var adminPermissions = []Permission{
	PermServerManage,
	PermRoleManage,
	PermRoleAssign,
	PermRoomManage,
	PermRoomRemoveMember,
	PermRoomMemberBan,
	PermRoomLock,
	PermRoomPurgeMessages,
	PermMessageDeleteOthers,
	PermUserDeleteAny,
	PermUserManageAccounts,
	PermUserManagePermissions,
	PermAdminUsersView,
	PermAdminAuditView,
}

func (c *ChattoCore) HasAnyAdminPermission(ctx context.Context, userID string) (bool, error) {
	for _, perm := range adminPermissions {
		has, err := c.hasServerPermission(ctx, userID, perm)
		if err != nil {
			return false, err
		}
		if has {
			return true, nil
		}
	}
	return false, nil
}

func (c *ChattoCore) CanManageServer(ctx context.Context, userID string) (bool, error) {
	return c.hasServerPermission(ctx, userID, PermServerManage)
}

func (c *ChattoCore) CanManageAnyRoom(ctx context.Context, userID string) (bool, error) {
	return c.hasServerPermission(ctx, userID, PermRoomManage)
}

func (c *ChattoCore) CanManageRoomGroup(ctx context.Context, userID, groupID string) (bool, error) {
	return c.hasGroupPermission(ctx, KindChannel, groupID, userID, PermRoomManage)
}

func (c *ChattoCore) CanLockRoom(ctx context.Context, userID, roomID string) (bool, error) {
	return c.hasRoomPermission(ctx, KindChannel, roomID, userID, PermRoomLock)
}

func (c *ChattoCore) CanPurgeRoomMessages(ctx context.Context, userID, roomID string) (bool, error) {
	return c.hasRoomPermission(ctx, KindChannel, roomID, userID, PermRoomPurgeMessages)
}

func (c *ChattoCore) CanBypassRoomLock(ctx context.Context, userID, roomID string) (bool, error) {
	return c.hasRoomPermission(ctx, KindChannel, roomID, userID, PermRoomBypassLock)
}

// resolvePermissionFamily applies deny-wins across a semantic permission
// family. It is used only where a narrow permission replaces one capability
// of a broader legacy permission.
func (c *ChattoCore) resolvePermissionFamily(ctx context.Context, userID string, kind RoomKind, roomID string, permissions ...Permission) (bool, error) {
	allowed := false
	for _, permission := range permissions {
		decision, err := c.ResolveUserPermission(ctx, userID, kind, roomID, permission)
		if err != nil {
			return false, err
		}
		if decision == DecisionDeny {
			return false, nil
		}
		if decision == DecisionAllow {
			allowed = true
		}
	}
	return allowed, nil
}

// CanRemoveRoomMember accepts either the narrow permission or the broad legacy
// room.manage permission, while a deny on either capability remains decisive.
func (c *ChattoCore) CanRemoveRoomMember(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	return c.resolvePermissionFamily(ctx, userID, kind, roomID, PermRoomRemoveMember, PermRoomManage)
}

// CanDeleteOthersMessage accepts either the narrow permission or the broad
// legacy message.manage permission. Editing still requires message.manage.
func (c *ChattoCore) CanDeleteOthersMessage(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	return c.resolvePermissionFamily(ctx, userID, kind, roomID, PermMessageDeleteOthers, PermMessageManage)
}

func (c *ChattoCore) CanSeeRoom(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	if kind == KindDM {
		return false, nil
	}
	isMember, err := c.RoomMembershipExists(ctx, kind, userID, roomID)
	if err != nil {
		return false, err
	}
	if isMember {
		return true, nil
	}
	return c.hasRoomPermission(ctx, kind, roomID, userID, PermRoomList)
}

func (c *ChattoCore) CanCreateRoom(ctx context.Context, userID string, kind RoomKind, groupID string) (bool, error) {
	if kind == KindChannel && groupID != "" {
		return c.hasGroupPermission(ctx, kind, groupID, userID, PermRoomCreate)
	}
	return c.hasKindPermission(ctx, kind, userID, PermRoomCreate)
}

func (c *ChattoCore) CanJoinRoom(ctx context.Context, userID string, kind RoomKind) (bool, error) {
	decision, err := c.ResolveUserPermission(ctx, userID, kind, "", PermRoomJoin)
	if err != nil {
		return false, err
	}
	return decision != DecisionDeny, nil
}

func (c *ChattoCore) CanJoinRoomAt(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	if kind == KindChannel {
		isOwner, err := c.IsServerOwner(ctx, userID)
		if err != nil {
			return false, err
		}
		if !isOwner && c.rooms().isRoomBanActive(roomID, userID, time.Now()) {
			return false, nil
		}
	}
	return c.hasRoomPermission(ctx, kind, roomID, userID, PermRoomJoin)
}

func (c *ChattoCore) CanPostMessage(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	return c.hasRoomPermission(ctx, kind, roomID, userID, PermMessagePost)
}

func (c *ChattoCore) CanPostInThread(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	return c.hasRoomPermission(ctx, kind, roomID, userID, PermMessagePostInThread)
}

func (c *ChattoCore) CanAttachFiles(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	return c.hasRoomPermission(ctx, kind, roomID, userID, PermMessageAttach)
}

func (c *ChattoCore) CanSendVoiceMessages(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	return c.hasRoomPermission(ctx, kind, roomID, userID, PermMessageVoice)
}

func (c *ChattoCore) CanReactToMessage(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	return c.hasRoomPermission(ctx, kind, roomID, userID, PermMessageReact)
}

func (c *ChattoCore) CanEchoMessage(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	return c.hasRoomPermission(ctx, kind, roomID, userID, PermMessageEcho)
}

func (c *ChattoCore) CanManageOthersMessage(ctx context.Context, userID string, kind RoomKind, roomID string) (bool, error) {
	return c.hasRoomPermission(ctx, kind, roomID, userID, PermMessageManage)
}
