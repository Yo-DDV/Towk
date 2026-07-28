import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusActiveMessageComposer, startCallWith, startDMWith } from './startDM';

const mocks = vi.hoisted(() => ({
  startDM: vi.fn(),
  goto: vi.fn()
}));

vi.mock('$lib/state/server/serverConnection.svelte', () => ({
  serverConnectionManager: {
    getClient: () => ({ connectBaseUrl: '/api/connect', bearerToken: 'token' })
  }
}));

vi.mock('$lib/api-client/rooms', () => ({
  createRoomCommandAPI: () => ({ startDM: mocks.startDM })
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/paths', () => ({
  resolve: (_route: string, params: { serverId: string; roomId: string }) =>
    `/chat/${params.serverId}/${params.roomId}`
}));
vi.mock('$lib/navigation', () => ({ serverIdToSegment: (serverId: string) => serverId }));
function mountRoomShell(child: HTMLElement): void {
  const region = document.createElement('div');
  region.dataset.testid = 'room-view-region';
  region.append(child);
  document.body.append(region);
}

beforeEach(() => {
  document.body.replaceChildren();
  mocks.startDM.mockReset();
  mocks.goto.mockReset();
  mocks.startDM.mockResolvedValue({ id: 'dm-room' });
  mocks.goto.mockResolvedValue(undefined);
});

afterEach(() => document.body.replaceChildren());

describe('profile direct actions', () => {
  it('opens the DM and focuses its active message composer', async () => {
    mocks.goto.mockImplementation(async () => {
      const composer = document.createElement('textarea');
      composer.dataset.testid = 'message-input';
      mountRoomShell(composer);
    });

    await startDMWith('server-1', 'user-2');

    expect(mocks.startDM).toHaveBeenCalledWith(['user-2']);
    expect(mocks.goto).toHaveBeenCalledWith('/chat/server-1/dm-room');
    expect(document.activeElement).toBe(document.querySelector('[data-testid="message-input"]'));
  });

  it('submits the resolved DM directly to the call controller', async () => {
    const request = vi.fn().mockResolvedValue({ status: 'joined' });

    await startCallWith('server-1', 'user-2', { request } as never);

    expect(mocks.startDM).toHaveBeenCalledWith(['user-2']);
    expect(request).toHaveBeenCalledWith({
      serverId: 'server-1',
      roomId: 'dm-room',
      source: 'direct-message'
    });
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('focuses an already mounted editable composer', async () => {
    const composer = document.createElement('div');
    composer.contentEditable = 'true';
    composer.tabIndex = 0;
    composer.dataset.testid = 'message-input';
    mountRoomShell(composer);

    await expect(focusActiveMessageComposer(20)).resolves.toBe(true);
    expect(document.activeElement).toBe(composer);
  });
});
