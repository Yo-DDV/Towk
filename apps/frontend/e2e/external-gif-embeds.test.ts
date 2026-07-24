import { expect } from '@playwright/test';
import { test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { TIMEOUTS } from './constants';

const giphyUrl = 'https://giphy.com/gifs/reaction-l0MYt5jPR6QX5pnqM';

test.describe('External GIF embeds', () => {
  test('renders a supported standalone URL behind the default privacy gate', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    await roomPage.sendMessage(giphyUrl);

    const message = page.locator('[role="article"]', { hasText: giphyUrl });
    const embed = message.getByTestId('external-gif-embed');
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed.locator('iframe')).toHaveCount(0);

    await embed.getByRole('button', { name: 'Load external GIF' }).click();
    await expect(embed.locator('iframe')).toHaveAttribute(
      'src',
      'https://giphy.com/embed/l0MYt5jPR6QX5pnqM'
    );
    await expect(message.locator(`a[href="${giphyUrl}"]`)).toBeVisible();
  });

  test('keeps a provider URL mixed with text as a normal link', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const body = `reaction ${giphyUrl}`;
    await roomPage.sendMessage(body);

    const message = page.locator('[role="article"]', { hasText: body });
    await expect(message.getByTestId('external-gif-embed')).toHaveCount(0);
    await expect(message.locator(`a[href="${giphyUrl}"]`)).toBeVisible();
  });
});
