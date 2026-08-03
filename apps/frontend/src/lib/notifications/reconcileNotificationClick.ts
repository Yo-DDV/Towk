import { serverRegistry } from '$lib/state/server/registry.svelte';

/**
 * Consume an application-owned native notification click in the foreground.
 *
 * The service worker separately attempts the same dismissal using its push
 * subscription proof so clicks also converge when no authenticated window is
 * open. This foreground path gives the active SPA an immediate optimistic
 * update, then reloads the two authoritative projections that render the
 * notification center and per-room badges.
 */
export async function reconcileNotificationClick(notificationId?: string): Promise<boolean> {
  if (!notificationId) return true;

  const originServer = serverRegistry.originServer;
  if (!originServer) return false;

  const stores = serverRegistry.tryGetStore(originServer.id);
  if (!stores?.isAuthenticated) return false;

  const dismissed = await stores.notifications.dismissById(notificationId);
  await Promise.allSettled([
    stores.notifications.fetch(),
    stores.rooms.refreshNotificationCounts()
  ]);
  return dismissed;
}
