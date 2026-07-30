import { serverRegistry } from '$lib/state/server/registry.svelte';
import type { AppUiState } from '$lib/state/appUi.svelte';
import type { ServerStateStore } from '$lib/state/server/store.svelte';
import type { VoiceCallState } from '$lib/state/server/voiceCall.svelte';

type GlobalCallStore = Pick<ServerStateStore, 'rooms' | 'serverInfo'> & {
  voiceCall: VoiceCallState;
};

type GlobalCallRegistry = {
  servers: Array<{ id: string; name?: string | null }>;
  tryGetStore: (serverId: string) => GlobalCallStore | undefined;
};

export type GlobalCallPhase = 'joining' | 'connected' | 'reconnecting';

export type GlobalCallSession = {
  serverId: string;
  roomId: string;
  callId: string | null;
  phase: GlobalCallPhase;
  store: GlobalCallStore;
};

/**
 * Project the one local call session without coupling it to the active route.
 *
 * The returned store is an observation only. Command handlers must call
 * `resolveCurrentGlobalCallStore` again so an auth refresh or server removal
 * cannot leave a stale control surface targeting a disposed store.
 */
export function resolveGlobalCallSession(
  registry: GlobalCallRegistry = serverRegistry
): GlobalCallSession | null {
  let selected: GlobalCallSession | null = null;

  for (const server of registry.servers) {
    const store = registry.tryGetStore(server.id);
    if (!store) continue;

    const voiceCall = store.voiceCall;
    const roomId = voiceCall.targetRoomId;
    if (!voiceCall.isInAnyCall || !roomId) continue;

    const candidate: GlobalCallSession = {
      serverId: server.id,
      roomId,
      callId: voiceCall.callId,
      phase: voiceCall.reconnecting
        ? 'reconnecting'
        : voiceCall.connected
          ? 'connected'
          : 'joining',
      store
    };

    if (!selected || callPhaseRank(candidate.phase) > callPhaseRank(selected.phase)) {
      selected = candidate;
    }
  }

  return selected;
}

export function resolveCurrentGlobalCallStore(
  session: GlobalCallSession,
  registry: GlobalCallRegistry = serverRegistry
): GlobalCallStore | null {
  const store = registry.tryGetStore(session.serverId);
  if (!store || store !== session.store) return null;
  if (!store.voiceCall.isInAnyCall || store.voiceCall.targetRoomId !== session.roomId) return null;
  if (store.voiceCall.callId !== session.callId) return null;
  return store;
}

/**
 * End the exact current session and return its room UI to Messages.
 *
 * Resolving the store again fences stale dock and Media Session actions from
 * affecting a replacement call. The surface changes before the asynchronous
 * leave settles so the local UI never exposes a dead call grid.
 */
export async function leaveGlobalCallSession(
  session: GlobalCallSession,
  appUi: Pick<AppUiState, 'resetRoomPrimarySurface'>,
  registry: GlobalCallRegistry = serverRegistry
): Promise<boolean> {
  const store = resolveCurrentGlobalCallStore(session, registry);
  if (!store) return false;

  appUi.resetRoomPrimarySurface(session.serverId, session.roomId);
  await store.voiceCall.leave();
  return true;
}

function callPhaseRank(phase: GlobalCallPhase): number {
  switch (phase) {
    case 'connected':
      return 3;
    case 'reconnecting':
      return 2;
    case 'joining':
      return 1;
  }
}
