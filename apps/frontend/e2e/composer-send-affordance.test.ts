import { expect } from '@playwright/test';
import { test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { TIMEOUTS } from './constants';

test.describe('Composer send affordance', () => {
  test('locks voice capture and promotes send as editor content changes', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const input = roomPage.messageInput;
    const voiceButton = page.getByTestId('voice-message-record-button');
    const sendButton = page.getByTestId('message-send-button');

    await expect(voiceButton).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(voiceButton).toBeEnabled();
    await expect(sendButton).toBeDisabled();
    await expect(sendButton).toHaveAttribute('data-ready', 'false');

    await input.click();
    await input.pressSequentially('L');

    await expect(voiceButton).toBeDisabled();
    await expect(sendButton).toBeEnabled();
    await expect(sendButton).toHaveAttribute('data-ready', 'true');
    await expect(sendButton).toHaveCSS('color', 'rgb(232, 120, 59)');
    await expect
      .poll(() => sendButton.evaluate((element) => getComputedStyle(element).animationName))
      .toContain('composer-send-float');

    await input.press('Control+A');
    await input.press('Backspace');

    await expect(voiceButton).toBeEnabled();
    await expect(sendButton).toBeDisabled();
    await expect(sendButton).toHaveAttribute('data-ready', 'false');
  });

  test('removes the floating motion when reduced motion is requested', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    await roomPage.messageInput.click();
    await roomPage.messageInput.pressSequentially('Launch');

    const sendButton = page.getByTestId('message-send-button');
    await expect(sendButton).toBeEnabled();
    await expect(sendButton).toHaveAttribute('data-ready', 'true');
    await expect(sendButton).toHaveCSS('color', 'rgb(232, 120, 59)');
    await expect(sendButton).toHaveCSS('animation-name', 'none');
  });
});
