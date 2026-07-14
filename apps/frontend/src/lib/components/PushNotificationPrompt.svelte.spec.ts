import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import { setReactiveLocale } from '$lib/i18n/state.svelte';
import PushNotificationPrompt from './PushNotificationPrompt.svelte';

const mocks = vi.hoisted(() => ({
  ensureRegistered: vi.fn(),
  getPushCapability: vi.fn(),
  getPermission: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  serverInfo: {
    pushNotificationsEnabled: true,
    vapidPublicKey: 'vapid-key' as string | null
  }
}));

vi.mock('$lib/notifications/pushNotifications', () => ({
  ensureRegistered: mocks.ensureRegistered,
  getPushCapability: mocks.getPushCapability,
  getPermission: mocks.getPermission
}));

vi.mock('$lib/ui/toast', () => ({
  toast: {
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: mocks.toastError
  }
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    originServer: { id: 'origin' },
    getStore: () => ({
      serverInfo: mocks.serverInfo
    })
  }
}));

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

function buttonWithText(container: Element, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!button) {
    throw new Error(`Button with text "${text}" not found`);
  }
  return button;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function installServiceWorkerControllerStub() {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  const listeners = new Set<(event: Event) => void>();
  const serviceWorker = {
    addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
      if (type === 'controllerchange') listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
      if (type === 'controllerchange') listeners.delete(listener);
    }),
    dispatchControllerChange() {
      for (const listener of listeners) listener(new Event('controllerchange'));
    }
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorker
  });
  return {
    serviceWorker,
    restore() {
      if (previous) Object.defineProperty(navigator, 'serviceWorker', previous);
      else Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  };
}

