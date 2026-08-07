import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenceStatus } from '@towk/api-types/api/v1/presence_pb';
import { __presenceAPITest, createPresenceAPI } from './presence';

const mocks = vi.hoisted(() => ({
  updatePresence: vi.fn()
}));

vi.mock('./connect.js', () => ({
  authHeaders: () => ({}),
  createTowkClient: () => ({ updatePresence: mocks.updatePresence }),
  handleAuthError: (_config: unknown, error: unknown) => {
    throw error;
  }
}));

vi.mock('$lib/notifications/pushClientId', () => ({
  currentPushClientId: () => 'install-a'
}));

describe('presence API session metadata', () => {
  beforeEach(() => {
    mocks.updatePresence.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds bounded installation and page-session metadata to lease reports', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value)
      }
    });

    const request = __presenceAPITest.presenceRequest(PresenceStatus.AWAY, false, {
      active: false,
      meaningfulActivity: true
    });

    expect(request.installationId).toMatch(/^[A-Za-z0-9_-]{1,96}$/);
    expect(request.sessionId).toBe(__presenceAPITest.presenceSessionId);
    expect(request.active).toBe(false);
    expect(request.meaningfulActivity).toBe(true);
    expect(request.releaseInstallation).toBeUndefined();
  });

  it('uses an installation-scoped release without creating a new page lease', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => 'install-a',
        setItem: () => {}
      }
    });

    const request = __presenceAPITest.presenceRequest(PresenceStatus.OFFLINE, true, {
      active: false,
      releaseInstallation: true
    });

    expect(request).toEqual({
      status: PresenceStatus.OFFLINE,
      userSelected: true,
      installationId: 'install-a',
      releaseInstallation: true
    });
  });

  it('serializes reports so lifecycle transitions cannot arrive out of order', async () => {
    let resolveFirst: ((value: { status: PresenceStatus }) => void) | undefined;
    mocks.updatePresence
      .mockImplementationOnce(
        () =>
          new Promise<{ status: PresenceStatus }>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ status: PresenceStatus.AWAY });

    const api = createPresenceAPI({
      serverId: 'origin',
      baseUrl: 'https://chat.example.test/api/connect',
      bearerToken: 'token'
    });

    const online = api.updatePresence(PresenceStatus.ONLINE, false, { active: true });
    const away = api.updatePresence(PresenceStatus.AWAY, false, { active: false });

    expect(mocks.updatePresence).toHaveBeenCalledTimes(1);
    resolveFirst?.({ status: PresenceStatus.ONLINE });
    await expect(online).resolves.toBe(PresenceStatus.ONLINE);
    await expect(away).resolves.toBe(PresenceStatus.AWAY);

    expect(mocks.updatePresence).toHaveBeenCalledTimes(2);
    expect(mocks.updatePresence.mock.calls.map(([request]) => request.status)).toEqual([
      PresenceStatus.ONLINE,
      PresenceStatus.AWAY
    ]);
  });
});
