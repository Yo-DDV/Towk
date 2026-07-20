import { expect, test, type Page } from '@playwright/test';

import { reloadCurrentPage } from './fixtures/navigation';

test('reload helper recovers before the test timeout when navigation stalls', async ({ page }) => {
  await page.setContent('<main>reload fixture</main>');

  let reloadOptions: Parameters<Page['reload']>[0];
  const originalReload = page.reload.bind(page);

  Object.defineProperty(page, 'reload', {
    configurable: true,
    value: async (options: Parameters<Page['reload']>[0]) => {
      reloadOptions = options;
      const error = new Error('page.reload: Timeout 8000ms exceeded.');
      error.name = 'TimeoutError';
      throw error;
    }
  });

  try {
    await reloadCurrentPage(page);
  } finally {
    Object.defineProperty(page, 'reload', {
      configurable: true,
      value: originalReload
    });
  }

  expect(reloadOptions).toEqual({
    waitUntil: 'domcontentloaded',
    timeout: 8_000
  });
  await expect(page.locator('html')).not.toHaveAttribute('data-e2e-reload-marker');
});
