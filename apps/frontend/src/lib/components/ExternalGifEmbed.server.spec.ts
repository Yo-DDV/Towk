import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
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

const tenor: ExternalGifDescriptor = {
  provider: 'tenor',
  providerLabel: 'Tenor',
  canonicalUrl: 'https://media.tenor.com/AbCdEfGhIjK/tenor.gif',
  resourceUrl: 'https://media.tenor.com/AbCdEfGhIjK/tenor.gif',
  renderMode: 'image',
  id: 'AbCdEfGhIjK'
};

describe('ExternalGifEmbed SSR privacy boundary', () => {
  it.each([false, true])(
    'does not emit the provider iframe before browser consent when autoLoad=%s',
    (autoLoad) => {
      const { body } = render(ExternalGifEmbed, { props: { gif: giphy, autoLoad } });

      expect(body).toContain(`href="${giphy.canonicalUrl}"`);
      expect(body).not.toContain('<iframe');
      expect(body).not.toContain(`src="${giphy.resourceUrl}"`);
    }
  );

  it('does not emit direct media elements during server rendering', () => {
    const { body } = render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });

    expect(body).toContain(`href="${tenor.canonicalUrl}"`);
    expect(body).not.toContain('<img');
    expect(body).not.toContain('<video');
  });
});
