import type { OutboxSentDetail } from './outbox.svelte';

export const OUTBOX_MESSAGE_SENT_EVENT = 'towk:outbox-message-sent';

export function notifyOutboxMessageSent(detail: OutboxSentDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OUTBOX_MESSAGE_SENT_EVENT, { detail }));
}

export function onOutboxMessageSent(handler: (detail: OutboxSentDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<OutboxSentDetail>).detail;
    if (!detail?.message.roomId || !detail.message.clientRequestId) return;
    handler(detail);
  };
  window.addEventListener(OUTBOX_MESSAGE_SENT_EVENT, listener);
  return () => window.removeEventListener(OUTBOX_MESSAGE_SENT_EVENT, listener);
}
