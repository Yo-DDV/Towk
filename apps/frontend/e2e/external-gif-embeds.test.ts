import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { TIMEOUTS } from './constants';

const PREFERENCES_KEY = 'chatto:preferences';
const EXTERNAL_GIF_AUTO_LOAD_PREFERENCE_VERSION = 1;
const giphyUrl = 'https://giphy.com/gifs/justin-word-oh-really-wow-QUENDfi6DEMLzQ0CKt';
const giphyMediaUrl = 'https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.gif';
const giphyEmbedUrl = 'https://giphy.com/embed/QUENDfi6DEMLzQ0CKt';
const tenorMediaUrl = 'https://media1.tenor.com/m/2wdlar795ZAAAAAd/example-content-url.gif';
const klipyMediaUrl =
  'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif';
const onePixelGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

async function sendExternalGifOnlyMessage(
  roomPage: {
    waitForInputEditable(): Promise<void>;
    messageInput: Locator;
  },
  body: string
): Promise<void> {
  await roomPage.waitForInputEditable();
  await roomPage.messageInput.fill(body);
  await roomPage.messageInput.press('Enter');
}

async function setExternalGifAutoLoad(page: Page, enabled: boolean): Promise<void> {
  await page.addInitScript(
    ({ key, enabled: nextEnabled, version }) => {
      let preferences: Record<string, unknown> = {};
      try {
        const raw = window.localStorage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        if (typeof parsed === 'object' && parsed !== null) {
          preferences = parsed as Record<string, unknown>;
        }
      } catch {
        preferences = {};
      }
      window.localStorage.setItem(
        key,
        JSON.stringify({
          ...preferences,
          externalGifAutoLoad: nextEnabled,
          externalGifAutoLoadPreferenceVersion: version
        })
      );
    },
    {
      key: PREFERENCES_KEY,
      enabled,
      version: EXTERNAL_GIF_AUTO_LOAD_PREFERENCE_VERSION
    }
  );
}

