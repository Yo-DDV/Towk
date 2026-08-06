import { FitMode } from '$lib/render/types';
import type { AttachmentAPI } from '$lib/api-client/attachments';

export type ExpiringAssetUrl = {
  url: string;
  expiresAt: string;
};

export type RefreshedAttachmentUrls = {
  assetUrl: ExpiringAssetUrl | null;
  thumbnailAssetUrl: ExpiringAssetUrl | null;
  videoThumbnailAssetUrl: ExpiringAssetUrl | null;
  variantAssetUrls: Map<string, ExpiringAssetUrl | null>;
};

export type AttachmentThumbnailRefreshOptions = {
  width: number;
  height: number;
  fit: FitMode;
};

export const DEFAULT_ATTACHMENT_THUMBNAIL_REFRESH: AttachmentThumbnailRefreshOptions = {
  width: 960,
  height: 400,
  fit: FitMode.Contain
};

export const LIGHTBOX_ATTACHMENT_IMAGE_REFRESH: AttachmentThumbnailRefreshOptions = {
  width: 2048,
  height: 2048,
  fit: FitMode.Contain
};

export const ASSET_URL_REFRESH_LEAD_MS = 2 * 60_000;

export function assetUrlExpiresAtMs(assetUrl: ExpiringAssetUrl | null | undefined): number | null {
  if (!assetUrl) return null;
  const expiresAt = new Date(assetUrl.expiresAt).getTime();
  return Number.isNaN(expiresAt) ? Date.now() : expiresAt;
}

export function assetUrlRefreshAt(
  assetUrl: ExpiringAssetUrl | null | undefined,
  leadMs = ASSET_URL_REFRESH_LEAD_MS
): number | null {
  const expiresAt = assetUrlExpiresAtMs(assetUrl);
  return expiresAt === null ? null : expiresAt - leadMs;
}

export function assetUrlNeedsRefresh(
  assetUrl: ExpiringAssetUrl | null | undefined,
  now = Date.now(),
  leadMs = ASSET_URL_REFRESH_LEAD_MS
): boolean {
  const refreshAt = assetUrlRefreshAt(assetUrl, leadMs);
  return refreshAt !== null && refreshAt <= now;
}

export function earliestAssetUrlRefreshAt(
  assetUrls: Iterable<ExpiringAssetUrl | null | undefined>,
  leadMs = ASSET_URL_REFRESH_LEAD_MS
): number | null {
  let nextRefreshAt: number | null = null;
  for (const assetUrl of assetUrls) {
    const refreshAt = assetUrlRefreshAt(assetUrl, leadMs);
    if (refreshAt === null) continue;
    nextRefreshAt = nextRefreshAt === null ? refreshAt : Math.min(nextRefreshAt, refreshAt);
  }
  return nextRefreshAt;
}

export function mergeRefreshedAttachmentUrls(
  current: Map<string, RefreshedAttachmentUrls>,
  fresh: Map<string, RefreshedAttachmentUrls>
): Map<string, RefreshedAttachmentUrls> {
  if (fresh.size === 0) return current;
  return new Map([...current, ...fresh]);
}

export function withAssetUrlRetryParam(url: string, retry: string | number): string {
  const hashStart = url.indexOf('#');
  const base = hashStart === -1 ? url : url.slice(0, hashStart);
  const hash = hashStart === -1 ? '' : url.slice(hashStart);
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}retry=${encodeURIComponent(String(retry))}${hash}`;
}

function isLightboxImageRefresh(options: AttachmentThumbnailRefreshOptions): boolean {
  return (
    options.width === LIGHTBOX_ATTACHMENT_IMAGE_REFRESH.width &&
    options.height === LIGHTBOX_ATTACHMENT_IMAGE_REFRESH.height &&
    options.fit === LIGHTBOX_ATTACHMENT_IMAGE_REFRESH.fit
  );
}

function withLightboxDisplayFallbacks(
  fresh: Map<string, RefreshedAttachmentUrls>
): Map<string, RefreshedAttachmentUrls> {
  let changed = false;
  const normalized = new Map<string, RefreshedAttachmentUrls>();
  for (const [assetId, urls] of fresh) {
    if (!urls.thumbnailAssetUrl && urls.assetUrl) {
      changed = true;
      normalized.set(assetId, { ...urls, thumbnailAssetUrl: urls.assetUrl });
    } else {
      normalized.set(assetId, urls);
    }
  }
  return changed ? normalized : fresh;
}

export async function refreshAttachmentUrlsForAssets(
  api: Pick<AttachmentAPI, 'refreshAssetUrls'>,
  roomId: string,
  assetIds: readonly string[],
  thumbnailOptions = DEFAULT_ATTACHMENT_THUMBNAIL_REFRESH
): Promise<Map<string, RefreshedAttachmentUrls>> {
  try {
    const fresh = await api.refreshAssetUrls(roomId, [...assetIds], thumbnailOptions);
    // A GIF or another directly displayable image can legitimately have no
    // generated thumbnail. Lightbox callers use thumbnailAssetUrl as their
    // fitted display ticket, so fall back to the refreshed original instead of
    // dropping the item during a long-lived viewer refresh.
    return isLightboxImageRefresh(thumbnailOptions)
      ? withLightboxDisplayFallbacks(fresh)
      : fresh;
  } catch (error) {
    console.warn('Failed to refresh attachment URLs', error);
    return new Map();
  }
}
