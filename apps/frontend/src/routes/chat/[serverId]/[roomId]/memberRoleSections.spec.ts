import { describe, expect, it } from 'vitest';
import type { ServerRole } from '$lib/api-client/roles';
import type { RoomMember } from '$lib/state/room/members.svelte';
import { PresenceStatus } from '$lib/render/types';
import { groupMembersByDisplayRole, safeRoleColor } from './memberRoleSections';

function role(name: string, displayName: string, position: number, color: string): ServerRole {
  return {
    name,
    displayName,
    description: '',
    permissions: [],
    permissionDenials: [],
    isSystem: ['owner', 'admin', 'moderator', 'helper', 'everyone'].includes(name),
    position,
    pingable: false,
    color
  };
}

function member(id: string, roles: string[]): RoomMember {
  return {
    id,
    login: id,
    displayName: id,
    presenceStatus: PresenceStatus.Online,
    roles
  };
}

describe('groupMembersByDisplayRole', () => {
  it('places each member once under the structurally highest default grade', () => {
    const result = groupMembersByDisplayRole(
      [
        member('alice', ['everyone', 'helper', 'owner']),
        member('boris', ['helper', 'moderator']),
        member('cora', ['everyone']),
        member('dina', ['unknown'])
      ],
      [
        role('everyone', 'Everyone', 0, ''),
        role('helper', 'Helper', 50, '#0891B2'),
        role('moderator', 'Moderator', 100, '#16A34A'),
        role('owner', 'Owner', 1000, '#F97316')
      ]
    );

    expect(result.sections.map((section) => section.role.name)).toEqual(['owner', 'moderator']);
    expect(result.sections[0]?.members.map((item) => item.id)).toEqual(['alice']);
    expect(result.sections[1]?.members.map((item) => item.id)).toEqual(['boris']);
    expect(result.ungrouped.map((item) => item.id)).toEqual(['cora', 'dina']);
    expect(
      result.sections
        .flatMap((section) => section.members)
        .concat(result.ungrouped)
        .map((item) => item.id)
    ).toHaveLength(4);
  });

  it('keeps Helper above a custom visual role regardless of numeric position', () => {
    const result = groupMembersByDisplayRole(
      [member('alice', ['helper', 'vip'])],
      [role('helper', 'Helper', 50, '#0891B2'), role('vip', 'VIP', 899, '#DB2777')]
    );

    expect(result.sections.map((section) => section.role.name)).toEqual(['helper']);
    expect(result.sections[0]?.members.map((item) => item.id)).toEqual(['alice']);
  });

  it('rejects non-canonical colors before they reach inline CSS', () => {
    expect(safeRoleColor('#a1B2c3')).toBe('#A1B2C3');
    expect(safeRoleColor('red')).toBeNull();
    expect(safeRoleColor('url(javascript:alert(1))')).toBeNull();
    expect(safeRoleColor('')).toBeNull();
  });
});
