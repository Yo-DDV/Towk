import { describe, expect, it, vi } from 'vitest';
import { FitMode } from '$lib/render/types';
import {
  DEFAULT_ATTACHMENT_THUMBNAIL_REFRESH,
  LIGHTBOX_ATTACHMENT_IMAGE_REFRESH,
  refreshAttachmentUrlsForAssets,
  type ExpiringAssetUrl,
  type RefreshedAttachmentUrls
} from './attachmentUrls';

const expiry = '2027-01-01T00:00:00.000Z';
const asset = (url: string): ExpiringAssetUrl => ({ url, expiresAt: expiry });
const refreshed = (
  assetUrl: ExpiringAssetUrl | null,
  thumbnailAssetUrl: ExpiringAssetUrl | null
): RefreshedAttachmentUrls => ({
  assetUrl,
  thumbnailAssetUrl,
  videoThumbnailAssetUrl: null,
  variantAssetUrls: new Map()
});

describe('refreshAttachmentUrlsForAssets lightbox display fallback', () => {
  it('reuses the refreshed original when a lightbox image has no thumbnail', async () => {
    const urls = refreshed(asset('/assets/animated.gif?fresh'), null);
    const refreshAssetUrls = vi.fn(async () => new Map([['animated', urls]]));

    const result = await refreshAttachmentUrlsForAssets(
      { refreshAssetUrls },
      'room',
      ['animated'],
      LIGHTBOX_ATTACHMENT_IMAGE_REFRESH
    );

    expect(result.get('animated')).toEqual({
      ...urls,
      thumbnailAssetUrl: urls.assetUrl
    });
    expect(refreshAssetUrls).toHaveBeenCalledWith(
      'room',
      ['animated'],
      LIGHTBOX_ATTACHMENT_IMAGE_REFRESH
    );
  });

  it('preserves a generated lightbox thumbnail when one is available', async () => {
    const urls = refreshed(asset('/assets/original?fresh'), asset('/assets/thumbnail?fresh'));
    const refreshAssetUrls = vi.fn(async () => new Map([['image', urls]]));

    const result = await refreshAttachmentUrlsForAssets(
      { refreshAssetUrls },
      'room',
      ['image'],
      { width: 2048, height: 2048, fit: FitMode.Contain }
    );

    expect(result.get('image')).toBe(urls);
  });

  it('does not blur thumbnail semantics for ordinary inline refreshes', async () => {
    const urls = refreshed(asset('/assets/animated.gif?fresh'), null);
    const refreshAssetUrls = vi.fn(async () => new Map([['animated', urls]]));

    const result = await refreshAttachmentUrlsForAssets(
      { refreshAssetUrls },
      'room',
      ['animated'],
      DEFAULT_ATTACHMENT_THUMBNAIL_REFRESH
    );

    expect(result.get('animated')).toBe(urls);
    expect(result.get('animated')?.thumbnailAssetUrl).toBeNull();
  });
});
