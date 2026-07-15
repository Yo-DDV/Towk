export interface VersionUpdateState {
  readonly current: boolean;
  check(): Promise<boolean>;
}

export interface VersionUpdateMonitor {
  checkNow(): Promise<void>;
  stop(): void;
}

/**
 * Poll the app version explicitly and report the first available update.
 *
 * SvelteKit also polls its `updated` state, but keeping the check here makes
 * the activation path resilient when a client observes `updated.current`
 * after the component's reactive effect has already settled.
 */
export function startVersionUpdateMonitor(
  state: VersionUpdateState,
  onUpdate: () => void,
  pollIntervalMs = 60_000
): VersionUpdateMonitor {
  let stopped = false;
  let handled = false;
  let checkInFlight: Promise<void> | null = null;

  const timer = globalThis.setInterval(() => {
    void checkNow();
  }, pollIntervalMs);

  async function checkNow(): Promise<void> {
    if (stopped || handled) return;
    if (checkInFlight) return checkInFlight;

    const run = (async () => {
      let updateAvailable = state.current;
      if (!updateAvailable) {
        try {
          updateAvailable = await state.check();
        } catch {
          // A transient offline check is expected on mobile. The next interval
          // retries without surfacing a false update failure to the user.
          return;
        }
      }

      if (!updateAvailable || stopped || handled) return;
      onUpdate();
      handled = true;
      globalThis.clearInterval(timer);
    })();
    checkInFlight = run;

    try {
      await run;
    } finally {
      if (checkInFlight === run) checkInFlight = null;
    }
  }

  function stop(): void {
    stopped = true;
    globalThis.clearInterval(timer);
  }

  void checkNow();

  return { checkNow, stop };
}
