import * as m from '$lib/i18n/messages';
import { g } from '$lib/i18n/gradeMessages.svelte';

export type SystemRoleName = 'owner' | 'admin' | 'moderator' | 'helper' | 'everyone';
export type RbacDecisionState = 'allow' | 'deny' | 'neutral';
export type RbacScopeKind = 'SERVER' | 'GROUP' | 'ROOM';

const SYSTEM_ROLE_NAMES = new Set<SystemRoleName>([
  'owner',
  'admin',
  'moderator',
  'helper',
  'everyone'
]);

const SYSTEM_ROLE_PRIORITY: Record<SystemRoleName, number> = {
  owner: 5,
  admin: 4,
  moderator: 3,
  helper: 2,
  everyone: 0
};

export function isSystemRoleName(roleName: string): roleName is SystemRoleName {
  return SYSTEM_ROLE_NAMES.has(roleName as SystemRoleName);
}

/** Display-only priority. Authorization never depends on role order. */
export function roleDisplayPriority(roleName: string, position = 0): number {
  if (isSystemRoleName(roleName)) return SYSTEM_ROLE_PRIORITY[roleName] * 10_000;
  return 10_000 + position;
}

export function localizedRoleDisplayName(roleName: string, fallback?: string | null): string {
  if (roleName === 'owner') return m['rbac.system_roles.owner.display_name']();
  if (roleName === 'admin') return m['rbac.system_roles.admin.display_name']();
  if (roleName === 'moderator') return m['rbac.system_roles.moderator.display_name']();
  if (roleName === 'helper') return g['grades.system_roles.helper.display_name']();
  if (roleName === 'everyone') return m['rbac.system_roles.everyone.display_name']();
  return fallback || roleName;
}

export function localizedRoleDescription(roleName: string, fallback?: string | null): string {
  if (roleName === 'owner') return m['rbac.system_roles.owner.description']();
  if (roleName === 'admin') return m['rbac.system_roles.admin.description']();
  if (roleName === 'moderator') return m['rbac.system_roles.moderator.description']();
  if (roleName === 'helper') return g['grades.system_roles.helper.description']();
  if (roleName === 'everyone') return m['rbac.system_roles.everyone.description']();
  return fallback || '';
}

export function localizedDecisionState(state: RbacDecisionState): string {
  if (state === 'allow') return m['rbac.permissions.state_allow']();
  if (state === 'deny') return m['rbac.permissions.state_deny']();
  return m['rbac.permissions.state_neutral']();
}

export function localizedScopeKind(kind: RbacScopeKind): string {
  if (kind === 'SERVER') return m['rbac.permissions.level_server']();
  if (kind === 'GROUP') return m['rbac.permissions.level_group']();
  return m['rbac.permissions.level_room']();
}

export function localizedScopeLabel(scope: { kind: RbacScopeKind; label: string }): string {
  if (scope.kind === 'SERVER') return m['rbac.permissions.level_server']();
  return scope.label;
}

export function localizedSubjectKind(subjectKind: string): string {
  if (subjectKind === 'user') return m['rbac.permissions.subject_user']();
  if (subjectKind === 'role') return m['rbac.permissions.subject_role']();
  return m['rbac.permissions.subject_generic']();
}
