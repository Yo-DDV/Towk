import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import type { PreparedMessageInput } from '$lib/api-client/messages';
import {
  activateOfflineAccount,
  listQueuedMessages,
  purgeOfflineAccount,
  type PrivateDataScope
} from './offlineData';
import { classifyOutboxFailure, PwaOutbox } from './outbox.svelte';

const scope: PrivateDataScope = {
  serverId: 'outbox-server',
  serverUrl: 'https://outbox.example.test',
  userId: 'U-outbox'
};

function message(clientRequestId: string): PreparedMessageInput {
  return {
    roomId: 'R1',
    body: 'queued body',
    attachmentAssetIds: [],
    threadRootEventId: null,
    inReplyTo: null,
    alsoSendToChannel: false,
    linkPreviewToken: '',
    clientRequestId
  };
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  await activateOfflineAccount(scope);
});

afterEach(async () => {
  await purgeOfflineAccount(scope).catch(() => undefined);
});

describe('PwaOutbox', () => {
  it('removes a message after successful delivery and emits the result', async () => {
    const outbox = new PwaOutbox();
    const sent = vi.fn();
    outbox.addEventListener('sent', sent);
    await outbox.queue(scope, message('request-success'));

    await outbox.flush(scope, async () => ({ event: null }), { force: true });

    await expect(listQueuedMessages(scope)).resolves.toHaveLength(0);
    expect(sent).toHaveBeenCalledOnce();
  });

  it('keeps retryable failures queued with bounded backoff', async () => {
    const outbox = new PwaOutbox();
    await outbox.queue(scope, message('request-retry'));

    await outbox.flush(
      scope,
      async () => {
        throw new ConnectError('temporarily unavailable', Code.Unavailable);
      },
      { force: true, now: 1_000 }
    );

    const [record] = await listQueuedMessages(scope);
    expect(record.value).toMatchObject({
      clientRequestId: 'request-retry',
      attemptCount: 1,
      nextAttemptAt: 6_000,
      state: 'queued'
    });
  });

  it('preserves send order while the oldest message is retryable', async () => {
    const outbox = new PwaOutbox();
    await outbox.queue(scope, message('request-first'));
    await outbox.queue(scope, message('request-second'));
    const attempted: string[] = [];

    await outbox.flush(
      scope,
      async (input) => {
        attempted.push(input.clientRequestId);
        if (input.clientRequestId === 'request-first') {
          throw new ConnectError('temporarily unavailable', Code.Unavailable);
        }
        return { event: null };
      },
      { force: true, now: 1_000 }
    );

    expect(attempted).toEqual(['request-first']);
    await expect(listQueuedMessages(scope)).resolves.toHaveLength(2);
  });

  it('marks permanent errors for user attention', async () => {
    const outbox = new PwaOutbox();
    await outbox.queue(scope, message('request-permanent'));

    await outbox.flush(
      scope,
      async () => {
        throw new ConnectError('invalid message', Code.InvalidArgument);
      },
      { force: true }
    );

    const [record] = await listQueuedMessages(scope);
    expect(record.value.state).toBe('needs_attention');
    expect(outbox.summary.needsAttention).toBe(1);
  });

  it('blocks queued messages when the server no longer advertises safe retries', async () => {
    const outbox = new PwaOutbox();
    await outbox.queue(scope, message('request-unsupported'));

    await outbox.markUnsupported(scope, 'Safe retry unsupported');

    const [record] = await listQueuedMessages(scope);
    expect(record.value).toMatchObject({
      clientRequestId: 'request-unsupported',
      state: 'needs_attention',
      lastError: 'Safe retry unsupported',
      attemptCount: 0
    });
    expect(outbox.summary).toMatchObject({ queued: 0, needsAttention: 1 });
  });

  it('serializes discard behind an in-flight send so a failed send cannot restore it', async () => {
    const outbox = new PwaOutbox();
    const sendStarted = deferred();
    const releaseSend = deferred();
    await outbox.queue(scope, message('request-discard-race'));

    const flush = outbox.flush(
      scope,
      async () => {
        sendStarted.resolve();
        await releaseSend.promise;
        throw new ConnectError('temporarily unavailable', Code.Unavailable);
      },
      { force: true }
    );
    await sendStarted.promise;
    const discard = outbox.discard(scope, 'request-discard-race');

    releaseSend.resolve();
    await Promise.all([flush, discard]);

    await expect(listQueuedMessages(scope)).resolves.toHaveLength(0);
  });

  it('classifies transport and authorization failures separately', () => {
    expect(classifyOutboxFailure(new TypeError('network failed'))).toBe('retryable');
    expect(classifyOutboxFailure(new ConnectError('signed out', Code.Unauthenticated))).toBe(
      'authentication'
    );
    expect(classifyOutboxFailure(new ConnectError('invalid', Code.InvalidArgument))).toBe(
      'permanent'
    );
  });
});
