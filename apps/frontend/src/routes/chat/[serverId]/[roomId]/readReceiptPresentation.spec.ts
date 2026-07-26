import { describe, expect, it } from 'vitest';
import type { RoomEventView } from '$lib/render/types';
import { readReceiptIndicatorEventIds } from './readReceiptPresentation';

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

describe('readReceiptIndicatorEventIds', () => {
  it('keeps only the final message in one consecutive author run', () => {
    expect([...readReceiptIndicatorEventIds([message('a1', 'alice'), message('a2', 'alice'), message('a3', 'alice')])]).toEqual([
      'a3'
    ]);
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
});
