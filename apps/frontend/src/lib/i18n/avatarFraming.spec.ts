import { describe, expect, it } from 'vitest';
import en from '../../../messages/en/avatar-framing.json';
import { avatarFramingCatalogs, formatAvatarFramingMessage } from './avatarFraming';

describe('avatar framing catalogs', () => {
  it('keeps exact key parity in every supported locale', () => {
    const expectedKeys = Object.keys(en).sort();
    expect(Object.keys(avatarFramingCatalogs).sort()).toEqual(['de', 'en', 'es', 'fr', 'pt']);
    for (const catalog of Object.values(avatarFramingCatalogs)) {
      expect(Object.keys(catalog).sort()).toEqual(expectedKeys);
      expect(Object.values(catalog).every((message) => message.trim().length > 0)).toBe(true);
    }
  });

  it('formats named values without altering unknown placeholders', () => {
    expect(formatAvatarFramingMessage('{size} at {x}, {unknown}', { size: 256, x: 12 })).toBe(
      '256 at 12, {unknown}'
    );
  });
});
