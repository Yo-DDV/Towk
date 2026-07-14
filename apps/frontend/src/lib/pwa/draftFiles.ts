import {
  hasBlockedExecutableMetadata,
  hasUnsafeAttachmentFilename,
  isBlockedExecutableFile,
  MAX_MESSAGE_ATTACHMENTS
} from '$lib/attachments/filePolicy';
import { privateDataNamespace, type PrivateDataScope } from './privateData';

const DATABASE_NAME = 'towk-draft-files';
const DATABASE_VERSION = 1;
const KEY_STORE = 'keys';
const DRAFT_STORE = 'drafts';
const DEVICE_CHUNK_SIZE = 2 * 1024 * 1024;

export const DRAFT_FILE_LIMITS = {
  maxFiles: MAX_MESSAGE_ATTACHMENTS,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalFileBytes: 100 * 1024 * 1024,
  maxFilenameChars: 255,
  maxDrafts: 20,
  maxStoredBytes: 150 * 1024 * 1024,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000
} as const;

type StoredKey = { namespace: string; key: CryptoKey };
type EncryptedChunk = { iv: ArrayBuffer; ciphertext: ArrayBuffer };
type DraftFileMetadata = Array<{
  name: string;
  type: string;
  size: number;
  lastModified: number;
}>;

type StoredDraftFiles = {
  id: string;
  namespace: string;
  updatedAt: number;
  expiresAt: number;
  byteSize: number;
  metadata: EncryptedChunk;
  files: EncryptedChunk[][];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
      () => reject(transaction.error ?? new Error('Draft file transaction aborted')),
      { once: true }
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('Draft file transaction failed')),
      { once: true }
    );
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || typeof crypto?.subtle === 'undefined') {
    throw new Error('Encrypted draft file storage is unavailable');
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(KEY_STORE)) {
          database.createObjectStore(KEY_STORE, { keyPath: 'namespace' });
        }
        if (!database.objectStoreNames.contains(DRAFT_STORE)) {
          const drafts = database.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
          drafts.createIndex('namespace', 'namespace');
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
      () => reject(new Error('Encrypted draft file storage upgrade is blocked')),
      { once: true }
    );
  });
}

async function encryptionKey(database: IDBDatabase, namespace: string): Promise<CryptoKey> {
  const read = database.transaction(KEY_STORE, 'readonly');
  const readDone = transactionDone(read);
  const existing = (await requestResult(read.objectStore(KEY_STORE).get(namespace))) as
    | StoredKey
    | undefined;
  await readDone;
  if (existing?.key) return existing.key;

  const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ]);
  const write = database.transaction(KEY_STORE, 'readwrite');
  const writeDone = transactionDone(write);
  const keys = write.objectStore(KEY_STORE);
  const current = (await requestResult(keys.get(namespace))) as StoredKey | undefined;
  const key = current?.key ?? candidate;
  if (!current) keys.put({ namespace, key } satisfies StoredKey);
  await writeDone;
  return key;
}

function encryptionParameters(
  id: string,
  label: string
): AesGcmParams & {
  iv: Uint8Array<ArrayBuffer>;
} {
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
  return {
    iv: parameters.iv.buffer,
    ciphertext: await crypto.subtle.encrypt(parameters, key, bytes)
  };
}

