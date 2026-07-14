import { afterEach, describe, expect, it } from 'vitest';
import { DRAFT_FILE_LIMITS, EncryptedDraftFileStore } from './draftFiles';
import type { PrivateDataScope } from './privateData';

const scope: PrivateDataScope = {
  serverId: 'draft-files-server',
  serverUrl: 'https://draft-files.example.test',
  userId: 'U-draft-files'
};

const otherScope: PrivateDataScope = { ...scope, userId: 'U-other' };
const store = new EncryptedDraftFileStore();

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

afterEach(async () => {
  await store.purgeAccount(scope).catch(() => undefined);
  await store.purgeAccount(otherScope).catch(() => undefined);
});

describe('encrypted draft attachments', () => {
  it('survives a new store instance without exposing plaintext', async () => {
    const file = new File(['private restart-safe attachment'], 'private-note.txt', {
      type: 'text/plain',
      lastModified: 1234
    });
    await store.put(scope, 'room:R1', [file]);

    const reopened = new EncryptedDraftFileStore();
    const [restored] = await reopened.get(scope, 'room:R1');
    expect(restored?.name).toBe('private-note.txt');
    expect(restored?.lastModified).toBe(1234);
    await expect(restored?.text()).resolves.toBe('private restart-safe attachment');

    const database = await requestResult(indexedDB.open('towk-draft-files', 1));
    const transaction = database.transaction('drafts', 'readonly');
    const records = (await requestResult(transaction.objectStore('drafts').getAll())) as Array<{
      metadata: { ciphertext: ArrayBuffer };
      files: Array<Array<{ ciphertext: ArrayBuffer }>>;
    }>;
    database.close();
    const ciphertext = new TextDecoder().decode(
      new Uint8Array(records[0]?.files[0]?.[0]?.ciphertext ?? new ArrayBuffer(0))
    );
    expect(ciphertext).not.toContain('private restart-safe attachment');
    expect(new TextDecoder().decode(records[0]?.metadata.ciphertext)).not.toContain(
      'private-note.txt'
    );
  });

  it('keeps concurrent first writes decryptable across store instances', async () => {
    const first = new EncryptedDraftFileStore();
    const second = new EncryptedDraftFileStore();
    await Promise.all([
      first.put(scope, 'room:R1', [new File(['first'], 'first.txt')]),
      second.put(scope, 'room:R2', [new File(['second'], 'second.txt')])
    ]);

    await expect((await first.get(scope, 'room:R1'))[0]?.text()).resolves.toBe('first');
    await expect((await second.get(scope, 'room:R2'))[0]?.text()).resolves.toBe('second');
  });

  it('isolates accounts and crypto-shreds files on purge', async () => {
    await store.put(scope, 'room:R1', [new File(['first account'], 'first.txt')]);
    await store.put(otherScope, 'room:R1', [new File(['other account'], 'other.txt')]);

    await store.purgeAccount(scope);

    await expect(store.get(scope, 'room:R1')).resolves.toEqual([]);
    await expect((await store.get(otherScope, 'room:R1'))[0]?.text()).resolves.toBe(
      'other account'
    );
  });

  it('rejects unsafe and oversized attachment metadata', async () => {
    await expect(store.put(scope, 'room:R1', [new File(['MZ'], 'payload.exe')])).rejects.toThrow(
      'Unsafe or oversized draft attachment'
    );
    await expect(
      store.put(scope, 'room:R1', [
        new File(['safe'], `${'x'.repeat(DRAFT_FILE_LIMITS.maxFilenameChars)}.txt`)
      ])
    ).rejects.toThrow('Unsafe or oversized draft attachment');
  });

  it('deletes persisted attachments when the draft becomes empty', async () => {
    await store.put(scope, 'room:R1', [new File(['draft'], 'draft.txt')]);
    await store.put(scope, 'room:R1', []);
    await expect(store.get(scope, 'room:R1')).resolves.toEqual([]);
  });
});
