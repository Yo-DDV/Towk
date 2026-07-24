export const EXTERNAL_GIF_EMBEDS_CAPABILITY = 'external-gif-embeds-v1';

export type ExternalGifProvider = 'giphy' | 'tenor';
export type ExternalGifRenderMode = 'iframe' | 'image' | 'video';
export type ExternalGifLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

export type ExternalGifDescriptor = {
  provider: ExternalGifProvider;
  providerLabel: 'GIPHY' | 'Tenor';
  canonicalUrl: string;
  resourceUrl: string;
  renderMode: ExternalGifRenderMode;
  id: string;
};

export type ExternalGifAutoLoadContext = {
  autoLoad: boolean;
  reducedMotion: boolean;
  hiddenByUser: boolean;
  online: boolean;
  pageVisible: boolean;
  loadState: ExternalGifLoadState;
  intersectionObserverAvailable: boolean;
};

const MAX_EXTERNAL_GIF_URL_LENGTH = 2_048;
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
const TENOR_LEGACY_IMAGE_ID = /^[A-Fa-f0-9]{32}$/;
const SAFE_GIPHY_METADATA = /^[A-Za-z0-9._-]{1,256}$/;
const SAFE_MEDIA_BASENAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,178}[A-Za-z0-9])?$/;
const SAFE_GIPHY_SLUG = /^[A-Za-z0-9_-]{6,256}$/;
const GIPHY_PAGE_ID = /^[A-Za-z0-9]{6,128}$/;
const MEDIA_FILENAME = /\.(gif|webp|mp4|webm)$/i;

function hasUnsafeURLCodePoint(rawUrl: string): boolean {
  for (const character of rawUrl) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint >= 0x7f) return true;
  }
  return false;
}

function safeHTTPSURL(rawUrl: string): URL | null {
  if (
    !rawUrl ||
    rawUrl.length > MAX_EXTERNAL_GIF_URL_LENGTH ||
    rawUrl.slice(0, 'https://'.length).toLowerCase() !== 'https://' ||
    rawUrl !== rawUrl.trim() ||
    rawUrl.includes('\\') ||
    hasUnsafeURLCodePoint(rawUrl)
  ) {
    return null;
  }
  const remainder = rawUrl.slice('https://'.length);
  const authority = remainder.split(/[/?#]/u, 1)[0];
  if (!authority || authority.includes('@') || authority.includes(':')) return null;

  // WHATWG URL parsing normalizes literal dot segments before exposing
  // pathname. Reject them from the raw path so frontend and backend
  // classification stay identical and no allow-list shape is reached only
  // after normalization.
  const rawPath = remainder.slice(authority.length).split(/[?#]/u, 1)[0];
  if (rawPath.includes('%')) return null;
  if (rawPath.split('/').some((segment) => segment === '.' || segment === '..')) return null;

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

function strictPathSegments(url: URL, allowSingleTrailingSlash = false): string[] | null {
  let path = url.pathname;
  if (allowSingleTrailingSlash && path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
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

function safeGiphyMetadata(value: string): boolean {
  return SAFE_GIPHY_METADATA.test(value) && !value.includes('..');
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
  const segments = strictPathSegments(url, true);
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

  if (host === 'i.giphy.com' && segments.length === 1) {
    const renderMode = mediaRenderMode(segments[0]);
    if (!renderMode) return null;
    const id = segments[0].replace(MEDIA_FILENAME, '');
    return GIPHY_PAGE_ID.test(id) ? giphyDescriptor(url, id, renderMode) : null;
  }

  let id = '';
  let filename = '';
  if (segments.length === 3 && segments[0] === 'media') {
    [, id, filename] = segments;
  } else if (segments.length === 4 && segments[0] === 'media' && safeGiphyMetadata(segments[1])) {
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

  // Older Tenor shares use /images/<32-hex-id>/<rendition>. Keep this
  // narrowly bounded because these URLs still appear in historical messages
  // and keyboard clipboard fallbacks.
  if (
    segments.length === 3 &&
    segments[0] === 'images' &&
    TENOR_LEGACY_IMAGE_ID.test(segments[1])
  ) {
    const renderMode = mediaRenderMode(segments[2]);
    return renderMode ? tenorDescriptor(url, segments[1], renderMode) : null;
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

export function shouldObserveExternalGif(context: ExternalGifAutoLoadContext): boolean {
  return (
    context.autoLoad &&
    !context.reducedMotion &&
    !context.hiddenByUser &&
    context.online &&
    context.pageVisible &&
    context.loadState === 'idle' &&
    context.intersectionObserverAvailable
  );
}
