import type { ServerRole } from '$lib/api-client/roles';
import type { RoomMember } from '$lib/state/room/members.svelte';

export type MemberRoleSection = {
  role: ServerRole;
  members: RoomMember[];
};

export function safeRoleColor(color: string | null | undefined): string | null {
  if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) return null;
  return color.toUpperCase();
}

export function displayRoleForMember(
  member: RoomMember,
  rolesByName: ReadonlyMap<string, ServerRole>
): ServerRole | null {
  let selected: ServerRole | null = null;
  for (const roleName of member.roles ?? []) {
    if (roleName === 'everyone') continue;
    const role = rolesByName.get(roleName);
    if (!role || !safeRoleColor(role.color)) continue;
    if (!selected || role.position > selected.position) selected = role;
  }
  return selected;
}

export function groupMembersByDisplayRole(
  members: RoomMember[],
  roles: ServerRole[]
): { sections: MemberRoleSection[]; ungrouped: RoomMember[] } {
  const rolesByName = new Map(roles.map((role) => [role.name, role]));
  const membersByRole = new Map<string, RoomMember[]>();
  const ungrouped: RoomMember[] = [];

  for (const member of members) {
    const role = displayRoleForMember(member, rolesByName);
    if (!role) {
      ungrouped.push(member);
      continue;
    }
    const group = membersByRole.get(role.name);
    if (group) group.push(member);
    else membersByRole.set(role.name, [member]);
  }

  const sections = roles
    .filter((role) => role.name !== 'everyone' && membersByRole.has(role.name))
    .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name))
    .map((role) => ({ role, members: membersByRole.get(role.name)! }));

  return { sections, ungrouped };
}
