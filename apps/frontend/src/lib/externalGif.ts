export const EXTERNAL_GIF_EMBEDS_CAPABILITY = 'external-gif-embeds-v1';

export type ExternalGifProvider = 'giphy' | 'tenor';
export type ExternalGifRenderMode = 'iframe' | 'image' | 'video';

export type ExternalGifDescriptor = {
  provider: ExternalGifProvider;
  providerLabel: 'GIPHY' | 'Tenor';
  canonicalUrl: string;
  resourceUrl: string;
  renderMode: ExternalGifRenderMode;
  id: string;
};

const GIPHY_PAGE_HOSTS = new Set(['giphy.com', 'www.giphy.com']);
const GIPHY_MEDIA_HOSTS = new Set([
  'i.giphy.com',
  'media.giphy.com',
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com'
]);
const TENOR_MEDIA_HOSTS = new Set(['media.tenor.com', 'media1.tenor.com', 'c.tenor.com']);
const SAFE_ID = /^[A-Za-z0-9_-]{6,128}$/;
const SAFE_TENOR_VARIANT = /^[A-Za-z0-9_-]{1,32}$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_MEDIA_BASENAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,178}[A-Za-z0-9])?$/;
const SAFE_GIPHY_SLUG = /^[A-Za-z0-9_-]{6,256}$/;
const GIPHY_PAGE_ID = /^[A-Za-z0-9]{6,128}$/;
const MEDIA_FILENAME = /\.(gif|webp|mp4|webm)$/i;

function hasUnsafeURLCodePoint(rawUrl: string): boolean {
  for (const character of rawUrl) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

function safeHTTPSURL(rawUrl: string): URL | null {
  if (
    !rawUrl ||
    !rawUrl.startsWith('https://') ||
    rawUrl !== rawUrl.trim() ||
    rawUrl.includes('\\') ||
    hasUnsafeURLCodePoint(rawUrl)
  ) {
    return null;
  }
  const authority = rawUrl.slice('https://'.length).split(/[/?#]/u, 1)[0];
  if (!authority || authority.includes('@') || authority.includes(':')) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  // Provider path contracts are ASCII and exact. Reject every escaped path
  // variant instead of trying to reason about equivalent decoded spellings.
  if (url.pathname.includes('%')) return null;
  url.hash = '';
  return url;
}

function strictPathSegments(url: URL): string[] | null {
  const path = url.pathname;
  if (!path.startsWith('/') || path === '/' || path.endsWith('/') || path.includes('//')) {
    return null;
  }
  const segments = path.slice(1).split('/');
  return segments.every(Boolean) ? segments : null;
}

function mediaRenderMode(filename: string): ExternalGifRenderMode | null {
  const match = filename.match(MEDIA_FILENAME);
  if (!match) return null;
  const basename = filename.slice(0, -match[0].length);
  if (!SAFE_MEDIA_BASENAME.test(basename) || basename.includes('..')) return null;
  return /^(?:mp4|webm)$/i.test(match[1]) ? 'video' : 'image';
}

function safePathSegment(value: string): boolean {
  return SAFE_PATH_SEGMENT.test(value) && !value.includes('..');
}

function giphyDescriptor(
  url: URL,
  id: string,
  renderMode: ExternalGifRenderMode,
  resourceUrl = url.href
): ExternalGifDescriptor {
  return {
    provider: 'giphy',
    providerLabel: 'GIPHY',
    canonicalUrl: url.href,
    resourceUrl,
    renderMode,
    id
  };
}

function parseGiphyPage(url: URL): ExternalGifDescriptor | null {
  if (!GIPHY_PAGE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const segments = strictPathSegments(url);
  if (!segments || segments.length !== 2) return null;

  let id = '';
  if (segments[0] === 'embed') {
    id = segments[1];
  } else if (segments[0] === 'gifs' || segments[0] === 'stickers') {
    if (!SAFE_GIPHY_SLUG.test(segments[1])) return null;
    id = segments[1].split('-').at(-1) ?? '';
  }
  if (!GIPHY_PAGE_ID.test(id)) return null;

  return giphyDescriptor(url, id, 'iframe', `https://giphy.com/embed/${id}`);
}

function parseGiphyMedia(url: URL): ExternalGifDescriptor | null {
  const host = url.hostname.toLowerCase();
  if (!GIPHY_MEDIA_HOSTS.has(host)) return null;
  const segments = strictPathSegments(url);
  if (!segments) return null;

  if (host === 'i.giphy.com') {
    if (segments.length !== 1) return null;
    const renderMode = mediaRenderMode(segments[0]);
    if (!renderMode) return null;
    const id = segments[0].replace(MEDIA_FILENAME, '');
    return GIPHY_PAGE_ID.test(id) ? giphyDescriptor(url, id, renderMode) : null;
  }

  let id = '';
  let filename = '';
  if (segments.length === 3 && segments[0] === 'media') {
    [, id, filename] = segments;
  } else if (segments.length === 4 && segments[0] === 'media' && safePathSegment(segments[1])) {
    [, , id, filename] = segments;
  } else {
    return null;
  }

  const renderMode = mediaRenderMode(filename);
  return renderMode && GIPHY_PAGE_ID.test(id) ? giphyDescriptor(url, id, renderMode) : null;
}

function tenorDescriptor(
  url: URL,
  id: string,
  renderMode: ExternalGifRenderMode
): ExternalGifDescriptor {
  return {
    provider: 'tenor',
    providerLabel: 'Tenor',
    canonicalUrl: url.href,
    resourceUrl: url.href,
    renderMode,
    id
  };
}

function parseTenorMedia(url: URL): ExternalGifDescriptor | null {
  if (!TENOR_MEDIA_HOSTS.has(url.hostname.toLowerCase())) return null;
  const segments = strictPathSegments(url);
  if (!segments) return null;

  // Tenor documents a bare media URL as well as named GIF/video renditions.
  if (segments.length === 1 && SAFE_ID.test(segments[0])) {
    return tenorDescriptor(url, segments[0], 'image');
  }

  let id = '';
  let filename = '';
  switch (segments.length) {
    case 2:
      [id, filename] = segments;
      break;
    case 3:
      if (segments[0] !== 'm') return null;
      [, id, filename] = segments;
      break;
    case 4:
      if (segments[0] !== 'm' || !SAFE_TENOR_VARIANT.test(segments[2])) return null;
      [, id, , filename] = segments;
      break;
    default:
      return null;
  }

  const renderMode = mediaRenderMode(filename);
  return renderMode && SAFE_ID.test(id) ? tenorDescriptor(url, id, renderMode) : null;
}

export function parseExternalGifUrl(rawUrl: string): ExternalGifDescriptor | null {
  const url = safeHTTPSURL(rawUrl);
  if (!url) return null;
  return parseGiphyPage(url) ?? parseGiphyMedia(url) ?? parseTenorMedia(url);
}

export function parseExternalGifMessageBody(body: string): ExternalGifDescriptor | null {
  const candidate = body.trim();
  if (!candidate || /\s/.test(candidate)) return null;
  return parseExternalGifUrl(candidate);
}

export function resolveExternalGifMessage(
  body: string,
  options: { supportsCapability: boolean; hasPersistedLinkPreview: boolean }
): ExternalGifDescriptor | null {
  if (!options.supportsCapability || options.hasPersistedLinkPreview) return null;
  return parseExternalGifMessageBody(body);
}
