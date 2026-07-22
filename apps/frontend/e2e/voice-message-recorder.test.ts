import { expect } from '@playwright/test';
import { test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { waitForRoomReady } from './fixtures/realtimeSync';
import { TIMEOUTS } from './constants';
import { ChatPage, RoomPage } from './pages';

test.describe('voice message recorder', () => {
  test('records and sends a MediaRecorder voice message in supported browsers', async ({
    playwright,
    browserName,
    serverURL
  }) => {
    test.skip(browserName === 'webkit', 'Playwright WebKit does not expose MediaRecorder here');

    const browserType =
      browserName === 'firefox'
        ? playwright.firefox
        : browserName === 'chromium'
          ? playwright.chromium
          : null;
    if (!browserType) test.skip();

    const browser = await browserType.launch(
      browserName === 'firefox'
        ? {
            firefoxUserPrefs: {
              'media.navigator.permission.disabled': true,
              'media.navigator.streams.fake': true
            }
          }
        : {
            args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
          }
    );
    const context = await browser.newContext({ baseURL: serverURL });
    const page = await context.newPage();
    const chatPage = new ChatPage(page);
    const roomPage = new RoomPage(page);

    try {
      await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');
      await waitForRoomReady(page, 'general');

      await page.getByRole('button', { name: 'Record a voice message' }).click();
      await expect(page.getByTestId('voice-message-live-waveform')).toBeVisible({
        timeout: TIMEOUTS.UI_STANDARD
      });
      await page.waitForTimeout(650);
      await page.getByRole('button', { name: 'Stop recording' }).click();

      await expect(page.getByTestId('voice-message-preview')).toBeVisible({
        timeout: TIMEOUTS.UI_STANDARD
      });

      await page.getByRole('button', { name: 'Send voice message' }).click();

      await expect(page.getByTestId('voice-message-preview')).toHaveCount(0, {
        timeout: TIMEOUTS.COMPLEX_OPERATION
      });
      await expect(roomPage.messages.last().getByTestId('voice-message-player')).toBeVisible({
        timeout: TIMEOUTS.REALTIME_EVENT
      });
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
