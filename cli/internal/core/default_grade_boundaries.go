package core

// Register the granular moderation permissions in the same unconditional DM
// privacy boundary as their broader legacy counterparts.
func init() {
	dmBoundaryDeniedPermissions[PermRoomRemoveMember] = true
	dmBoundaryDeniedPermissions[PermMessageDeleteOthers] = true
}
