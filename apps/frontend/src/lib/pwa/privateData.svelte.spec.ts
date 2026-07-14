import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EncryptedPrivateDataStore,
  PRIVATE_DATA_LIMITS,
  privateDataNamespace,
  type PrivateDataScope
} from './privateData';

const scope: PrivateDataScope = {
  serverId: 'example-server',
  serverUrl: 'https://chat.example.test',
  userId: 'U-test'
};

const stores: EncryptedPrivateDataStore[] = [];

function createStore(): EncryptedPrivateDataStore {
  const store = new EncryptedPrivateDataStore();
  stores.push(store);
  return store;
}

beforeEach(async () => {
  const store = createStore();
  await store.activateAccount(scope);
});

afterEach(async () => {
  for (const store of stores.splice(0)) {
    await store.purgeAccount(scope).catch(() => undefined);
    await store.close();
  }
});

describe('EncryptedPrivateDataStore', () => {
  it('round-trips private values without exposing plaintext records', async () => {
    const store = createStore();
    await store.put(scope, 'draft', 'room:R1', { text: 'highly private draft' });

    await expect(store.get(scope, 'draft', 'room:R1')).resolves.toMatchObject({
      logicalKey: 'room:R1',
      value: { text: 'highly private draft' }
    });

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('towk-private-data', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['keys', 'records'], 'readonly');
    const keyRequest = transaction.objectStore('keys').getAll();
    const recordRequest = transaction.objectStore('records').getAll();
    const [keys, records] = await Promise.all([
      new Promise<unknown[]>((resolve) => {
        keyRequest.onsuccess = () => resolve(keyRequest.result);
      }),
      new Promise<Array<{ namespace: string; ciphertext: ArrayBuffer }>>((resolve) => {
        recordRequest.onsuccess = () => resolve(recordRequest.result);
      })
    ]);
    database.close();

    const namespace = await privateDataNamespace(scope);
    const scopedKeys = keys.filter(
      (key) => (key as { namespace?: string }).namespace === namespace
    ) as Array<{ key: CryptoKey }>;
    const scopedRecords = records.filter((record) => record.namespace === namespace);
    expect(scopedKeys).toHaveLength(1);
    expect(scopedKeys[0].key.extractable).toBe(false);
    expect(scopedRecords).toHaveLength(1);
    expect(new TextDecoder().decode(scopedRecords[0].ciphertext)).not.toContain(
      'highly private draft'
    );
  });

  it('isolates accounts and crypto-shreds one account on purge', async () => {
    const store = createStore();
    const otherScope = { ...scope, userId: 'U-other' };
    await store.put(scope, 'draft', 'room:R1', { text: 'first account' });
    await store.put(otherScope, 'draft', 'room:R1', { text: 'other account' });

    await store.purgeAccount(scope);

    await expect(store.get(scope, 'draft', 'room:R1')).resolves.toBeNull();
    await expect(store.get(otherScope, 'draft', 'room:R1')).resolves.toMatchObject({
      value: { text: 'other account' }
    });
    await store.purgeAccount(otherScope);
  });

  it('uses one durable key for concurrent first writes from separate tabs', async () => {
    const first = createStore();
    const second = createStore();

    const now = Date.now();
    await Promise.all([
      first.put(scope, 'draft', 'room:R1', { text: 'first tab' }, now),
      second.put(scope, 'draft', 'room:R2', { text: 'second tab' }, now)
    ]);

    await expect(first.get(scope, 'draft', 'room:R1')).resolves.toMatchObject({
      value: { text: 'first tab' }
    });
    await expect(second.get(scope, 'draft', 'room:R2')).resolves.toMatchObject({
      value: { text: 'second tab' }
    });
    const records = await first.list<{ text: string }>(scope, 'draft');
    expect(new Set(records.map((record) => record.updatedAt)).size).toBe(2);
  });

  it('persists account revocation across store instances until authentication', async () => {
    const first = createStore();
    const second = createStore();
    await first.put(scope, 'draft', 'room:R1', { text: 'before sign-out' });

    await second.purgeAccount(scope);

    await expect(first.put(scope, 'draft', 'room:R2', { text: 'stale tab write' })).rejects.toThrow(
      'Encrypted local account storage is inactive'
    );
    await first.activateAccount(scope);
    await expect(first.put(scope, 'draft', 'room:R2', { text: 'new session' })).resolves.toBe(
      undefined
    );
  });

  it('evicts the oldest records when a kind exceeds its bounded count', async () => {
    const store = createStore();
    const limit = PRIVATE_DATA_LIMITS.draft.maxRecords;
    const now = Date.now();
    for (let index = 0; index <= limit; index += 1) {
      await store.put(scope, 'draft', `room:R${index}`, { text: `draft ${index}` }, now + index);
    }

    const records = await store.list<{ text: string }>(scope, 'draft');
    expect(records).toHaveLength(limit);
    expect(records.some((record) => record.logicalKey === 'room:R0')).toBe(false);
    expect(records.some((record) => record.logicalKey === `room:R${limit}`)).toBe(true);
  });

  it('rejects oversized plaintext before encryption', async () => {
    const store = createStore();
    const oversized = 'x'.repeat(PRIVATE_DATA_LIMITS.draft.maxRecordBytes + 1);
    await expect(store.put(scope, 'draft', 'room:R1', { text: oversized })).rejects.toThrow(
      'exceeds its encrypted local storage limit'
    );
  });
});
