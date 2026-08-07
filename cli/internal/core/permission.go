package core

import (
	"fmt"
	"slices"
	"strings"
)

// PermissionScope marks where a permission can be configured.
// Most permissions apply at the server level (default). Channel-room
// permissions (e.g. message.post) additionally include ScopeGroup (to be
// configured per room group) and ScopeRoom (to be overridden per individual
// room).
type PermissionScope string

const (
	ScopeServer PermissionScope = "server"
	ScopeGroup  PermissionScope = "group"
	ScopeRoom   PermissionScope = "room"
)

// PermissionCategory groups related permissions for UI organization.
type PermissionCategory string

const (
	CategoryServer  PermissionCategory = "server"
	CategoryRoom    PermissionCategory = "room"
	CategoryMessage PermissionCategory = "message"
	CategoryRole    PermissionCategory = "role"
	CategoryAdmin   PermissionCategory = "admin"
	CategoryUser    PermissionCategory = "user"
)

// Permission represents a permission in the permission model.
type Permission string

const (
	// ===== Server Permissions =====

	// PermServerManage allows updating server settings (name, description, logo).
	PermServerManage Permission = "server.manage"

	// ===== Room Permissions =====

	// PermRoomCreate allows creating new rooms.
	PermRoomCreate Permission = "room.create"

	// PermRoomJoin allows joining existing rooms. Distinct from `room.list`.
	PermRoomJoin Permission = "room.join"

	// PermRoomList allows seeing a room in the directory and elsewhere the
	// server enumerates rooms.
	PermRoomList Permission = "room.list"

	// PermRoomRemoveMember allows removing an explicit channel-room membership
	// without granting the broader room configuration capability.
	PermRoomRemoveMember Permission = "room.remove-member"

	// PermRoomManage allows updating or deleting channel rooms.
	PermRoomManage Permission = "room.manage"

	// PermRoomMemberBan allows banning members from channel rooms.
	PermRoomMemberBan Permission = "room.ban-member"

	// PermRoomLock allows locking and unlocking channel posting.
	PermRoomLock Permission = "room.lock"

	// PermRoomPurgeMessages allows placing a channel history barrier and
	// securely deleting message-owned content.
	PermRoomPurgeMessages Permission = "room.purge-messages"

	// PermRoomBypassLock allows additive content while a channel is locked.
	PermRoomBypassLock Permission = "room.bypass-lock"

	// ===== Message Permissions =====

	// PermMessagePost allows posting new root messages in rooms.
	PermMessagePost Permission = "message.post"

	// PermMessagePostInThread allows posting messages in a thread.
	PermMessagePostInThread Permission = "message.post-in-thread"

	// PermMessageAttach allows attaching files to new messages.
	PermMessageAttach Permission = "message.attach"

	// PermMessageVoice allows recording and posting first-class voice messages.
	PermMessageVoice Permission = "message.voice"

	// PermMessageDeleteOthers allows deleting another user's message without
	// allowing the actor to rewrite that message.
	PermMessageDeleteOthers Permission = "message.delete-others"

	// PermMessageManage is the broad legacy moderation permission. It allows
	// editing and deleting other users' messages.
	PermMessageManage Permission = "message.manage"

	// PermMessageReact allows adding/removing reactions to messages.
	PermMessageReact Permission = "message.react"

	// PermMessageEcho allows echoing thread replies to the main channel.
	PermMessageEcho Permission = "message.echo"

	// ===== Role Management Permissions =====

	// PermRoleManage allows creating, editing, deleting, and reordering roles
	// and their permission grants.
	PermRoleManage Permission = "role.manage"

	// PermRoleAssign allows assigning and revoking roles to/from users.
	PermRoleAssign Permission = "role.assign"

	// ===== Admin Panel Permissions =====

	// PermAdminUsersView allows viewing the users page in admin.
	PermAdminUsersView Permission = "admin.view-users"

	// PermAdminAuditView allows viewing the audit log in admin.
	PermAdminAuditView Permission = "admin.view-audit"

	// ===== User Management Permissions =====

	// PermUserDeleteAny allows admins to delete any user's account.
	PermUserDeleteAny Permission = "user.delete-any"

	// PermUserDeleteSelf allows users to delete their own account.
	PermUserDeleteSelf Permission = "user.delete-self"

	// PermUserManageAccounts allows account lifecycle and recovery operations.
	PermUserManageAccounts Permission = "user.manage-accounts"

	// PermUserManagePermissions allows editing direct per-user permission
	// overrides.
	PermUserManagePermissions Permission = "user.manage-permissions"
)

