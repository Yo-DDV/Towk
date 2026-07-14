import { Code, ConnectError } from '@connectrpc/connect';
import { SvelteMap } from 'svelte/reactivity';
import type { CreateMessageResult, PreparedMessageInput } from '$lib/api-client/messages';
import {
  deleteQueuedMessage,
  encryptedPrivateData,
  listQueuedMessages,
  saveQueuedMessage,
  type PrivateDataScope,
  type QueuedMessage
} from './offlineData';
import { OUTBOX_SYNC_TAG } from './outboxPolicy';

export { OUTBOX_SYNC_TAG };
const MAX_AUTOMATIC_ATTEMPTS = 12;
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000, 30 * 60_000] as const;

export type OutboxFailureKind = 'retryable' | 'authentication' | 'permanent';

export type OutboxSentDetail = {
  scope: PrivateDataScope;
  message: QueuedMessage;
  result: CreateMessageResult;
};

export type OutboxSummary = {
  queued: number;
  needsAttention: number;
  syncing: boolean;
};

type SendQueuedMessage = (input: PreparedMessageInput) => Promise<CreateMessageResult>;

function scopeIdentity(scope: PrivateDataScope): string {
  return `${scope.serverId}\u0000${scope.serverUrl}\u0000${scope.userId}`;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ConnectError) return `${error.code}: ${error.rawMessage || error.message}`;
  if (error instanceof Error) return error.message.slice(0, 300);
  return 'Unknown send failure';
}

export function classifyOutboxFailure(error: unknown): OutboxFailureKind {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'retryable';
  if (error instanceof TypeError) return 'retryable';
  if (!(error instanceof ConnectError)) return 'permanent';

  if (error.code === Code.Unauthenticated || error.code === Code.PermissionDenied) {
    return 'authentication';
  }
  if (
    error.code === Code.Unavailable ||
    error.code === Code.DeadlineExceeded ||
    error.code === Code.Aborted ||
    error.code === Code.ResourceExhausted ||
    error.code === Code.Unknown
  ) {
    return 'retryable';
  }
  return 'permanent';
}

function nextRetryAt(attemptCount: number, now: number): number {
  const delay = RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
  return now + delay;
}

async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const sync = (
    registration as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
    }
  ).sync;
  await sync?.register(OUTBOX_SYNC_TAG);
}

export class PwaOutbox extends EventTarget {
  summary = $state<OutboxSummary>({ queued: 0, needsAttention: 0, syncing: false });
  #flushes = new SvelteMap<string, Promise<void>>();
  #scopes = new SvelteMap<string, PrivateDataScope>();

  #remember(scopes: PrivateDataScope[]): void {
    for (const scope of scopes) this.#scopes.set(scopeIdentity(scope), scope);
  }

  async queue(scope: PrivateDataScope, input: PreparedMessageInput): Promise<void> {
    this.#remember([scope]);
    if (!input.clientRequestId) throw new TypeError('Queued messages require client_request_id');
    void encryptedPrivateData.requestPersistentStorage().catch(() => false);
    const now = Date.now();
    await saveQueuedMessage(scope, {
      ...input,
      queuedAt: now,
      attemptCount: 0,
      nextAttemptAt: now,
      state: 'queued',
      lastError: null
    });
    void requestBackgroundSync().catch(() => undefined);
    await this.refresh([scope]);
    this.dispatchEvent(new Event('change'));
  }

  async refresh(scopes: PrivateDataScope[]): Promise<void> {
    this.#remember(scopes);
    let queued = 0;
    let needsAttention = 0;
    for (const scope of this.#scopes.values()) {
      const records = await listQueuedMessages(scope).catch(() => []);
      for (const record of records) {
        if (record.value.state === 'needs_attention') needsAttention += 1;
        else queued += 1;
      }
    }
    this.summary = { ...this.summary, queued, needsAttention };
  }

  flush(
    scope: PrivateDataScope,
    send: SendQueuedMessage,
    options: { force?: boolean; now?: number } = {}
  ): Promise<void> {
    this.#remember([scope]);
    const key = scopeIdentity(scope);
    const current = this.#flushes.get(key);
    if (current) return current;
    const flush = this.#flush(scope, send, options).finally(() => {
      if (this.#flushes.get(key) === flush) this.#flushes.delete(key);
    });
    this.#flushes.set(key, flush);
    return flush;
  }

  async retry(scope: PrivateDataScope, clientRequestId: string): Promise<void> {
    this.#remember([scope]);
    const record = (await listQueuedMessages(scope)).find(
      (candidate) => candidate.value.clientRequestId === clientRequestId
    );
    if (!record) return;
    await saveQueuedMessage(scope, {
      ...record.value,
      state: 'queued',
      attemptCount: 0,
      nextAttemptAt: Date.now(),
      lastError: null
    });
    await this.refresh([scope]);
    this.dispatchEvent(new Event('change'));
  }

  async discard(scope: PrivateDataScope, clientRequestId: string): Promise<void> {
    await deleteQueuedMessage(scope, clientRequestId);
    await this.refresh([scope]);
    this.dispatchEvent(new Event('change'));
  }

  async #flush(
    scope: PrivateDataScope,
    send: SendQueuedMessage,
    options: { force?: boolean; now?: number }
  ): Promise<void> {
    const now = options.now ?? Date.now();
    this.summary = { ...this.summary, syncing: true };
    this.dispatchEvent(new Event('change'));
    try {
      const records = (await listQueuedMessages(scope)).sort(
        (a, b) =>
          a.value.queuedAt - b.value.queuedAt ||
          a.value.clientRequestId.localeCompare(b.value.clientRequestId)
      );
      for (const record of records) {
        const queued = record.value;
        if (!options.force && (queued.state !== 'queued' || queued.nextAttemptAt > now)) continue;
        try {
          const result = await send(queued);
          await deleteQueuedMessage(scope, queued.clientRequestId);
          this.dispatchEvent(
            new CustomEvent<OutboxSentDetail>('sent', {
              detail: { scope, message: queued, result }
            })
          );
        } catch (error) {
          const failure = classifyOutboxFailure(error);
          const attemptCount = queued.attemptCount + 1;
          const needsAttention = failure !== 'retryable' || attemptCount >= MAX_AUTOMATIC_ATTEMPTS;
          await saveQueuedMessage(scope, {
            ...queued,
            attemptCount,
            nextAttemptAt: needsAttention ? queued.nextAttemptAt : nextRetryAt(attemptCount, now),
            state: needsAttention ? 'needs_attention' : 'queued',
            lastError: safeErrorMessage(error)
          });
          if (failure === 'authentication' || failure === 'retryable') break;
        }
      }
    } finally {
      this.summary = { ...this.summary, syncing: false };
      await this.refresh([scope]);
      this.dispatchEvent(new Event('change'));
    }
  }
}

export const pwaOutbox = new PwaOutbox();
