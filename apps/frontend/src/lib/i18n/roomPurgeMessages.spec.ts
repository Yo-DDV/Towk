import { describe, expect, it } from 'vitest';
import deCatalog from '../../../messages/de/room_purge.json';
import enCatalog from '../../../messages/en/room_purge.json';
import esCatalog from '../../../messages/es/room_purge.json';
import frCatalog from '../../../messages/fr/room_purge.json';
import ptCatalog from '../../../messages/pt/room_purge.json';

const catalogs = {
  en: enCatalog.room_purge,
  de: deCatalog.room_purge,
  fr: frCatalog.room_purge,
  es: esCatalog.room_purge,
  pt: ptCatalog.room_purge
};

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

describe('room purge localization', () => {
  it('keeps every supported locale on the same non-empty key set', () => {
    const expectedKeys = Object.keys(catalogs.en).sort();
    expect(expectedKeys.length).toBeGreaterThan(30);
    for (const [locale, catalog] of Object.entries(catalogs)) {
      expect(Object.keys(catalog).sort(), locale).toEqual(expectedKeys);
      expect(Object.values(catalog).every((value) => value.trim().length > 0), locale).toBe(true);
    }
  });

  it('keeps interpolation placeholders aligned with English', () => {
    for (const key of Object.keys(catalogs.en) as Array<keyof typeof catalogs.en>) {
      const expected = placeholders(catalogs.en[key]);
      for (const [locale, catalog] of Object.entries(catalogs)) {
        expect(placeholders(catalog[key]), `${locale}.${key}`).toEqual(expected);
      }
    }
  });
});