function decryptBytes(
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

async function validateFiles(files: File[]): Promise<void> {
  if (files.length > DRAFT_FILE_LIMITS.maxFiles) {
    throw new RangeError('Too many draft attachments');
  }
  let totalBytes = 0;
  for (const file of files) {
    if (
      file.size > DRAFT_FILE_LIMITS.maxFileBytes ||
      !file.name ||
      file.name.length > DRAFT_FILE_LIMITS.maxFilenameChars ||
      file.type.length > 255 ||
      hasUnsafeAttachmentFilename(file.name) ||
      hasBlockedExecutableMetadata(file) ||
      (await isBlockedExecutableFile(file))
    ) {
      throw new TypeError('Unsafe or oversized draft attachment');
    }
    totalBytes += file.size;
  }
  if (totalBytes > DRAFT_FILE_LIMITS.maxTotalFileBytes) {
    throw new RangeError('Draft attachments are too large');
  }
}

async function recordID(namespace: string, logicalKey: string): Promise<string> {
  return `${namespace}:${await sha256(logicalKey)}`;
}

async function recordsForNamespace(
  database: IDBDatabase,
  namespace: string
): Promise<StoredDraftFiles[]> {
  const transaction = database.transaction(DRAFT_STORE, 'readonly');
  const done = transactionDone(transaction);
  const records = (await requestResult(
    transaction.objectStore(DRAFT_STORE).index('namespace').getAll(IDBKeyRange.only(namespace))
  )) as StoredDraftFiles[];
  await done;
  return records;
}

async function deleteRecords(database: IDBDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const transaction = database.transaction(DRAFT_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const drafts = transaction.objectStore(DRAFT_STORE);
  for (const id of ids) drafts.delete(id);
  await done;
}

async function prune(database: IDBDatabase, namespace: string, now: number): Promise<void> {
  const records = (await recordsForNamespace(database, namespace)).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
  let retainedCount = 0;
  let retainedBytes = 0;
  const deleteIDs: string[] = [];
  for (const record of records) {
    const fits =
      record.expiresAt > now &&
      retainedCount < DRAFT_FILE_LIMITS.maxDrafts &&
      retainedBytes + record.byteSize <= DRAFT_FILE_LIMITS.maxStoredBytes;
    if (!fits) {
      deleteIDs.push(record.id);
      continue;
    }
    retainedCount += 1;
    retainedBytes += record.byteSize;
  }
  await deleteRecords(database, deleteIDs);
}

export class EncryptedDraftFileStore {
  async put(scope: PrivateDataScope, logicalKey: string, files: File[]): Promise<void> {
    const namespace = await privateDataNamespace(scope);
    const id = await recordID(namespace, logicalKey);
    const database = await openDatabase();
    try {
      if (files.length === 0) {
        await deleteRecords(database, [id]);
        return;
      }
      await validateFiles(files);
      const key = await encryptionKey(database, namespace);
      const metadata: DraftFileMetadata = files.map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified
      }));
      const encryptedMetadata = await encryptBytes(
        key,
        id,
        'metadata',
        encoder.encode(JSON.stringify(metadata))
      );
      const encryptedFiles: EncryptedChunk[][] = [];
      let byteSize = encryptedMetadata.ciphertext.byteLength;
      for (const [fileIndex, file] of files.entries()) {
        const chunks: EncryptedChunk[] = [];
        for (
          let offset = 0, chunkIndex = 0;
          offset < file.size;
          offset += DEVICE_CHUNK_SIZE, chunkIndex += 1
        ) {
          const chunk = await encryptBytes(
            key,
            id,
            `file:${fileIndex}:${chunkIndex}`,
            await file.slice(offset, offset + DEVICE_CHUNK_SIZE).arrayBuffer()
          );
          chunks.push(chunk);
          byteSize += chunk.ciphertext.byteLength;
        }
        encryptedFiles.push(chunks);
      }

      const now = Date.now();
      const transaction = database.transaction(DRAFT_STORE, 'readwrite');
      const done = transactionDone(transaction);
      const drafts = transaction.objectStore(DRAFT_STORE);
      const existing = (await requestResult(
        drafts.index('namespace').getAll(IDBKeyRange.only(namespace))
      )) as StoredDraftFiles[];
      const newest = existing.reduce((latest, record) => Math.max(latest, record.updatedAt), 0);
      const updatedAt = Math.max(now, newest + 1);
      drafts.put({
        id,
        namespace,
        updatedAt,
        expiresAt: now + DRAFT_FILE_LIMITS.maxAgeMs,
        byteSize,
        metadata: encryptedMetadata,
        files: encryptedFiles
      } satisfies StoredDraftFiles);
      await done;
      await prune(database, namespace, now);
    } finally {
      database.close();
    }
  }

  async get(scope: PrivateDataScope, logicalKey: string): Promise<File[]> {
    const namespace = await privateDataNamespace(scope);
    const id = await recordID(namespace, logicalKey);
    const database = await openDatabase();
    try {
      const transaction = database.transaction([KEY_STORE, DRAFT_STORE], 'readonly');
      const done = transactionDone(transaction);
      const keyRequest = transaction.objectStore(KEY_STORE).get(namespace);
      const draftRequest = transaction.objectStore(DRAFT_STORE).get(id);
      const [keyRecord, stored] = (await Promise.all([
        requestResult(keyRequest),
        requestResult(draftRequest)
      ])) as [StoredKey | undefined, StoredDraftFiles | undefined];
      await done;
      if (!stored) return [];
      if (!keyRecord?.key) {
        await deleteRecords(database, [id]);
        return [];
      }
      if (stored.expiresAt <= Date.now()) {
        await deleteRecords(database, [id]);
        return [];
      }

      try {
        const metadata = JSON.parse(
          decoder.decode(await decryptBytes(keyRecord.key, id, 'metadata', stored.metadata))
        ) as DraftFileMetadata;
        if (!Array.isArray(metadata) || metadata.length !== stored.files.length) {
          throw new Error('Corrupt draft attachment metadata');
        }
        const files: File[] = [];
        for (const [fileIndex, fileMetadata] of metadata.entries()) {
          const parts: ArrayBuffer[] = [];
          for (const [chunkIndex, chunk] of stored.files[fileIndex]!.entries()) {
            parts.push(
              await decryptBytes(keyRecord.key, id, `file:${fileIndex}:${chunkIndex}`, chunk)
            );
          }
          const file = new File(parts, fileMetadata.name, {
            type: fileMetadata.type,
            lastModified: fileMetadata.lastModified
          });
          if (file.size !== fileMetadata.size) throw new Error('Corrupt draft attachment size');
          files.push(file);
        }
        await validateFiles(files);
        return files;
      } catch {
        await deleteRecords(database, [id]).catch(() => undefined);
        return [];
      }
    } finally {
      database.close();
    }
  }

  async delete(scope: PrivateDataScope, logicalKey: string): Promise<void> {
    const namespace = await privateDataNamespace(scope);
    const database = await openDatabase();
    try {
      await deleteRecords(database, [await recordID(namespace, logicalKey)]);
    } finally {
      database.close();
    }
  }

  async purgeAccount(scope: PrivateDataScope): Promise<void> {
    const namespace = await privateDataNamespace(scope);
    const database = await openDatabase();
    try {
      const transaction = database.transaction([KEY_STORE, DRAFT_STORE], 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(KEY_STORE).delete(namespace);
      const request = transaction
        .objectStore(DRAFT_STORE)
        .index('namespace')
        .openKeyCursor(IDBKeyRange.only(namespace));
      request.addEventListener('success', () => {
        const cursor = request.result;
        if (!cursor) return;
        transaction.objectStore(DRAFT_STORE).delete(cursor.primaryKey);
        cursor.continue();
      });
      await done;
    } finally {
      database.close();
    }
  }
}

export const encryptedDraftFiles = new EncryptedDraftFileStore();
