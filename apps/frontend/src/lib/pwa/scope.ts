import type { RegisteredServer } from '$lib/state/server/registry.svelte';
import type { PrivateDataScope } from './privateData';

export function privateDataScopeForServer(
  server: RegisteredServer | null | undefined
): PrivateDataScope | null {
  if (!server?.userId) return null;
  return {
    serverId: server.id,
    serverUrl: server.url,
    userId: server.userId
  };
}
