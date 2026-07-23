export const MIN_PASSWORD_CODE_POINTS = 8;
export const MAX_PASSWORD_UTF8_BYTES = 72;
export const PASSWORD_TOO_SHORT = 'PASSWORD_TOO_SHORT';
export const PASSWORD_TOO_LONG = 'PASSWORD_TOO_LONG';
export const PASSWORD_ERROR_METADATA_KEY = 'Towk-Error-Code';

export type PasswordValidationCode = typeof PASSWORD_TOO_SHORT | typeof PASSWORD_TOO_LONG;

export type PasswordValidationMessages = {
  tooShort: string;
  tooLong: string;
};

const textEncoder = new TextEncoder();

export function passwordCodePointLength(password: string): number {
  return Array.from(password).length;
}

export function passwordUtf8ByteLength(password: string): number {
  return textEncoder.encode(password).length;
}

export function passwordValidationCode(password: string): PasswordValidationCode | undefined {
  if (passwordCodePointLength(password) < MIN_PASSWORD_CODE_POINTS) {
    return PASSWORD_TOO_SHORT;
  }
  if (passwordUtf8ByteLength(password) > MAX_PASSWORD_UTF8_BYTES) {
    return PASSWORD_TOO_LONG;
  }
  return undefined;
}

export function normalizePasswordValidationCode(
  code: unknown
): PasswordValidationCode | undefined {
  return code === PASSWORD_TOO_SHORT || code === PASSWORD_TOO_LONG ? code : undefined;
}

export function passwordValidationMessageForCode(
  code: unknown,
  messages: PasswordValidationMessages
): string | undefined {
  switch (normalizePasswordValidationCode(code)) {
    case PASSWORD_TOO_SHORT:
      return messages.tooShort;
    case PASSWORD_TOO_LONG:
      return messages.tooLong;
    default:
      return undefined;
  }
}

export function passwordValidationMessage(
  password: string,
  messages: PasswordValidationMessages
): string | undefined {
  return passwordValidationMessageForCode(passwordValidationCode(password), messages);
}
