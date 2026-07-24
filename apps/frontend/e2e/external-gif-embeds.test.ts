import { expect } from '@playwright/test';
import { test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { TIMEOUTS } from './constants';

const giphyUrl = 'https://giphy.com/gifs/reaction-l0MYt5jPR6QX5pnqM';
const giphyMediaUrl = 'https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.gif';
const onePixelGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

test.describe('External GIF embeds', () => {
  test('renders a supported standalone URL behind the default privacy gate', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await page.route('https://giphy.com/embed/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>GIPHY test embed</title>'
      });
    });

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

  test('renders a current GIPHY CDN URL as direct media after consent', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await page.route('https://i.giphy.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/gif',
        body: onePixelGif,
        headers: { 'Cache-Control': 'public, max-age=60' }
      });
    });

    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');
    await roomPage.sendMessage(giphyMediaUrl);

    const message = page.locator('[role="article"]', { hasText: giphyMediaUrl });
    const embed = message.getByTestId('external-gif-embed');
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed.locator('img')).toHaveCount(0);

    await embed.getByRole('button', { name: 'Load external GIF' }).click();
    await expect(embed.locator('img')).toHaveAttribute('src', giphyMediaUrl);
    await expect(embed).toHaveAttribute('data-state', 'loaded');
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
