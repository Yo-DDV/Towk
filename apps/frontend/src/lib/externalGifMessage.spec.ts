import { describe, expect, it } from 'vitest';
import {
  MAX_EXTERNAL_GIF_EMBEDS_PER_MESSAGE,
  parseExternalGifMessageBodyList,
  resolveExternalGifMessageList
} from './externalGifMessage';

const giphyPageUrl =
  'https://giphy.com/gifs/justin-word-oh-really-wow-QUENDfi6DEMLzQ0CKt';
const giphyMediaUrl =
  'https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.gif';
const tenorMediaUrl = 'https://media1.tenor.com/m/2wdlar795ZAAAAAd/example-content-url.gif';
const klipyMediaUrl =
  'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif';

describe('parseExternalGifMessageBodyList', () => {
  it('accepts one or more supported URLs separated only by whitespace', () => {
    const result = parseExternalGifMessageBodyList(
      `  ${giphyMediaUrl}\n\n${giphyPageUrl}\t${tenorMediaUrl}\n${klipyMediaUrl}  `
    );

    expect(result?.map((descriptor) => descriptor.provider)).toEqual([
      'giphy',
      'giphy',
      'tenor',
      'klipy'
    ]);
    expect(result).toHaveLength(MAX_EXTERNAL_GIF_EMBEDS_PER_MESSAGE);
  });

  it('accepts exact rich-composer self-links and Markdown autolinks', () => {
    const body = `[${giphyMediaUrl}](${giphyMediaUrl})\n\n<${giphyPageUrl}>`;

    expect(
      parseExternalGifMessageBodyList(body)?.map((descriptor) => descriptor.resourceUrl)
    ).toEqual([giphyMediaUrl, 'https://giphy.com/embed/QUENDfi6DEMLzQ0CKt']);
    expect(
      parseExternalGifMessageBodyList(`[${giphyPageUrl}](<${giphyPageUrl}>)`)
    ).toHaveLength(1);
  });

  it('accepts the hybrid body persisted by the rich composer', () => {
    const body = `[${giphyMediaUrl}](${giphyMediaUrl})\n\n${giphyPageUrl}`;

    expect(
      parseExternalGifMessageBodyList(body)?.map((descriptor) => descriptor.resourceUrl)
    ).toEqual([giphyMediaUrl, 'https://giphy.com/embed/QUENDfi6DEMLzQ0CKt']);
  });

  it('preserves duplicate URLs instead of silently changing message meaning', () => {
    expect(
      parseExternalGifMessageBodyList(`${giphyPageUrl}\n${giphyPageUrl}`)
    ).toHaveLength(2);
  });

  it.each([
    '',
    `reaction ${giphyPageUrl}`,
    `${giphyPageUrl}\nhttps://example.com/reaction.gif`,
    `[reaction](${giphyPageUrl})`,
    `[${giphyPageUrl}](${giphyMediaUrl})`
  ])('keeps non-GIF-only content on the ordinary Markdown path: %s', (body) => {
    expect(parseExternalGifMessageBodyList(body)).toBeNull();
  });

  it('fails closed above the bounded per-message card count', () => {
    const body = Array.from(
      { length: MAX_EXTERNAL_GIF_EMBEDS_PER_MESSAGE + 1 },
      () => giphyPageUrl
    ).join('\n');

    expect(parseExternalGifMessageBodyList(body)).toBeNull();
  });
});

describe('resolveExternalGifMessageList', () => {
  const body = `${giphyMediaUrl}\n${giphyPageUrl}`;

  it('requires the server capability', () => {
    expect(
      resolveExternalGifMessageList(body, {
        supportsCapability: false,
        hasPersistedLinkPreview: false
      })
    ).toBeNull();
  });

  it('preserves historical persisted previews', () => {
    expect(
      resolveExternalGifMessageList(body, {
        supportsCapability: true,
        hasPersistedLinkPreview: true
      })
    ).toBeNull();
  });

  it('returns every descriptor for a capable server without a persisted preview', () => {
    expect(
      resolveExternalGifMessageList(body, {
        supportsCapability: true,
        hasPersistedLinkPreview: false
      })
    ).toHaveLength(2);
  });
});
