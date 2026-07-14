import { SvelteMap } from 'svelte/reactivity';
import {
  deletePersistedDraft,
  loadPersistedDraft,
  savePersistedDraft,
  type PersistedDraft,
  type PrivateDataScope
} from '$lib/pwa/offlineData';
import type { FileWithUrl } from './attachments.svelte';

const draftFilesMap = new SvelteMap<string, FileWithUrl[]>();

export function draftKey(roomId: string, threadRootEventId?: string): string {
  return threadRootEventId
    ? `chatto:draft:${roomId}:thread:${threadRootEventId}`
    : `chatto:draft:${roomId}`;
}

export class DraftState {
  key = '';
  #context: {
    scope: PrivateDataScope;
    roomId: string;
    threadRootEventId: string | null;
  } | null = null;
  #pending: PersistedDraft | null = null;
  #persistTimer: ReturnType<typeof setTimeout> | null = null;

  switchKey(
    key: string,
    scope: PrivateDataScope | null,
    roomId: string,
    threadRootEventId?: string | null
  ): string {
    void this.flush().catch(() => undefined);
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
  }

  discardFiles(): void {
    if (this.key) draftFilesMap.delete(this.key);
  }

  dispose(): void {
    void this.flush().catch(() => undefined);
  }
}
