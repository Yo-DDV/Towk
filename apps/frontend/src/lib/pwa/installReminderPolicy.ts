export const PWA_INSTALL_REMINDER_DELAY_MS = 60_000;
export const PWA_INSTALL_REMINDER_REPEAT_MS = 14 * 24 * 60 * 60 * 1_000;

export type InstallReminderState = {
  visits: number;
  lastShownAt: number;
  snoozedUntil: number;
};

export function createInstallReminderState(): InstallReminderState {
  return { visits: 0, lastShownAt: 0, snoozedUntil: 0 };
}

export function isInstallReminderState(value: unknown): value is InstallReminderState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<InstallReminderState>;
  return (
    Number.isInteger(candidate.visits) &&
    (candidate.visits ?? -1) >= 0 &&
    Number.isFinite(candidate.lastShownAt) &&
    (candidate.lastShownAt ?? -1) >= 0 &&
    Number.isFinite(candidate.snoozedUntil) &&
    (candidate.snoozedUntil ?? -1) >= 0
  );
}

export function recordInstallVisit(state: InstallReminderState): InstallReminderState {
  return { ...state, visits: Math.min(state.visits + 1, 1_000) };
}

export function markInstallReminderShown(
  state: InstallReminderState,
  now: number
): InstallReminderState {
  return { ...state, lastShownAt: now };
}

export function snoozeInstallReminder(
  state: InstallReminderState,
  now: number
): InstallReminderState {
  return {
    ...state,
    lastShownAt: now,
    snoozedUntil: now + PWA_INSTALL_REMINDER_REPEAT_MS
  };
}

export function isInstallReminderDue(
  state: InstallReminderState,
  options: { installed: boolean; now: number; engagedForMs: number }
): boolean {
  if (options.installed || state.visits < 2) return false;
  if (options.engagedForMs < PWA_INSTALL_REMINDER_DELAY_MS) return false;
  if (options.now < state.snoozedUntil) return false;
  if (state.lastShownAt > 0 && options.now - state.lastShownAt < PWA_INSTALL_REMINDER_REPEAT_MS) {
    return false;
  }
  return true;
}
