import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import { loadLocaleMessages } from '$lib/i18n/messages';
import { setReactiveLocale } from '$lib/i18n/state.svelte';
import type { ExternalGifDescriptor } from '$lib/externalGif';
import testAnimationUrl from '../../../e2e/fixtures/test-animation.gif?url';
import ExternalGifEmbed from './ExternalGifEmbed.svelte';

const directImage: ExternalGifDescriptor = {
  provider: 'klipy',
  providerLabel: 'KLIPY',
  canonicalUrl:
    'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif',
  resourceUrl: testAnimationUrl,
  renderMode: 'image',
  id: '4493325008d34b7bf8cd6813cd5c1619'
};

const giphyFrame: ExternalGifDescriptor = {
  provider: 'giphy',
  providerLabel: 'GIPHY',
  canonicalUrl: 'https://giphy.com/gifs/reaction-l0MYt5jPR6QX5pnqM',
  resourceUrl: 'about:blank',
  renderMode: 'iframe',
  id: 'l0MYt5jPR6QX5pnqM'
};

beforeEach(async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  await loadLocaleMessages('en');
  setReactiveLocale('en');
});

afterEach(() => vi.unstubAllGlobals());

describe('ExternalGifEmbed responsive media geometry', () => {
  it('shrinks direct media and its fallback to a narrow message column without cropping', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: directImage, autoLoad: false } });
    screen.container.style.width = '15rem';

    const shell = document.querySelector<HTMLElement>('[data-testid="external-gif-embed"]');
    const fallback = document.querySelector<HTMLElement>('[data-testid="external-gif-fallback"]');

    await vi.waitFor(() => {
      const hostBounds = screen.container.getBoundingClientRect();
      const shellBounds = shell?.getBoundingClientRect();
      expect(shellBounds).toBeDefined();
      if (!shellBounds) throw new Error('direct GIF fallback geometry was unavailable');
      expect(shellBounds.width).toBeLessThanOrEqual(hostBounds.width + 1);
      expect(fallback?.scrollWidth).toBeLessThanOrEqual(Math.ceil(shellBounds.width) + 1);
    });

    await screen.getByRole('button', { name: 'Load external GIF' }).click();

    const media = document.querySelector<HTMLElement>('[data-testid="external-gif-media"]');
    const image = media?.querySelector<HTMLImageElement>('img');
    const controls = document.querySelector<HTMLElement>('[data-testid="external-gif-controls"]');

    expect(shell?.dataset.renderMode).toBe('image');
    expect(shell?.classList.contains('external-gif-direct')).toBe(true);
    expect(media?.classList.contains('external-gif-direct-media')).toBe(true);
    expect(image?.classList.contains('external-gif-direct-element')).toBe(true);
    expect(image?.classList.contains('object-contain')).toBe(true);
    expect(image?.classList.contains('max-h-[36rem]')).toBe(true);
    expect(media).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(media?.nextElementSibling).toBe(controls);

    await vi.waitFor(() => {
      const hostBounds = screen.container.getBoundingClientRect();
      const shellBounds = shell?.getBoundingClientRect();
      const imageBounds = image?.getBoundingClientRect();
      expect(shellBounds).toBeDefined();
      expect(imageBounds).toBeDefined();
      if (!shellBounds || !imageBounds) throw new Error('direct GIF geometry was unavailable');
      expect(shellBounds.width).toBeGreaterThan(0);
      expect(shellBounds.width).toBeLessThanOrEqual(hostBounds.width + 1);
      expect(imageBounds.width).toBeLessThanOrEqual(shellBounds.width + 1);
      expect(Math.abs(shellBounds.width - imageBounds.width)).toBeLessThanOrEqual(3);
      expect(shell?.scrollWidth).toBeLessThanOrEqual(Math.ceil(shellBounds.width) + 1);
    });
  });

  it('keeps provider page embeds responsive in a bounded widescreen frame', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: giphyFrame, autoLoad: false } });
    await screen.getByRole('button', { name: 'Load external GIF' }).click();

    const shell = document.querySelector<HTMLElement>('[data-testid="external-gif-embed"]');
    const media = document.querySelector<HTMLElement>('[data-testid="external-gif-media"]');
    const frame = media?.querySelector<HTMLIFrameElement>('iframe');

    expect(shell?.dataset.renderMode).toBe('iframe');
    expect(shell?.classList.contains('max-w-xl')).toBe(true);
    expect(media?.classList.contains('aspect-video')).toBe(true);
    expect(frame?.classList.contains('w-full')).toBe(true);
  });
});
