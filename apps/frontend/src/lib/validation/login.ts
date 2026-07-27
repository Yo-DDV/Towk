/**
 * Login/username validation matching the backend rules.
 *
 * Allowed: ASCII letters, digits, periods, underscores, hyphens.
 * Must start with a letter or digit.
 * Length: 2-32 characters.
 * Mixed case is preserved; uniqueness and login are case-insensitive.
 */

import { getLocale } from '$lib/i18n/runtime';

import type { ValidationResult } from './displayName';

/** Maximum login length in characters (matching backend) */
export const MAX_LOGIN_LENGTH = 32;

/** Minimum login length in characters (matching backend) */
export const MIN_LOGIN_LENGTH = 2;

/** Cooldown duration in milliseconds (30 days, matching backend) */
export const LOGIN_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/** Pattern: must start with letter/digit, followed by letters/digits/periods/underscores/hyphens */
const LOGIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Validate a login/username.
 *
 * Returns a stable error code when validation fails; callers localize it at render time.
 * The login should be trimmed before validating (use normalizeLogin).
 */
export function validateLogin(login: string): ValidationResult {
  if (login === '') {
    return { valid: false, errorCode: 'username_empty' };
  }

  if (login.length < MIN_LOGIN_LENGTH) {
    return { valid: false, errorCode: 'username_too_short' };
  }

  if (login.length > MAX_LOGIN_LENGTH) {
    return { valid: false, errorCode: 'username_too_long' };
  }

  if (!LOGIN_PATTERN.test(login)) {
    const firstChar = login[0];
    if (firstChar === '.' || firstChar === '_' || firstChar === '-') {
      return { valid: false, errorCode: 'username_invalid_start' };
    }
    return { valid: false, errorCode: 'username_invalid_characters' };
  }

  return { valid: true };
}

/**
 * Normalize a login by trimming whitespace. Casing is preserved.
 */
export function normalizeLogin(login: string): string {
  return login.trim();
}

/**
 * Validate and normalize a login.
 * Returns the validation result. If valid, the normalized login is in the result.
 */
export function validateAndNormalizeLogin(
  login: string
): ValidationResult & { normalized?: string } {
  const normalized = normalizeLogin(login);
  const result = validateLogin(normalized);
  if (result.valid) {
    return { ...result, normalized };
  }
  return result;
}

/**
 * Get the remaining cooldown time in milliseconds.
 * Returns 0 if no cooldown is active.
 */
export function getLoginChangeCooldownRemaining(lastChangeDate: Date | null): number {
  if (!lastChangeDate) return 0;
  const elapsed = Date.now() - lastChangeDate.getTime();
  const remaining = LOGIN_CHANGE_COOLDOWN_MS - elapsed;
  return remaining > 0 ? remaining : 0;
}

/**
 * Format a cooldown duration in milliseconds into a human-readable string.
 */
export function formatCooldownRemaining(ms: number): string {
  if (ms <= 0) return '';

  const locale = getLocale();
  let value: number;
  let unit: Intl.NumberFormatOptions['unit'];
  if (ms >= 24 * 60 * 60 * 1000) {
    value = Math.ceil(ms / (24 * 60 * 60 * 1000));
    unit = 'day';
  } else if (ms >= 60 * 60 * 1000) {
    value = Math.ceil(ms / (60 * 60 * 1000));
    unit = 'hour';
  } else {
    value = Math.ceil(ms / (60 * 1000));
    unit = 'minute';
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'long'
  }).format(value);
}
