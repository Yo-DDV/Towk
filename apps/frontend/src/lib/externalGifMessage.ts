import { parseExternalGifUrl, type ExternalGifDescriptor } from '$lib/externalGif';

export const MAX_EXTERNAL_GIF_EMBEDS_PER_MESSAGE = 4;

export type ExternalGifMessageOptions = {
  supportsCapability: boolean;
  hasPersistedLinkPreview: boolean;
};

/**
 * Parse a message that contains only supported external GIF URLs.
 *
 * Whitespace may separate up to four URLs so keyboard/share-sheet payloads that
 * include both a provider page and a direct rendition still render cleanly.
 * Any other token keeps the complete message on the ordinary Markdown path.
 */
export function parseExternalGifMessageBodyList(body: string): ExternalGifDescriptor[] | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const candidates = trimmed.split(/\s+/u);
  if (candidates.length > MAX_EXTERNAL_GIF_EMBEDS_PER_MESSAGE) return null;

  const descriptors: ExternalGifDescriptor[] = [];
  for (const candidate of candidates) {
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
