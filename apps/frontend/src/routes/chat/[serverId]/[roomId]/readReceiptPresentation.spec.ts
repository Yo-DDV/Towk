import { describe, expect, it } from 'vitest';
import type { RoomEventView } from '$lib/render/types';
import {
  READ_RECEIPT_SUMMARY_BATCH_LIMIT,
  readReceiptIndicatorEventIds,
  readReceiptSummaryEventIds,
  shouldShowReadReceiptIndicator,
  withReadReceiptPresentation
} from './readReceiptPresentation';

function message(id: string, actorId?: string | null): RoomEventView {
  return {
    id,
    actorId,
    createdAt: '2026-07-26T12:00:00.000Z',
    event: {
      kind: 'messagePosted',
      roomId: 'room-1',
      body: id,
      attachments: [],
      reactions: [],
      replyCount: 0,
      threadParticipants: []
    }
  };
}

function systemEvent(id: string): RoomEventView {
  return {
    id,
    actorId: 'system',
    createdAt: '2026-07-26T12:00:00.000Z',
    event: {
      kind: 'callStarted',
      roomId: 'room-1',
      callId: `call-${id}`
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

describe('readReceiptIndicatorEventIds', () => {
  it('keeps only the final message in one consecutive author run', () => {
    const ids = readReceiptIndicatorEventIds([
      message('a1', 'alice'),
      message('a2', 'alice'),
      message('a3', 'alice')
    ]);

    expect(ids).toEqual(new Set(['a3']));
  });

  it('keeps the final message of every author run', () => {
    const ids = readReceiptIndicatorEventIds([
      message('a1', 'alice'),
      message('a2', 'alice'),
      message('b1', 'bob'),
      message('b2', 'bob'),
      message('a3', 'alice')
    ]);

    expect(ids).toEqual(new Set(['a2', 'b2', 'a3']));
  });

  it('does not split a run on non-message timeline events', () => {
    const ids = readReceiptIndicatorEventIds([
      message('a1', 'alice'),
      systemEvent('call-1'),
      message('a2', 'alice')
    ]);

    expect(ids).toEqual(new Set(['a2']));
  });

  it('does not collapse messages whose author identity is unavailable', () => {
    const ids = readReceiptIndicatorEventIds([message('unknown-1'), message('unknown-2')]);

    expect(ids).toEqual(new Set(['unknown-1', 'unknown-2']));
  });

  it('requests summaries only for the final message of each author run', () => {
    const presented = withReadReceiptPresentation([
      message('a1', 'alice'),
      message('a2', 'alice'),
      message('b1', 'bob')
    ]);

    expect(readReceiptSummaryEventIds(presented)).toEqual(['a2', 'b1']);
  });

  it('excludes thread echo events that the public receipt API rejects', () => {
    const presented = withReadReceiptPresentation([
      message('room-message', 'alice'),
      echo('thread-echo', 'bob')
    ]);

    expect(readReceiptSummaryEventIds(presented)).toEqual(['room-message']);
  });

  it('bounds summary requests to the protobuf batch limit', () => {
    const presented = withReadReceiptPresentation(
      Array.from({ length: READ_RECEIPT_SUMMARY_BATCH_LIMIT + 5 }, (_, index) =>
        message(`m${index}`, `user-${index}`)
      )
    );
    const ids = readReceiptSummaryEventIds(presented);

    expect(ids).toHaveLength(READ_RECEIPT_SUMMARY_BATCH_LIMIT);
    expect(ids[0]).toBe('m5');
    expect(ids.at(-1)).toBe(`m${READ_RECEIPT_SUMMARY_BATCH_LIMIT + 4}`);
  });

  it('decorates each timeline independently and leaves source events untouched', () => {
    const first = message('a1', 'alice');
    const second = message('a2', 'alice');
    const presented = withReadReceiptPresentation([first, second]);

    expect(presented[0]).not.toBe(first);
    expect(presented[1]).not.toBe(second);
    expect(shouldShowReadReceiptIndicator(first)).toBe(true);
    expect(shouldShowReadReceiptIndicator(presented[0])).toBe(false);
    expect(shouldShowReadReceiptIndicator(presented[1])).toBe(true);
  });
});
