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
  const record = await encryptedPrivateData.get<PersistedDraft>(
    scope,
    'draft',
    draftLogicalKey(roomId, threadRootEventId)
  );
  return record?.value ?? null;
}

export async function savePersistedDraft(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId: string | null | undefined,
  draft: PersistedDraft
): Promise<void> {
  const key = draftLogicalKey(roomId, threadRootEventId);
  if (!draft.text) {
    await encryptedPrivateData.delete(scope, 'draft', key);
    return;
  }
  await encryptedPrivateData.put(scope, 'draft', key, draft);
}

export function deletePersistedDraft(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId?: string | null
): Promise<void> {
  return encryptedPrivateData.delete(scope, 'draft', draftLogicalKey(roomId, threadRootEventId));
}

export function loadPersistedDraftFiles(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId?: string | null
): Promise<File[]> {
  return encryptedDraftFiles.get(scope, draftLogicalKey(roomId, threadRootEventId));
}

export function savePersistedDraftFiles(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId: string | null | undefined,
  files: File[]
): Promise<void> {
  return encryptedDraftFiles.put(scope, draftLogicalKey(roomId, threadRootEventId), files);
}

export function deletePersistedDraftFiles(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId?: string | null
): Promise<void> {
  return encryptedDraftFiles.delete(scope, draftLogicalKey(roomId, threadRootEventId));
}

export async function purgeOfflineAccount(scope: PrivateDataScope): Promise<void> {
  await Promise.all([
    encryptedPrivateData.purgeAccount(scope),
    encryptedDraftFiles.purgeAccount(scope)
  ]);
}

export async function loadCachedTimeline(
  scope: PrivateDataScope,
  roomId: string,
  threadRootEventId?: string | null
): Promise<CachedTimeline | null> {
  const record = await encryptedPrivateData.get<CachedTimeline>(
    scope,
    'timeline',
    timelineLogicalKey(roomId, threadRootEventId)
  );
  return record?.value ?? null;
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
  await encryptedPrivateData.put(
    scope,
    'timeline',
    timelineLogicalKey(timeline.roomId, timeline.threadRootEventId),
    { ...timeline, events: boundedEvents }
  );
}

export function listQueuedMessages(
  scope: PrivateDataScope
): Promise<PrivateDataRecord<QueuedMessage>[]> {
  return encryptedPrivateData.list<QueuedMessage>(scope, 'outbox');
}

export function saveQueuedMessage(scope: PrivateDataScope, message: QueuedMessage): Promise<void> {
  return encryptedPrivateData.put(scope, 'outbox', message.clientRequestId, message);
}

export function deleteQueuedMessage(
  scope: PrivateDataScope,
  clientRequestId: string
): Promise<void> {
  return encryptedPrivateData.delete(scope, 'outbox', clientRequestId);
}

export { encryptedPrivateData };
export type { PrivateDataScope };
