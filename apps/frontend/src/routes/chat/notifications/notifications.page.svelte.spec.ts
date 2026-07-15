import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { q } from '$lib/test-utils';
import { loadLocaleMessages } from '$lib/i18n/messages';
import { setReactiveLocale } from '$lib/i18n/state.svelte';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    goto: vi.fn(),
    appUi: {
      disableRoomCallWideFor: vi.fn()
    },
    dismissNativeNotification: vi.fn(),
    reconcileNativeNotifications: vi.fn(),
    notification: {
      id: 'mention-1',
      kind: 'mention',
      createdAt: new Date().toISOString(),
      actor: null,
      summary: 'Mentioned you in a message',
      mentionRoom: { id: 'room-1', name: 'general' },
      mentionEventId: 'event-1',
      mentionInThread: 'thread-1'
    },
    store: {
      isAuthenticated: true,
      serverInfo: {
        name: 'Test Server'
      },
      notifications: {
        notifications: [] as unknown[],
        unreadNotificationCount: 1,
        fetch: vi.fn().mockResolvedValue(undefined),
        dismiss: vi.fn().mockResolvedValue(true),
        dismissAll: vi.fn().mockResolvedValue(0),
        getCleanPath: vi.fn().mockReturnValue('/chat/-/room-1/thread-1'),
        getLocationString: vi.fn().mockReturnValue('#general in Test Server')
      },
      pendingHighlights: {
        set: vi.fn()
      },
      rooms: {
        decrementUnreadNotification: vi.fn(),
        refreshNotificationCounts: vi.fn().mockResolvedValue(undefined),
        clearAllUnreadNotifications: vi.fn()
      }
    }
  }
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto,
  pushState: vi.fn(),
  replaceState: vi.fn()
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    servers: [{ id: 'origin', url: 'https://chat.example.test' }],
    getStore: vi.fn(() => mocks.store)
  }
}));

vi.mock('$lib/state/appUi.svelte', () => ({
  getAppUiState: () => mocks.appUi
}));

vi.mock('$lib/state/userSettings.svelte', () => ({
  getUserSettings: () => ({})
}));

vi.mock('$lib/notifications/pushNotifications', () => ({
  dismissNativeNotification: mocks.dismissNativeNotification,
  reconcileNativeNotifications: mocks.reconcileNativeNotifications
}));

import NotificationsPage from './+page.svelte';

describe('notifications page', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await loadLocaleMessages('en');
    setReactiveLocale('en');
    mocks.store.notifications.notifications = [mocks.notification];
    mocks.store.notifications.fetch.mockResolvedValue(undefined);
    mocks.store.notifications.dismiss.mockResolvedValue(true);
    mocks.store.notifications.getCleanPath.mockReturnValue('/chat/-/room-1/thread-1');
    mocks.store.notifications.getLocationString.mockReturnValue('#general in Test Server');
    mocks.store.rooms.refreshNotificationCounts.mockResolvedValue(undefined);
  });

  it('reveals the target room before navigating from a notification row', async () => {
    const { container } = render(NotificationsPage);

    const item = q(container, '[data-testid="notification-item"]') as HTMLElement;
    await expect.element(item).toBeInTheDocument();
    item.click();

    await vi.waitFor(() => {
      expect(mocks.appUi.disableRoomCallWideFor).toHaveBeenCalledWith('origin', 'room-1');
      expect(mocks.appUi.disableRoomCallWideFor.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.goto.mock.invocationCallOrder[0]
      );
      expect(mocks.store.pendingHighlights.set).toHaveBeenCalledWith(
        'room-1',
        'thread-1',
        'event-1'
      );
      expect(mocks.store.notifications.dismiss).toHaveBeenCalledWith('mention-1');
      expect(mocks.dismissNativeNotification).toHaveBeenCalledWith('mention-1');
      expect(mocks.goto).toHaveBeenCalledWith('/chat/-/room-1/thread-1');
    });
  });

  it('closes the matching native notification when dismissing from the list', async () => {
    const { container } = render(NotificationsPage);

    const dismiss = q(container, 'button[title="Dismiss"]') as HTMLButtonElement;
    dismiss.click();

    await vi.waitFor(() => {
      expect(mocks.store.notifications.dismiss).toHaveBeenCalledWith('mention-1');
      expect(mocks.dismissNativeNotification).toHaveBeenCalledWith('mention-1');
      expect(mocks.store.rooms.decrementUnreadNotification).toHaveBeenCalledWith('room-1');
      expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalled();
    });
  });

  it('clears native notifications when clearing all pending notifications', async () => {
    mocks.store.notifications.dismissAll.mockResolvedValue(1);
    const { container } = render(NotificationsPage);

    const clearAll = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Clear all')
    ) as HTMLButtonElement | undefined;
    expect(clearAll).toBeTruthy();
    clearAll?.click();

    await vi.waitFor(() => {
      expect(mocks.store.notifications.dismissAll).toHaveBeenCalledOnce();
      expect(mocks.reconcileNativeNotifications).toHaveBeenCalledWith([]);
      expect(mocks.store.rooms.clearAllUnreadNotifications).toHaveBeenCalledOnce();
      expect(mocks.store.rooms.refreshNotificationCounts).toHaveBeenCalled();
    });
  });
});
