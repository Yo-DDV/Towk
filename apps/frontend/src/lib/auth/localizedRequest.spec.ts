import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ getLocale: vi.fn(() => 'fr') }));

vi.mock('$lib/i18n/runtime', () => runtime);

import { localizedJSONHeaders, TOWK_LOCALE_HEADER } from './localizedRequest';

describe('localizedJSONHeaders', () => {
  beforeEach(() => {
    runtime.getLocale.mockReset();
    runtime.getLocale.mockReturnValue('fr');
  });

  it('sets JSON content type and the selected application locale', () => {
    const headers = localizedJSONHeaders();

    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get(TOWK_LOCALE_HEADER)).toBe('fr');
  });

  it('preserves caller headers while replacing a stale locale', () => {
    const headers = localizedJSONHeaders({
      Accept: 'application/json',
      'Content-Type': 'application/problem+json',
      [TOWK_LOCALE_HEADER]: 'en'
    });

    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Content-Type')).toBe('application/problem+json');
    expect(headers.get(TOWK_LOCALE_HEADER)).toBe('fr');
  });
});
