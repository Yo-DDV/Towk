import {
  hasBlockedExecutableMetadata,
  hasUnsafeAttachmentFilename,
  isBlockedExecutableFile
} from '$lib/attachments/filePolicy';

const DATABASE_NAME = 'towk-share-inbox';
const DATABASE_VERSION = 1;
const KEY_STORE = 'keys';
const SHARE_STORE = 'shares';
const DEVICE_KEY_ID = 'device';
const CHUNK_SIZE = 2 * 1024 * 1024;

export const SHARE_INBOX_LIMITS = {
  maxFiles: 8,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalFileBytes: 100 * 1024 * 1024,
  maxTextBytes: 100 * 1024,
  maxUrlChars: 4096,
  maxFilenameChars: 255,
  maxEntries: 3,
  maxStoredBytes: 150 * 1024 * 1024,
  maxAgeMs: 60 * 60 * 1000
} as const;

export type IncomingShare = {
  title: string;
  text: string;
  url: string;
  files: File[];
};

export type IncomingShareSummary = Omit<IncomingShare, 'files'> & {
  files: ShareMetadata['files'];
};

type ShareMetadata = Omit<IncomingShare, 'files'> & {
  files: Array<{ name: string; type: string; lastModified: number; size: number }>;
};

type EncryptedChunk = { iv: ArrayBuffer; ciphertext: ArrayBuffer };

type StoredShare = {
  id: string;
  createdAt: number;
  expiresAt: number;
  byteSize: number;
  metadata: EncryptedChunk;
  files: EncryptedChunk[][];
};

type StoredKey = { id: string; key: CryptoKey };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isShareID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('Share inbox transaction aborted')),
      { once: true }
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('Share inbox transaction failed')),
      { once: true }
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || typeof crypto?.subtle === 'undefined') {
    throw new Error('Encrypted share storage is unavailable');
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(KEY_STORE)) {
          database.createObjectStore(KEY_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(SHARE_STORE)) {
          const shares = database.createObjectStore(SHARE_STORE, { keyPath: 'id' });
          shares.createIndex('createdAt', 'createdAt');
        }
      },
      { once: true }
    );
    request.addEventListener(
      'success',
      () => {
        request.result.addEventListener('versionchange', () => request.result.close());
        resolve(request.result);
      },
      { once: true }
    );
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener(
      'blocked',
      () => reject(new Error('Encrypted share storage upgrade is blocked')),
      { once: true }
    );
  });
}

async function encryptionKey(database: IDBDatabase): Promise<CryptoKey> {
  const read = database.transaction(KEY_STORE, 'readonly');
  const readDone = transactionDone(read);
  const stored = (await requestResult(read.objectStore(KEY_STORE).get(DEVICE_KEY_ID))) as
    | StoredKey
    | undefined;
  await readDone;
  if (stored?.key) return stored.key;

  const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ]);
  const write = database.transaction(KEY_STORE, 'readwrite');
  const writeDone = transactionDone(write);
  const keys = write.objectStore(KEY_STORE);
  const current = (await requestResult(keys.get(DEVICE_KEY_ID))) as StoredKey | undefined;
  const key = current?.key ?? candidate;
  if (!current) keys.put({ id: DEVICE_KEY_ID, key } satisfies StoredKey);
  await writeDone;
  return key;
}

