import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredServer } from '$lib/state/server/registry.svelte';
import { SIGN_OUT_TIMEOUT_MS, signOutServer } from './signOut';

const mocks = vi.hoisted(() => ({
  releasePresence: vi.fn(() => Promise.resolve(0))
}));

vi.mock('$lib/api-client/presence', () => ({
  APIPresenceStatus: { OFFLINE: 4 },
  createPresenceAPI: () => ({ updatePresence: mocks.releasePresence })
}));

const remoteServer: RegisteredServer = {
  id: 'remote',
  url: 'https://remote.example.test',
  name: 'Remote',
  iconUrl: null,
  token: 'remote-token',
  userId: 'user-1',
  userLogin: 'alice',
  userDisplayName: 'Alice',
  userAvatarUrl: null,
  reauthRequiredAt: null,
  addedAt: 1
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mocks.releasePresence.mockReset();
  mocks.releasePresence.mockResolvedValue(0);
});

describe('signOutServer', () => {
  it('releases the installation before remote logout', async () => {
    const order: string[] = [];
    mocks.releasePresence.mockImplementation(async () => {
      order.push('presence');
      return 0;
    });
    const fetchMock = vi.fn(async () => {
      order.push('logout');
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await signOutServer(remoteServer, false);

    expect(order).toEqual(['presence', 'logout']);
    expect(mocks.releasePresence).toHaveBeenCalledWith(
      4,
      true,
      { active: false, releaseInstallation: true },
      expect.any(AbortSignal)
    );
  });

  it('continues logout when installation release fails', async () => {
    mocks.releasePresence.mockRejectedValueOnce(new Error('presence unavailable'));
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(signOutServer(remoteServer, false)).resolves.toMatchObject({ status: 204 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('aborts stale remote logout requests', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const logoutError = signOutServer(remoteServer, false).catch((error) => error);
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(SIGN_OUT_TIMEOUT_MS);

    await expect(logoutError).resolves.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://remote.example.test/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer remote-token' },
        signal: expect.any(AbortSignal)
      })
    );
  });
});
