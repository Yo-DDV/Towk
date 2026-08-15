import { describe, expect, it } from 'vitest';
import { selectUpdatePolicy } from './updatePolicy';

describe('PWA update policy', () => {
  it.each([{ phase: 'joining' }, { phase: 'connected' }, { phase: 'reconnecting' }])(
    'defers a destructive reload while $phase',
    () => {
      expect(
        selectUpdatePolicy({
          isInCall: true,
          canSafelyReload: false,
          isAppVisible: true,
          observedDuringCall: true,
          updateAfterCallRequested: false
        })
      ).toEqual({ action: 'update-after-call', shouldAutoReload: false });
    }
  );

  it('reloads after the call only when the user scheduled that update', () => {
    const baseline = {
      isInCall: false,
      canSafelyReload: true,
      isAppVisible: true,
      observedDuringCall: true
    };

    expect(
      selectUpdatePolicy({ ...baseline, updateAfterCallRequested: false }).shouldAutoReload
    ).toBe(false);
    expect(
      selectUpdatePolicy({ ...baseline, updateAfterCallRequested: true }).shouldAutoReload
    ).toBe(true);
  });

  it('does not auto-reload a visible reader after the window loses focus', () => {
    expect(
      selectUpdatePolicy({
        isInCall: false,
        canSafelyReload: true,
        isAppVisible: true,
        observedDuringCall: false,
        updateAfterCallRequested: false
      })
    ).toEqual({ action: 'reload', shouldAutoReload: false });
  });

  it('auto-reloads an idle update only after the app is hidden', () => {
    expect(
      selectUpdatePolicy({
        isInCall: false,
        canSafelyReload: true,
        isAppVisible: false,
        observedDuringCall: false,
        updateAfterCallRequested: false
      })
    ).toEqual({ action: 'reload', shouldAutoReload: true });
  });
});
