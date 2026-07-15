import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import { setReactiveLocale } from '$lib/i18n/state.svelte';
import { q } from '$lib/test-utils';
import PwaAndroidStandaloneNotice from './PwaAndroidStandaloneNotice.svelte';

const originalMatchMedia = window.matchMedia;

function displayModeQueryList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  };
}

function installRuntimeEnvironment({
  userAgent,
  standalone = false,
  minimalUi = false
}: {
  userAgent: string;
  standalone?: boolean;
  minimalUi?: boolean;
}) {
  vi.stubGlobal('navigator', {
    userAgent,
    platform: 'Linux armv8l',
    maxTouchPoints: 5
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) =>
      displayModeQueryList(
        query,
        (query === '(display-mode: standalone)' && standalone) ||
          (query === '(display-mode: minimal-ui)' && minimalUi)
      )
    )
  });
}

async function settle() {
  await Promise.resolve();
  flushSync();
}

describe('PwaAndroidStandaloneNotice', () => {
  beforeEach(() => {
    setReactiveLocale('en');
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia
    });
  });

  it('blocks legacy Android standalone installs with a visible migration action', async () => {
    installRuntimeEnvironment({
      userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141',
      standalone: true
    });

    const { container } = render(PwaAndroidStandaloneNotice);
    await settle();

    await expect.element(q(container, '[role="dialog"]')).toBeVisible();
    expect(container.textContent).toContain('Update the Android app install.');
    expect(container.textContent).toContain('old standalone mode');

    q(container, 'button')!.click();

    const [target, windowTarget, features] = vi.mocked(window.open).mock.calls[0]!;
    expect(target).toContain('package=com.android.chrome');
    expect(target).toContain(`S.browser_fallback_url=${encodeURIComponent(window.location.href)}`);
    expect(windowTarget).toBe('_blank');
    expect(features).toBe('noopener,noreferrer');
    await expect.element(q(container, '[role="dialog"]')).toBeVisible();
  });

  it('does not show for current Android minimal-ui installs', async () => {
    installRuntimeEnvironment({
      userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141',
      minimalUi: true
    });

    const { container } = render(PwaAndroidStandaloneNotice);
    await settle();

    expect(q(container, '[role="dialog"]')).toBeNull();
  });

  it('does not show for non-Android standalone contexts', async () => {
    installRuntimeEnvironment({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      standalone: true
    });

    const { container } = render(PwaAndroidStandaloneNotice);
    await settle();

    expect(q(container, '[role="dialog"]')).toBeNull();
  });
});
