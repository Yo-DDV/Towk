import { beforeEach, describe, expect, it } from 'vitest';

import { setLocale } from '$lib/i18n/runtime';
import { localizedRoomDescription } from './roomLabels';

describe('localizedRoomDescription', () => {
  beforeEach(async () => setLocale('en'));

  it('localizes untouched product-owned defaults', async () => {
    await setLocale('fr');
    expect(localizedRoomDescription('announcements', 'Announcements and news')).toBe(
      'Annonces et actualités'
    );
    expect(localizedRoomDescription('general', 'General discussion')).toBe('Discussion générale');
  });

  it('preserves operator-authored content', async () => {
    await setLocale('de');
    expect(localizedRoomDescription('general', 'Community lounge')).toBe('Community lounge');
  });
});
