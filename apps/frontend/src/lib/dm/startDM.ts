import { serverConnectionManager } from '$lib/state/server/serverConnection.svelte';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { serverIdToSegment } from '$lib/navigation';
import { createRoomCommandAPI, type PublicRoom } from '$lib/api-client/rooms';
import {
  roomSidebarPanelStorageSuffix,
  setPendingRoomSidebarPanel,
  setRoomSidebarPanel
} from '$lib/storage/roomSidebarPanel';
import { serverStorageKey } from '$lib/storage/serverStorage';

export async function ensureDMWith(serverId: string, userId: string): Promise<PublicRoom | null> {
  const conn = serverConnectionManager.getClient(serverId);
  return createRoomCommandAPI({
    serverId,
    baseUrl: conn.connectBaseUrl,
    bearerToken: conn.bearerToken
  }).startDM([userId]);
}

function navigateToDM(serverId: string, roomId: string): void {
  goto(
    resolve('/chat/[serverId]/[roomId]', {
      serverId: serverIdToSegment(serverId),
      roomId
    })
  );
}

/** Start a DM conversation with a user and navigate to it. */
export async function startDMWith(serverId: string, userId: string): Promise<void> {
  const room = await ensureDMWith(serverId, userId);
  if (room) navigateToDM(serverId, room.id);
}

/** Start or open a DM, then expose its call panel for an immediate call. */
export async function startCallWith(serverId: string, userId: string): Promise<void> {
  const room = await ensureDMWith(serverId, userId);
  if (!room) return;

  setRoomSidebarPanel(serverId, room.id, 'call');
  setPendingRoomSidebarPanel(serverId, room.id, 'call');
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: serverStorageKey(serverId, roomSidebarPanelStorageSuffix(room.id)),
      newValue: 'call'
    })
  );
  navigateToDM(serverId, room.id);
}
