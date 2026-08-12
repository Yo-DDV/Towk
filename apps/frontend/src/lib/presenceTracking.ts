import {
  createPresenceAPI,
  APIPresenceStatus,
  type PresenceAPIConfig,
  type PresenceReportOptions
} from '$lib/api-client/presence';
import { PresenceStatus } from '$lib/render/types';
import { presencePreference, type PresenceMode } from '$lib/state/presencePreference.svelte';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const HIDDEN_DELAY_MS = 10_000;
const UNFOCUSED_DELAY_MS = 30_000;
const NOISY_ACTIVITY_THROTTLE_MS = 1_000;
const ACTIVE_PRESENCE_REFRESH_MS = 30_000;
const INACTIVE_PRESENCE_REFRESH_MS = 5 * 60 * 1000;
const PRESENCE_MODE_STORAGE_KEY = 'chatto.presence.mode';

type ActivityState = 'active' | 'idle' | 'hidden' | 'passive';

export type PresenceReporterConfig = PresenceAPIConfig;

export type PresenceTrackingOptions = {
  onPauseLiveEvents?: () => void;
  onResumeLiveEvents?: () => void;
};

let initialized = false;
let applyModeFromUI: ((mode: PresenceMode) => void) | null = null;

function apiStatusToPresenceStatus(status: APIPresenceStatus): PresenceStatus {
  switch (status) {
    case APIPresenceStatus.AWAY:
      return PresenceStatus.Away;
    case APIPresenceStatus.DO_NOT_DISTURB:
      return PresenceStatus.DoNotDisturb;
    case APIPresenceStatus.OFFLINE:
      return PresenceStatus.Offline;
    default:
      return PresenceStatus.Online;
  }
}

function presenceStatusToAPIStatus(status: PresenceStatus): APIPresenceStatus {
  switch (status) {
    case PresenceStatus.Away:
      return APIPresenceStatus.AWAY;
    case PresenceStatus.DoNotDisturb:
      return APIPresenceStatus.DO_NOT_DISTURB;
    case PresenceStatus.Offline:
      return APIPresenceStatus.OFFLINE;
    default:
      return APIPresenceStatus.ONLINE;
  }
}

function modeToExplicitStatus(mode: PresenceMode): PresenceStatus | null {
  switch (mode) {
    case 'away':
      return PresenceStatus.Away;
    case 'doNotDisturb':
      return PresenceStatus.DoNotDisturb;
    case 'invisible':
      return PresenceStatus.Offline;
    default:
      return null;
  }
}

function readStoredMode(): PresenceMode {
  if (typeof localStorage === 'undefined') return 'auto';
  try {
    const stored = localStorage.getItem(PRESENCE_MODE_STORAGE_KEY);
    if (
      stored === 'auto' ||
      stored === 'away' ||
      stored === 'doNotDisturb' ||
      stored === 'invisible'
    ) {
      return stored;
    }
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
  return 'auto';
}

export function shouldPauseLiveEventsForStoredPresence(): boolean {
  return readStoredMode() === 'invisible';
}

function storeMode(mode: PresenceMode) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PRESENCE_MODE_STORAGE_KEY, mode);
  } catch {
    // Presence remains functional for the current page without persistence.
  }
}

export function setPresenceMode(mode: PresenceMode) {
  storeMode(mode);
  presencePreference.mode = mode;
  applyModeFromUI?.(mode);
}

function isActiveState(state: ActivityState): boolean {
  return state === 'active';
}

function statusForAutoState(state: ActivityState): PresenceStatus {
  return isActiveState(state) ? PresenceStatus.Online : PresenceStatus.Away;
}

