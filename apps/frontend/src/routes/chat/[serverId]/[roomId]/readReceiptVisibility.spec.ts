import { describe, expect, it } from 'vitest';
import type { RoomEventView } from '$lib/render/types';
import { latestVisibleReadReceiptTarget } from './readReceiptVisibility';

function message(
  id: string,
  actorId: string,
  threadRootEventId: string | null = null
): RoomEventView {
  return {
    id,
    createdAt: '2026-07-25T12:00:00Z',
    actorId,
    actor: null,
    event: {
      kind: 'messagePosted',
      roomId: 'room-1',
      attachments: [],
      reactions: [],
      threadRootEventId,
      replyCount: 0,
      threadParticipants: []
    }
  };
}

function echo(id: string, actorId: string): RoomEventView {
  const event = message(id, actorId);
  if (event.event?.kind === 'messagePosted') {
    event.event.echoOfEventId = `${id}-source`;
  }
  return event;
}

describe('latestVisibleReadReceiptTarget', () => {
  it('selects the newest visible message from another user', () => {
    const events = [message('m1', 'alice'), message('m2', 'self'), message('m3', 'bob')];

    expect(latestVisibleReadReceiptTarget(events, ['m1', 'm2', 'm3'], 'self', null)).toBe('m3');
  });

  it('does not publish receipts for the viewer’s own messages', () => {
    const events = [message('m1', 'self'), message('m2', 'self')];

    expect(latestVisibleReadReceiptTarget(events, ['m1', 'm2'], 'self', null)).toBeNull();
  });

  it('keeps thread receipts scoped to the active thread', () => {
    const events = [
      message('root', 'alice'),
      message('thread-a', 'bob', 'root'),
      message('thread-b', 'cara', 'other-root')
    ];

    expect(latestVisibleReadReceiptTarget(events, ['thread-a', 'thread-b'], 'self', 'root')).toBe(
      'thread-a'
    );
  });

  it('skips thread echo events and advances to the latest canonical message', () => {
    const events = [message('canonical', 'alice'), echo('thread-echo', 'bob')];

    expect(latestVisibleReadReceiptTarget(events, ['canonical', 'thread-echo'], 'self', null)).toBe(
      'canonical'
    );
  });
});
