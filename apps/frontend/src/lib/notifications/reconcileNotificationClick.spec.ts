import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileNotificationClick } from './reconcileNotificationClick';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    originServer: { id: 'origin' } as { id: string } | undefined,
    isAuthenticated: true,
    dismissById: vi.fn(() => Promise.resolve(true)),
    fetch: vi.fn(() => Promise.resolve()),
    refreshNotificationCounts: vi.fn(() => Promise.resolve())
  }
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    get originServer() {
      return mocks.originServer;
    },
    tryGetStore: () => ({
      isAuthenticated: mocks.isAuthenticated,
      notifications: {
        dismissById: mocks.dismissById,
        fetch: mocks.fetch
      },
      rooms: {
        refreshNotificationCounts: mocks.refreshNotificationCounts
      }
    })
  }
}));

describe('reconcileNotificationClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.originServer = { id: 'origin' };
    mocks.isAuthenticated = true;
    mocks.dismissById.mockResolvedValue(true);
    mocks.fetch.mockResolvedValue(undefined);
    mocks.refreshNotificationCounts.mockResolvedValue(undefined);
  });

  it('dismisses the exact notification before refreshing authoritative counters', async () => {
    await expect(reconcileNotificationClick('notification-1')).resolves.toBe(true);

    expect(mocks.dismissById).toHaveBeenCalledWith('notification-1');
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.refreshNotificationCounts).toHaveBeenCalledOnce();
    expect(mocks.dismissById.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetch.mock.invocationCallOrder[0]
    );
  });

  it('ignores empty or unauthenticated click identities', async () => {
    await expect(reconcileNotificationClick(undefined)).resolves.toBe(true);
    mocks.isAuthenticated = false;
    await expect(reconcileNotificationClick('notification-2')).resolves.toBe(false);

    expect(mocks.dismissById).not.toHaveBeenCalled();
  });
});
