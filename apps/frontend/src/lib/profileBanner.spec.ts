import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROFILE_BANNER_MAX_DIMENSION,
  PROFILE_BANNER_MAX_PIXELS,
  PROFILE_BANNER_MAX_UPLOAD_BYTES,
  PROFILE_BANNER_MIN_HEIGHT,
  PROFILE_BANNER_MIN_WIDTH,
  PROFILE_BANNER_RECOMMENDED_HEIGHT,
  PROFILE_BANNER_RECOMMENDED_WIDTH,
  clearProfileBannerCapabilityCache,
  isProfileBannerBelowRecommendation,
  supportsProfileBanners,
  validateProfileBannerDimensions,
  validateProfileBannerFile
} from './profileBanner';

afterEach(() => {
  vi.restoreAllMocks();
  clearProfileBannerCapabilityCache();
});

describe('profile banner client contract', () => {
  it('accepts only the supported static image MIME types', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateProfileBannerFile({ type, size: 1024 })).toBeNull();
    }
    for (const type of ['image/gif', 'image/svg+xml', 'text/html', '']) {
      expect(validateProfileBannerFile({ type, size: 1024 })).toBe('invalid_type');
    }
  });

  it('rejects empty and oversized uploads before network work', () => {
    expect(validateProfileBannerFile({ type: 'image/jpeg', size: 0 })).toBe('too_large');
    expect(
      validateProfileBannerFile({
        type: 'image/jpeg',
        size: PROFILE_BANNER_MAX_UPLOAD_BYTES + 1
      })
    ).toBe('too_large');
    expect(
      validateProfileBannerFile({
        type: 'image/jpeg',
        size: PROFILE_BANNER_MAX_UPLOAD_BYTES
      })
    ).toBeNull();
  });

  it('rejects dimensions outside the server-side decoding envelope', () => {
    expect(
      validateProfileBannerDimensions({
        width: PROFILE_BANNER_MIN_WIDTH - 1,
        height: PROFILE_BANNER_MIN_HEIGHT
      })
    ).toBe('too_small');
    expect(
      validateProfileBannerDimensions({
        width: PROFILE_BANNER_MAX_DIMENSION + 1,
        height: PROFILE_BANNER_MIN_HEIGHT
      })
    ).toBe('dimensions_too_large');
    expect(
      validateProfileBannerDimensions({
        width: PROFILE_BANNER_MAX_DIMENSION,
        height: Math.floor(PROFILE_BANNER_MAX_PIXELS / PROFILE_BANNER_MAX_DIMENSION) + 1
      })
    ).toBe('dimensions_too_large');
    expect(
      validateProfileBannerDimensions({
        width: PROFILE_BANNER_RECOMMENDED_WIDTH,
        height: PROFILE_BANNER_RECOMMENDED_HEIGHT
      })
    ).toBeNull();
  });

  it('marks dimensions below the documented recommendation', () => {
    expect(
      isProfileBannerBelowRecommendation({
        width: PROFILE_BANNER_RECOMMENDED_WIDTH,
        height: PROFILE_BANNER_RECOMMENDED_HEIGHT
      })
    ).toBe(false);
    expect(
      isProfileBannerBelowRecommendation({
        width: PROFILE_BANNER_RECOMMENDED_WIDTH - 1,
        height: PROFILE_BANNER_RECOMMENDED_HEIGHT
      })
    ).toBe(true);
  });

  it('caches one capability request per server endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ supported: true }), { status: 200 }));
    const config = {
      serverId: 'server-1',
      baseUrl: 'https://towk.example/api/connect',
      bearerToken: 'token'
    };

    await expect(supportsProfileBanners(config)).resolves.toBe(true);
    await expect(supportsProfileBanners(config)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://towk.example/api/profile/banner/capability');
  });
});
