/** Seven-day reminders keep disabled Web Push visible without blocking normal use. */
export const PUSH_PROMPT_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function nextPushPromptReminderAt(now = Date.now()): number {
  return now + PUSH_PROMPT_REMINDER_INTERVAL_MS;
}

export function isPushPromptReminderDue(snoozedUntil: number, now = Date.now()): boolean {
  return !Number.isFinite(snoozedUntil) || snoozedUntil <= now;
}
