import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ReadReceiptBadge from './ReadReceiptBadge.svelte';

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
  it('shows only the receipt icon and count while preserving an accessible label', () => {
    const { container } = render(ReadReceiptBadge, {
      roomId: 'room-1',
      messageEventId: 'event-1',
      summary: {
        messageEventId: 'event-1',
        readerCount: 2,
        latestReadAt: null
      }
    });

    const indicator = container.querySelector(
      '[data-testid="read-receipt-indicator"]'
    ) as HTMLButtonElement | null;

    expect(indicator).toBeTruthy();
    expect(indicator?.textContent?.trim()).toBe('2');
    expect(indicator?.querySelector('.uil--check-circle')).toBeTruthy();
    expect(indicator?.getAttribute('aria-label')).toContain('2');
    expect(indicator?.className).toContain('opacity-70');
    expect(indicator?.className).toContain('hover:opacity-90');
    expect(indicator?.className).toContain('focus-visible:opacity-100');
  });
});
