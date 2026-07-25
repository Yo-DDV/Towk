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

const PROFILE_ACTION_TARGET_TIMEOUT_MS = 2_000;

export async function ensureDMWith(serverId: string, userId: string): Promise<PublicRoom | null> {
  const conn = serverConnectionManager.getClient(serverId);
  return createRoomCommandAPI({
    serverId,
    baseUrl: conn.connectBaseUrl,
    bearerToken: conn.bearerToken
  }).startDM([userId]);
}

async function navigateToDM(serverId: string, roomId: string): Promise<void> {
  await goto(
    resolve('/chat/[serverId]/[roomId]', {
      serverId: serverIdToSegment(serverId),
      roomId
    })
  );
}

function nextAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
  }
  return new Promise((resolveFrame) => setTimeout(resolveFrame, 16));
}

/** Focus the active room composer after navigation and component mounting settle. */
export async function focusActiveMessageComposer(
  timeoutMs = PROFILE_ACTION_TARGET_TIMEOUT_MS
): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    const composer =
      document.querySelector<HTMLElement>(
        '[data-testid="room-view-region"] [data-testid="message-input"]'
      ) ?? document.querySelector<HTMLElement>('[data-testid="message-input"]');
    if (composer) {
      const disabled =
        ((composer instanceof HTMLInputElement || composer instanceof HTMLTextAreaElement) &&
          composer.disabled) ||
        composer.getAttribute('aria-disabled') === 'true';
      if (!disabled) {
        composer.focus({ preventScroll: true });
        if (document.activeElement === composer) return true;
      }
    }
    await nextAnimationFrame();
  } while (Date.now() <= deadline);

  return false;
}

/** Activate the real call control after the DM call panel has mounted. */
export async function activateActiveCallControl(
  timeoutMs = PROFILE_ACTION_TARGET_TIMEOUT_MS
): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    const callButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="call-join-button"]'
    );
    if (callButton && !callButton.disabled && callButton.getAttribute('aria-disabled') !== 'true') {
      callButton.focus({ preventScroll: true });
      callButton.click();
      return true;
    }
    await nextAnimationFrame();
  } while (Date.now() <= deadline);

  return false;
}

/** Start a DM conversation, navigate to it, and place the caret in the composer. */
export async function startDMWith(serverId: string, userId: string): Promise<void> {
  const room = await ensureDMWith(serverId, userId);
  if (!room) return;

  await navigateToDM(serverId, room.id);
  await focusActiveMessageComposer();
}

/** Start or open a DM, expose its call panel, then activate the existing join/start flow. */
export async function startCallWith(serverId: string, userId: string): Promise<void> {
  const room = await ensureDMWith(serverId, userId);
  if (!room) return;

  setRoomSidebarPanel(serverId, room.id, 'call');
  setPendingRoomSidebarPanel(serverId, room.id, 'call');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: serverStorageKey(serverId, roomSidebarPanelStorageSuffix(room.id)),
        newValue: 'call'
      })
    );
  }

  await navigateToDM(serverId, room.id);
  await activateActiveCallControl();
}
