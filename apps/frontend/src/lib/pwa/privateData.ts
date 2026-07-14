const DATABASE_NAME = 'towk-private-data';
const DATABASE_VERSION = 1;
const KEY_STORE = 'keys';
const RECORD_STORE = 'records';

export type PrivateDataKind = 'draft' | 'outbox' | 'timeline';

export type PrivateDataScope = {
  serverId: string;
  serverUrl: string;
  userId: string;
};

export type PrivateDataLimits = {
  maxRecords: number;
  maxBytes: number;
  maxAgeMs: number;
  maxRecordBytes: number;
};

export const PRIVATE_DATA_LIMITS: Record<PrivateDataKind, PrivateDataLimits> = {
  draft: {
    maxRecords: 100,
    maxBytes: 2 * 1024 * 1024,
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    maxRecordBytes: 256 * 1024
  },
  outbox: {
    maxRecords: 100,
    maxBytes: 5 * 1024 * 1024,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    maxRecordBytes: 512 * 1024
  },
  timeline: {
    maxRecords: 30,
    maxBytes: 20 * 1024 * 1024,
    maxAgeMs: 14 * 24 * 60 * 60 * 1000,
    maxRecordBytes: 2 * 1024 * 1024
  }
};

type StoredEncryptionKey = {
  namespace: string;
  key?: CryptoKey;
  createdAt?: number;
  generation?: string;
  revokedAt?: number;
};

type EncryptionKeyMaterial = { key: CryptoKey; generation: string };

type StoredPrivateRecord = {
  id: string;
  namespace: string;
  kind: PrivateDataKind;
  updatedAt: number;
  expiresAt: number;
  byteSize: number;
  keyGeneration?: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

export type PrivateDataRecord<T> = {
  logicalKey: string;
  value: T;
  updatedAt: number;
  expiresAt: number;
};

type PrivateDataEnvelope<T> = {
  logicalKey: string;
  value: T;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const LEGACY_KEY_GENERATION = 'legacy';

function newKeyGeneration(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

function keyGeneration(key: StoredEncryptionKey): string {
  return key.generation ?? LEGACY_KEY_GENERATION;
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
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')),
      { once: true }
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed')),
      { once: true }
    );
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function canonicalServerOrigin(serverUrl: string): string {
  try {
    return new URL(serverUrl).origin;
  } catch {
    return serverUrl;
  }
}

function assertScope(scope: PrivateDataScope): void {
  if (!scope.serverId || !scope.serverUrl || !scope.userId) {
    throw new TypeError('Private PWA data requires a server and authenticated account scope');
  }
}

export async function privateDataNamespace(scope: PrivateDataScope): Promise<string> {
  assertScope(scope);
  return sha256(
    `${scope.serverId}\u0000${canonicalServerOrigin(scope.serverUrl)}\u0000${scope.userId}`
  );
}

function assertAvailable(): void {
  if (typeof indexedDB === 'undefined' || typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error('Encrypted private browser storage is unavailable');
  }
}

function openDatabase(onVersionChange: () => void): Promise<IDBDatabase> {
  assertAvailable();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(KEY_STORE)) {
          database.createObjectStore(KEY_STORE, { keyPath: 'namespace' });
        }
        if (!database.objectStoreNames.contains(RECORD_STORE)) {
          const records = database.createObjectStore(RECORD_STORE, { keyPath: 'id' });
          records.createIndex('namespace', 'namespace', { unique: false });
          records.createIndex('namespaceKind', ['namespace', 'kind'], { unique: false });
        }
      },
      { once: true }
    );
    request.addEventListener(
      'success',
      () => {
        const database = request.result;
        database.addEventListener('versionchange', () => {
          database.close();
          onVersionChange();
        });
        resolve(database);
      },
      { once: true }
    );
    request.addEventListener('error', () => reject(request.error), { once: true });
    request.addEventListener(
      'blocked',
      () => reject(new Error('Encrypted private browser storage upgrade is blocked')),
      { once: true }
    );
  });
}

