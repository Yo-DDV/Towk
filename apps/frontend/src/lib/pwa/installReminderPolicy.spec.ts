import { describe, expect, it } from 'vitest';
import {
  PWA_INSTALL_REMINDER_DELAY_MS,
  PWA_INSTALL_REMINDER_REPEAT_MS,
  createInstallReminderState,
  isInstallReminderDue,
  isInstallReminderState,
  markInstallReminderShown,
  recordInstallVisit,
  snoozeInstallReminder
} from './installReminderPolicy';

describe('PWA install reminder policy', () => {
  it('waits for a return visit and meaningful engagement', () => {
    const firstVisit = recordInstallVisit(createInstallReminderState());
    expect(
      isInstallReminderDue(firstVisit, {
        installed: false,
        now: PWA_INSTALL_REMINDER_REPEAT_MS,
        engagedForMs: PWA_INSTALL_REMINDER_DELAY_MS
      })
    ).toBe(false);

    const returnVisit = recordInstallVisit(firstVisit);
    expect(
      isInstallReminderDue(returnVisit, {
        installed: false,
        now: PWA_INSTALL_REMINDER_REPEAT_MS,
        engagedForMs: PWA_INSTALL_REMINDER_DELAY_MS - 1
      })
    ).toBe(false);
    expect(
      isInstallReminderDue(returnVisit, {
        installed: false,
        now: PWA_INSTALL_REMINDER_REPEAT_MS,
        engagedForMs: PWA_INSTALL_REMINDER_DELAY_MS
      })
    ).toBe(true);
  });

  it('never reminds an installed app context', () => {
    const state = recordInstallVisit(recordInstallVisit(createInstallReminderState()));
    expect(
      isInstallReminderDue(state, {
        installed: true,
        now: PWA_INSTALL_REMINDER_REPEAT_MS,
        engagedForMs: PWA_INSTALL_REMINDER_DELAY_MS
      })
    ).toBe(false);
  });

  it('does not repeat until the cadence has elapsed', () => {
    const now = 2 * PWA_INSTALL_REMINDER_REPEAT_MS;
    const state = markInstallReminderShown(
      recordInstallVisit(recordInstallVisit(createInstallReminderState())),
      now
    );

    expect(
      isInstallReminderDue(state, {
        installed: false,
        now: now + PWA_INSTALL_REMINDER_REPEAT_MS - 1,
        engagedForMs: PWA_INSTALL_REMINDER_DELAY_MS
      })
    ).toBe(false);
    expect(
      isInstallReminderDue(state, {
        installed: false,
        now: now + PWA_INSTALL_REMINDER_REPEAT_MS,
        engagedForMs: PWA_INSTALL_REMINDER_DELAY_MS
      })
    ).toBe(true);
  });

  it('honors an explicit snooze and validates persisted state', () => {
    const now = 3 * PWA_INSTALL_REMINDER_REPEAT_MS;
    const state = snoozeInstallReminder(
      recordInstallVisit(recordInstallVisit(createInstallReminderState())),
      now
    );

    expect(state.snoozedUntil).toBe(now + PWA_INSTALL_REMINDER_REPEAT_MS);
    expect(isInstallReminderState(state)).toBe(true);
    expect(isInstallReminderState({ ...state, visits: -1 })).toBe(false);
    expect(isInstallReminderState({ ...state, lastShownAt: 'today' })).toBe(false);
  });
});
