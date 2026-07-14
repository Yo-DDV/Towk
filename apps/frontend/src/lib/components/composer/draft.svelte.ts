import { SvelteMap } from 'svelte/reactivity';
import {
  deletePersistedDraftFiles,
  deletePersistedDraft,
  encryptedPrivateData,
  loadPersistedDraftFiles,
  loadPersistedDraft,
  savePersistedDraftFiles,
  savePersistedDraft,
  type PersistedDraft,
  type PrivateDataScope
} from '$lib/pwa/offlineData';
import type { FileWithUrl } from './attachments.svelte';

const draftFilesMap = new SvelteMap<string, FileWithUrl[]>();

type DraftContext = {
  scope: PrivateDataScope;
  roomId: string;
  threadRootEventId: string | null;
};

export function draftKey(roomId: string, threadRootEventId?: string): string {
  return threadRootEventId
    ? `chatto:draft:${roomId}:thread:${threadRootEventId}`
    : `chatto:draft:${roomId}`;
}

export class DraftState {
  key = '';
  #context: DraftContext | null = null;
  #pending: PersistedDraft | null = null;
  #persistTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingFiles: { context: DraftContext; files: File[] } | null = null;
  #filePersistTimer: ReturnType<typeof setTimeout> | null = null;

  switchKey(
    key: string,
    scope: PrivateDataScope | null,
    roomId: string,
    threadRootEventId?: string | null
  ): string {
    void Promise.all([this.flush(), this.flushFiles()]).catch(() => undefined);
    this.key = key;
    this.#context = scope ? { scope, roomId, threadRootEventId: threadRootEventId ?? null } : null;
    return sessionStorage.getItem(key) ?? '';
  }

  async load(legacyText: string): Promise<PersistedDraft | null> {
    const context = this.#context;
    const key = this.key;
    if (!context) return legacyText ? { text: legacyText, richMode: false } : null;
    const persisted = await loadPersistedDraft(
      context.scope,
      context.roomId,
      context.threadRootEventId
    );
    if (persisted || !legacyText) return persisted;

    const migrated = { text: legacyText, richMode: false };
    await savePersistedDraft(context.scope, context.roomId, context.threadRootEventId, migrated);
    if (key) sessionStorage.removeItem(key);
    return migrated;
  }

  async loadFiles(): Promise<FileWithUrl[]> {
    const saved = this.takeFiles();
    if (saved.length > 0) return saved;
    const context = this.#context;
    if (!context) return [];
    const files = await loadPersistedDraftFiles(
      context.scope,
      context.roomId,
      context.threadRootEventId
    );
    return files.map((file) => ({ file, url: URL.createObjectURL(file) }));
  }

  persistText(message: string, richMode: boolean): void {
    if (!this.key) return;
    if (!this.#context) {
      if (message) sessionStorage.setItem(this.key, message);
      else sessionStorage.removeItem(this.key);
      return;
    }

    this.#pending = { text: message, richMode };
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => void this.flush().catch(() => undefined), 250);
  }

  persistFiles(files: FileWithUrl[]): void {
    const context = this.#context;
    if (!context) return;
    const values = files.map(({ file }) => file);
    this.#pendingFiles = { context, files: values };
    if (values.length > 0) {
      void encryptedPrivateData.requestPersistentStorage().catch(() => false);
    }
    if (this.#filePersistTimer) clearTimeout(this.#filePersistTimer);
    this.#filePersistTimer = setTimeout(() => void this.flushFiles().catch(() => undefined), 350);
  }

  clearText(): void {
    if (this.key) sessionStorage.removeItem(this.key);
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = null;
    this.#pending = null;
    const context = this.#context;
    if (context) {
      void deletePersistedDraft(context.scope, context.roomId, context.threadRootEventId).catch(
        () => undefined
      );
    }
  }

  async flush(): Promise<void> {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = null;
    const pending = this.#pending;
    const context = this.#context;
    const key = this.key;
    this.#pending = null;
    if (!pending || !context) return;
    try {
      await savePersistedDraft(context.scope, context.roomId, context.threadRootEventId, pending);
      if (key) sessionStorage.removeItem(key);
    } catch (error) {
      if (key) {
        if (pending.text) sessionStorage.setItem(key, pending.text);
        else sessionStorage.removeItem(key);
      }
      throw error;
    }
  }

  async flushFiles(): Promise<void> {
    if (this.#filePersistTimer) clearTimeout(this.#filePersistTimer);
    this.#filePersistTimer = null;
    const pending = this.#pendingFiles;
    this.#pendingFiles = null;
    if (!pending) return;
    await savePersistedDraftFiles(
      pending.context.scope,
      pending.context.roomId,
      pending.context.threadRootEventId,
      pending.files
    );
  }

  takeFiles(): FileWithUrl[] {
    if (!this.key) return [];
    const saved = draftFilesMap.get(this.key) ?? [];
    draftFilesMap.delete(this.key);
    return saved;
  }

  stashFiles(files: FileWithUrl[]): void {
    if (!this.key) return;
    if (files.length > 0) {
      draftFilesMap.set(this.key, files);
    } else {
      draftFilesMap.delete(this.key);
    }
    this.persistFiles(files);
  }

  discardFiles(): void {
    if (this.key) draftFilesMap.delete(this.key);
    if (this.#filePersistTimer) clearTimeout(this.#filePersistTimer);
    this.#filePersistTimer = null;
    this.#pendingFiles = null;
    const context = this.#context;
    if (context) {
      void deletePersistedDraftFiles(
        context.scope,
        context.roomId,
        context.threadRootEventId
      ).catch(() => undefined);
    }
  }

  dispose(): void {
    void Promise.all([this.flush(), this.flushFiles()]).catch(() => undefined);
  }
}
