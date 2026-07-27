import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { render } from 'vitest-browser-svelte';
import type { RoomPurgeAPI, RoomPurgeAPIConfig } from '$lib/api-client/roomPurge';
import type { AdminRoomLayoutAPI } from '$lib/api-client/adminRoomLayout';
import type { RoomCommandAPI } from '$lib/api-client/rooms';
import {
  AdminRoomLayoutStore,
  type AdminRoomGroup,
  type AdminRoomInfo
} from '$lib/state/server/adminRoomLayout.svelte';
import type { RegisteredServer } from '$lib/state/server/registry.svelte';
import ArchivedRoomPurgePanel from './ArchivedRoomPurgePanel.svelte';

function room(id: string, name: string, archived = true): AdminRoomInfo {
  return { id, name, description: `${name} description`, archived, isUniversal: false };
}

function group(rooms: AdminRoomInfo[]): AdminRoomGroup {
  return {
    id: 'G00000000000000',
    name: 'Lobby',
    canCreateRoom: true,
    rooms,
    items: rooms.map((value) => ({ id: `room:${value.id}`, kind: 'room', room: value }))
  };
}

function makeLayout(rooms: AdminRoomInfo[]): AdminRoomLayoutStore {
  const layoutAPI = {
    listRoomGroups: vi.fn().mockResolvedValue([]),
    createRoomGroup: vi.fn(),
    updateRoomGroup: vi.fn(),
    deleteRoomGroup: vi.fn(),
    reorderRoomGroups: vi.fn(),
    moveRoomToGroup: vi.fn(),
    reorderSidebarItemsInGroup: vi.fn(),
    createSidebarLink: vi.fn(),
    updateSidebarLink: vi.fn(),
    deleteSidebarLink: vi.fn(),
    moveSidebarLinkToGroup: vi.fn()
  } satisfies AdminRoomLayoutAPI;
  const roomAPI = {
    updateRoom: vi.fn(),
    archiveRoom: vi.fn(),
    unarchiveRoom: vi.fn()
  } satisfies Pick<RoomCommandAPI, 'updateRoom' | 'archiveRoom' | 'unarchiveRoom'>;
  const layout = new AdminRoomLayoutStore(layoutAPI, roomAPI);
  layout.initialized = true;
  layout.groups = [group(rooms)];
  return layout;
}

function server(): RegisteredServer {
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
    addedAt: 1
  };
}

function api(options: {
  allowed?: boolean;
  purge?: RoomPurgeAPI['purge'];
} = {}): RoomPurgeAPI {
  return {
    capability: vi.fn().mockResolvedValue({
      canPurgeArchivedRooms: options.allowed ?? true
    }),
    purge:
      options.purge ??
      vi.fn().mockResolvedValue({
        alreadyPurged: false,
        roomEventsDeleted: 4,
        rbacEventsDeleted: 1,
        assetEventsDeleted: 2,
        attachmentsDeleted: 1,
        linkPreviewAssetsDeleted: 0
      })
  };
}

