import { expect } from '@playwright/test';
import { test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { TIMEOUTS } from './constants';

test.describe('Desktop emoji picker', () => {
  test('browses, previews, inserts, and sends an emoji from the composer', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    await roomPage.messageInput.click();
    await roomPage.messageInput.pressSequentially('Launch now');
    for (let index = 0; index < 3; index += 1) {
      await roomPage.messageInput.press('ArrowLeft');
    }

    const trigger = page.getByTestId('composer-emoji-button');
    await expect(trigger).toBeVisible({ timeout: TIMEOUTS.UI_FAST });
    await trigger.click();

    const picker = page.getByTestId('composer-emoji-picker');
    await expect(picker).toBeVisible({ timeout: TIMEOUTS.UI_FAST });

    await picker.getByTestId('emoji-picker-search').fill(':rocket:');
    const rocket = picker.locator('button[title=":rocket:"]');
    await expect(rocket).toBeVisible({ timeout: TIMEOUTS.UI_FAST });
    await rocket.hover();
    await expect(picker.getByTestId('emoji-picker-preview-shortcode')).toHaveText(':rocket:');

    await rocket.click();
    await expect(picker).not.toBeVisible();
    await expect(roomPage.messageInput).toHaveText('Launch 🚀now');

    await roomPage.messageInput.press('Enter');
    await expect(page.locator('[role="article"]', { hasText: 'Launch 🚀now' })).toBeVisible({
      timeout: TIMEOUTS.UI_STANDARD
    });
  });
});
