import * as m from '$lib/i18n/messages';

const DEFAULT_ANNOUNCEMENTS_DESCRIPTION = 'Announcements and news';
const DEFAULT_GENERAL_DESCRIPTION = 'General discussion';

/** Localize only untouched product-owned seed copy; user-edited descriptions remain verbatim. */
export function localizedRoomDescription(
  name: string,
  description: string | null | undefined
): string | null {
  const normalized = description?.trim();
  if (!normalized) return null;
  if (name === 'announcements' && normalized === DEFAULT_ANNOUNCEMENTS_DESCRIPTION) {
    return m['room.system_defaults.announcements_description']();
  }
  if (name === 'general' && normalized === DEFAULT_GENERAL_DESCRIPTION) {
    return m['room.system_defaults.general_description']();
  }
  return normalized;
}
