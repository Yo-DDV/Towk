import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import { q } from '$lib/test-utils';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    onroomcreated: vi.fn()
  }
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    serverId: 'origin',
    connectBaseUrl: 'https://chat.example.test/api/connect',
    bearerToken: 'token'
  })
}));

vi.mock('$lib/api-client/rooms', () => ({
  createRoomCommandAPI: () => ({
    createRoom: mocks.createRoom,
    joinRoom: mocks.joinRoom
  })
}));

async function fillNameAndSubmit(container: HTMLElement, name = 'general'): Promise<void> {
  const input = q(container, '#room-name') as HTMLInputElement;
  input.value = name;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  (q(container, 'button[type="submit"]') as HTMLButtonElement).click();
}

import CreateRoom from './CreateRoom.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createRoom.mockResolvedValue({ id: 'room-1', name: 'general', description: '' });
  mocks.joinRoom.mockResolvedValue({ id: 'room-1', name: 'general', description: '' });
});

describe('CreateRoom', () => {
  it('creates a normal room through ConnectRPC and joins it', async () => {
    const { container } = render(CreateRoom, {
      groupId: 'group-1',
      onroomcreated: mocks.onroomcreated
    });

    await fillNameAndSubmit(container);

    await vi.waitFor(() => {
      expect(mocks.onroomcreated).toHaveBeenCalledWith('room-1');
    });
    expect(mocks.createRoom).toHaveBeenCalledWith({
      name: 'general',
      description: null,
      groupId: 'group-1',
      universal: false
    });
    expect(mocks.joinRoom).toHaveBeenCalledWith('room-1');
  });

  it('passes the universal flag to ConnectRPC', async () => {
    const { container } = render(CreateRoom, {
      groupId: 'group-1',
      onroomcreated: mocks.onroomcreated
    });

    (q(container, '#room-universal') as HTMLInputElement).click();
    await fillNameAndSubmit(container);

    await vi.waitFor(() => {
      expect(mocks.onroomcreated).toHaveBeenCalledWith('room-1');
    });
    expect(mocks.createRoom).toHaveBeenCalledWith({
      name: 'general',
      description: null,
      groupId: 'group-1',
      universal: true
    });
  });

  it('accepts emoji and submits a normalized multi-word room name', async () => {
    const { container } = render(CreateRoom, {
      groupId: 'group-1',
      onroomcreated: mocks.onroomcreated
    });

    await fillNameAndSubmit(container, '  📣   Cafe\u0301 Updates  ');

    await vi.waitFor(() => {
      expect(mocks.createRoom).toHaveBeenCalledWith({
        name: '📣 Café Updates',
        description: null,
        groupId: 'group-1',
        universal: false
      });
    });
  });
});
