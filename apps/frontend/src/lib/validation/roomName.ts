import { hasVisibleContent } from './content';

export const ROOM_NAME_MAX_LENGTH = 30;

export type RoomNameValidationError = 'required' | 'too_long' | 'invalid_characters';

export type RoomNameValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; normalized: string; errorCode: RoomNameValidationError };

const EMOJI_JOINER = '\u200d';
const SPACE_SEPARATORS = /\p{Zs}+/gu;
const CONTROL_OR_SEPARATOR = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u;
const FORMAT_CHARACTER = /\p{Cf}/u;
const MARK_CHARACTER = /\p{M}/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const EMOJI_EXTENDER = /[\p{M}\p{Emoji_Modifier}]/u;

function isEmojiJoiner(codePoints: string[], index: number): boolean {
  let previous = index - 1;
  while (previous >= 0 && EMOJI_EXTENDER.test(codePoints[previous])) previous -= 1;

  let next = index + 1;
  while (next < codePoints.length && EMOJI_EXTENDER.test(codePoints[next])) next += 1;

  return (
    previous >= 0 &&
    next < codePoints.length &&
    EXTENDED_PICTOGRAPHIC.test(codePoints[previous]) &&
    EXTENDED_PICTOGRAPHIC.test(codePoints[next])
  );
}

/** Match the canonical display form persisted by the Go command model. */
export function normalizeRoomName(name: string): string {
  return name.normalize('NFC').trim().replace(SPACE_SEPARATORS, ' ');
}

export function roomNameLength(name: string): number {
  return [...name].length;
}

export function validateRoomName(name: string): RoomNameValidationResult {
  const normalized = normalizeRoomName(name);
  if (!normalized || !hasVisibleContent(normalized)) {
    return { valid: false, normalized, errorCode: 'required' };
  }

  const codePoints = [...normalized];
  let hasVisibleBase = false;
  for (const [index, character] of codePoints.entries()) {
    if (
      CONTROL_OR_SEPARATOR.test(character) ||
      (FORMAT_CHARACTER.test(character) &&
        (character !== EMOJI_JOINER || !isEmojiJoiner(codePoints, index)))
    ) {
      return { valid: false, normalized, errorCode: 'invalid_characters' };
    }
    if (!MARK_CHARACTER.test(character)) hasVisibleBase = true;
  }

  if (!hasVisibleBase) return { valid: false, normalized, errorCode: 'required' };

  if (roomNameLength(normalized) > ROOM_NAME_MAX_LENGTH) {
    return { valid: false, normalized, errorCode: 'too_long' };
  }

  return { valid: true, normalized };
}
