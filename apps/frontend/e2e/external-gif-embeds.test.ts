import { expect } from '@playwright/test';
import { test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { TIMEOUTS } from './constants';

const giphyUrl = 'https://giphy.com/gifs/justin-word-oh-really-wow-QUENDfi6DEMLzQ0CKt';
const giphyMediaUrl = 'https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.gif';
const tenorMediaUrl = 'https://media1.tenor.com/m/2wdlar795ZAAAAAd/example-content-url.gif';
const klipyMediaUrl =
  'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif';
const onePixelGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

test.describe('External GIF embeds', () => {
  test('replaces the standalone GIPHY URL with the default privacy card', async ({
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

    const message = page.locator('[role="article"]', { hasText: 'GIPHY' }).last();
    const embed = message.getByTestId('external-gif-embed');
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed).toHaveAttribute('data-provider', 'giphy');
    await expect(embed.locator('iframe')).toHaveCount(0);
    await expect(message.locator(`a[href="${giphyUrl}"]`)).toHaveCount(1);
    await expect(message.getByRole('link', { name: giphyUrl })).toHaveCount(0);

    await embed.getByRole('button', { name: 'Load external GIF' }).click();
    await expect(embed.locator('iframe')).toHaveAttribute(
      'src',
      'https://giphy.com/embed/QUENDfi6DEMLzQ0CKt'
    );
  });

  test('renders current GIPHY CDN media after consent', async ({ page, chatPage, roomPage }) => {
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

    const embed = page.getByTestId('external-gif-embed').last();
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed.locator('img')).toHaveCount(0);

    await embed.getByRole('button', { name: 'Load external GIF' }).click();
    await expect(embed.locator('img')).toHaveAttribute('src', giphyMediaUrl);
    await expect(embed).toHaveAttribute('data-state', 'loaded');
  });

  test('renders the KLIPY media URL observed on Docker 1 after consent', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await page.route('https://static.klipy.com/**', async (route) => {
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
    await roomPage.sendMessage(klipyMediaUrl);

    const embed = page.getByTestId('external-gif-embed').last();
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed).toHaveAttribute('data-provider', 'klipy');
    await expect(embed.locator('img')).toHaveCount(0);

    await embed.getByRole('button', { name: 'Load external GIF' }).click();
    await expect(embed.locator('img')).toHaveAttribute('src', klipyMediaUrl);
    await expect(embed).toHaveAttribute('data-state', 'loaded');
  });

  test('renders an official Tenor media URL after consent', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await page.route('https://media1.tenor.com/**', async (route) => {
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
    await roomPage.sendMessage(tenorMediaUrl);

    const embed = page.getByTestId('external-gif-embed').last();
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed).toHaveAttribute('data-provider', 'tenor');

    await embed.getByRole('button', { name: 'Load external GIF' }).click();
    await expect(embed.locator('img')).toHaveAttribute('src', tenorMediaUrl);
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
