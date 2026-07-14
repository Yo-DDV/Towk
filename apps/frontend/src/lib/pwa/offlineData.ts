import type { PreparedMessageInput } from '$lib/api-client/messages';
import type { RoomEventView } from '$lib/render/types';
import { encryptedPrivateData, type PrivateDataRecord, type PrivateDataScope } from './privateData';
import { encryptedDraftFiles } from './draftFiles';

export type PersistedDraft = {
  text: string;
  richMode: boolean;
};

export type CachedTimeline = {
  roomId: string;
  threadRootEventId: string | null;
  events: RoomEventView[];
  cachedAt: number;
};

export type OutboxState = 'queued' | 'needs_attention';

export type QueuedMessage = PreparedMessageInput & {
  queuedAt: number;
  attemptCount: number;
  nextAttemptAt: number;
  state: OutboxState;
  lastError: string | null;
};

const TIMELINE_EVENT_LIMIT = 100;
const inactiveAccounts = new Set<string>();
const inFlightWrites = new Map<string, Set<Promise<unknown>>>();
const desiredAccountState = new Map<string, boolean>();
const lifecycleQueues = new Map<string, Promise<void>>();
const lifecycleChannel =
  typeof window === 'undefined' || typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel('towk-private-data');

function canonicalServerOrigin(serverUrl: string): string {
  try {
    return new URL(serverUrl).origin;
  } catch {
    return serverUrl;
  }
}

function accountIdentity(scope: PrivateDataScope): string {
  return `${scope.serverId}\u0000${canonicalServerOrigin(scope.serverUrl)}\u0000${scope.userId}`;
}

function accountIsActive(scope: PrivateDataScope): boolean {
  return !inactiveAccounts.has(accountIdentity(scope));
}

async function waitForActiveAccount(scope: PrivateDataScope): Promise<boolean> {
  const identity = accountIdentity(scope);
  const pending = lifecycleQueues.get(identity);
  if (pending && desiredAccountState.get(identity) === true) {
    try {
      await pending;
    } catch {
      return false;
    }
  }
  return desiredAccountState.get(identity) !== false && !inactiveAccounts.has(identity);
}

async function trackWrite<T>(scope: PrivateDataScope, operation: () => Promise<T>): Promise<T> {
  const identity = accountIdentity(scope);
  if (!(await waitForActiveAccount(scope)) || inactiveAccounts.has(identity)) {
    throw new Error('Encrypted local account storage is inactive');
  }

  let pending: Promise<T>;
  try {
    pending = operation();
  } catch (error) {
    pending = Promise.reject(error);
  }
  let accountWrites = inFlightWrites.get(identity);
  if (!accountWrites) {
    accountWrites = new Set();
    inFlightWrites.set(identity, accountWrites);
  }
  accountWrites.add(pending);
  const release = () => {
    accountWrites?.delete(pending);
    if (accountWrites?.size === 0) inFlightWrites.delete(identity);
  };
  void pending.then(release, release);
  return pending;
}

function enqueueAccountLifecycle(scope: PrivateDataScope, active: boolean): Promise<void> {
  const identity = accountIdentity(scope);
  desiredAccountState.set(identity, active);
  inactiveAccounts.add(identity);
  if (!active) lifecycleChannel?.postMessage({ type: 'deactivate', identity });

  const previous = lifecycleQueues.get(identity) ?? Promise.resolve();
  const lifecycle = previous
    .catch(() => undefined)
    .then(async () => {
      if (active) {
        await Promise.all([
          encryptedPrivateData.activateAccount(scope),
          encryptedDraftFiles.activateAccount(scope)
        ]);
        return;
      }
      const pending = [...(inFlightWrites.get(identity) ?? [])];
      if (pending.length > 0) await Promise.allSettled(pending);
      await Promise.all([
        encryptedPrivateData.purgeAccount(scope),
        encryptedDraftFiles.purgeAccount(scope)
      ]);
    });
  lifecycleQueues.set(identity, lifecycle);

  void lifecycle.then(
    () => {
      if (lifecycleQueues.get(identity) !== lifecycle) return;
      lifecycleQueues.delete(identity);
      if (desiredAccountState.get(identity) === true) {
        inactiveAccounts.delete(identity);
        lifecycleChannel?.postMessage({ type: 'activate', identity });
      }
    },
    () => {
      if (lifecycleQueues.get(identity) !== lifecycle) return;
      lifecycleQueues.delete(identity);
      inactiveAccounts.add(identity);
    }
  );
  return lifecycle;
}

if (lifecycleChannel) {
  lifecycleChannel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!event.data || typeof event.data !== 'object') return;
    const message = event.data as { type?: unknown; identity?: unknown };
    if (typeof message.identity !== 'string') return;
    if (message.type === 'deactivate') {
      desiredAccountState.set(message.identity, false);
      inactiveAccounts.add(message.identity);
    } else if (message.type === 'activate' && !lifecycleQueues.has(message.identity)) {
      desiredAccountState.set(message.identity, true);
      inactiveAccounts.delete(message.identity);
    }
  });
}

