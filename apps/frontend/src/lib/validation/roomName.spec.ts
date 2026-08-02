import { describe, expect, it } from 'vitest';
import { normalizeRoomName, roomNameLength, validateRoomName } from './roomName';

describe('room name validation', () => {
  it('normalizes Unicode and repeated spacing for storage', () => {
    expect(normalizeRoomName('  📣   Cafe\u0301\u00a0Updates  ')).toBe('📣 Café Updates');
  });

  it('counts Unicode code points instead of UTF-16 code units', () => {
    expect(roomNameLength('💬'.repeat(30))).toBe(30);
    expect(validateRoomName('💬'.repeat(30))).toMatchObject({ valid: true });
    expect(validateRoomName('💬'.repeat(31))).toMatchObject({
      valid: false,
      errorCode: 'too_long'
    });
  });

  it('accepts spaces, punctuation, accents, and compound emoji', () => {
    expect(validateRoomName('👨‍👩‍👧‍👦 Café / entraide!')).toMatchObject({
      valid: true,
      normalized: '👨‍👩‍👧‍👦 Café / entraide!'
    });
  });

  it.each([
    'team\tupdates',
    'team\nupdates',
    'team\u200bupdates',
    'team\u202eupdates',
    'team\u200dupdates'
  ])('rejects unsafe invisible input %j', (input) => {
    expect(validateRoomName(input)).toMatchObject({
      valid: false,
      errorCode: 'invalid_characters'
    });
  });

  it('rejects combining marks without a visible base character', () => {
    expect(validateRoomName('\u0301\u0308')).toMatchObject({
      valid: false,
      errorCode: 'required'
    });
  });
});