describe('PushNotificationPrompt', () => {
  beforeEach(() => {
    setReactiveLocale('en');
    localStorage.clear();
    mocks.serverInfo.pushNotificationsEnabled = true;
    mocks.serverInfo.vapidPublicKey = 'vapid-key';
    mocks.ensureRegistered.mockReset();
    mocks.ensureRegistered.mockResolvedValue(true);
    mocks.getPermission.mockReset();
    mocks.getPermission.mockReturnValue('default');
    mocks.getPushCapability.mockReset();
    mocks.getPushCapability.mockReturnValue('supported');
    mocks.toastSuccess.mockReset();
    mocks.toastWarning.mockReset();
    mocks.toastError.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the prompt when push is configured, supported, and permission is unset', async () => {
    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    expect(container.textContent).toContain('Enable push notifications');
    expect(container.textContent).toContain('every new channel and direct message');
    await expect.element(buttonWithText(container, 'Enable')).toBeVisible();
    await expect.element(buttonWithText(container, 'Not now')).toBeVisible();
  });

  it('does not show when permission is already granted', async () => {
    const controller = installServiceWorkerControllerStub();
    mocks.getPermission.mockReturnValue('granted');

    try {
      const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
      await settle();

      expect(container.textContent).not.toContain('Enable push notifications');
      expect(mocks.ensureRegistered).toHaveBeenCalledOnce();
      expect(mocks.ensureRegistered).toHaveBeenCalledWith('vapid-key', { prompt: false });

      controller.serviceWorker.dispatchControllerChange();
      await settle();

      expect(mocks.ensureRegistered).toHaveBeenCalledTimes(2);
      expect(mocks.ensureRegistered).toHaveBeenLastCalledWith('vapid-key', { prompt: false });
    } finally {
      controller.restore();
    }
  });

  it('re-registers a granted subscription when this browser changes language', async () => {
    mocks.getPermission.mockReturnValue('granted');
    render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    expect(mocks.ensureRegistered).toHaveBeenCalledOnce();

    setReactiveLocale('fr');
    await settle();

    expect(mocks.ensureRegistered).toHaveBeenCalledTimes(2);
    expect(mocks.ensureRegistered).toHaveBeenLastCalledWith('vapid-key', { prompt: false });
  });

  it('shows the guard again when permission is granted but push registration is unhealthy', async () => {
    mocks.getPermission.mockReturnValue('granted');
    mocks.ensureRegistered.mockResolvedValue(false);

    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    expect(container.textContent).toContain('Enable push notifications');
    await expect.element(buttonWithText(container, 'Enable')).toBeVisible();
  });

  it('requires confirmation and snoozes reminders instead of permanently opting out', async () => {
    const now = 1_750_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    buttonWithText(container, 'Not now').click();
    await settle();

    expect(container.textContent).toContain('Continue without notifications?');
    expect(localStorage.getItem('chatto:i:origin:user:user-1:pushPromptSnoozedUntil')).toBeNull();

    buttonWithText(container, 'Continue without notifications').click();
    await settle();

    expect(container.textContent).not.toContain('Enable push notifications');
    expect(Number(localStorage.getItem('chatto:i:origin:user:user-1:pushPromptSnoozedUntil'))).toBe(
      now + 7 * 24 * 60 * 60 * 1000
    );
  });

  it('shows again when a previous reminder snooze has expired', async () => {
    const now = 1_750_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    localStorage.setItem('chatto:i:origin:user:user-1:pushPromptSnoozedUntil', String(now - 1));

    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    expect(container.textContent).toContain('Enable push notifications');
  });

  it('does not honor the legacy permanent dismissal flag', async () => {
    localStorage.setItem('chatto:i:origin:user:user-1:pushPromptDismissed', '1');

    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    expect(container.textContent).toContain('Enable push notifications');
    expect(localStorage.getItem('chatto:i:origin:user:user-1:pushPromptDismissed')).toBeNull();
  });

  it('warns when browser notification permission is blocked', async () => {
    mocks.getPermission.mockReturnValue('denied');

    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    expect(container.textContent).toContain('Push notifications are blocked');
    expect(container.textContent).toContain('new channel and direct messages');
    await expect.element(buttonWithText(container, 'How to enable')).toBeVisible();
    await expect.element(buttonWithText(container, 'Not now')).toBeVisible();
  });

  it('reappears immediately when a previously granted permission is lost', async () => {
    mocks.getPermission.mockReturnValue('granted');
    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();
    expect(container.textContent).not.toContain('Push notifications are blocked');

    mocks.getPermission.mockReturnValue('denied');
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(container.textContent).toContain('Push notifications are blocked');
  });

  it('invalidates a snooze when permission was revoked while the PWA was closed', async () => {
    const snoozeKey = 'chatto:i:origin:user:user-1:pushPromptSnoozedUntil';
    localStorage.setItem(snoozeKey, String(Date.now() + 60_000));
    localStorage.setItem(
      'chatto:i:origin:user:user-1:pushPromptLastPermission',
      'granted'
    );
    mocks.getPermission.mockReturnValue('denied');

    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    expect(container.textContent).toContain('Push notifications are blocked');
    expect(localStorage.getItem(snoozeKey)).toBeNull();
  });

  it('honors a confirmed snooze while granted registration remains unhealthy', async () => {
    const snoozeKey = 'chatto:i:origin:user:user-1:pushPromptSnoozedUntil';
    const snoozedUntil = Date.now() + 60_000;
    localStorage.setItem(snoozeKey, String(snoozedUntil));
    localStorage.setItem(
      'chatto:i:origin:user:user-1:pushPromptLastPermission',
      'granted'
    );
    mocks.getPermission.mockReturnValue('granted');
    mocks.ensureRegistered.mockResolvedValue(false);

    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    expect(mocks.ensureRegistered).toHaveBeenCalledWith('vapid-key', { prompt: false });
    expect(container.textContent).not.toContain('Enable push notifications');
    expect(localStorage.getItem(snoozeKey)).toBe(String(snoozedUntil));
  });

  it('does not report a stale healthy registration when permission changes in flight', async () => {
    const registration = deferred<boolean>();
    mocks.getPermission.mockReturnValue('granted');
    mocks.ensureRegistered.mockReturnValue(registration.promise);

    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await vi.waitFor(() => expect(mocks.ensureRegistered).toHaveBeenCalledOnce());

    mocks.getPermission.mockReturnValue('denied');
    registration.resolve(true);
    await settle();

    expect(container.textContent).toContain('Push notifications are blocked');
    expect(container.textContent).not.toContain('Enable push notifications');
  });

  it('synchronizes a reminder decision made in another tab', async () => {
    const snoozeKey = 'chatto:i:origin:user:user-1:pushPromptSnoozedUntil';
    localStorage.setItem(snoozeKey, String(Date.now() + 60_000));
    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();
    expect(container.textContent).not.toContain('Enable push notifications');

    localStorage.removeItem(snoozeKey);
    window.dispatchEvent(new StorageEvent('storage', { key: snoozeKey }));
    await settle();

    expect(container.textContent).toContain('Enable push notifications');
  });

  it('reconciles the push subscription when permission is granted in browser settings', async () => {
    mocks.getPermission.mockReturnValue('denied');
    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();
    expect(container.textContent).toContain('Push notifications are blocked');

    mocks.getPermission.mockReturnValue('granted');
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(mocks.ensureRegistered).toHaveBeenCalledWith('vapid-key', { prompt: false });
    expect(container.textContent).not.toContain('Enable push notifications');
    expect(container.textContent).not.toContain('Push notifications are blocked');
  });

  it('shows iOS Home Screen guidance without registering push', async () => {
    mocks.getPushCapability.mockReturnValue('ios_home_screen_required');
    mocks.getPermission.mockReturnValue(null);

    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    expect(container.textContent).toContain('Add Towk to your Home Screen');
    expect(container.textContent).toContain('supported iOS/iPadOS versions');
    expect(container.textContent).toContain('open Towk from its Home Screen icon');
    expect(container.textContent).not.toContain('every new channel and direct message');
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('Enable')
      )
    ).toBe(false);
    expect(mocks.ensureRegistered).not.toHaveBeenCalled();
  });

  it('enables push through the registration helper', async () => {
    mocks.ensureRegistered.mockImplementation(async () => {
      mocks.getPermission.mockReturnValue('granted');
      return true;
    });

    const { container } = render(PushNotificationPrompt, { props: { userId: 'user-1' } });
    await settle();

    buttonWithText(container, 'Enable').click();
    await settle();

    expect(mocks.ensureRegistered).toHaveBeenCalledWith('vapid-key', { prompt: true });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Push notifications enabled');
    expect(container.textContent).not.toContain('Enable push notifications');
  });
});
