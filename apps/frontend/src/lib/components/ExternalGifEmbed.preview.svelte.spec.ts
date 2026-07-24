import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import { loadLocaleMessages } from '$lib/i18n/messages';
import { setReactiveLocale } from '$lib/i18n/state.svelte';
import type { ExternalGifDescriptor } from '$lib/externalGif';
import ExternalGifEmbed from './ExternalGifEmbed.svelte';

const giphy: ExternalGifDescriptor = {
  provider: 'giphy',
  providerLabel: 'GIPHY',
  canonicalUrl: 'https://giphy.com/gifs/reaction-l0MYt5jPR6QX5pnqM',
  resourceUrl: 'https://giphy.com/embed/l0MYt5jPR6QX5pnqM',
  renderMode: 'iframe',
  id: 'l0MYt5jPR6QX5pnqM'
};

function stubMotion() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  );
}

beforeEach(async () => {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  stubMotion();
  await loadLocaleMessages('en');
  setReactiveLocale('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ExternalGifEmbed persisted preview boundary', () => {
  it('keeps a standalone component visible when no message article exists', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: giphy } });

    await expect.element(screen.getByTestId('external-gif-embed')).toBeVisible();
    await expect
      .element(screen.getByTestId('external-gif-embed'))
      .not.toHaveAttribute('data-suppressed-by-preview');
  });

  it('stays visible inside a message article without a persisted preview', async () => {
    const article = document.createElement('article');
    article.setAttribute('role', 'article');
    document.body.append(article);
    const screen = render(ExternalGifEmbed, {
      target: article,
      props: { gif: giphy }
    });

    await expect.element(screen.getByTestId('external-gif-embed')).toBeVisible();
    await expect
      .element(screen.getByTestId('external-gif-embed'))
      .not.toHaveAttribute('data-suppressed-by-preview');
  });

  it('suppresses the enhancement when the message already has a persisted preview', async () => {
    const article = document.createElement('article');
    article.setAttribute('role', 'article');
    const preview = document.createElement('div');
    preview.dataset.testid = 'link-preview-card';
    article.append(preview);
    document.body.append(article);
    const screen = render(ExternalGifEmbed, {
      target: article,
      props: { gif: giphy }
    });
    const embed = screen.getByTestId('external-gif-embed');

    await expect.element(embed).not.toBeVisible();
    await expect.element(embed).toHaveAttribute('data-suppressed-by-preview', 'true');
    await expect.element(embed.locator('iframe')).toHaveCount(0);
    await expect.element(embed.locator('img')).toHaveCount(0);
    await expect.element(embed.locator('video')).toHaveCount(0);
  });
});
