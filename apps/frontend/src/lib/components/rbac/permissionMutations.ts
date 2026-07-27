import type { PermissionAPI, PermissionState } from '$lib/api-client/permissions';
import * as m from '$lib/i18n/messages';
import { localizedErrorMessage } from '$lib/i18n/localizedError';

export type { PermissionState };

export type MutationScope =
  | { tier: 'server'; roleName: string }
  | { tier: 'group'; roleName: string; groupId: string }
  | { tier: 'room'; roleName: string; roomId: string };

export async function setRolePermission(
  api: PermissionAPI,
  scope: MutationScope,
  permission: string,
  newState: PermissionState
): Promise<{ error?: string }> {
  try {
    await api.setRolePermission({
      roleName: scope.roleName,
      scope,
      permission,
      state: newState
    });
    return {};
  } catch (error) {
    return { error: localizedErrorMessage(error, m['rbac.permissions.update_failed']()) };
  }
}
