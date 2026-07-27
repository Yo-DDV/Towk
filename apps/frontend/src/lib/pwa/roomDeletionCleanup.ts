import type { RegisteredServer } from '$lib/state/server/registry.svelte';
import { purgeOfflineRoom } from './offlineData';
import { privateDataScopeForServer } from './scope';
import type { PrivateDataScope } from './privateData';

export type PurgeOfflineRoom = (scope: PrivateDataScope, roomId: string) => Promise<void>;

export async function purgeDeletedRoomForServer(
  server: RegisteredServer | null | undefined,
  roomId: string,
  purge: PurgeOfflineRoom = purgeOfflineRoom
): Promise<void> {
  if (!roomId) return;
  const scope = privateDataScopeForServer(server);
  if (!scope) return;
  await purge(scope, roomId);
}
