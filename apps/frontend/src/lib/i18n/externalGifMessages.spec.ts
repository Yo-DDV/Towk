import { afterEach, describe, expect, it } from 'vitest';
import { setReactiveLocale } from './state.svelte';
import { externalGifMessages } from './externalGifMessages';

afterEach(() => setReactiveLocale('en'));

describe('externalGifMessages', () => {
  it.each([
    ['en', 'Load external GIF'],
    ['de', 'Externes GIF laden'],
    ['fr', 'Charger le GIF externe'],
    ['es', 'Cargar GIF externo'],
    ['pt', 'Carregar GIF externo']
  ] as const)('selects the %s catalog reactively', (locale, expected) => {
    setReactiveLocale(locale);
    expect(externalGifMessages.load()).toBe(expected);
  });

  it('interpolates the provider without interpreting markup', () => {
    setReactiveLocale('en');
    expect(externalGifMessages.privacyNotice('<provider>')).toContain('<provider>');
  });
});
