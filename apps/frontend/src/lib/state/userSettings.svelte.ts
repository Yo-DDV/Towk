/**
 * Server-side user display preferences (timezone, time format, read receipts).
 *
 * Populated from the LoadCurrentUser query during app initialization.
 * Used by time formatting utilities to respect user preferences.
 */

import { createContext } from 'svelte';
import { TimeFormat } from '$lib/render/types';

export function hour12ForTimeFormat(timeFormat: TimeFormat): boolean | undefined {
  if (timeFormat === TimeFormat.TwelveHour) return true;
  if (timeFormat === TimeFormat.TwentyFourHour) return false;
  return undefined;
}

export class UserSettingsState {
  /** IANA timezone name, or null for browser default. */
  timezone = $state<string | null>(null);

  /** Time display format preference. */
  timeFormat = $state<TimeFormat>(TimeFormat.Auto);

  /** Whether this account publishes and may inspect reciprocal read receipts. */
  readReceiptsEnabled = $state(true);

  /**
   * Effective timezone for Intl.DateTimeFormat.
   * Returns undefined when unset, which tells Intl to use browser default.
   */
  get effectiveTimezone(): string | undefined {
    return this.timezone || undefined;
  }

  /**
   * Effective hour12 option for Intl.DateTimeFormat.
   * Returns undefined when unset, which tells Intl to use locale default.
   */
  get effectiveHour12(): boolean | undefined {
    return hour12ForTimeFormat(this.timeFormat);
  }

  /** Update from server settings data. */
  updateFromData(
    settings:
      | { timezone?: string | null; timeFormat: TimeFormat; readReceiptsEnabled?: boolean }
      | null
      | undefined
  ) {
    if (settings) {
      this.timezone = settings.timezone ?? null;
      this.timeFormat = settings.timeFormat;
      this.readReceiptsEnabled = settings.readReceiptsEnabled ?? true;
    } else {
      this.timezone = null;
      this.timeFormat = TimeFormat.Auto;
      this.readReceiptsEnabled = true;
    }
  }
}

export const [getUserSettings, setUserSettings] = createContext<UserSettingsState>();