// PermissionMetadata provides display information and scope constraints for a permission.
type PermissionMetadata struct {
	Permission  Permission
	DisplayName string
	Description string
	Category    PermissionCategory
	Scopes      []PermissionScope
}

// allPermissions holds metadata for every configurable permission. This is the
// canonical ordering used by APIs, templates, matrices and localization parity
// checks.
var allPermissions = []PermissionMetadata{
	{PermServerManage, "Manage Server", "Update server settings (name, description, logo)", CategoryServer, []PermissionScope{ScopeServer}},

	{PermRoomCreate, "Create Rooms", "Create new rooms in this group (or anywhere if granted at server scope)", CategoryRoom, []PermissionScope{ScopeServer, ScopeGroup}},
	{PermRoomJoin, "Join Rooms", "Join existing rooms", CategoryRoom, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermRoomList, "Discover Rooms", "See rooms in the directory and group 'Join all' affordances", CategoryRoom, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermRoomRemoveMember, "Remove Room Members", "Remove explicit members from channel rooms without banning them", CategoryRoom, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermRoomManage, "Manage Rooms", "Edit, configure permissions on, and delete rooms", CategoryRoom, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermRoomMemberBan, "Ban Room Members", "Ban members from rooms", CategoryRoom, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermRoomLock, "Lock Rooms", "Lock and unlock posting in channel rooms", CategoryRoom, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermRoomPurgeMessages, "Purge Room Messages", "Permanently erase message-owned channel history while preserving the room", CategoryRoom, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermRoomBypassLock, "Bypass Room Locks", "Add content to a locked channel room", CategoryRoom, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},

	{PermMessagePost, "Post Messages", "Post new messages in rooms and start DMs", CategoryMessage, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermMessagePostInThread, "Post in Threads", "Post messages in threads", CategoryMessage, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermMessageAttach, "Attach Files", "Attach files to messages", CategoryMessage, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermMessageVoice, "Send Voice Messages", "Record and send voice messages", CategoryMessage, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermMessageDeleteOthers, "Delete Others' Messages", "Delete other users' messages without editing them", CategoryMessage, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermMessageManage, "Manage Messages", "Edit and delete other users' messages", CategoryMessage, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermMessageReact, "React to Messages", "Add and remove reactions", CategoryMessage, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},
	{PermMessageEcho, "Echo to Channel", "Echo thread replies to the main channel for visibility", CategoryMessage, []PermissionScope{ScopeServer, ScopeGroup, ScopeRoom}},

	{PermRoleManage, "Manage Roles", "Create, edit, delete, and reorder roles and their permissions", CategoryRole, []PermissionScope{ScopeServer}},
	{PermRoleAssign, "Assign Roles", "Assign and revoke roles for users", CategoryRole, []PermissionScope{ScopeServer}},

	{PermAdminUsersView, "View Users", "View the users page in admin", CategoryAdmin, []PermissionScope{ScopeServer}},
	{PermAdminAuditView, "View Audit Log", "View the audit log in admin", CategoryAdmin, []PermissionScope{ScopeServer}},

	{PermUserDeleteAny, "Delete Any User", "Delete any user's account", CategoryUser, []PermissionScope{ScopeServer}},
	{PermUserDeleteSelf, "Delete Own Account", "Delete your own account", CategoryUser, []PermissionScope{ScopeServer}},
	{PermUserManageAccounts, "Manage User Accounts", "Create users, edit account identity, reset passwords, attach verified emails, and clear login cooldowns", CategoryUser, []PermissionScope{ScopeServer}},
	{PermUserManagePermissions, "Manage User Permissions", "Grant, deny, and clear direct per-user permission overrides", CategoryUser, []PermissionScope{ScopeServer}},
}

var permissionIndex map[Permission]PermissionMetadata

func init() {
	permissionIndex = make(map[Permission]PermissionMetadata, len(allPermissions))
	for _, p := range allPermissions {
		if _, exists := permissionIndex[p.Permission]; exists {
			panic(fmt.Sprintf("duplicate permission metadata for %q", p.Permission))
		}
		permissionIndex[p.Permission] = p
	}
}

// AllPermissions returns a detached copy of all defined permission metadata.
func AllPermissions() []PermissionMetadata {
	return slices.Clone(allPermissions)
}

