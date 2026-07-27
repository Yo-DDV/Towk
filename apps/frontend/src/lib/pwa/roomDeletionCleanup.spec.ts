import { describe, expect, it, vi } from 'vitest';
import type { RegisteredServer } from '$lib/state/server/registry.svelte';
import { purgeDeletedRoomForServer } from './roomDeletionCleanup';

function server(overrides: Partial<RegisteredServer> = {}): RegisteredServer {
  return {
    id: 'towk-example',
    url: 'https://towk.example',
    name: 'Towk',
    iconUrl: null,
    token: null,
    userId: 'U00000000000000',
    userLogin: 'owner',
    userDisplayName: 'Owner',
    userAvatarUrl: null,
    reauthRequiredAt: null,
    addedAt: 1,
    ...overrides
  };
}

describe('purgeDeletedRoomForServer', () => {
  it('purges the exact room inside the authenticated server account scope', async () => {
    const purge = vi.fn().mockResolvedValue(undefined);
    await purgeDeletedRoomForServer(server(), 'R00000000000000', purge);

    expect(purge).toHaveBeenCalledOnce();
    expect(purge).toHaveBeenCalledWith(
      {
        serverId: 'towk-example',
        serverUrl: 'https://towk.example',
        userId: 'U00000000000000'
      },
      'R00000000000000'
    );
  });

  it('does nothing without an authenticated account or room identifier', async () => {
    const purge = vi.fn().mockResolvedValue(undefined);
    await purgeDeletedRoomForServer(server({ userId: null }), 'R00000000000000', purge);
    await purgeDeletedRoomForServer(server(), '', purge);

    expect(purge).not.toHaveBeenCalled();
  });
});
