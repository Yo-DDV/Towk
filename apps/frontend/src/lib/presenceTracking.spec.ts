import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  APIPresenceStatus,
  type PresenceReportOptions
} from '$lib/api-client/presence';
import { PresenceStatus } from '$lib/render/types';
import { __presenceTrackingTest, initPresenceTracking, setPresenceMode } from './presenceTracking';

type UpdatePresence = (
  status: APIPresenceStatus,
  userSelected?: boolean,
  options?: PresenceReportOptions
) => Promise<APIPresenceStatus>;
type PresenceStatusHandler = (status: PresenceStatus) => void;

const mocks = vi.hoisted(() => ({
  updatePresence: vi.fn()
}));

vi.mock('$lib/api-client/presence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api-client/presence')>();
  return {
    ...actual,
    createPresenceAPI: () => ({
      updatePresence: mocks.updatePresence
    })
  };
});

let documentTarget: EventTarget;
let windowTarget: EventTarget;
let visibilityState: DocumentVisibilityState;
let focused: boolean;
let cleanup: (() => void) | null;
let onStatusChange: Mock<PresenceStatusHandler>;
let onPauseLiveEvents: Mock<() => void>;
let onResumeLiveEvents: Mock<() => void>;

function dispatchDocumentEvent(type: string) {
  documentTarget.dispatchEvent(new Event(type));
}

function dispatchWindowEvent(type: string) {
  windowTarget.dispatchEvent(new Event(type));
}

function dispatchStorageMode(mode: string) {
  const event = new Event('storage') as StorageEvent;
  Object.defineProperties(event, {
    key: { value: __presenceTrackingTest.PRESENCE_MODE_STORAGE_KEY },
    newValue: { value: mode }
  });
  windowTarget.dispatchEvent(event);
}

function setVisibility(next: DocumentVisibilityState) {
  visibilityState = next;
  dispatchDocumentEvent('visibilitychange');
}

function blurWindow() {
  focused = false;
  dispatchWindowEvent('blur');
}

function focusWindow() {
  focused = true;
  dispatchWindowEvent('focus');
}

function startTracking() {
  onStatusChange = vi.fn<PresenceStatusHandler>();
  onPauseLiveEvents = vi.fn();
  onResumeLiveEvents = vi.fn();
  cleanup = initPresenceTracking(
    () => [
      {
        serverId: 'origin',
        baseUrl: 'https://chat.example.test/api/connect',
        bearerToken: 't'
      }
    ],
    onStatusChange,
    { onPauseLiveEvents, onResumeLiveEvents }
  );
}

function sentStatuses(): APIPresenceStatus[] {
  return mocks.updatePresence.mock.calls.map((call) => call[0]);
}

function sentUserSelectedFlags(): Array<boolean | undefined> {
  return mocks.updatePresence.mock.calls.map((call) => call[1]);
}

function sentOptions(): Array<PresenceReportOptions | undefined> {
  return mocks.updatePresence.mock.calls.map((call) => call[2]);
}

