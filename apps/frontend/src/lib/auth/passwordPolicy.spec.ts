import { describe, expect, it } from 'vitest';

import {
  MAX_PASSWORD_UTF8_BYTES,
  MIN_PASSWORD_CODE_POINTS,
  PASSWORD_TOO_LONG,
  PASSWORD_TOO_SHORT,
  assertPasswordPolicy,
  normalizePasswordValidationCode,
  passwordCodePointLength,
  passwordUtf8ByteLength,
  passwordValidationCode,
  passwordValidationMessage,
  passwordValidationMessageForCode
} from './passwordPolicy';

const messages = {
  tooShort: 'too short',
  tooLong: 'too long'
};

describe('passwordPolicy', () => {
  it.each([
    ['seven ASCII code points', 'a'.repeat(7), PASSWORD_TOO_SHORT, 7, 7],
    ['eight ASCII code points', 'a'.repeat(8), undefined, 8, 8],
    ['seventy one ASCII bytes', 'a'.repeat(71), undefined, 71, 71],
    ['seventy two ASCII bytes', 'a'.repeat(72), undefined, 72, 72],
    ['seventy three ASCII bytes', 'a'.repeat(73), PASSWORD_TOO_LONG, 73, 73],
    ['one hundred twenty eight ASCII bytes', 'a'.repeat(128), PASSWORD_TOO_LONG, 128, 128],
    ['one hundred twenty nine ASCII bytes', 'a'.repeat(129), PASSWORD_TOO_LONG, 129, 129],
    ['seven multibyte code points', 'é'.repeat(7), PASSWORD_TOO_SHORT, 7, 14],
    ['eight multibyte code points', 'é'.repeat(8), undefined, 8, 16],
    ['seventy one multibyte bytes', '田'.repeat(23) + 'é', undefined, 24, 71],
    ['seventy two multibyte bytes', '田'.repeat(24), undefined, 24, 72],
    ['seventy three multibyte bytes', '田'.repeat(23) + 'éé', PASSWORD_TOO_LONG, 25, 73],
    [
      'one hundred twenty eight multibyte bytes',
      '田'.repeat(42) + 'é',
      PASSWORD_TOO_LONG,
      43,
      128
    ],
    ['one hundred twenty nine multibyte bytes', '田'.repeat(43), PASSWORD_TOO_LONG, 43, 129]
  ])('%s', (_name, password, expectedCode, expectedCodePoints, expectedBytes) => {
    expect(passwordCodePointLength(password)).toBe(expectedCodePoints);
    expect(passwordUtf8ByteLength(password)).toBe(expectedBytes);
    expect(passwordValidationCode(password)).toBe(expectedCode);
  });

  it('publishes the agreed boundaries', () => {
    expect(MIN_PASSWORD_CODE_POINTS).toBe(8);
    expect(MAX_PASSWORD_UTF8_BYTES).toBe(72);
  });

  it('maps validation codes to caller-provided messages', () => {
    expect(passwordValidationMessage('a'.repeat(7), messages)).toBe(messages.tooShort);
    expect(passwordValidationMessage('a'.repeat(73), messages)).toBe(messages.tooLong);
    expect(passwordValidationMessage('a'.repeat(8), messages)).toBeUndefined();
    expect(passwordValidationMessageForCode(PASSWORD_TOO_LONG, messages)).toBe(messages.tooLong);
  });

  it('rejects invalid values before API calls', () => {
    expect(() => assertPasswordPolicy('a'.repeat(7), messages)).toThrow(messages.tooShort);
    expect(() => assertPasswordPolicy('a'.repeat(73), messages)).toThrow(messages.tooLong);
    expect(() => assertPasswordPolicy('a'.repeat(8), messages)).not.toThrow();
  });

  it('ignores unknown transport codes', () => {
    expect(normalizePasswordValidationCode('OTHER_ERROR')).toBeUndefined();
    expect(passwordValidationMessageForCode(undefined, messages)).toBeUndefined();
  });
});
