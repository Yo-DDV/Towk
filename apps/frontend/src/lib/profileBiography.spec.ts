import { describe, expect, it } from 'vitest';
import {
  isProfileBiographyWithinLimit,
  MAX_PROFILE_BIOGRAPHY_BYTES,
  profileBiographyByteLength
} from './profileBiography';

describe('profile biography limits', () => {
  it('counts UTF-8 bytes instead of JavaScript code units', () => {
    expect(profileBiographyByteLength('é')).toBe(2);
    expect(profileBiographyByteLength('🙂')).toBe(4);
  });

  it('accepts the exact limit and rejects the next byte', () => {
    expect(isProfileBiographyWithinLimit('a'.repeat(MAX_PROFILE_BIOGRAPHY_BYTES))).toBe(true);
    expect(isProfileBiographyWithinLimit('a'.repeat(MAX_PROFILE_BIOGRAPHY_BYTES + 1))).toBe(false);
  });
});
