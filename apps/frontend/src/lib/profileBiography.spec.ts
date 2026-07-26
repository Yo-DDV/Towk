import { describe, expect, it } from 'vitest';
import {
  isProfileBiographyWithinLimit,
  MAX_PROFILE_BIOGRAPHY_BYTES,
  MAX_PROFILE_BIOGRAPHY_CHARACTERS,
  profileBiographyByteLength,
  profileBiographyCharacterLength
} from './profileBiography';

describe('profile biography limits', () => {
  it('counts Unicode code points and UTF-8 bytes independently', () => {
    expect(profileBiographyCharacterLength('é')).toBe(1);
    expect(profileBiographyCharacterLength('🙂')).toBe(1);
    expect(profileBiographyByteLength('é')).toBe(2);
    expect(profileBiographyByteLength('🙂')).toBe(4);
  });

  it('accepts the exact character and byte boundary', () => {
    const value = '🙂'.repeat(MAX_PROFILE_BIOGRAPHY_CHARACTERS);
    expect(profileBiographyCharacterLength(value)).toBe(MAX_PROFILE_BIOGRAPHY_CHARACTERS);
    expect(profileBiographyByteLength(value)).toBe(MAX_PROFILE_BIOGRAPHY_BYTES);
    expect(isProfileBiographyWithinLimit(value)).toBe(true);
  });

  it('rejects the first Unicode code point past the profile boundary', () => {
    expect(isProfileBiographyWithinLimit('a'.repeat(MAX_PROFILE_BIOGRAPHY_CHARACTERS + 1))).toBe(
      false
    );
    expect(isProfileBiographyWithinLimit('🙂'.repeat(MAX_PROFILE_BIOGRAPHY_CHARACTERS + 1))).toBe(
      false
    );
  });
});
