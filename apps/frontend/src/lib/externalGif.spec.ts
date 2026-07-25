import { describe, expect, it } from 'vitest';
import {
  parseExternalGifMessageBody,
  parseExternalGifUrl,
  resolveExternalGifMessage,
  shouldObserveExternalGif,
  type ExternalGifAutoLoadContext,
  type ExternalGifProvider,
  type ExternalGifRenderMode
} from './externalGif';

const validURLs: ReadonlyArray<
  readonly [string, ExternalGifProvider, ExternalGifRenderMode, string]
> = [
  [
    'https://giphy.com/gifs/justin-word-oh-really-wow-QUENDfi6DEMLzQ0CKt',
    'giphy',
    'iframe',
    'https://giphy.com/embed/QUENDfi6DEMLzQ0CKt'
  ],
  [
    'https://giphy.com/gifs/reaction-happy-l0MYt5jPR6QX5pnqM/',
    'giphy',
    'iframe',
    'https://giphy.com/embed/l0MYt5jPR6QX5pnqM'
  ],
  [
    'https://www.giphy.com/stickers/wave-3o7TKsQ8UQ4l4LhGz6',
    'giphy',
    'iframe',
    'https://giphy.com/embed/3o7TKsQ8UQ4l4LhGz6'
  ],
  [
    'HTTPS://GIPHY.com/embed/l0MYt5jPR6QX5pnqM/',
    'giphy',
    'iframe',
    'https://giphy.com/embed/l0MYt5jPR6QX5pnqM'
  ],
  [
    'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif?cid=test',
    'giphy',
    'image',
    'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif?cid=test'
  ],
  [
    'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.webp',
    'giphy',
    'image',
    'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.webp'
  ],
  [
    'https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.gif',
    'giphy',
    'image',
    'https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.gif'
  ],
  [
    'https://i.giphy.com/l0MYt5jPR6QX5pnqM.mp4',
    'giphy',
    'video',
    'https://i.giphy.com/l0MYt5jPR6QX5pnqM.mp4'
  ],
  [
    'https://media.tenor.com/2wdlar795ZAAAAAd',
    'tenor',
    'image',
    'https://media.tenor.com/2wdlar795ZAAAAAd'
  ],
  [
    'https://media1.tenor.com/m/2wdlar795ZAAAAAd/example-content-url.gif',
    'tenor',
    'image',
    'https://media1.tenor.com/m/2wdlar795ZAAAAAd/example-content-url.gif'
  ],
  [
    'https://media.tenor.com/m/AbCdEfGhIjK/AAAAC/tenor.mp4',
    'tenor',
    'video',
    'https://media.tenor.com/m/AbCdEfGhIjK/AAAAC/tenor.mp4'
  ],
  [
    'https://c.tenor.com/images/0123456789abcdef0123456789ABCDEF/tenor.webp',
    'tenor',
    'image',
    'https://c.tenor.com/images/0123456789abcdef0123456789ABCDEF/tenor.webp'
  ],
  [
    'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif',
    'klipy',
    'image',
    'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif'
  ],
  [
    'https://static.klipy.co/ii/3bbfac09dcb32c2b1e87ad063c4ac16e/9d/55/7VnHqCsL.webp',
    'klipy',
    'image',
    'https://static.klipy.co/ii/3bbfac09dcb32c2b1e87ad063c4ac16e/9d/55/7VnHqCsL.webp'
  ],
  [
    'https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/bc/1d/hYDJ4v1I.mp4?download=0',
    'klipy',
    'video',
    'https://static.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/bc/1d/hYDJ4v1I.mp4?download=0'
  ]
];

