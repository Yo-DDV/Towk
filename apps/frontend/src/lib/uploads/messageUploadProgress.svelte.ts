import { SvelteMap } from 'svelte/reactivity';
import {
  applyMessageUploadProgress,
  createMessageUploadProgressEntry,
  failMessageUploadProgress,
  transitionMessageUploadProgress,
  type BeginMessageUploadInput,
  type MessageUploadProgressEntry,
  type MessageUploadProgressUpdate
} from './messageUploadProgressModel';

const entriesById = new SvelteMap<string, MessageUploadProgressEntry>();
const dismissalTimers = new Map<string, ReturnType<typeof setTimeout>>();
const CONFIRMED_VISIBLE_MS = 1_100;

function replace(entry: MessageUploadProgressEntry): void {
  entriesById.set(entry.id, entry);
}

function clearTimer(id: string): void {
  const timer = dismissalTimers.get(id);
  if (timer) clearTimeout(timer);
  dismissalTimers.delete(id);
}

function dismissAfterConfirmation(id: string): void {
  clearTimer(id);
  const timer = setTimeout(() => {
    const current = entriesById.get(id);
    if (current?.phase === 'confirmed') entriesById.delete(id);
    dismissalTimers.delete(id);
  }, CONFIRMED_VISIBLE_MS);
  dismissalTimers.set(id, timer);
}

export const messageUploadProgress = {
  get entries(): MessageUploadProgressEntry[] {
    return [...entriesById.values()].sort((left, right) => left.startedAt - right.startedAt);
  },

  begin(input: BeginMessageUploadInput): MessageUploadProgressEntry {
    clearTimer(input.id);
    entriesById.delete(input.id);
    for (const entry of entriesById.values()) {
      if (
        entry.serverId === (input.serverId ?? '') &&
        entry.roomId === input.roomId &&
        entry.threadRootEventId === (input.threadRootEventId ?? null) &&
        entry.phase === 'failed'
      ) {
        clearTimer(entry.id);
        entriesById.delete(entry.id);
      }
    }
    const entry = createMessageUploadProgressEntry(input);
    replace(entry);
    return entry;
  },

  update(id: string, update: MessageUploadProgressUpdate, now = Date.now()): void {
    const entry = entriesById.get(id);
    if (!entry) return;
    replace(applyMessageUploadProgress(entry, update, now));
  },

  markSending(id: string, now = Date.now()): void {
    const entry = entriesById.get(id);
    if (!entry) return;
    replace(transitionMessageUploadProgress(entry, 'sending', now));
  },

  markConfirming(id: string, now = Date.now()): void {
    const entry = entriesById.get(id);
    if (!entry) return;
    replace(transitionMessageUploadProgress(entry, 'confirming', now));
  },

  markConfirmed(id: string, now = Date.now()): void {
    const entry = entriesById.get(id);
    if (!entry) return;
    replace(transitionMessageUploadProgress(entry, 'confirmed', now));
    dismissAfterConfirmation(id);
  },

  fail(id: string, now = Date.now()): void {
    const entry = entriesById.get(id);
    if (!entry) return;
    clearTimer(id);
    replace(failMessageUploadProgress(entry, now));
  },

  dismiss(id: string): void {
    clearTimer(id);
    entriesById.delete(id);
  },

  resetForTests(): void {
    for (const id of dismissalTimers.keys()) clearTimer(id);
    entriesById.clear();
  }
};
