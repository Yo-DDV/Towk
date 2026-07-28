import { serverConnectionManager } from '$lib/state/server/serverConnection.svelte';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { serverIdToSegment } from '$lib/navigation';
import { createRoomCommandAPI, type PublicRoom } from '$lib/api-client/rooms';
import type { CallJoinController } from '$lib/state/callJoinController.svelte';

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

/** Start a DM conversation, navigate to it, and place the caret in the composer. */
export async function startDMWith(serverId: string, userId: string): Promise<void> {
  const room = await ensureDMWith(serverId, userId);
  if (!room) return;

  await navigateToDM(serverId, room.id);
  await focusActiveMessageComposer();
}

/** Resolve a DM and submit an explicit join intent without DOM polling or synthetic clicks. */
export async function startCallWith(
  serverId: string,
  userId: string,
  callJoinController: CallJoinController
): Promise<void> {
  const room = await ensureDMWith(serverId, userId);
  if (!room) return;

  await callJoinController.request({
    serverId,
    roomId: room.id,
    source: 'direct-message'
  });
}
