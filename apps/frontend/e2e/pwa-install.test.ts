import { expect, type Page } from '@playwright/test';
import { test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';

type BrowserEnvironment = {
  userAgent: string;
  platform: string;
  maxTouchPoints?: number;
};

async function openTowk(
  page: Page,
  chatPage: { goto(): Promise<void> },
  environment: BrowserEnvironment
) {
  await page.addInitScript(({ userAgent, platform, maxTouchPoints = 0 }) => {
    Object.defineProperties(navigator, {
      userAgent: { configurable: true, get: () => userAgent },
      platform: { configurable: true, get: () => platform },
      maxTouchPoints: { configurable: true, get: () => maxTouchPoints }
    });
  }, environment);
  await createAndLoginTestUser(page);
  await chatPage.goto();
  await expect(page.locator('.app-header')).toBeVisible();
}

test.describe('PWA installation', () => {
  test('does not promote installation in Chromium without a native install prompt', async ({
    page,
    chatPage
  }) => {
    await page.clock.install({ time: new Date('2026-07-20T12:00:00Z') });
    await page.addInitScript(() => {
      localStorage.setItem(
        'chatto:pwaInstallReminder',
        JSON.stringify({ visits: 1, lastShownAt: 0, snoozedUntil: 0 })
      );
    });
    await openTowk(page, chatPage, {
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36',
      platform: 'Linux x86_64'
    });

    await page.clock.fastForward(90_000);

    await expect(page.locator('[data-pwa-status]')).toHaveCount(0);
    await expect(page.getByTestId('pwa-install-reminder')).toHaveCount(0);
  });

  test('uses the native Android install action and removes it after acceptance', async ({
    page,
    chatPage
  }) => {
    await openTowk(page, chatPage, {
      userAgent:
        'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv81',
      maxTouchPoints: 5
    });
    await page.evaluate(() => {
      const target = window as typeof window & { __pwaPromptCalls?: number };
      target.__pwaPromptCalls = 0;
      window.dispatchEvent(
        Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
          prompt: async () => {
            target.__pwaPromptCalls = (target.__pwaPromptCalls ?? 0) + 1;
          },
          userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' })
        })
      );
    });

    await page.locator('[data-pwa-status="browser"]').click();
    await expect(page.getByRole('button', { name: 'Install now' })).toBeVisible();
    await expect(page.getByTestId('pwa-install-guide')).toHaveCount(0);

    await page.getByRole('button', { name: 'Install now' }).click();

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as typeof window & { __pwaPromptCalls?: number }).__pwaPromptCalls
        )
      )
      .toBe(1);
    await expect(page.locator('[data-pwa-status]')).toHaveCount(0);
  });

  test('shows only Linux-compatible alternatives to Firefox', async ({ page, chatPage }) => {
    await openTowk(page, chatPage, {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:152.0) Gecko/20100101 Firefox/152.0',
      platform: 'Linux x86_64'
    });

    await page.locator('[data-pwa-status="browser"]').click();

    const guide = page.getByTestId('pwa-install-guide');
    await expect(guide).toContainText('Firefox cannot install Towk on this system');
    await expect(guide).toContainText('Open this page in Chrome or Edge');
    await expect(guide).not.toContainText('Safari');
  });

  test('keeps every iPhone Safari step in view on small portrait and landscape screens', async ({
    page,
    chatPage
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openTowk(page, chatPage, {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5
    });

    await page.locator('[data-pwa-status="browser"]').click();
    const dialog = page.locator('dialog[open]');
    const finalStep = page.getByTestId('pwa-install-guide').locator('li').last();

    await expect(finalStep).toBeInViewport({ ratio: 1 });
    const portraitBounds = await dialog.boundingBox();
    expect(portraitBounds).not.toBeNull();
    expect(portraitBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((portraitBounds?.y ?? 0) + (portraitBounds?.height ?? 569)).toBeLessThanOrEqual(568);

    await page.setViewportSize({ width: 640, height: 360 });

    await expect(finalStep).toBeInViewport({ ratio: 1 });
    const landscapeBounds = await dialog.boundingBox();
    expect(landscapeBounds).not.toBeNull();
    expect(landscapeBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((landscapeBounds?.y ?? 0) + (landscapeBounds?.height ?? 361)).toBeLessThanOrEqual(360);
  });
});
