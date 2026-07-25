import { describe, expect, it } from 'vitest';
import { canEditMessage } from './messageEditPolicy';

const nowMs = Date.parse('2026-07-25T12:00:00Z');

describe('canEditMessage', () => {
  it('allows an author to edit within the server window', () => {
    expect(
      canEditMessage({
        isAuthor: true,
        canManageOthersMessage: true,
        createdAt: '2026-07-25T10:00:00Z',
        messageEditWindowSeconds: 3 * 60 * 60,
        nowMs
      })
    ).toBe(true);
  });

  it('does not let message.manage bypass the window for the author', () => {
    expect(
      canEditMessage({
        isAuthor: true,
        canManageOthersMessage: true,
        createdAt: '2026-07-25T08:00:00Z',
        messageEditWindowSeconds: 3 * 60 * 60,
        nowMs
      })
    ).toBe(false);
  });

  it('allows message.manage to edit another user message outside the window', () => {
    expect(
      canEditMessage({
        isAuthor: false,
        canManageOthersMessage: true,
        createdAt: '2026-07-24T08:00:00Z',
        messageEditWindowSeconds: 3 * 60 * 60,
        nowMs
      })
    ).toBe(true);
  });

  it('rejects another user message without message.manage', () => {
    expect(
      canEditMessage({
        isAuthor: false,
        canManageOthersMessage: false,
        createdAt: '2026-07-25T10:00:00Z',
        messageEditWindowSeconds: 3 * 60 * 60,
        nowMs
      })
    ).toBe(false);
  });
});
