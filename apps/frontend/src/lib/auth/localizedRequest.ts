import { getLocale } from '$lib/i18n/runtime';

export const TOWK_LOCALE_HEADER = 'X-Towk-Locale';

export function localizedJSONHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set(TOWK_LOCALE_HEADER, getLocale());
  return headers;
}
