import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import { setReactiveLocale } from '$lib/i18n/state.svelte';
import { PWA_INSTALL_REMINDER_DELAY_MS } from '$lib/pwa/installReminderPolicy';
import PwaInstallButton from './PwaInstallButton.svelte';

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

function setBrowserEnvironment({
  userAgent,
  platform = 'Linux x86_64',
  maxTouchPoints = 0,
  installed = false
}: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  installed?: boolean;
}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(maxTouchPoints);
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: installed && query === '(display-mode: standalone)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }) as unknown as MediaQueryList
  );
}

function statusButton(container: Element): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[data-pwa-status]');
  if (!button) throw new Error('PWA status button not found');
  return button;
}

function buttonWithText(container: Element, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!button) throw new Error(`Button with text "${text}" not found`);
  return button;
}

describe('PwaInstallButton', () => {
  beforeEach(() => {
    setReactiveLocale('en');
    localStorage.clear();
    delete (window as Window & { __towkInstallPrompt?: Event | null }).__towkInstallPrompt;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('always shows browser status and the recommended Safari iOS guide', async () => {
    setBrowserEnvironment({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5
    });
    const { container, unmount } = render(PwaInstallButton);
    await settle();

    expect(statusButton(container).dataset.pwaStatus).toBe('browser');
    statusButton(container).click();
    await settle();

    expect(container.textContent).toContain('Safari on iPhone or iPad');
    expect(container.textContent).toContain('Recommended on iPhone and iPad');
    expect(container.textContent).toContain('If shown, turn on Open as Web App');
    expect(container.querySelector('[data-testid="pwa-install-browser-icon"]')).toHaveClass(
      'iconify-color',
      'logos--safari'
    );
    expect(container.textContent).not.toContain('Install now');
    unmount();
  });

  it('reports an installed display mode without showing install instructions', async () => {
    setBrowserEnvironment({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36',
      installed: true
    });
    const { container, unmount } = render(PwaInstallButton);
    await settle();

    expect(statusButton(container).dataset.pwaStatus).toBe('installed');
    statusButton(container).click();
    await settle();

    expect(container.textContent).toContain('Towk is ready in app mode');
    expect(container.querySelector('[data-testid="pwa-install-guide"]')).toBeNull();
    unmount();
  });

  it('uses the one-shot native browser install event from a user click', async () => {
    setBrowserEnvironment({
      userAgent:
        'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36'
    });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
    });
    const { container, unmount } = render(PwaInstallButton);
    await settle();

    window.dispatchEvent(event);
    statusButton(container).click();
    await settle();
    buttonWithText(container, 'Install now').click();
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    expect(statusButton(container).dataset.pwaStatus).toBe('installed');
    expect(container.textContent).not.toContain('Install now');
    unmount();
  });

  it('retains a native install event captured before the authenticated header mounts', async () => {
    setBrowserEnvironment({
      userAgent:
        'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36'
    });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
    });
    (window as Window & { __towkInstallPrompt?: Event | null }).__towkInstallPrompt = event;

    const { container, unmount } = render(PwaInstallButton);
    await settle();
    statusButton(container).click();
    await settle();
    buttonWithText(container, 'Install now').click();
    await settle();

    expect(prompt).toHaveBeenCalledOnce();
    expect(statusButton(container).dataset.pwaStatus).toBe('installed');
    expect(
      (window as Window & { __towkInstallPrompt?: Event | null }).__towkInstallPrompt
    ).toBeNull();
    unmount();
  });

  it('falls back to the browser guide when the native install dialog fails', async () => {
    setBrowserEnvironment({
      userAgent:
        'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36'
    });
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn().mockRejectedValue(new Error('browser rejected install UI')),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' })
    });
    const { container, unmount } = render(PwaInstallButton);
    await settle();

    window.dispatchEvent(event);
    statusButton(container).click();
    await settle();
    buttonWithText(container, 'Install now').click();
    await settle();

    expect(container.textContent).toContain('The browser could not open its installation dialog');
    expect(container.textContent).toContain('Choose Add to Home screen, then Install');
    unmount();
  });

  it('shows a return-visit reminder after engagement and snoozes it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));
    setBrowserEnvironment({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36'
    });
    localStorage.setItem(
      'chatto:pwaInstallReminder',
      JSON.stringify({ visits: 1, lastShownAt: 0, snoozedUntil: 0 })
    );
    const { container, unmount } = render(PwaInstallButton);
    await settle();

    await vi.advanceTimersByTimeAsync(PWA_INSTALL_REMINDER_DELAY_MS);
    await settle();
    expect(container.querySelector('[data-testid="pwa-install-reminder"]')).not.toBeNull();

    buttonWithText(container, 'Later').click();
    await settle();
    expect(container.querySelector('[data-testid="pwa-install-reminder"]')).toBeNull();
    const saved = JSON.parse(localStorage.getItem('chatto:pwaInstallReminder') ?? '{}') as {
      snoozedUntil?: number;
    };
    expect(saved.snoozedUntil).toBeGreaterThan(Date.now());
    unmount();
  });

  it('does not interrupt an unauthenticated page with a reminder', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));
    setBrowserEnvironment({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36'
    });
    localStorage.setItem(
      'chatto:pwaInstallReminder',
      JSON.stringify({ visits: 1, lastShownAt: 0, snoozedUntil: 0 })
    );
    const { container, unmount } = render(PwaInstallButton, { remindersEnabled: false });
    await settle();

    await vi.advanceTimersByTimeAsync(PWA_INSTALL_REMINDER_DELAY_MS + 30_000);
    await settle();
    expect(container.querySelector('[data-testid="pwa-install-reminder"]')).toBeNull();
    unmount();
  });
});