const invalidURLs = [
  'http://giphy.com/gifs/test-l0MYt5jPR6QX5pnqM',
  'https://user@giphy.com/gifs/test-l0MYt5jPR6QX5pnqM',
  'https://giphy.com:443/embed/l0MYt5jPR6QX5pnqM',
  'https://giphy.com.evil.example/gifs/test-l0MYt5jPR6QX5pnqM',
  'https://media5.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  'https://media.giphy.com/media/%2Fetc/giphy.gif',
  'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM//giphy.gif',
  'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif/',
  'https://giphy.com/embed/l0MYt5jPR6QX5pnqM/extra',
  'https://tenor.com/view/reaction-gif-123456',
  'https://media2.tenor.com/AbCdEfGhIjK/tenor.gif',
  'https://media.tenor.com/a/tenor.gif',
  'https://media.tenor.com/AbCdEfGhIjK/.gif',
  'https://media.tenor.com/AbCdEfGhIjK/a..b.gif',
  'https://media.tenor.com/AbCdEfGhIjK/reaction.svg',
  'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.svg',
  'https://static.klipy.com/ii/not-a-hash/12/66/VRmb0agTs8UFUzia.gif',
  'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/1/66/VRmb0agTs8UFUzia.gif',
  'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/666/VRmb0agTs8UFUzia.gif',
  'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/a..b.gif',
  'https://static.klipy.com.evil.example/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/file.gif',
  'https://cdn.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/file.gif',
  'https://example.com/reaction.gif',
  ' javascript:alert(1)',
  'javascript:alert(1)'
] as const;

describe('parseExternalGifUrl', () => {
  it.each(validURLs)(
    'accepts a supported provider URL: %s',
    (url, provider, renderMode, resourceUrl) => {
      expect(parseExternalGifUrl(url)).toMatchObject({ provider, renderMode, resourceUrl });
    }
  );

  it.each(invalidURLs)('rejects an unsupported or hostile URL: %s', (url) => {
    expect(parseExternalGifUrl(url)).toBeNull();
  });

  it('removes URL fragments without rewriting provider query parameters', () => {
    expect(
      parseExternalGifUrl(
        'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif?x=1#fragment'
      )
    ).toMatchObject({
      canonicalUrl:
        'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif?x=1',
      resourceUrl:
        'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif?x=1'
    });
  });
});

describe('parseExternalGifMessageBody', () => {
  it('accepts a standalone supported URL with surrounding whitespace', () => {
    expect(
      parseExternalGifMessageBody(
        '  https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif\n'
      )
    ).toMatchObject({ provider: 'klipy' });
  });

  it.each([
    'look https://media.tenor.com/AbCdEfGhIjK/tenor.gif',
    'https://media.tenor.com/AbCdEfGhIjK/tenor.gif thanks',
    '[reaction](https://media.tenor.com/AbCdEfGhIjK/tenor.gif)',
    '> https://media.tenor.com/AbCdEfGhIjK/tenor.gif',
    '`https://media.tenor.com/AbCdEfGhIjK/tenor.gif`'
  ])('keeps mixed or formatted content as a normal message: %s', (body) => {
    expect(parseExternalGifMessageBody(body)).toBeNull();
  });
});

describe('resolveExternalGifMessage', () => {
  const body =
    'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif';

  it('requires the server capability', () => {
    expect(
      resolveExternalGifMessage(body, {
        supportsCapability: false,
        hasPersistedLinkPreview: false
      })
    ).toBeNull();
  });

  it('preserves a persisted legacy link preview instead of rendering twice', () => {
    expect(
      resolveExternalGifMessage(body, {
        supportsCapability: true,
        hasPersistedLinkPreview: true
      })
    ).toBeNull();
  });

  it('returns the descriptor for a capable server without a legacy preview', () => {
    expect(
      resolveExternalGifMessage(body, {
        supportsCapability: true,
        hasPersistedLinkPreview: false
      })
    ).toMatchObject({ provider: 'klipy', renderMode: 'image' });
  });
});

describe('shouldObserveExternalGif', () => {
  const ready: ExternalGifAutoLoadContext = {
    autoLoad: true,
    reducedMotion: false,
    hiddenByUser: false,
    online: true,
    pageVisible: true,
    loadState: 'idle',
    intersectionObserverAvailable: true
  };

  it('allows viewport-proximate auto-load only when every guard is satisfied', () => {
    expect(shouldObserveExternalGif(ready)).toBe(true);
  });

  it.each([
    ['auto-load disabled', { autoLoad: false }],
    ['reduced motion', { reducedMotion: true }],
    ['hidden by the reader', { hiddenByUser: true }],
    ['offline', { online: false }],
    ['background tab', { pageVisible: false }],
    ['already loading', { loadState: 'loading' as const }],
    ['no IntersectionObserver', { intersectionObserverAvailable: false }]
  ])('fails closed for %s', (_name, override) => {
    expect(shouldObserveExternalGif({ ...ready, ...override })).toBe(false);
  });
});
