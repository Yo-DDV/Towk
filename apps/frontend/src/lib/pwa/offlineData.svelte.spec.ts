import { afterEach, describe, expect, it } from 'vitest';
import {
  activateOfflineAccount,
  listQueuedMessages,
  loadCachedTimeline,
  loadPersistedDraft,
  loadPersistedDraftFiles,
  purgeOfflineAccount,
  purgeOfflineRoomHistory,
  saveCachedTimeline,
  savePersistedDraft,
  savePersistedDraftFiles,
  saveQueuedMessage,
  type PrivateDataScope
} from './offlineData';

const scope: PrivateDataScope = {
  serverId: 'offline-account-lifecycle',
  serverUrl: 'https://offline-account.example.test',
  userId: 'U-offline-account'
};

afterEach(async () => {
  await purgeOfflineAccount(scope).catch(() => undefined);
  await activateOfflineAccount(scope);
});

describe('offline account lifecycle', () => {
  it('waits for writes already in flight before crypto-shredding the account', async () => {
    await activateOfflineAccount(scope);
    const textWrite = savePersistedDraft(scope, 'R1', null, {
      text: 'must not come back after sign-out',
      richMode: false
    });
    const fileWrite = savePersistedDraftFiles(scope, 'R1', null, [
      new File(['must also disappear'], 'pending.txt', { type: 'text/plain' })
    ]);

    const purge = purgeOfflineAccount(scope);
    await Promise.allSettled([textWrite, fileWrite]);
    await purge;

    await activateOfflineAccount(scope);
    await expect(loadPersistedDraft(scope, 'R1')).resolves.toBeNull();
    await expect(loadPersistedDraftFiles(scope, 'R1')).resolves.toEqual([]);
  });

  it('rejects new private writes until the account is authenticated again', async () => {
    await purgeOfflineAccount(scope);

    await expect(
      savePersistedDraft(scope, 'R1', null, { text: 'late write', richMode: false })
    ).rejects.toThrow('Encrypted local account storage is inactive');
    await expect(
      savePersistedDraftFiles(scope, 'R1', null, [new File(['late'], 'late.txt')])
    ).rejects.toThrow('Encrypted local account storage is inactive');

    await activateOfflineAccount(scope);
    await savePersistedDraft(scope, 'R1', null, { text: 'new session', richMode: false });
    await expect(loadPersistedDraft(scope, 'R1')).resolves.toMatchObject({
      text: 'new session'
    });
  });

  it('fails closed for legacy room history without applying room-deletion lifecycle', async () => {
    await activateOfflineAccount(scope);
    await Promise.all([
      savePersistedDraft(scope, 'R1', null, { text: 'legacy source text', richMode: false }),
      savePersistedDraft(scope, 'R2', null, { text: 'other room', richMode: false }),
      savePersistedDraftFiles(scope, 'R1', null, [
        new File(['legacy source file'], 'legacy.txt', { type: 'text/plain' })
      ]),
      saveCachedTimeline(scope, {
        roomId: 'R1',
        threadRootEventId: null,
        events: [],
        cachedAt: Date.now()
      }),
      saveQueuedMessage(scope, {
        roomId: 'R1',
        body: 'stale outbox message',
        attachmentAssetIds: [],
        threadRootEventId: null,
        inReplyTo: null,
        alsoSendToChannel: false,
        linkPreviewToken: '',
        clientRequestId: 'purged-history-message',
        queuedAt: Date.now(),
        attemptCount: 0,
        nextAttemptAt: 0,
        state: 'queued',
        lastError: null
      })
    ]);

    await purgeOfflineRoomHistory(scope, 'R1');

    await expect(loadPersistedDraft(scope, 'R1')).resolves.toBeNull();
    await expect(loadPersistedDraftFiles(scope, 'R1')).resolves.toEqual([]);
    await expect(loadCachedTimeline(scope, 'R1')).resolves.toBeNull();
    await expect(listQueuedMessages(scope)).resolves.toEqual([]);
    await expect(loadPersistedDraft(scope, 'R2')).resolves.toMatchObject({ text: 'other room' });
  });
});