describe('initPresenceTracking', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    mocks.updatePresence = vi.fn<UpdatePresence>((status) => Promise.resolve(status));
    documentTarget = new EventTarget();
    windowTarget = new EventTarget();
    visibilityState = 'visible';
    focused = true;
    cleanup = null;

    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      })
    });
    vi.stubGlobal('document', {
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener: documentTarget.removeEventListener.bind(documentTarget),
      dispatchEvent: documentTarget.dispatchEvent.bind(documentTarget),
      hasFocus: () => focused,
      get visibilityState() {
        return visibilityState;
      }
    });
    vi.stubGlobal('window', {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
      dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget)
    });
  });

  afterEach(() => {
    cleanup?.();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reports an active session immediately and uses the 10-minute idle boundary', () => {
    startTracking();

    expect(sentStatuses()).toEqual([APIPresenceStatus.ONLINE]);
    expect(sentOptions()).toEqual([{ active: true, meaningfulActivity: true }]);

    vi.advanceTimersByTime(__presenceTrackingTest.IDLE_TIMEOUT_MS - 1);
    expect(sentStatuses()).not.toContain(APIPresenceStatus.AWAY);

    vi.advanceTimersByTime(1);
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.AWAY);
    expect(sentOptions().at(-1)).toEqual({ active: false, meaningfulActivity: false });
    expect(onStatusChange).toHaveBeenLastCalledWith(PresenceStatus.Away);
  });

  it('keeps Online through the hidden grace, then reports Away and returns immediately', () => {
    startTracking();

    setVisibility('hidden');
    vi.advanceTimersByTime(__presenceTrackingTest.HIDDEN_DELAY_MS - 1);
    expect(sentStatuses()).toEqual([APIPresenceStatus.ONLINE]);

    vi.advanceTimersByTime(1);
    expect(sentStatuses()).toEqual([APIPresenceStatus.ONLINE, APIPresenceStatus.AWAY]);
    expect(sentOptions().at(-1)?.active).toBe(false);

    setVisibility('visible');
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.ONLINE);
    expect(sentOptions().at(-1)).toEqual({ active: true, meaningfulActivity: true });
  });

  it('applies the 30-second passive grace when a visible page starts unfocused', () => {
    focused = false;
    startTracking();

    expect(sentStatuses()).toEqual([APIPresenceStatus.ONLINE]);
    vi.advanceTimersByTime(__presenceTrackingTest.UNFOCUSED_DELAY_MS - 1);
    expect(sentStatuses()).toEqual([APIPresenceStatus.ONLINE]);

    vi.advanceTimersByTime(1);
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.AWAY);
    expect(sentOptions().at(-1)?.active).toBe(false);
  });

  it('uses a separate 30-second grace for a visible but unfocused window', () => {
    startTracking();

    blurWindow();
    vi.advanceTimersByTime(__presenceTrackingTest.UNFOCUSED_DELAY_MS - 1);
    expect(sentStatuses()).toEqual([APIPresenceStatus.ONLINE]);

    vi.advanceTimersByTime(1);
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.AWAY);
    expect(sentOptions().at(-1)?.active).toBe(false);

    focusWindow();
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.ONLINE);
    expect(sentOptions().at(-1)?.active).toBe(true);
  });

  it('cancels the passive transition when focus returns during the grace', () => {
    startTracking();

    blurWindow();
    vi.advanceTimersByTime(__presenceTrackingTest.UNFOCUSED_DELAY_MS - 1);
    focusWindow();
    vi.advanceTimersByTime(1);

    expect(sentStatuses()).toEqual([APIPresenceStatus.ONLINE]);

    // Focus occurs 1ms before the passive grace expires; leave 1ms before
    // the refresh deadline after crossing that boundary.
    vi.advanceTimersByTime(__presenceTrackingTest.ACTIVE_PRESENCE_REFRESH_MS - 2);
    expect(sentStatuses()).toEqual([APIPresenceStatus.ONLINE]);

    vi.advanceTimersByTime(1);
    expect(sentStatuses()).toEqual([
      APIPresenceStatus.ONLINE,
      APIPresenceStatus.ONLINE
    ]);
  });

  it('returns Online on meaningful activity after idle', () => {
    startTracking();

    vi.advanceTimersByTime(__presenceTrackingTest.IDLE_TIMEOUT_MS);
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.AWAY);

    dispatchDocumentEvent('pointerdown');

    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.ONLINE);
    expect(sentOptions().at(-1)).toEqual({ active: true, meaningfulActivity: true });
  });

  it('keeps the desired automatic status when another device makes the aggregate DND', async () => {
    mocks.updatePresence.mockImplementation((status, userSelected) =>
      Promise.resolve(
        status === APIPresenceStatus.ONLINE && !userSelected
          ? APIPresenceStatus.DO_NOT_DISTURB
          : status
      )
    );

    startTracking();
    await Promise.resolve();

    expect(onStatusChange).toHaveBeenLastCalledWith(PresenceStatus.DoNotDisturb);

    vi.advanceTimersByTime(__presenceTrackingTest.ACTIVE_PRESENCE_REFRESH_MS);

    expect(sentStatuses()).toEqual([
      APIPresenceStatus.ONLINE,
      APIPresenceStatus.ONLINE
    ]);
    expect(sentOptions().at(-1)).toEqual({ active: true, meaningfulActivity: false });
  });

  it('reduces inactive refreshes to one every five minutes', () => {
    startTracking();
    setVisibility('hidden');
    vi.advanceTimersByTime(__presenceTrackingTest.HIDDEN_DELAY_MS);

    const callsAfterAway = mocks.updatePresence.mock.calls.length;
    vi.advanceTimersByTime(__presenceTrackingTest.INACTIVE_PRESENCE_REFRESH_MS - 1);
    expect(mocks.updatePresence).toHaveBeenCalledTimes(callsAfterAway);

    vi.advanceTimersByTime(1);
    expect(mocks.updatePresence).toHaveBeenCalledTimes(callsAfterAway + 1);
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.AWAY);
    expect(sentOptions().at(-1)?.active).toBe(false);
  });

  it('preserves manual DND while still reporting the real session activity', () => {
    startTracking();
    setPresenceMode('doNotDisturb');

    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.DO_NOT_DISTURB);
    expect(sentUserSelectedFlags().at(-1)).toBe(true);
    expect(sentOptions().at(-1)?.active).toBe(true);

    setVisibility('hidden');
    vi.advanceTimersByTime(__presenceTrackingTest.HIDDEN_DELAY_MS);

    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.DO_NOT_DISTURB);
    expect(sentUserSelectedFlags().at(-1)).toBe(true);
    expect(sentOptions().at(-1)?.active).toBe(false);
  });

  it('releases the installation when Look offline is selected', () => {
    startTracking();
    setPresenceMode('invisible');

    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.OFFLINE);
    expect(sentUserSelectedFlags().at(-1)).toBe(true);
    expect(sentOptions().at(-1)).toEqual({
      active: false,
      releaseInstallation: true
    });
    expect(onStatusChange).toHaveBeenLastCalledWith(PresenceStatus.Offline);
    expect(onPauseLiveEvents).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(sentStatuses().filter((status) => status === APIPresenceStatus.OFFLINE)).toHaveLength(1);
  });

  it('clears a manual mode with one atomic automatic-mode report', () => {
    startTracking();
    setPresenceMode('away');
    const callsBeforeAuto = mocks.updatePresence.mock.calls.length;

    setPresenceMode('auto');

    expect(mocks.updatePresence).toHaveBeenCalledTimes(callsBeforeAuto + 1);
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.ONLINE);
    expect(sentUserSelectedFlags().at(-1)).toBe(true);
    expect(sentOptions().at(-1)).toEqual({
      active: true,
      meaningfulActivity: false
    });
    expect(onResumeLiveEvents).not.toHaveBeenCalled();
  });

  it('synchronizes Look offline and automatic mode across tabs', () => {
    startTracking();

    dispatchStorageMode('invisible');
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.OFFLINE);
    expect(onPauseLiveEvents).toHaveBeenCalledOnce();

    const callsBeforeAuto = mocks.updatePresence.mock.calls.length;
    dispatchStorageMode('auto');
    expect(mocks.updatePresence).toHaveBeenCalledTimes(callsBeforeAuto + 1);
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.ONLINE);
    expect(sentUserSelectedFlags().at(-1)).toBe(true);
    expect(onResumeLiveEvents).toHaveBeenCalledOnce();
  });

  it('reports Away immediately before a page freeze or pagehide', () => {
    startTracking();
    dispatchDocumentEvent('freeze');

    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.AWAY);
    expect(sentOptions().at(-1)?.active).toBe(false);

    focusWindow();
    dispatchWindowEvent('pageshow');
    expect(sentStatuses().at(-1)).toBe(APIPresenceStatus.ONLINE);
  });

  it('removes lifecycle listeners and timers during cleanup', () => {
    startTracking();
    const callsBeforeCleanup = mocks.updatePresence.mock.calls.length;

    cleanup?.();
    cleanup = null;
    setVisibility('hidden');
    blurWindow();
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(mocks.updatePresence).toHaveBeenCalledTimes(callsBeforeCleanup);
  });
});
