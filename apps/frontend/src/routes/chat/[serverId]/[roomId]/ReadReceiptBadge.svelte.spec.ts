import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ReadReceiptBadge from './ReadReceiptBadge.svelte';

const mocks = vi.hoisted(() => ({
  listReadReceiptReaders: vi.fn()
}));

vi.mock('$lib/api-client/readState', () => ({
  createReadStateAPI: () => ({
    listReadReceiptReaders: mocks.listReadReceiptReaders
  })
}));

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'origin'
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    serverId: 'origin',
    connectBaseUrl: 'https://chat.example.test/api/connect',
    bearerToken: 'token'
  })
}));

describe('ReadReceiptBadge', () => {
  beforeEach(() => {
    mocks.listReadReceiptReaders.mockReset().mockResolvedValue({
      enabled: true,
      readers: [],
      totalCount: 0,
      hasMore: false
    });
  });

  it('shows only the receipt icon and count while preserving an accessible label', () => {
    const { container } = render(ReadReceiptBadge, {
      roomId: 'room-1',
      messageEventId: 'event-1',
      summary: {
        messageEventId: 'event-1',
        readerCount: 2
      }
    });

    const indicator = container.querySelector(
      '[data-testid="read-receipt-indicator"]'
    ) as HTMLButtonElement | null;

    expect(indicator).toBeTruthy();
    expect(indicator?.textContent?.trim()).toBe('2');
    expect(indicator?.querySelector('.uil--check-circle')).toBeTruthy();
    expect(indicator?.getAttribute('aria-label')).toContain('2');
    expect(indicator?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(indicator?.className).toContain('opacity-70');
    expect(indicator?.className).toContain('hover:opacity-90');
    expect(indicator?.className).toContain('focus-visible:opacity-100');
  });

  it('refreshes the reader list whenever the badge is reopened', async () => {
    mocks.listReadReceiptReaders
      .mockResolvedValueOnce({
        enabled: true,
        readers: [
          {
            id: 'alice',
            login: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            deleted: false,
            readAt: '2026-07-27T10:00:00.000Z'
          }
        ],
        totalCount: 1,
        hasMore: false
      })
      .mockResolvedValueOnce({
        enabled: true,
        readers: [
          {
            id: 'alice',
            login: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            deleted: false,
            readAt: '2026-07-27T10:00:00.000Z'
          },
          {
            id: 'bob',
            login: 'bob',
            displayName: 'Bob',
            avatarUrl: null,
            deleted: false,
            readAt: '2026-07-27T10:01:00.000Z'
          }
        ],
        totalCount: 2,
        hasMore: false
      });

    const { container } = render(ReadReceiptBadge, {
      roomId: 'room-1',
      messageEventId: 'event-1',
      summary: {
        messageEventId: 'event-1',
        readerCount: 2
      }
    });
    const indicator = container.querySelector(
      '[data-testid="read-receipt-indicator"]'
    ) as HTMLButtonElement;

    indicator.click();
    await vi.waitFor(() => expect(mocks.listReadReceiptReaders).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(document.body.textContent).toContain('Alice'));

    indicator.click();
    indicator.click();

    await vi.waitFor(() => expect(mocks.listReadReceiptReaders).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(document.body.textContent).toContain('Bob'));
  });

  it('closes the reader dialog with Escape and restores trigger focus', async () => {
    const { container } = render(ReadReceiptBadge, {
      roomId: 'room-1',
      messageEventId: 'event-1',
      summary: {
        messageEventId: 'event-1',
        readerCount: 1
      }
    });
    const indicator = container.querySelector(
      '[data-testid="read-receipt-indicator"]'
    ) as HTMLButtonElement;

    indicator.click();
    await vi.waitFor(() => expect(indicator.getAttribute('aria-expanded')).toBe('true'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await vi.waitFor(() => expect(indicator.getAttribute('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(indicator);
  });
});