func GetPermissionMetadata(perm Permission) (PermissionMetadata, bool) {
	meta, ok := permissionIndex[perm]
	return meta, ok
}

func ValidatePermission(perm Permission) error {
	if _, ok := permissionIndex[perm]; !ok {
		return fmt.Errorf("%w: %s", ErrInvalidPermission, perm)
	}
	return nil
}

func ValidatePermissionString(perm string) error {
	return ValidatePermission(Permission(perm))
}

func PermissionAppliesAtScope(perm Permission, scope PermissionScope) bool {
	meta, ok := permissionIndex[perm]
	return ok && slices.Contains(meta.Scopes, scope)
}

func PermissionsForScope(scope PermissionScope) []PermissionMetadata {
	var result []PermissionMetadata
	for _, p := range allPermissions {
		if slices.Contains(p.Scopes, scope) {
			result = append(result, p)
		}
	}
	return result
}

func PermissionsForCategory(category PermissionCategory) []PermissionMetadata {
	var result []PermissionMetadata
	for _, p := range allPermissions {
		if p.Category == category {
			result = append(result, p)
		}
	}
	return result
}

// DefaultEveryonePermissions returns ordinary server-scope capabilities shared
// by every authenticated user. Attachments remain fresh-seed-only for backward
// compatibility with deployments that deliberately did not receive that later
// default.
func DefaultEveryonePermissions() []Permission {
	return []Permission{
		PermUserDeleteSelf,
		PermRoomList,
		PermRoomJoin,
		PermMessagePost,
		PermMessagePostInThread,
		PermMessageVoice,
		PermMessageReact,
		PermMessageEcho,
	}
}

func DefaultSeedEveryonePermissions() []Permission {
	return append(DefaultEveryonePermissions(), PermMessageAttach)
}

// DefaultModeratorPermissions contains only moderation-specific capabilities;
// Moderator inherits ordinary member capabilities from everyone.
func DefaultModeratorPermissions() []Permission {
	return []Permission{
		PermRoomRemoveMember,
		PermRoomMemberBan,
		PermRoomLock,
		PermRoomBypassLock,
		PermMessageDeleteOthers,
	}
}

// DefaultAdminPermissions is intentionally explicit. Adding a permission to the
// catalog must never silently grant it to Admin. Purging room history remains
// excluded from the default delegated-administrator baseline.
func DefaultAdminPermissions() []Permission {
	return []Permission{
		PermServerManage,
		PermRoomCreate,
		PermRoomList,
		PermRoomJoin,
		PermRoomManage,
		PermRoomRemoveMember,
		PermRoomMemberBan,
		PermRoomLock,
		PermRoomBypassLock,
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
}

func DefaultOwnerPermissions() []Permission { return nil }

func DefaultRoomEveryonePermissions() []Permission { return nil }

func DefaultAnnouncementsEveryonePermissions() []Permission { return nil }

func DefaultAnnouncementsEveryoneDenials() []Permission {
	return []Permission{PermMessagePost}
}

func DefaultAnnouncementsPosterPermissions() []Permission { return nil }

func DefaultRoomModeratorPermissions() []Permission { return nil }

func DefaultRoomAdminPermissions() []Permission { return nil }

// PermissionKeyParts holds the verb and objectType components for KV key generation.
type PermissionKeyParts struct {
	Verb       string
	ObjectType string
}

func parseKeyParts(perm string) PermissionKeyParts {
	objectType, verb, ok := strings.Cut(perm, ".")
	if !ok {
		return PermissionKeyParts{}
	}
	return PermissionKeyParts{Verb: verb, ObjectType: objectType}
}

func init() {
	for _, p := range allPermissions {
		parts := parseKeyParts(string(p.Permission))
		if parts.Verb == "" || parts.ObjectType == "" {
			panic(fmt.Sprintf("permission %q does not follow {objectType}.{verb} format", p.Permission))
		}
		if strings.Contains(parts.Verb, ".") {
			panic(fmt.Sprintf("permission %q has nested dots — verb %q must use dashes instead", p.Permission, parts.Verb))
		}
	}
}

func GetPermissionKeyParts(perm Permission) PermissionKeyParts {
	return parseKeyParts(string(perm))
}

func (p Permission) KeyParts() PermissionKeyParts {
	return parseKeyParts(string(p))
}

func ReconstructPermission(verb, objectType string) Permission {
	perm := Permission(objectType + "." + verb)
	if _, ok := permissionIndex[perm]; ok {
		return perm
	}
	return ""
}
