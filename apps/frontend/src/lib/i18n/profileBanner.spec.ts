import { describe, expect, it } from 'vitest';
import { profileBannerCatalogs } from './profileBanner';

describe('profile banner localization catalogs', () => {
  it('keeps every supported locale in key parity with English', () => {
    const englishKeys = Object.keys(profileBannerCatalogs.en).sort();

    for (const [locale, catalog] of Object.entries(profileBannerCatalogs)) {
      expect(Object.keys(catalog).sort(), `catalog ${locale}`).toEqual(englishKeys);
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('keeps the documented limits consistent in every locale', () => {
    for (const catalog of Object.values(profileBannerCatalogs)) {
      expect(catalog.drop_subtitle).toContain('8');
      expect(catalog.recommendation).toContain('1536');
      expect(catalog.recommendation).toContain('512');
      expect(catalog.recommendation).toContain('600');
      expect(catalog.recommendation).toContain('200');
    }
  });
});
