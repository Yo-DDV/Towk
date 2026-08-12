package core

import "slices"

const (
	// RoleHelper is the stable identifier for Towk's built-in community helper grade.
	RoleHelper = "helper"

	// RoleColorHelper is the default display accent for Helper.
	RoleColorHelper = "#0891B2"
)

const (
	GradeTemplateMembersV1   = "members.v1"
	GradeTemplateHelperV1    = "helper.v1"
	GradeTemplateModeratorV1 = "moderator.v1"
	GradeTemplateAdminV2     = "admin.v2"
)

// GradeTemplate is a versioned server-scope permission baseline. Templates
// intentionally contain only explicit decisions contributed by the grade;
// ordinary capabilities inherited from everyone are not duplicated.
type GradeTemplate struct {
	ID          string
	RoleName    string
	Permissions []Permission
	Pingable    bool
	Color       string
}

// IsDefaultSystemGrade extends the historical system-role predicate with the
// Helper grade introduced by the default-grade catalog.
func IsDefaultSystemGrade(roleName string) bool {
	return roleName == RoleHelper || IsSystemRole(roleName)
}

// DefaultHelperPermissions returns the explicit permissions contributed by
// Helper. Helpers inherit Members and intentionally receive no moderation or
// administration capability by default.
func DefaultHelperPermissions() []Permission {
	return nil
}

// DefaultGradeTemplates returns detached template values so callers cannot
// mutate the canonical baselines.
func DefaultGradeTemplates() []GradeTemplate {
	return []GradeTemplate{
		{
			ID:          GradeTemplateMembersV1,
			RoleName:    RoleEveryone,
			Permissions: slices.Clone(DefaultSeedEveryonePermissions()),
			Pingable:    false,
			Color:       "",
		},
		{
			ID:          GradeTemplateHelperV1,
			RoleName:    RoleHelper,
			Permissions: slices.Clone(DefaultHelperPermissions()),
			Pingable:    true,
			Color:       RoleColorHelper,
		},
		{
			ID:          GradeTemplateModeratorV1,
			RoleName:    RoleModerator,
			Permissions: slices.Clone(DefaultModeratorPermissions()),
			Pingable:    true,
			Color:       RoleColorModerator,
		},
		{
			ID:          GradeTemplateAdminV2,
			RoleName:    RoleAdmin,
			Permissions: slices.Clone(DefaultAdminPermissions()),
			Pingable:    false,
			Color:       RoleColorAdmin,
		},
	}
}

// GradeTemplateByID returns a detached template matching id.
func GradeTemplateByID(id string) (GradeTemplate, bool) {
	for _, template := range DefaultGradeTemplates() {
		if template.ID == id {
			return template, true
		}
	}
	return GradeTemplate{}, false
}
