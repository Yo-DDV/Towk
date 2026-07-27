import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDetailedUserProfileCache, scheduleCustomStatusExpiry } from './userProfiles.svelte';
import type { DetailedUserProfile } from '$lib/api-client/memberDirectory';

describe('custom status expiry scheduling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fires when a custom status expires', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-06-24T12:00:00.000Z').getTime();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
    const onExpire = vi.fn();

    const cleanup = scheduleCustomStatusExpiry(
      {
        emoji: '🍜',
        text: 'Lunch',
        expiresAt: '2026-06-24T12:01:00.000Z'
      },
      onExpire
    );

    await vi.advanceTimersByTimeAsync(59_999);
    expect(onExpire).not.toHaveBeenCalled();

    dateNow.mockReturnValue(now + 60_000);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(onExpire).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('cancels a scheduled custom status expiry', async () => {
    vi.useFakeTimers();
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-24T12:00:00.000Z').getTime());
    const onExpire = vi.fn();

    const cleanup = scheduleCustomStatusExpiry(
      {
        emoji: '🍜',
        text: 'Lunch',
        expiresAt: '2026-06-24T12:01:00.000Z'
      },
      onExpire
    );

    cleanup();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onExpire).not.toHaveBeenCalled();
  });
});

const detailedProfile = (displayName: string): DetailedUserProfile => ({
  user: {
    id: 'U1',
    login: 'alice',
    displayName,
    deleted: false,
    avatarUrl: null,
    presenceStatus: 'ONLINE' as DetailedUserProfile['user']['presenceStatus'],
    customStatus: null
  },
  roles: [],
  joinedAt: null,
  biographyMarkdown: '',
  lastActivity: null,
  lastActivityVisible: true,
  viewerIsSelf: false,
  viewerCanMessage: true,
  viewerCanCall: false
});

describe('detailed user profile cache', () => {
  it('deduplicates concurrent requests and reuses the cached result', async () => {
    const cache = createDetailedUserProfileCache();
    const loader = vi.fn(async () => detailedProfile('Alice'));

    const [first, second] = await Promise.all([
      cache.load('server-1', 'U1', loader),
      cache.load('server-1', 'U1', loader)
    ]);

    expect(first?.user.displayName).toBe('Alice');
    expect(second).toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);

    await expect(cache.load('server-1', 'U1', loader)).resolves.toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('invalidates only the selected server-scoped entry', async () => {
    const cache = createDetailedUserProfileCache();
    const firstLoader = vi.fn(async () => detailedProfile('First'));
    const secondLoader = vi.fn(async () => detailedProfile('Second'));

    await cache.load('server-1', 'U1', firstLoader);
    await cache.load('server-2', 'U1', secondLoader);
    cache.invalidate('server-1', 'U1');

    await cache.load('server-1', 'U1', firstLoader);
    await cache.load('server-2', 'U1', secondLoader);

    expect(firstLoader).toHaveBeenCalledTimes(2);
    expect(secondLoader).toHaveBeenCalledTimes(1);
    expect(cache.revision('server-1', 'U1')).toBe(1);
    expect(cache.revision('server-2', 'U1')).toBe(0);
  });

  it('does not repopulate the cache from a response invalidated in flight', async () => {
    const cache = createDetailedUserProfileCache();
    let resolveFirst!: (profile: DetailedUserProfile) => void;
    const firstRequest = new Promise<DetailedUserProfile>((resolve) => {
      resolveFirst = resolve;
    });
    const loader = vi
      .fn<() => Promise<DetailedUserProfile | null>>()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValueOnce(detailedProfile('Fresh'));

    const pending = cache.load('server-1', 'U1', loader);
    cache.invalidate('server-1', 'U1');
    resolveFirst(detailedProfile('Stale'));

    await expect(pending).resolves.toMatchObject({ user: { displayName: 'Fresh' } });
    await expect(cache.load('server-1', 'U1', loader)).resolves.toMatchObject({
      user: { displayName: 'Fresh' }
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('caches a not-found result until invalidated', async () => {
    const cache = createDetailedUserProfileCache();
    const loader = vi.fn(async () => null);

    await expect(cache.load('server-1', 'missing', loader)).resolves.toBeNull();
    await expect(cache.load('server-1', 'missing', loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);

    cache.invalidate('server-1', 'missing');
    await expect(cache.load('server-1', 'missing', loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('clears all detailed entries for one server', async () => {
    const cache = createDetailedUserProfileCache();
    const loader = vi.fn(async () => detailedProfile('Alice'));

    await cache.load('server-1', 'U1', loader);
    await cache.load('server-2', 'U1', loader);
    cache.clearServer('server-1');

    await cache.load('server-1', 'U1', loader);
    await cache.load('server-2', 'U1', loader);
    expect(loader).toHaveBeenCalledTimes(3);
  });
});