export function activateOfflineAccount(scope: PrivateDataScope): Promise<void> {
  return enqueueAccountLifecycle(scope, true);
}

export function draftLogicalKey(roomId: string, threadRootEventId?: string | null): string {
  return threadRootEventId ? `room:${roomId}:thread:${threadRootEventId}` : `room:${roomId}`;
}

export function timelineLogicalKey(roomId: string, threadRootEventId?: string | null): string {
  return threadRootEventId ? `room:${roomId}:thread:${threadRootEventId}` : `room:${roomId}`;
}

export async function loadPersistedDraft(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId?: string | null
): Promise<PersistedDraft | null> {
  if (!(await waitForActiveAccount(scope))) return null;
  const record = await encryptedPrivateData.get<PersistedDraft>(
    scope,
    'draft',
    draftLogicalKey(roomId, threadRootEventId)
  );
  return accountIsActive(scope) ? (record?.value ?? null) : null;
}

export async function savePersistedDraft(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId: string | null | undefined,
  draft: PersistedDraft
): Promise<void> {
  const key = draftLogicalKey(roomId, threadRootEventId);
  if (!draft.text) {
    if (desiredAccountState.get(accountIdentity(scope)) === false) return;
    await trackWrite(scope, () => encryptedPrivateData.delete(scope, 'draft', key));
    return;
  }
  await trackWrite(scope, () => encryptedPrivateData.put(scope, 'draft', key, draft));
}

export function deletePersistedDraft(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId?: string | null
): Promise<void> {
  if (desiredAccountState.get(accountIdentity(scope)) === false) return Promise.resolve();
  return trackWrite(scope, () =>
    encryptedPrivateData.delete(scope, 'draft', draftLogicalKey(roomId, threadRootEventId))
  );
}

export async function loadPersistedDraftFiles(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId?: string | null
): Promise<File[]> {
  if (!(await waitForActiveAccount(scope))) return [];
  const files = await encryptedDraftFiles.get(scope, draftLogicalKey(roomId, threadRootEventId));
  return accountIsActive(scope) ? files : [];
}

export function savePersistedDraftFiles(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId: string | null | undefined,
  files: File[]
): Promise<void> {
  if (files.length === 0 && desiredAccountState.get(accountIdentity(scope)) === false) {
    return Promise.resolve();
  }
  return trackWrite(scope, () =>
    encryptedDraftFiles.put(scope, draftLogicalKey(roomId, threadRootEventId), files)
  );
}

export function deletePersistedDraftFiles(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId?: string | null
): Promise<void> {
  if (desiredAccountState.get(accountIdentity(scope)) === false) return Promise.resolve();
  return trackWrite(scope, () =>
    encryptedDraftFiles.delete(scope, draftLogicalKey(roomId, threadRootEventId))
  );
}

export function purgeOfflineAccount(scope: PrivateDataScope): Promise<void> {
  return enqueueAccountLifecycle(scope, false);
}

export async function loadCachedTimeline(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId?: string | null
): Promise<CachedTimeline | null> {
  if (!(await waitForActiveAccount(scope))) return null;
  const record = await encryptedPrivateData.get<CachedTimeline>(
    scope,
    'timeline',
    timelineLogicalKey(roomId, threadRootEventId)
  );
  return accountIsActive(scope) ? (record?.value ?? null) : null;
}

export async function saveCachedTimeline(
  scope: PrivateDataScope,
  timeline: CachedTimeline
): Promise<void> {
  const root = timeline.threadRootEventId
    ? timeline.events.find((event) => event.id === timeline.threadRootEventId)
    : null;
  const recent = timeline.events.slice(-TIMELINE_EVENT_LIMIT);
  const boundedEvents =
    root && !recent.some((event) => event.id === root.id)
      ? [root, ...recent.slice(-(TIMELINE_EVENT_LIMIT - 1))]
      : recent;
  await trackWrite(scope, () =>
    encryptedPrivateData.put(
      scope,
      'timeline',
      timelineLogicalKey(timeline.roomId, timeline.threadRootEventId),
      { ...timeline, events: boundedEvents }
    )
  );
}

export async function listQueuedMessages(
  scope: PrivateDataScope
): Promise<PrivateDataRecord<QueuedMessage>[]> {
  if (!(await waitForActiveAccount(scope))) return [];
  const records = await encryptedPrivateData.list<QueuedMessage>(scope, 'outbox');
  return accountIsActive(scope) ? records : [];
}

export function saveQueuedMessage(scope: PrivateDataScope, message: QueuedMessage): Promise<void> {
  return trackWrite(scope, () =>
    encryptedPrivateData.put(scope, 'outbox', message.clientRequestId, message)
  );
}

export function deleteQueuedMessage(
  scope: PrivateDataScope,
  clientRequestId: string
): Promise<void> {
  if (desiredAccountState.get(accountIdentity(scope)) === false) return Promise.resolve();
  return trackWrite(scope, () => encryptedPrivateData.delete(scope, 'outbox', clientRequestId));
}

export { encryptedPrivateData };
export type { PrivateDataScope };