test.describe('External GIF embeds', () => {
  test('auto-loads a standalone GIPHY page URL by default', async ({ page, chatPage, roomPage }) => {
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

    const requestPromise = page.waitForRequest((request) => request.url() === giphyEmbedUrl, {
      timeout: TIMEOUTS.UI_STANDARD
    });
    await sendExternalGifOnlyMessage(roomPage, giphyUrl);
    await requestPromise;

    const message = page.locator('[role="article"]', { hasText: 'GIPHY' }).last();
    const embed = message.getByTestId('external-gif-embed');
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed).toHaveAttribute('data-provider', 'giphy');
    await expect(embed).toHaveAttribute('data-auto-load', 'enabled');
    await expect(embed).toHaveAttribute('data-load-origin', 'auto');
    await expect(embed).toHaveAttribute('data-state', 'loaded');
    await expect(embed.locator('iframe')).toHaveAttribute('src', giphyEmbedUrl);
    await expect(message.locator(`a[href="${giphyUrl}"]`)).toHaveCount(1);
    await expect(message.getByRole('link', { name: giphyUrl })).toHaveCount(0);
  });

  test('auto-loads current GIPHY CDN media by default', async ({ page, chatPage, roomPage }) => {
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

    const requestPromise = page.waitForRequest((request) => request.url() === giphyMediaUrl, {
      timeout: TIMEOUTS.UI_STANDARD
    });
    await sendExternalGifOnlyMessage(roomPage, giphyMediaUrl);
    await requestPromise;

    const embed = page.getByTestId('external-gif-embed').last();
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed).toHaveAttribute('data-load-origin', 'auto');
    await expect(embed.locator('img')).toHaveAttribute('src', giphyMediaUrl);
    await expect(embed).toHaveAttribute('data-state', 'loaded');
  });

  test('auto-loads the KLIPY media URL observed on Docker 1', async ({
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

    const requestPromise = page.waitForRequest((request) => request.url() === klipyMediaUrl, {
      timeout: TIMEOUTS.UI_STANDARD
    });
    await sendExternalGifOnlyMessage(roomPage, klipyMediaUrl);
    await requestPromise;

    const embed = page.getByTestId('external-gif-embed').last();
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed).toHaveAttribute('data-provider', 'klipy');
    await expect(embed).toHaveAttribute('data-load-origin', 'auto');
    await expect(embed.locator('img')).toHaveAttribute('src', klipyMediaUrl);
    await expect(embed).toHaveAttribute('data-state', 'loaded');
  });

  test('auto-loads an official Tenor media URL', async ({ page, chatPage, roomPage }) => {
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

    const requestPromise = page.waitForRequest((request) => request.url() === tenorMediaUrl, {
      timeout: TIMEOUTS.UI_STANDARD
    });
    await sendExternalGifOnlyMessage(roomPage, tenorMediaUrl);
    await requestPromise;

    const embed = page.getByTestId('external-gif-embed').last();
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed).toHaveAttribute('data-provider', 'tenor');
    await expect(embed).toHaveAttribute('data-load-origin', 'auto');
    await expect(embed.locator('img')).toHaveAttribute('src', tenorMediaUrl);
    await expect(embed).toHaveAttribute('data-state', 'loaded');
  });

  test('auto-loads every URL in a GIF-only multi-link message without raw-link duplication', async ({
    page,
    chatPage,
    roomPage
  }) => {
    let mediaRequests = 0;
    let embedRequests = 0;
    await page.route('https://i.giphy.com/**', async (route) => {
      mediaRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'image/gif',
        body: onePixelGif,
        headers: { 'Cache-Control': 'public, max-age=60' }
      });
    });
    await page.route('https://giphy.com/embed/**', async (route) => {
      embedRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>GIPHY test embed</title>'
      });
    });

    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');
    expect(mediaRequests).toBe(0);
    expect(embedRequests).toBe(0);

    const mediaRequestPromise = page.waitForRequest(
      (request) => request.url() === giphyMediaUrl,
      { timeout: TIMEOUTS.UI_STANDARD }
    );
    const embedRequestPromise = page.waitForRequest(
      (request) => request.url() === giphyEmbedUrl,
      { timeout: TIMEOUTS.UI_STANDARD }
    );
    await sendExternalGifOnlyMessage(roomPage, `${giphyMediaUrl}\n\n${giphyUrl}`);
    await Promise.all([mediaRequestPromise, embedRequestPromise]);

    const message = page.locator('[role="article"]').last();
    const embeds = message.getByTestId('external-gif-embed');
    await expect(embeds).toHaveCount(2, { timeout: TIMEOUTS.UI_STANDARD });
    await expect(message.getByTestId('external-gif-message')).toHaveAttribute(
      'data-embed-count',
      '2'
    );
    await expect(message.getByRole('link', { name: giphyMediaUrl })).toHaveCount(0);
    await expect(message.getByRole('link', { name: giphyUrl })).toHaveCount(0);
    await expect(message.locator(`a[href="${giphyMediaUrl}"]`)).toHaveCount(1);
    await expect(message.locator(`a[href="${giphyUrl}"]`)).toHaveCount(1);
    await expect(embeds.nth(0)).toHaveAttribute('data-load-origin', 'auto');
    await expect(embeds.nth(1)).toHaveAttribute('data-load-origin', 'auto');
    await expect(embeds.nth(0).locator('img')).toHaveAttribute('src', giphyMediaUrl);
    await expect(embeds.nth(1).locator('iframe')).toHaveAttribute('src', giphyEmbedUrl);
    await expect(embeds.nth(0)).toHaveAttribute('data-state', 'loaded');
    await expect(embeds.nth(1)).toHaveAttribute('data-state', 'loaded');
    await expect.poll(() => mediaRequests).toBe(1);
    await expect.poll(() => embedRequests).toBe(1);
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

  test('honors an explicit auto-load opt-out and keeps the manual fallback', async ({
    page,
    chatPage,
    roomPage
  }) => {
    let embedRequests = 0;
    await setExternalGifAutoLoad(page, false);
    await page.route('https://giphy.com/embed/**', async (route) => {
      embedRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>GIPHY test embed</title>'
      });
    });

    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');
    await sendExternalGifOnlyMessage(roomPage, giphyUrl);

    const embed = page.getByTestId('external-gif-embed').last();
    await expect(embed).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(embed).toHaveAttribute('data-auto-load', 'disabled');
    await expect(embed.locator('iframe')).toHaveCount(0);
    await expect(embed.getByRole('button', { name: 'Load external GIF' })).toBeVisible();
    expect(embedRequests).toBe(0);

    const requestPromise = page.waitForRequest((request) => request.url() === giphyEmbedUrl, {
      timeout: TIMEOUTS.UI_STANDARD
    });
    await embed.getByRole('button', { name: 'Load external GIF' }).click();
    await requestPromise;
    await expect(embed.locator('iframe')).toHaveAttribute('src', giphyEmbedUrl);
    await expect(embed).toHaveAttribute('data-load-origin', 'manual');
    await expect(embed).toHaveAttribute('data-state', 'loaded');
    await expect.poll(() => embedRequests).toBe(1);
  });
});