function buttonByText(container: Element, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`);
  return button;
}

function fill(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('ArchivedRoomPurgePanel', () => {
  it('does not render destructive actions without server-confirmed owner capability', async () => {
    const deniedAPI = api({ allowed: false });
    const apiFactory = vi.fn((_config: RoomPurgeAPIConfig) => deniedAPI);
    const { container } = render(ArchivedRoomPurgePanel, {
      props: {
        layout: makeLayout([room('R00000000000000', 'archived')]),
        server: server(),
        apiFactory
      }
    });

    await vi.waitFor(() => expect(deniedAPI.capability).toHaveBeenCalledOnce());
    expect(container.querySelector('[data-testid="archived-room-purge-panel"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="archived"]')).toBeNull();
  });

  it('lists archived rooms only and requires an exact confirmation', async () => {
    const ownerAPI = api();
    const { container } = render(ArchivedRoomPurgePanel, {
      props: {
        layout: makeLayout([
          room('R00000000000000', 'retired-room'),
          room('R00000000000001', 'active-room', false)
        ]),
        server: server(),
        apiFactory: () => ownerAPI
      }
    });

    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="archived-room-purge-panel"]')).not.toBeNull()
    );
    expect(container.textContent).toContain('#retired-room');
    expect(container.textContent).not.toContain('#active-room');

    const action = container.querySelector('button[aria-label="Permanently delete #retired-room"]');
    if (!(action instanceof HTMLButtonElement)) throw new Error('purge action not found');
    action.click();
    flushSync();
    expect(action.getAttribute('aria-pressed')).toBe('true');

    const input = container.querySelector('#room-purge-confirmation');
    if (!(input instanceof HTMLInputElement)) throw new Error('confirmation input not found');
    const submit = buttonByText(container, 'Delete room permanently');
    expect(submit.disabled).toBe(true);
    fill(input, 'RETIRED-ROOM');
    expect(submit.disabled).toBe(true);
    expect(container.textContent).toContain('must exactly match');
    fill(input, 'retired-room');
    expect(submit.disabled).toBe(false);
  });

  it('purges the server and exact encrypted offline room before reporting success', async () => {
    const ownerAPI = api();
    const purgeLocalRoom = vi.fn().mockResolvedValue(undefined);
    const onroompurged = vi.fn().mockResolvedValue(undefined);
    const target = room('R00000000000000', 'retired-room');
    const { container } = render(ArchivedRoomPurgePanel, {
      props: {
        layout: makeLayout([target]),
        server: server(),
        apiFactory: () => ownerAPI,
        purgeLocalRoom,
        onroompurged
      }
    });

    await vi.waitFor(() => expect(ownerAPI.capability).toHaveBeenCalledOnce());
    const action = container.querySelector('button[aria-label="Permanently delete #retired-room"]');
    if (!(action instanceof HTMLButtonElement)) throw new Error('purge action not found');
    action.click();
    flushSync();
    const input = container.querySelector('#room-purge-confirmation');
    if (!(input instanceof HTMLInputElement)) throw new Error('confirmation input not found');
    fill(input, target.name);
    buttonByText(container, 'Delete room permanently').click();

    await vi.waitFor(() => expect(ownerAPI.purge).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(purgeLocalRoom).toHaveBeenCalledOnce());
    expect(ownerAPI.purge).toHaveBeenCalledWith(target.id, target.name);
    expect(purgeLocalRoom).toHaveBeenCalledWith(expect.objectContaining({ id: 'towk-example' }), target.id);
    await vi.waitFor(() => expect(onroompurged).toHaveBeenCalledWith(target.id));
  });

  it('retries only local cleanup after the irreversible server step succeeded', async () => {
    const purge = vi.fn().mockResolvedValue({
      alreadyPurged: false,
      roomEventsDeleted: 1,
      rbacEventsDeleted: 0,
      assetEventsDeleted: 0,
      attachmentsDeleted: 0,
      linkPreviewAssetsDeleted: 0
    });
    const ownerAPI = api({ purge });
    const purgeLocalRoom = vi
      .fn()
      .mockRejectedValueOnce(new Error('indexeddb unavailable'))
      .mockResolvedValueOnce(undefined);
    const target = room('R00000000000000', 'retired-room');
    const { container } = render(ArchivedRoomPurgePanel, {
      props: {
        layout: makeLayout([target]),
        server: server(),
        apiFactory: () => ownerAPI,
        purgeLocalRoom
      }
    });

    await vi.waitFor(() => expect(ownerAPI.capability).toHaveBeenCalledOnce());
    const action = container.querySelector('button[aria-label="Permanently delete #retired-room"]');
    if (!(action instanceof HTMLButtonElement)) throw new Error('purge action not found');
    action.click();
    flushSync();
    const input = container.querySelector('#room-purge-confirmation');
    if (!(input instanceof HTMLInputElement)) throw new Error('confirmation input not found');
    fill(input, target.name);
    buttonByText(container, 'Delete room permanently').click();

    await vi.waitFor(() => expect(container.textContent).toContain('Retry local cleanup'));
    expect(purge).toHaveBeenCalledOnce();
    expect(purgeLocalRoom).toHaveBeenCalledOnce();
    buttonByText(container, 'Retry local cleanup').click();

    await vi.waitFor(() => expect(purgeLocalRoom).toHaveBeenCalledTimes(2));
    expect(purge).toHaveBeenCalledOnce();
  });
});
