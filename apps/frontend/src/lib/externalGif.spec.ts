import { describe, expect, it } from 'vitest';
import {
  parseExternalGifMessageBody,
  parseExternalGifUrl,
  resolveExternalGifMessage,
  type ExternalGifProvider,
  type ExternalGifRenderMode
} from './externalGif';

const validURLs: ReadonlyArray<
  readonly [string, ExternalGifProvider, ExternalGifRenderMode, string]
> = [
  [
    'https://giphy.com/gifs/reaction-happy-l0MYt5jPR6QX5pnqM',
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
    'https://giphy.com/embed/l0MYt5jPR6QX5pnqM',
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
    'https://media0.giphy.com/media/l0MYt5jPR6QX5pnqM/200w.gif',
    'giphy',
    'image',
    'https://media0.giphy.com/media/l0MYt5jPR6QX5pnqM/200w.gif'
  ],
  [
    'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.webp',
    'giphy',
    'image',
    'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.webp'
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
    'https://media.tenor.com/AbCdEfGhIjK/tenor.gif',
    'tenor',
    'image',
    'https://media.tenor.com/AbCdEfGhIjK/tenor.gif'
  ],
  [
    'https://media.tenor.com/m/AbCdEfGhIjK/AAAAC/tenor.mp4',
    'tenor',
    'video',
    'https://media.tenor.com/m/AbCdEfGhIjK/AAAAC/tenor.mp4'
  ],
  [
    'https://c.tenor.com/AbCdEfGhIjK/tenor.webp',
    'tenor',
    'image',
    'https://c.tenor.com/AbCdEfGhIjK/tenor.webp'
  ],
  [
    'https://media.tenor.com/m/AbCdEfGhIjK/reaction-video.webm',
    'tenor',
    'video',
    'https://media.tenor.com/m/AbCdEfGhIjK/reaction-video.webm'
  ]
];

const invalidURLs = [
  'http://giphy.com/gifs/test-l0MYt5jPR6QX5pnqM',
  'https://user@giphy.com/gifs/test-l0MYt5jPR6QX5pnqM',
  'https://giphy.com:444/gifs/test-l0MYt5jPR6QX5pnqM',
  'https://giphy.com:443/embed/l0MYt5jPR6QX5pnqM',
  'https://giphy.com:/embed/l0MYt5jPR6QX5pnqM',
  'https://giphy.com:0443/embed/l0MYt5jPR6QX5pnqM',
  'HTTPS://giphy.com/embed/l0MYt5jPR6QX5pnqM',
  'https://@giphy.com/embed/l0MYt5jPR6QX5pnqM',
  'https://giphy.com/embed/l0MYt5jPR6QX5pnqM\n',
  'https://giphy.com.evil.example/gifs/test-l0MYt5jPR6QX5pnqM',
  'https://evil.example/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  'https://media5.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  'https://media999.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  'https://media.giphy.com/media/%2Fetc/giphy.gif',
  'https://media.giphy.com/media/%6c0MYt5jPR6QX5pnqM/giphy.gif',
  'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM//giphy.gif',
  'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif/',
  'https://media.giphy.com/media/short/giphy.gif',
  'https://media.giphy.com/media/v1..bad/l0MYt5jPR6QX5pnqM/giphy.gif',
  'https://i.giphy.com/path/l0MYt5jPR6QX5pnqM.gif',
  'https://giphy.com/embed/l0MYt5jPR6QX5pnqM/extra',
  'https://giphy.com/gifs/reaction-%2el0MYt5jPR6QX5pnqM',
  'https://media2.tenor.com/AbCdEfGhIjK/tenor.gif',
  'https://media.tenor.com/a/tenor.gif',
  'https://media.tenor.com/AbCdEfGhIjK/.gif',
  'https://media.tenor.com/AbCdEfGhIjK/a..b.gif',
  'https://media.tenor.com/AbCdEfGhIjK/reaction.svg',
  'https://media.tenor.com/m/AbCdEfGhIjK/too/many/segments/tenor.gif',
  'https://media.tenor.com/m/AbCdEfGhIjK/variant-with-more-than-thirty-two-characters/tenor.gif',
  'https://media.tenor.com/AbCdEfGhIjK/tenor.gif/',
  'https://media.tenor.com/AbCdEfGhIjK//tenor.gif',
  'https://tenor.com/view/reaction-gif-123456',
  'https://example.com/reaction.gif',
  'https://giphy.com\\@evil.example/embed/l0MYt5jPR6QX5pnqM',
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

  it('removes fragments from canonical and media URLs', () => {
    expect(
      parseExternalGifUrl('https://media.tenor.com/AbCdEfGhIjK/tenor.gif#fragment')
    ).toMatchObject({
      canonicalUrl: 'https://media.tenor.com/AbCdEfGhIjK/tenor.gif',
      resourceUrl: 'https://media.tenor.com/AbCdEfGhIjK/tenor.gif'
    });
  });
});

describe('parseExternalGifMessageBody', () => {
  it('accepts a standalone supported URL with surrounding whitespace', () => {
    expect(
      parseExternalGifMessageBody('  https://media.tenor.com/AbCdEfGhIjK/tenor.gif\n')
    ).not.toBeNull();
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
  const body = 'https://media.tenor.com/AbCdEfGhIjK/excited-happy-dance.gif';

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
    ).toMatchObject({ provider: 'tenor', renderMode: 'image' });
  });
});