function normalizedUrl(input: string): string {
  if (!input.trim()) return '';
  try {
    const url = new URL(input);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

async function validateShare(input: IncomingShare): Promise<IncomingShare> {
  const title = input.title.trim().slice(0, 500);
  const text = input.text.trim();
  if (input.url.length > SHARE_INBOX_LIMITS.maxUrlChars) {
    throw new RangeError('Shared URL is too large');
  }
  const url = normalizedUrl(input.url);
  if (encoder.encode(text).byteLength > SHARE_INBOX_LIMITS.maxTextBytes) {
    throw new RangeError('Shared text is too large');
  }
  if (input.files.length > SHARE_INBOX_LIMITS.maxFiles) {
    throw new RangeError('Too many shared files');
  }

  let totalFileBytes = 0;
  for (const file of input.files) {
    if (
      file.size > SHARE_INBOX_LIMITS.maxFileBytes ||
      !file.name ||
      file.name.length > SHARE_INBOX_LIMITS.maxFilenameChars ||
      file.type.length > 255 ||
      hasUnsafeAttachmentFilename(file.name) ||
      hasBlockedExecutableMetadata(file) ||
      (await isBlockedExecutableFile(file))
    ) {
      throw new TypeError('Unsafe or oversized shared file');
    }
    totalFileBytes += file.size;
  }
  if (totalFileBytes > SHARE_INBOX_LIMITS.maxTotalFileBytes) {
    throw new RangeError('Shared files are too large');
  }
  if (!title && !text && !url && input.files.length === 0) {
    throw new TypeError('Shared payload is empty');
  }

  return { title, text, url, files: input.files };
}

function encryptionParameters(
  id: string,
  label: string
): AesGcmParams & { iv: Uint8Array<ArrayBuffer> } {
  return {
    name: 'AES-GCM',
    iv: crypto.getRandomValues(new Uint8Array(12)),
    additionalData: encoder.encode(`${id}:${label}`)
  };
}

async function encryptBytes(
  key: CryptoKey,
  id: string,
  label: string,
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>
): Promise<EncryptedChunk> {
  const parameters = encryptionParameters(id, label);
  const ciphertext = await crypto.subtle.encrypt(parameters, key, bytes);
  return { iv: parameters.iv.buffer, ciphertext };
}

async function decryptBytes(
  key: CryptoKey,
  id: string,
  label: string,
  chunk: EncryptedChunk
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: chunk.iv,
      additionalData: encoder.encode(`${id}:${label}`)
    },
    key,
    chunk.ciphertext
  );
}

async function deleteRecords(database: IDBDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const transaction = database.transaction(SHARE_STORE, 'readwrite');
  const done = transactionDone(transaction);
  for (const id of ids) transaction.objectStore(SHARE_STORE).delete(id);
  await done;
}

async function prune(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(SHARE_STORE, 'readonly');
  const done = transactionDone(transaction);
  const shares = (await requestResult(
    transaction.objectStore(SHARE_STORE).getAll()
  )) as StoredShare[];
  await done;

  const now = Date.now();
  let retainedEntries = 0;
  let retainedBytes = 0;
  const deleteIDs: string[] = [];
  for (const share of shares.sort((a, b) => b.createdAt - a.createdAt)) {
    const fits =
      share.expiresAt > now &&
      retainedEntries < SHARE_INBOX_LIMITS.maxEntries &&
      retainedBytes + share.byteSize <= SHARE_INBOX_LIMITS.maxStoredBytes;
    if (!fits) {
      deleteIDs.push(share.id);
      continue;
    }
    retainedEntries += 1;
    retainedBytes += share.byteSize;
  }
  await deleteRecords(database, deleteIDs);
}

