import { parseExternalGifUrl, type ExternalGifDescriptor } from '$lib/externalGif';

export const MAX_EXTERNAL_GIF_EMBEDS_PER_MESSAGE = 4;

export type ExternalGifMessageOptions = {
  supportsCapability: boolean;
  hasPersistedLinkPreview: boolean;
};

function unwrapExactMarkdownAutolink(token: string): string | null {
  if (!token.startsWith('<') || !token.endsWith('>')) return null;

  const destination = token.slice(1, -1);
  if (!destination || destination.includes('<') || destination.includes('>')) return null;
  return destination;
}

function unwrapExactMarkdownSelfLink(token: string): string | null {
  if (!token.startsWith('[') || !token.endsWith(')')) return null;

  const separatorIndex = token.indexOf('](');
  if (separatorIndex <= 1) return null;

  const label = token.slice(1, separatorIndex);
  const destination = token.slice(separatorIndex + 2, -1);
  if (!label || !destination || label.includes(']')) return null;

  // TipTap can serialize an automatically linked URL as [URL](URL). Accept
  // only that lossless form: a custom label is user-authored Markdown and must
  // remain visible instead of being replaced by an external-media card.
  return label === destination ? destination : null;
}

function externalGifUrlFromMessageToken(token: string): string | null {
  if (token.startsWith('<')) return unwrapExactMarkdownAutolink(token);
  if (token.startsWith('[')) return unwrapExactMarkdownSelfLink(token);
  return token;
}

/**
 * Parse a message that contains only supported external GIF URLs.
 *
 * Whitespace may separate up to four URLs so keyboard/share-sheet payloads that
 * include both a provider page and a direct rendition still render cleanly.
 * Exact Markdown autolinks and exact `[URL](URL)` self-links emitted by the rich
 * composer are treated as their underlying URL. Any other token keeps the
 * complete message on the ordinary Markdown path.
 */
export function parseExternalGifMessageBodyList(body: string): ExternalGifDescriptor[] | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/u);
  if (tokens.length > MAX_EXTERNAL_GIF_EMBEDS_PER_MESSAGE) return null;

  const descriptors: ExternalGifDescriptor[] = [];
  for (const token of tokens) {
    const candidate = externalGifUrlFromMessageToken(token);
    if (!candidate) return null;

    const descriptor = parseExternalGifUrl(candidate);
    if (!descriptor) return null;
    descriptors.push(descriptor);
  }

  return descriptors;
}

export function resolveExternalGifMessageList(
  body: string,
  options: ExternalGifMessageOptions
): ExternalGifDescriptor[] | null {
  if (!options.supportsCapability || options.hasPersistedLinkPreview) return null;
  return parseExternalGifMessageBodyList(body);
}
