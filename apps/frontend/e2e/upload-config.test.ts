import { expect } from '@playwright/test';
import { test } from './setup';
import { TIMEOUTS } from './constants';
import { createAndLoginTestUser } from './fixtures/testUser';

test.use({
  serverOptions: {
    env: {
      CHATTO_CORE_ASSETS_MAX_UPLOAD_SIZE: '10KB',
      CHATTO_VIDEO_ENABLED: 'false'
    }
  }
});

test.describe('upload configuration', () => {
  test('server upload size limit reaches the composer', async ({ page, chatPage, roomPage }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    await roomPage.fileInput.setInputFiles('e2e/fixtures/brighton.jpg');

    await expect(page.getByText('too large')).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(roomPage.attachmentPreview).not.toBeVisible();
  });

  test('processing-disabled server accepts and renders the original video', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    await expect(roomPage.fileInput).not.toHaveAttribute('accept');
    await roomPage.fileInput.setInputFiles('e2e/fixtures/test-video.mp4');
    await expect(roomPage.videoAttachmentPreview).toBeVisible();

    const text = `Original video ${Date.now()}`;
    await roomPage.messageInput.fill(text);
    await roomPage.messageInput.press('Enter');

    const message = roomPage.getMessage(text);
    await expect(roomPage.rawVideoPlayer).toBeVisible({
      timeout: TIMEOUTS.UI_STANDARD
    });
    await expect(message.locator.locator('media-player')).toHaveCount(0);
  });
});
