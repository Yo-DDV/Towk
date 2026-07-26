import type { RoomEventView } from '$lib/render/types';
import { isMessagePostedEvent } from '$lib/render/eventKinds';

export function visibleMessageEventIds(
  container: HTMLElement | null,
  viewportCoverageThreshold = 0.55
): string[] {
  if (!container) return [];
  const viewport = container.getBoundingClientRect();
  const ids: string[] = [];
  const nodes = container.querySelectorAll<HTMLElement>('[data-event-id]');
  for (const node of nodes) {
    const eventId = node.dataset.eventId;
    if (!eventId) continue;
    const rect = node.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) continue;
    const visibleTop = Math.max(rect.top, viewport.top);
    const visibleBottom = Math.min(rect.bottom, viewport.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    if (visibleHeight / rect.height >= viewportCoverageThreshold) {
      ids.push(eventId);
    }
  }
  return ids;
}

export function latestVisibleReadReceiptTarget(
  events: readonly RoomEventView[],
  visibleIds: readonly string[],
  currentUserId: string | null | undefined,
  threadRootEventId: string | null | undefined
): string | null {
  if (!currentUserId || visibleIds.length === 0) return null;
  const visible = new Set(visibleIds);
  const expectedThread = threadRootEventId ?? null;

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!visible.has(event.id)) continue;
    if (!isMessagePostedEvent(event.event)) continue;
    if (event.actorId === currentUserId) continue;

    const messageThread = event.event.threadRootEventId ?? null;
    if (
      expectedThread !== null &&
      messageThread !== expectedThread &&
      event.id !== expectedThread
    ) {
      continue;
    }

    return event.id;
  }

  return null;
}