export class EncryptedPrivateDataStore {
  #databasePromise: Promise<IDBDatabase> | null = null;
  #namespacePromises = new Map<string, Promise<string>>();
  #namespaceLocks = new Map<string, Promise<unknown>>();

  isSupported(): boolean {
    return typeof indexedDB !== 'undefined' && typeof globalThis.crypto?.subtle !== 'undefined';
  }

  async get<T>(
    scope: PrivateDataScope,
    kind: PrivateDataKind,
    logicalKey: string
  ): Promise<PrivateDataRecord<T> | null> {
    const namespace = await this.#namespace(scope);
    return this.#locked(namespace, async () => {
      const database = await this.#database();
      const id = await this.#recordID(namespace, kind, logicalKey);
      const transaction = database.transaction(RECORD_STORE, 'readonly');
      const done = transactionDone(transaction);
      const record = (await requestResult(transaction.objectStore(RECORD_STORE).get(id))) as
        | StoredPrivateRecord
        | undefined;
      await done;
      if (!record) return null;
      if (record.expiresAt <= Date.now()) {
        await this.#deleteRecord(database, id);
        return null;
      }
      const key = await this.#getEncryptionKey(database, namespace, false);
      if (!key) return null;
      try {
        return await this.#decryptRecord<T>(record, key);
      } catch {
        await this.#deleteRecord(database, id);
        return null;
      }
    });
  }

  async list<T>(scope: PrivateDataScope, kind: PrivateDataKind): Promise<PrivateDataRecord<T>[]> {
    const namespace = await this.#namespace(scope);
    return this.#locked(namespace, async () => {
      const database = await this.#database();
      const records = await this.#recordsForKind(database, namespace, kind);
      const key = await this.#getEncryptionKey(database, namespace, false);
      if (!key) return [];
      const now = Date.now();
      const expiredIDs: string[] = [];
      const decrypted: PrivateDataRecord<T>[] = [];
      for (const record of records) {
        if (record.expiresAt <= now) {
          expiredIDs.push(record.id);
          continue;
        }
        try {
          decrypted.push(await this.#decryptRecord<T>(record, key));
        } catch {
          expiredIDs.push(record.id);
        }
      }
      if (expiredIDs.length > 0) await this.#deleteRecords(database, expiredIDs);
      return decrypted.sort((a, b) => a.updatedAt - b.updatedAt);
    });
  }

  async put<T>(
    scope: PrivateDataScope,
    kind: PrivateDataKind,
    logicalKey: string,
    value: T,
    now = Date.now()
  ): Promise<void> {
    const namespace = await this.#namespace(scope);
    return this.#locked(namespace, async () => {
      const limits = PRIVATE_DATA_LIMITS[kind];
      const envelope: PrivateDataEnvelope<T> = { logicalKey, value };
      const plaintext = encoder.encode(JSON.stringify(envelope));
      if (plaintext.byteLength > limits.maxRecordBytes) {
        throw new RangeError(`${kind} record exceeds its encrypted local storage limit`);
      }

      const database = await this.#database();
      const key = await this.#getEncryptionKey(database, namespace, true);
      if (!key) throw new Error('Failed to create private browser storage key');
      const id = await this.#recordID(namespace, kind, logicalKey);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(id) },
        key.key,
        plaintext
      );
      const transaction = database.transaction([KEY_STORE, RECORD_STORE], 'readwrite');
      const done = transactionDone(transaction);
      const storedKey = (await requestResult(transaction.objectStore(KEY_STORE).get(namespace))) as
        | StoredEncryptionKey
        | undefined;
      if (
        !storedKey?.key ||
        storedKey.revokedAt !== undefined ||
        keyGeneration(storedKey) !== key.generation
      ) {
        transaction.abort();
        await done.catch(() => undefined);
        throw new Error('Encrypted local account storage changed while writing');
      }
      const records = transaction.objectStore(RECORD_STORE);
      const existing = (await requestResult(
        records.index('namespaceKind').getAll(IDBKeyRange.only([namespace, kind]))
      )) as StoredPrivateRecord[];
      const newest = existing.reduce((latest, record) => Math.max(latest, record.updatedAt), 0);
      const updatedAt = Math.max(now, newest + 1);
      records.put({
        id,
        namespace,
        kind,
        updatedAt,
        expiresAt: now + limits.maxAgeMs,
        byteSize: ciphertext.byteLength,
        keyGeneration: key.generation,
        iv: iv.buffer,
        ciphertext
      } satisfies StoredPrivateRecord);
      await done;
      await this.#prune(database, namespace, kind, limits, now);
    });
  }

  async delete(scope: PrivateDataScope, kind: PrivateDataKind, logicalKey: string): Promise<void> {
    const namespace = await this.#namespace(scope);
    return this.#locked(namespace, async () => {
      const database = await this.#database();
      await this.#deleteRecord(database, await this.#recordID(namespace, kind, logicalKey));
    });
  }

  async activateAccount(scope: PrivateDataScope): Promise<void> {
    const namespace = await this.#namespace(scope);
    return this.#locked(namespace, async () => {
      const database = await this.#database();
      const transaction = database.transaction(KEY_STORE, 'readwrite');
      const done = transactionDone(transaction);
      const keys = transaction.objectStore(KEY_STORE);
      const current = (await requestResult(keys.get(namespace))) as StoredEncryptionKey | undefined;
      if (current?.revokedAt !== undefined) keys.delete(namespace);
      await done;
    });
  }

  async purgeAccount(scope: PrivateDataScope): Promise<void> {
    const namespace = await this.#namespace(scope);
    return this.#locked(namespace, async () => {
      const database = await this.#database();
      const transaction = database.transaction([KEY_STORE, RECORD_STORE], 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(KEY_STORE).put({
        namespace,
        generation: newKeyGeneration(),
        revokedAt: Date.now()
      } satisfies StoredEncryptionKey);
      const records = transaction.objectStore(RECORD_STORE).index('namespace');
      const cursorRequest = records.openKeyCursor(IDBKeyRange.only(namespace));
      cursorRequest.addEventListener('success', () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        transaction.objectStore(RECORD_STORE).delete(cursor.primaryKey);
        cursor.continue();
      });
      await done;
    });
  }

  async requestPersistentStorage(): Promise<boolean> {
    if (typeof navigator === 'undefined') return false;
    const storage = navigator.storage as StorageManager & {
      persist?: () => Promise<boolean>;
      persisted?: () => Promise<boolean>;
    };
    if (!storage?.persist) return false;
    if (storage.persisted && (await storage.persisted())) return true;
    return storage.persist();
  }

  async close(): Promise<void> {
    if (!this.#databasePromise) return;
    const database = await this.#databasePromise;
    database.close();
    this.#databasePromise = null;
  }

  async #database(): Promise<IDBDatabase> {
    this.#databasePromise ??= openDatabase(() => {
      this.#databasePromise = null;
    });
    try {
      return await this.#databasePromise;
    } catch (error) {
      this.#databasePromise = null;
      throw error;
    }
  }

  async #namespace(scope: PrivateDataScope): Promise<string> {
    assertScope(scope);
    const input = `${scope.serverId}\u0000${canonicalServerOrigin(scope.serverUrl)}\u0000${scope.userId}`;
    let promise = this.#namespacePromises.get(input);
    if (!promise) {
      promise = privateDataNamespace(scope);
      this.#namespacePromises.set(input, promise);
    }
    return promise;
  }

  async #recordID(namespace: string, kind: PrivateDataKind, logicalKey: string): Promise<string> {
    return `${namespace}:${kind}:${await sha256(logicalKey)}`;
  }

  async #locked<T>(namespace: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#namespaceLocks.get(namespace) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.#namespaceLocks.set(namespace, current);
    try {
      return await current;
    } finally {
      if (this.#namespaceLocks.get(namespace) === current) {
        this.#namespaceLocks.delete(namespace);
      }
    }
  }

  async #getEncryptionKey(
    database: IDBDatabase,
    namespace: string,
    create: boolean
  ): Promise<EncryptionKeyMaterial | null> {
    const read = database.transaction(KEY_STORE, 'readonly');
    const readDone = transactionDone(read);
    const existing = (await requestResult(read.objectStore(KEY_STORE).get(namespace))) as
      | StoredEncryptionKey
      | undefined;
    await readDone;
    if (existing?.revokedAt !== undefined) {
      if (create) throw new Error('Encrypted local account storage is inactive');
      return null;
    }
    if (existing?.key) return { key: existing.key, generation: keyGeneration(existing) };
    if (!create) return null;

    const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt'
    ]);
    const candidateGeneration = newKeyGeneration();
    const write = database.transaction(KEY_STORE, 'readwrite');
    const writeDone = transactionDone(write);
    const keys = write.objectStore(KEY_STORE);
    const current = (await requestResult(keys.get(namespace))) as StoredEncryptionKey | undefined;
    if (current?.revokedAt !== undefined) {
      await writeDone;
      throw new Error('Encrypted local account storage is inactive');
    }
    const key = current?.key ?? candidate;
    const generation = current?.key ? keyGeneration(current) : candidateGeneration;
    if (!current?.key) keys.put({ namespace, key, generation, createdAt: Date.now() });
    await writeDone;
    return { key, generation };
  }

  async #recordsForKind(
    database: IDBDatabase,
    namespace: string,
    kind: PrivateDataKind
  ): Promise<StoredPrivateRecord[]> {
    const transaction = database.transaction(RECORD_STORE, 'readonly');
    const done = transactionDone(transaction);
    const records = (await requestResult(
      transaction
        .objectStore(RECORD_STORE)
        .index('namespaceKind')
        .getAll(IDBKeyRange.only([namespace, kind]))
    )) as StoredPrivateRecord[];
    await done;
    return records;
  }

  async #decryptRecord<T>(
    record: StoredPrivateRecord,
    key: EncryptionKeyMaterial
  ): Promise<PrivateDataRecord<T>> {
    if ((record.keyGeneration ?? LEGACY_KEY_GENERATION) !== key.generation) {
      throw new Error('Encrypted private data key generation changed');
    }
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(record.iv),
        additionalData: encoder.encode(record.id)
      },
      key.key,
      record.ciphertext
    );
    const envelope = JSON.parse(decoder.decode(plaintext)) as PrivateDataEnvelope<T>;
    if (!envelope || typeof envelope.logicalKey !== 'string') {
      throw new Error('Invalid encrypted private data envelope');
    }
    return {
      logicalKey: envelope.logicalKey,
      value: envelope.value,
      updatedAt: record.updatedAt,
      expiresAt: record.expiresAt
    };
  }

  async #prune(
    database: IDBDatabase,
    namespace: string,
    kind: PrivateDataKind,
    limits: PrivateDataLimits,
    now: number
  ): Promise<void> {
    const records = (await this.#recordsForKind(database, namespace, kind)).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
    let retainedCount = 0;
    let retainedBytes = 0;
    const deleteIDs: string[] = [];
    for (const record of records) {
      const fits =
        record.expiresAt > now &&
        retainedCount < limits.maxRecords &&
        retainedBytes + record.byteSize <= limits.maxBytes;
      if (!fits) {
        deleteIDs.push(record.id);
        continue;
      }
      retainedCount += 1;
      retainedBytes += record.byteSize;
    }
    if (deleteIDs.length > 0) await this.#deleteRecords(database, deleteIDs);
  }

  async #deleteRecord(database: IDBDatabase, id: string): Promise<void> {
    await this.#deleteRecords(database, [id]);
  }

  async #deleteRecords(database: IDBDatabase, ids: string[]): Promise<void> {
    const transaction = database.transaction(RECORD_STORE, 'readwrite');
    const done = transactionDone(transaction);
    const records = transaction.objectStore(RECORD_STORE);
    for (const id of ids) records.delete(id);
    await done;
  }
}

export const encryptedPrivateData = new EncryptedPrivateDataStore();
