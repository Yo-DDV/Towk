import { page } from '$app/state';
import { segmentToServerId } from '$lib/navigation';
import { serverRegistry } from './server/registry.svelte';

/**
 * Returns the active server ID, derived from the URL `[serverId]` segment.
 * The global notification route preserves the server that opened it in shallow
 * page state so its channel sidebar can remain scoped without changing the URL.
 * Falls back to the origin server when neither source resolves.
 *
 * Reactive when called inside `$derived` / `$effect` / template — the
 * `page.params`, `page.state`, and `serverRegistry.originServer` reads track via
 * Svelte's normal reactivity. No context or cached global selection is needed.
 */
export function getActiveServer(): string {
  const routeServerId = segmentToServerId(page.params.serverId ?? '-');
  if (routeServerId) return routeServerId;

  const notificationServerId = page.state.notificationServerId;
  if (
    notificationServerId &&
    serverRegistry.tryGetStore(notificationServerId)?.isAuthenticated
  ) {
    return notificationServerId;
  }

  return serverRegistry.originServer?.id ?? '';
}
