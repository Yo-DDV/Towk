import { isMessagePostedEvent } from '$lib/render/eventKinds';
import type { RoomEventView } from '$lib/render/types';

/**
 * Returns the message IDs that may render a compact read-receipt indicator.
 *
 * A consecutive run of messages from the same author is represented by its
 * final visible message only. Non-message timeline events do not break a run,
 * because they do not represent another participant writing between messages.
 * Missing actor IDs are treated as unique so unrelated anonymous events are
 * never collapsed accidentally.
 */
export function readReceiptIndicatorEventIds(events: readonly RoomEventView[]): Set<string> {
  const indicatorEventIds = new Set<string>();
  let nextMessageActorKey: string | null = null;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!isMessagePostedEvent(event.event)) continue;

    const actorKey = event.actorId ?? `event:${event.id}`;
    if (actorKey === nextMessageActorKey) continue;

    indicatorEventIds.add(event.id);
    nextMessageActorKey = actorKey;
  }

  return indicatorEventIds;
}
