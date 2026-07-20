import type { Page } from '@playwright/test';

const RELOAD_STEP_TIMEOUT_MS = 8_000;

export async function reloadCurrentPage(page: Page): Promise<void> {
  const expectedUrl = page.url();
  const marker = `reload-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await page.evaluate((value) => {
    document.documentElement.dataset.e2eReloadMarker = value;
  }, marker);

  try {
    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: RELOAD_STEP_TIMEOUT_MS
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !(error instanceof Error && error.name === 'TimeoutError') &&
      !message.includes('net::ERR_ABORTED') &&
      !message.includes('interrupted by another navigation')
    ) {
      throw error;
    }

    // Chromium can abort page.reload() when the application starts a
    // competing navigation during hydration. Re-navigate to the exact same
    // URL so this helper still proves a fresh document instead of accepting
    // the old page after the interrupted reload.
    await page.goto(expectedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: RELOAD_STEP_TIMEOUT_MS
    });
  }

  await page.waitForFunction(
    ({ previousMarker, url }) =>
      window.location.href === url &&
      document.readyState !== 'loading' &&
      document.documentElement.dataset.e2eReloadMarker !== previousMarker,
    { previousMarker: marker, url: expectedUrl },
    { timeout: RELOAD_STEP_TIMEOUT_MS }
  );
}

export async function unloadPageForIdentitySwitch(page: Page): Promise<void> {
  try {
    await page.goto('about:blank');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !message.includes('net::ERR_ABORTED') &&
      !message.includes('interrupted by another navigation')
    ) {
      throw error;
    }
  }
}