export async function storeIncomingShare(input: IncomingShare): Promise<string> {
  const share = await validateShare(input);
  const database = await openDatabase();
  try {
    const key = await encryptionKey(database);
    const id = crypto.randomUUID();
    const metadata: ShareMetadata = {
      title: share.title,
      text: share.text,
      url: share.url,
      files: share.files.map((file) => ({
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        size: file.size
      }))
    };
    const encryptedMetadata = await encryptBytes(
      key,
      id,
      'metadata',
      encoder.encode(JSON.stringify(metadata))
    );
    const encryptedFiles: EncryptedChunk[][] = [];
    let byteSize = encryptedMetadata.ciphertext.byteLength;
    for (const [fileIndex, file] of share.files.entries()) {
      const chunks: EncryptedChunk[] = [];
      for (let offset = 0, chunkIndex = 0; offset < file.size; offset += CHUNK_SIZE, chunkIndex++) {
        const chunk = await encryptBytes(
          key,
          id,
          `file:${fileIndex}:${chunkIndex}`,
          await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer()
        );
        chunks.push(chunk);
        byteSize += chunk.ciphertext.byteLength;
      }
      encryptedFiles.push(chunks);
    }

    const now = Date.now();
    const transaction = database.transaction(SHARE_STORE, 'readwrite');
    const done = transactionDone(transaction);
    const shares = transaction.objectStore(SHARE_STORE);
    const latest = await requestResult(shares.index('createdAt').openCursor(null, 'prev'));
    const createdAt = Math.max(
      now,
      ((latest?.value as StoredShare | undefined)?.createdAt ?? 0) + 1
    );
    shares.put({
      id,
      createdAt,
      expiresAt: now + SHARE_INBOX_LIMITS.maxAgeMs,
      byteSize,
      metadata: encryptedMetadata,
      files: encryptedFiles
    } satisfies StoredShare);
    await done;
    await prune(database);
    return id;
  } finally {
    database.close();
  }
}

export async function getIncomingShare(id: string): Promise<IncomingShare | null> {
  if (!isShareID(id)) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SHARE_STORE, 'readonly');
    const done = transactionDone(transaction);
    const stored = (await requestResult(transaction.objectStore(SHARE_STORE).get(id))) as
      | StoredShare
      | undefined;
    await done;
    if (!stored) return null;
    if (stored.expiresAt <= Date.now()) {
      await deleteRecords(database, [id]);
      return null;
    }

    const key = await encryptionKey(database);
    const metadata = JSON.parse(
      decoder.decode(await decryptBytes(key, id, 'metadata', stored.metadata))
    ) as ShareMetadata;
    if (metadata.files.length !== stored.files.length) throw new Error('Corrupt shared files');

    const files: File[] = [];
    for (const [fileIndex, metadataFile] of metadata.files.entries()) {
      const parts: ArrayBuffer[] = [];
      for (const [chunkIndex, chunk] of stored.files[fileIndex]!.entries()) {
        parts.push(await decryptBytes(key, id, `file:${fileIndex}:${chunkIndex}`, chunk));
      }
      const file = new File(parts, metadataFile.name, {
        type: metadataFile.type,
        lastModified: metadataFile.lastModified
      });
      if (file.size !== metadataFile.size) throw new Error('Corrupt shared file size');
      files.push(file);
    }
    return { title: metadata.title, text: metadata.text, url: metadata.url, files };
  } catch {
    await deleteRecords(database, [id]).catch(() => undefined);
    return null;
  } finally {
    database.close();
  }
}

export async function getIncomingShareSummary(id: string): Promise<IncomingShareSummary | null> {
  if (!isShareID(id)) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SHARE_STORE, 'readonly');
    const done = transactionDone(transaction);
    const stored = (await requestResult(transaction.objectStore(SHARE_STORE).get(id))) as
      | StoredShare
      | undefined;
    await done;
    if (!stored) return null;
    if (stored.expiresAt <= Date.now()) {
      await deleteRecords(database, [id]);
      return null;
    }
    const key = await encryptionKey(database);
    const metadata = JSON.parse(
      decoder.decode(await decryptBytes(key, id, 'metadata', stored.metadata))
    ) as ShareMetadata;
    if (metadata.files.length !== stored.files.length) throw new Error('Corrupt shared files');
    return metadata;
  } catch {
    await deleteRecords(database, [id]).catch(() => undefined);
    return null;
  } finally {
    database.close();
  }
}

export async function deleteIncomingShare(id: string): Promise<void> {
  if (!isShareID(id)) return;
  const database = await openDatabase();
  try {
    await deleteRecords(database, [id]);
  } finally {
    database.close();
  }
}

export async function purgeIncomingShares(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([SHARE_STORE, KEY_STORE], 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(SHARE_STORE).clear();
    transaction.objectStore(KEY_STORE).clear();
    await done;
  } finally {
    database.close();
  }
}