export function initPresenceTracking(
  getReporters: () => PresenceReporterConfig[],
  onStatusChange?: (status: PresenceStatus) => void,
  options: PresenceTrackingOptions = {}
): () => void {
  if (initialized) return () => {};
  initialized = true;

  let currentMode = readStoredMode();
  let windowFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  let currentState: ActivityState = document.visibilityState === 'hidden' ? 'hidden' : 'active';
  let desiredStatus: PresenceStatus | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  let passiveTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTimerResetAt = 0;
  let reportRevision = 0;
  let pendingMeaningfulActivity = isActiveState(currentState);
  const reporterAPIs = new Map<
    string,
    { signature: string; api: ReturnType<typeof createPresenceAPI> }
  >();
  let disposed = false;

  presencePreference.mode = currentMode;

  function emitLocalStatus(status: PresenceStatus) {
    presencePreference.effectiveStatus = status;
    onStatusChange?.(status);
  }

  function applyAcceptedStatus(accepted: APIPresenceStatus, revision: number) {
    if (disposed || revision !== reportRevision || currentMode === 'invisible') return;
    const acceptedStatus = apiStatusToPresenceStatus(accepted);
    if (presencePreference.effectiveStatus !== acceptedStatus) {
      emitLocalStatus(acceptedStatus);
    }
  }

  function reporterAPI(config: PresenceReporterConfig): ReturnType<typeof createPresenceAPI> {
    const key = config.serverId ?? config.baseUrl;
    const signature = `${config.baseUrl}\u0000${config.bearerToken ?? ''}`;
    const existing = reporterAPIs.get(key);
    if (existing?.signature === signature) return existing.api;

    const api = createPresenceAPI(config);
    reporterAPIs.set(key, { signature, api });
    return api;
  }

  function sendPresenceReport(
    status: PresenceStatus,
    userSelected: boolean,
    revision: number,
    reportOptions: PresenceReportOptions
  ) {
    for (const config of getReporters()) {
      reporterAPI(config)
        .updatePresence(presenceStatusToAPIStatus(status), userSelected, reportOptions)
        .then((accepted) => applyAcceptedStatus(accepted, revision))
        .catch(() => {});
    }
  }

  function clearRefreshTimer() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  function scheduleRefresh() {
    clearRefreshTimer();
    if (currentMode === 'invisible' || desiredStatus === null) return;
    const delay = isActiveState(currentState)
      ? ACTIVE_PRESENCE_REFRESH_MS
      : INACTIVE_PRESENCE_REFRESH_MS;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (currentMode === 'invisible' || desiredStatus === null) return;
      const meaningfulActivity = pendingMeaningfulActivity && isActiveState(currentState);
      pendingMeaningfulActivity = false;
      const revision = ++reportRevision;
      sendPresenceReport(desiredStatus, currentMode !== 'auto', revision, {
        active: isActiveState(currentState),
        meaningfulActivity
      });
      scheduleRefresh();
    }, delay);
  }

  function reportStatus(
    status: PresenceStatus,
    userSelected = false,
    meaningfulActivity = false
  ) {
    const revision = ++reportRevision;
    desiredStatus = status;
    if (meaningfulActivity) pendingMeaningfulActivity = false;
    emitLocalStatus(status);
    sendPresenceReport(status, userSelected, revision, {
      active: isActiveState(currentState) && status !== PresenceStatus.Offline,
      meaningfulActivity
    });
    scheduleRefresh();
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function resetIdleTimer() {
    clearIdleTimer();
    if (!isActiveState(currentState)) return;
    lastTimerResetAt = Date.now();
    idleTimer = setTimeout(() => transition('idle'), IDLE_TIMEOUT_MS);
  }

  function clearHiddenTimer() {
    if (hiddenTimer) {
      clearTimeout(hiddenTimer);
      hiddenTimer = null;
    }
  }

  function clearPassiveTimer() {
    if (passiveTimer) {
      clearTimeout(passiveTimer);
      passiveTimer = null;
    }
  }

  function statusForCurrentMode(): PresenceStatus {
    return modeToExplicitStatus(currentMode) ?? statusForAutoState(currentState);
  }

  function transition(newState: ActivityState, meaningfulActivity = false) {
    if (newState === currentState) {
      if (meaningfulActivity && isActiveState(currentState)) {
        pendingMeaningfulActivity = true;
        resetIdleTimer();
        // A focus/resume signal is fresh authenticated proof that this page is
        // active. Move the routine lease refresh forward instead of sending a
        // redundant Online report immediately after the lifecycle event.
        scheduleRefresh();
      }
      return;
    }

    currentState = newState;
    if (isActiveState(newState)) {
      resetIdleTimer();
    } else {
      clearIdleTimer();
    }
    if (currentMode === 'invisible') return;
    reportStatus(statusForCurrentMode(), currentMode !== 'auto', meaningfulActivity);
  }

  function syncLifecycleState(meaningfulActivity = false) {
    if (document.visibilityState === 'hidden') {
      transition('hidden');
      return;
    }
    if (!windowFocused) {
      transition('passive');
      return;
    }
    transition('active', meaningfulActivity);
  }

  function scheduleHiddenTransition() {
    clearHiddenTimer();
    hiddenTimer = setTimeout(() => {
      hiddenTimer = null;
      transition('hidden');
    }, HIDDEN_DELAY_MS);
  }

  function schedulePassiveTransition() {
    clearPassiveTimer();
    if (document.visibilityState === 'hidden' || windowFocused) return;
    passiveTimer = setTimeout(() => {
      passiveTimer = null;
      transition('passive');
    }, UNFOCUSED_DELAY_MS);
  }

  function applyMode(mode: PresenceMode, persist = false, syncedFromStorage = false) {
    const previousMode = currentMode;
    currentMode = mode;
    presencePreference.mode = mode;
    if (persist) storeMode(mode);

    if (mode === 'invisible') {
      clearRefreshTimer();
      desiredStatus = null;
      const revision = ++reportRevision;
      emitLocalStatus(PresenceStatus.Offline);
      sendPresenceReport(PresenceStatus.Offline, true, revision, {
        active: false,
        releaseInstallation: true
      });
      options.onPauseLiveEvents?.();
      return;
    }

    if (previousMode === 'invisible') {
      options.onResumeLiveEvents?.();
      syncLifecycleState(true);
    }

    if (mode === 'auto') {
      if (persist || syncedFromStorage) {
        // One explicit Online control report clears a user-selected
        // Away/DND while its active flag records the real page state.
        // Keeping this atomic avoids request reordering restoring an
        // obsolete manual override.
        const automaticStatus = statusForAutoState(currentState);
        const meaningfulActivity =
          isActiveState(currentState) &&
          (previousMode === 'invisible' || desiredStatus === null);
        const revision = ++reportRevision;
        desiredStatus = automaticStatus;
        if (meaningfulActivity) pendingMeaningfulActivity = false;
        emitLocalStatus(automaticStatus);
        sendPresenceReport(PresenceStatus.Online, true, revision, {
          active: isActiveState(currentState),
          meaningfulActivity
        });
        scheduleRefresh();
      } else {
        reportStatus(
          statusForAutoState(currentState),
          false,
          isActiveState(currentState) &&
            (previousMode === 'invisible' || desiredStatus === null)
        );
      }
    } else {
      reportStatus(
        modeToExplicitStatus(mode) ?? statusForAutoState(currentState),
        true,
        (persist || syncedFromStorage || desiredStatus === null) && isActiveState(currentState)
      );
    }

    if (isActiveState(currentState)) resetIdleTimer();
  }

  applyModeFromUI = (mode) => applyMode(mode, true);

  function onActivity(noisy = false) {
    if (document.visibilityState === 'hidden' || !windowFocused) return;

    if (!isActiveState(currentState)) {
      transition('active', true);
      return;
    }

    if (!noisy || Date.now() - lastTimerResetAt >= NOISY_ACTIVITY_THROTTLE_MS) {
      pendingMeaningfulActivity = true;
      resetIdleTimer();
    }
  }

  function onQuietActivity() {
    onActivity(false);
  }

  function onNoisyActivity() {
    onActivity(true);
  }

  const quietActivityEvents = ['pointerdown', 'keydown', 'touchstart'] as const;
  const noisyActivityEvents = ['pointermove', 'wheel', 'scroll'] as const;

  for (const event of quietActivityEvents) {
    document.addEventListener(event, onQuietActivity, { passive: true });
  }
  for (const event of noisyActivityEvents) {
    document.addEventListener(event, onNoisyActivity, { passive: true });
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      clearPassiveTimer();
      scheduleHiddenTransition();
      return;
    }
    clearHiddenTimer();
    if (windowFocused) {
      transition('active', true);
    } else if (currentState !== 'hidden') {
      schedulePassiveTransition();
    }
  }

  function onFocus() {
    windowFocused = true;
    clearPassiveTimer();
    if (document.visibilityState !== 'hidden') transition('active', true);
  }

  function onBlur() {
    windowFocused = false;
    schedulePassiveTransition();
  }

  function onFreeze() {
    clearHiddenTimer();
    clearPassiveTimer();
    transition('hidden');
  }

  function onResume() {
    syncLifecycleState(true);
  }

  function onPageHide() {
    transition('hidden');
  }

  function onPageShow() {
    syncLifecycleState(true);
  }

  function onStorage(event: StorageEvent) {
    if (event.key !== PRESENCE_MODE_STORAGE_KEY || event.newValue === null) return;
    if (
      event.newValue === 'auto' ||
      event.newValue === 'away' ||
      event.newValue === 'doNotDisturb' ||
      event.newValue === 'invisible'
    ) {
      applyMode(event.newValue, false, true);
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('freeze', onFreeze as EventListener);
  document.addEventListener('resume', onResume as EventListener);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('storage', onStorage);

  if (isActiveState(currentState)) resetIdleTimer();
  applyMode(currentMode);
  if (document.visibilityState !== 'hidden' && !windowFocused) {
    schedulePassiveTransition();
  }

  return () => {
    disposed = true;
    reportRevision++;
    reporterAPIs.clear();
    for (const event of quietActivityEvents) {
      document.removeEventListener(event, onQuietActivity);
    }
    for (const event of noisyActivityEvents) {
      document.removeEventListener(event, onNoisyActivity);
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('freeze', onFreeze as EventListener);
    document.removeEventListener('resume', onResume as EventListener);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('storage', onStorage);
    clearIdleTimer();
    clearHiddenTimer();
    clearPassiveTimer();
    clearRefreshTimer();
    if (applyModeFromUI) applyModeFromUI = null;
    initialized = false;
  };
}

export const __presenceTrackingTest = {
  PRESENCE_MODE_STORAGE_KEY,
  IDLE_TIMEOUT_MS,
  HIDDEN_DELAY_MS,
  UNFOCUSED_DELAY_MS,
  ACTIVE_PRESENCE_REFRESH_MS,
  INACTIVE_PRESENCE_REFRESH_MS,
  apiStatusToPresenceStatus
};
