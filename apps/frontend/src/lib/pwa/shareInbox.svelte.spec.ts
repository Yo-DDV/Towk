import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteIncomingShare,
  getIncomingShare,
  getIncomingShareSummary,
  purgeIncomingShares,
  SHARE_INBOX_LIMITS,
  storeIncomingShare
} from './shareInbox';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

async function rawShare(id: string) {
  const database = await requestResult(indexedDB.open('towk-share-inbox', 1));
  const transaction = database.transaction('shares', 'readonly');
  const record = (await requestResult(transaction.objectStore('shares').get(id))) as {
    metadata: { ciphertext: ArrayBuffer };
    files: Array<Array<{ ciphertext: ArrayBuffer }>>;
  };
  database.close();
  return record;
}

describe('encrypted incoming PWA shares', () => {
  beforeEach(async () => {
    await purgeIncomingShares();
  });

  afterAll(async () => {
    await purgeIncomingShares();
  });

  it('round-trips text, URLs, and file bytes', async () => {
    const file = new File(['private attachment'], 'note.txt', {
      type: 'text/plain',
      lastModified: 1234
    });
    const id = await storeIncomingShare({
      title: 'Shared title',
      text: 'Shared body',
      url: 'https://example.com/article',
      files: [file]
    });

    const result = await getIncomingShare(id);
    expect(result).not.toBeNull();
    expect(result?.title).toBe('Shared title');
    expect(result?.text).toBe('Shared body');
    expect(result?.url).toBe('https://example.com/article');
    expect(result?.files).toHaveLength(1);
    expect(result?.files[0]?.name).toBe('note.txt');
    await expect(result?.files[0]?.text()).resolves.toBe('private attachment');
    await expect(getIncomingShareSummary(id)).resolves.toMatchObject({
      title: 'Shared title',
      files: [{ name: 'note.txt', size: file.size }]
    });
  });

  it('does not leave metadata or file contents readable in IndexedDB', async () => {
    const id = await storeIncomingShare({
      title: 'secret-title-2dded6',
      text: 'secret-body-cae5c8',
      url: 'https://example.com/private-5669b4',
      files: [new File(['secret-file-8711db'], 'secret-name-994aac.txt')]
    });
    const raw = await rawShare(id);
    const bytes = [
      new Uint8Array(raw.metadata.ciphertext),
      ...raw.files.flatMap((chunks) => chunks.map((chunk) => new Uint8Array(chunk.ciphertext)))
    ];
    const combined = new Uint8Array(bytes.reduce((total, value) => total + value.length, 0));
    let offset = 0;
    for (const value of bytes) {
      combined.set(value, offset);
      offset += value.length;
    }
    const ciphertext = new TextDecoder().decode(combined);

    expect(ciphertext).not.toContain('secret-title-2dded6');
    expect(ciphertext).not.toContain('secret-body-cae5c8');
    expect(ciphertext).not.toContain('secret-name-994aac');
    expect(ciphertext).not.toContain('secret-file-8711db');
  });

  it('rejects executable files before persistence', async () => {
    await expect(
      storeIncomingShare({
        title: '',
        text: '',
        url: '',
        files: [new File(['MZ payload'], 'payload.exe', { type: 'application/octet-stream' })]
      })
    ).rejects.toThrow('Unsafe or oversized shared file');
  });

  it('bounds URL and filename metadata before encryption', async () => {
    await expect(
      storeIncomingShare({
        title: '',
        text: '',
        url: `https://example.com/${'x'.repeat(SHARE_INBOX_LIMITS.maxUrlChars)}`,
        files: []
      })
    ).rejects.toThrow('Shared URL is too large');
    await expect(
      storeIncomingShare({
        title: '',
        text: '',
        url: '',
        files: [new File(['safe'], `${'x'.repeat(SHARE_INBOX_LIMITS.maxFilenameChars)}.txt`)]
      })
    ).rejects.toThrow('Unsafe or oversized shared file');
    await expect(getIncomingShare('not-an-inbox-id')).resolves.toBeNull();
  });

  it('uses one durable encryption key for concurrent first writes', async () => {
    const [first, second] = await Promise.all([
      storeIncomingShare({ title: 'First', text: '', url: '', files: [] }),
      storeIncomingShare({ title: 'Second', text: '', url: '', files: [] })
    ]);

    await expect(getIncomingShare(first)).resolves.toMatchObject({ title: 'First' });
    await expect(getIncomingShare(second)).resolves.toMatchObject({ title: 'Second' });
  });

  it('prunes old entries and supports explicit deletion', async () => {
    const ids: string[] = [];
    for (let index = 0; index <= SHARE_INBOX_LIMITS.maxEntries; index++) {
      ids.push(await storeIncomingShare({ title: `Share ${index}`, text: '', url: '', files: [] }));
    }

    await expect(getIncomingShare(ids[0]!)).resolves.toBeNull();
    await expect(getIncomingShare(ids.at(-1)!)).resolves.not.toBeNull();
    await deleteIncomingShare(ids.at(-1)!);
    await expect(getIncomingShare(ids.at(-1)!)).resolves.toBeNull();
  });
});
