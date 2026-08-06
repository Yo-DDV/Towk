/** Permission metadata used by tooltips, templates and explanation surfaces. */

import * as m from '$lib/i18n/messages';

export type PermissionMetadata = {
  description: () => string;
  risk: 'standard' | 'moderation' | 'sensitive' | 'destructive' | 'privilege';
  legacy?: boolean;
};

export const PERMISSION_METADATA: Record<string, PermissionMetadata> = {
  'server.manage': { description: m['rbac.permission_descriptions.server_manage'], risk: 'sensitive' },
  'room.create': { description: m['rbac.permission_descriptions.room_create'], risk: 'standard' },
  'room.join': { description: m['rbac.permission_descriptions.room_join'], risk: 'standard' },
  'room.list': { description: m['rbac.permission_descriptions.room_list'], risk: 'standard' },
  'room.remove-member': {
    description: m['grades.permission_descriptions.room_remove_member'],
    risk: 'moderation'
  },
  'room.manage': { description: m['rbac.permission_descriptions.room_manage'], risk: 'privilege' },
  'room.ban-member': {
    description: m['rbac.permission_descriptions.room_ban_member'],
    risk: 'moderation'
  },
  'room.lock': { description: m['grades.permission_descriptions.room_lock'], risk: 'moderation' },
  'room.purge-messages': {
    description: m['grades.permission_descriptions.room_purge_messages'],
    risk: 'destructive'
  },
  'room.bypass-lock': {
    description: m['grades.permission_descriptions.room_bypass_lock'],
    risk: 'moderation'
  },
  'message.post': { description: m['rbac.permission_descriptions.message_post'], risk: 'standard' },
  'message.post-in-thread': {
    description: m['rbac.permission_descriptions.message_post_in_thread'],
    risk: 'standard'
  },
  'message.attach': { description: m['rbac.permission_descriptions.message_attach'], risk: 'standard' },
  'message.voice': { description: m['rbac.permission_descriptions.message_voice'], risk: 'standard' },
  'message.delete-others': {
    description: m['grades.permission_descriptions.message_delete_others'],
    risk: 'moderation'
  },
  'message.manage': {
    description: m['rbac.permission_descriptions.message_manage'],
    risk: 'sensitive',
    legacy: true
  },
  'message.react': { description: m['rbac.permission_descriptions.message_react'], risk: 'standard' },
  'message.echo': { description: m['rbac.permission_descriptions.message_echo'], risk: 'standard' },
  'role.manage': { description: m['rbac.permission_descriptions.role_manage'], risk: 'privilege' },
  'role.assign': { description: m['rbac.permission_descriptions.role_assign'], risk: 'privilege' },
  'admin.view-users': {
    description: m['rbac.permission_descriptions.admin_view_users'],
    risk: 'sensitive'
  },
  'admin.view-audit': {
    description: m['rbac.permission_descriptions.admin_view_audit'],
    risk: 'sensitive'
  },
  'user.delete-any': {
    description: m['rbac.permission_descriptions.user_delete_any'],
    risk: 'destructive'
  },
  'user.delete-self': {
    description: m['rbac.permission_descriptions.user_delete_self'],
    risk: 'destructive'
  },
  'user.manage-accounts': {
    description: m['rbac.permission_descriptions.user_manage_accounts'],
    risk: 'privilege'
  },
  'user.manage-permissions': {
    description: m['rbac.permission_descriptions.user_manage_permissions'],
    risk: 'privilege'
  }
};

export function getPermissionDescription(id: string): string {
  return PERMISSION_METADATA[id]?.description() ?? id;
}

export function getPermissionRisk(id: string): PermissionMetadata['risk'] {
  return PERMISSION_METADATA[id]?.risk ?? 'sensitive';
}
