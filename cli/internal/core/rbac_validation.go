package core

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// RBAC-engine-specific validation errors. Errors common with the rest of core
// (ErrInvalidRoleName, ErrRoleNotFound, ErrRoleAlreadyExists,
// ErrPermissionDenied, ErrCannotDeleteSystemRole, ErrInvalidPermission) live in
// core/errors.go and core/rbac.go.
var (
	// ErrCannotReorderSystemRole is returned when attempting to reorder a system role.
	ErrCannotReorderSystemRole = errors.New("cannot reorder system roles")
)

// roleNameRegex matches valid role names: must start with a lowercase letter,
// may contain lowercase letters / digits / dashes in the middle, must end
// with a lowercase letter or digit. 1-32 characters.
//
// Single-character names are explicitly allowed (e.g. "a"). The end-anchor
// rules out leading/trailing dashes ("-admin", "admin-") and the regex
// disallows underscores, dots, uppercase, and unicode.
var roleNameRegex = regexp.MustCompile(`^[a-z]([a-z0-9-]{0,30}[a-z0-9])?$`)
var roleColorRegex = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

const (
	RoleColorOwner     = "#F97316"
	RoleColorAdmin     = "#7C3AED"
	RoleColorModerator = "#16A34A"
)

var customRoleColors = [...]string{
	"#2563EB",
	"#7C3AED",
	"#DB2777",
	"#0891B2",
	"#0D9488",
	"#CA8A04",
}

// ValidateRoleName checks if a role name is valid.
// Valid names: lowercase letters / digits / dashes, starting with a letter,
// 1-32 characters, no leading or trailing dash.
func ValidateRoleName(name string) error {
	if !roleNameRegex.MatchString(name) {
		return ErrInvalidRoleName
	}
	return nil
}

func validateRoleMetadata(displayName, description string) error {
	if err := validateStringMaxCharacters("role display name", displayName, MaxRoleDisplayNameLength); err != nil {
		return err
	}
	if err := validateStringMaxLength("role description", description, MaxRoleDescriptionLength); err != nil {
		return err
	}
	return nil
}

func normalizeRoleColor(color string) (string, error) {
	if !roleColorRegex.MatchString(color) {
		return "", fmt.Errorf("%w: role color must use #RRGGBB format", ErrInvalidArgument)
	}
	return strings.ToUpper(color), nil
}

func defaultRoleColor(roleName string, position int32) string {
	switch roleName {
	case RoleOwner:
		return RoleColorOwner
	case RoleAdmin:
		return RoleColorAdmin
	case RoleModerator:
		return RoleColorModerator
	case RoleEveryone:
		return ""
	}
	index := int(position - PositionCustomFirst)
	if index < 0 {
		index = 0
	}
	return customRoleColors[index%len(customRoleColors)]
}
