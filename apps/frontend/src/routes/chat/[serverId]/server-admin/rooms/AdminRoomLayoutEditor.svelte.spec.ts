import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { flushSync } from 'svelte';
import { render } from 'vitest-browser-svelte';
import '../../../../../app.css';
import type { AdminRoomLayoutAPI } from '$lib/api-client/adminRoomLayout';
import type { RoomPurgeAPI, RoomPurgeAPIConfig } from '$lib/api-client/roomPurge';
import type { RoomCommandAPI } from '$lib/api-client/rooms';
import {
  AdminRoomLayoutStore,
  type AdminRoomGroup,
  type AdminRoomInfo
} from '$lib/state/server/adminRoomLayout.svelte';
import type { RegisteredServer } from '$lib/state/server/registry.svelte';
import { q } from '$lib/test-utils';
import AdminRoomLayoutEditor from './AdminRoomLayoutEditor.svelte';

vi.mock('$app/navigation', () => ({
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
  disableScrollHandling: vi.fn(),
  goto: vi.fn(),
  invalidate: vi.fn(),
  invalidateAll: vi.fn(),
  onNavigate: vi.fn(),
  preloadCode: vi.fn(),
  preloadData: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn()
}));

vi.mock('$app/paths', () => ({
  assets: '',
  base: '',
  resolve: (path: string, params?: Record<string, string>) =>
    path
      .replace('[serverId]', params?.serverId ?? '')
      .replace('[groupId]', params?.groupId ?? '')
      .replace('[roomId]', params?.roomId ?? '')
}));

vi.mock('svelte-dnd-action', () => ({
  dndzone: () => ({
    update: vi.fn(),
    destroy: vi.fn()
  })
}));

function room(id: string, overrides: Partial<AdminRoomInfo> = {}): AdminRoomInfo {
  return {
    id,
    name: overrides.name ?? id,
    description: overrides.description ?? null,
    archived: overrides.archived ?? false,
    isUniversal: overrides.isUniversal ?? false
  };
}

function group(id: string, rooms: AdminRoomInfo[], name = id): AdminRoomGroup {
  return {
    id,
    name,
    canCreateRoom: true,
    rooms,
    items: rooms.map((room) => ({ id: `room:${room.id}`, kind: 'room', room }))
  };
}

function roomAPI(): Pick<RoomCommandAPI, 'updateRoom' | 'archiveRoom' | 'unarchiveRoom'> {
  return {
    updateRoom: vi.fn().mockResolvedValue(null),
    archiveRoom: vi.fn().mockResolvedValue(null),
    unarchiveRoom: vi.fn().mockResolvedValue(null)
  };
}

function makeLayout(): AdminRoomLayoutStore {
  const layoutAPI = {
    listRoomGroups: vi.fn().mockResolvedValue([]),
    createRoomGroup: vi.fn().mockResolvedValue(null),
    updateRoomGroup: vi.fn().mockResolvedValue(null),
    deleteRoomGroup: vi.fn().mockResolvedValue(true),
    reorderRoomGroups: vi.fn().mockResolvedValue([]),
    moveRoomToGroup: vi.fn().mockResolvedValue(undefined),
    reorderSidebarItemsInGroup: vi.fn().mockResolvedValue(null),
    createSidebarLink: vi.fn().mockResolvedValue(null),
    updateSidebarLink: vi.fn().mockResolvedValue(null),
    deleteSidebarLink: vi.fn().mockResolvedValue(true),
    moveSidebarLinkToGroup: vi.fn().mockResolvedValue(undefined)
  } satisfies AdminRoomLayoutAPI;
  return new AdminRoomLayoutStore(layoutAPI, roomAPI());
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

function purgeAPI(
  options: {
    allowed?: boolean;
    capability?: RoomPurgeAPI['capability'];
    purge?: RoomPurgeAPI['purge'];
  } = {}
): RoomPurgeAPI {
  return {
    capability:
      options.capability ??
      vi.fn().mockResolvedValue({
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

type RenderEditorOptions = {
  server?: RegisteredServer | null;
  roomPurgeApiFactory?: (config: RoomPurgeAPIConfig) => RoomPurgeAPI;
  purgeLocalRoom?: (server: RegisteredServer | null | undefined, roomId: string) => Promise<void>;
  onroompurged?: (roomId: string) => void | Promise<void>;
};

function renderEditor(layout: AdminRoomLayoutStore, options: RenderEditorOptions = {}) {
  return render(AdminRoomLayoutEditor, {
    props: { layout, serverSegment: '-', ...options }
  });
}

function buttonByText(container: Element, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`button not found: ${text}`);
  }
  return button;
}

function buttonByTitle(container: Element, title: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.title === title
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`button not found: ${title}`);
  }
  return button;
}

function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('AdminRoomLayoutEditor', () => {
  it('renders loading, error, empty, and populated states from the layout store', async () => {
    const loading = makeLayout();
    loading.isRefreshing = true;
    const loadingRender = renderEditor(loading);
    await expect.element(q(loadingRender.container, 'div')).toHaveTextContent('Loading rooms...');

    const error = makeLayout();
    error.error = 'Server not found';
    const errorRender = renderEditor(error);
    expect(errorRender.container.textContent).toContain('Server not found');

    const empty = makeLayout();
    empty.initialized = true;
    const emptyRender = renderEditor(empty);
    expect(emptyRender.container.textContent).toContain('No room groups yet');

    const populated = makeLayout();
    populated.initialized = true;
    populated.groups = [
      group('g1', [room('r1', { name: 'general', description: 'Public room' })], 'Lobby')
    ];
    const populatedRender = renderEditor(populated);
    expect(populatedRender.container.textContent).toContain('Lobby');
    expect(populatedRender.container.textContent).toContain('general');
    expect(populatedRender.container.textContent).toContain('Public room');
  });

  it('opens the create-group dialog and delegates submission to the layout store', async () => {
    const layout = makeLayout();
    layout.initialized = true;
    layout.groups = [group('g1', [], 'Lobby')];
    const createGroup = vi.spyOn(layout, 'createGroup').mockResolvedValue({
      ok: true,
      group: group('g2', [], 'Projects')
    });
    const { container } = renderEditor(layout);

    buttonByText(container, 'New Group').click();
    flushSync();
    fill(q(container, '#new-group-name') as HTMLInputElement, 'Projects');
    buttonByText(container, 'Create Group').click();

    await vi.waitFor(() => {
      expect(createGroup).toHaveBeenCalledWith('Projects');
    });
  });

  it('keeps Save disabled and shows validation when a room name has leading whitespace', async () => {
    const layout = makeLayout();
    layout.initialized = true;
    layout.groups = [group('g1', [room('r1', { name: 'general' })], 'Lobby')];
    const updateRoom = vi.spyOn(layout, 'updateRoom').mockResolvedValue({ ok: true });
    const { container } = renderEditor(layout);

    const edit = container.querySelector('[title="Edit room"]');
    if (!(edit instanceof HTMLButtonElement)) throw new Error('edit button not found');
    edit.click();
    flushSync();

    const input = q(container, '#edit-room-name') as HTMLInputElement;
    fill(input, ' bad-name');

    expect(container.textContent).toContain('Room name cannot have leading or trailing whitespace');
    const save = buttonByText(container, 'Save Changes');
    expect(save.disabled).toBe(true);
    save.click();
    await Promise.resolve();
    expect(updateRoom).not.toHaveBeenCalled();
  });

  it('edits the Universal flag from the room edit modal, not a row action', async () => {
    const layout = makeLayout();
    layout.initialized = true;
    layout.groups = [group('g1', [room('r1', { name: 'general' })], 'Lobby')];
    const updateRoom = vi.spyOn(layout, 'updateRoom').mockResolvedValue({ ok: true });
    const updateRoomUniversal = vi
      .spyOn(layout, 'updateRoomUniversal')
      .mockResolvedValue({ ok: true });
    const { container } = renderEditor(layout);

    expect(container.querySelector('[title="Make universal room"]')).toBeNull();

    const edit = container.querySelector('[title="Edit room"]');
    if (!(edit instanceof HTMLButtonElement)) throw new Error('edit button not found');
    edit.click();
    flushSync();

    const checkbox = q(container, '#edit-room-universal') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    checkbox.click();
    flushSync();

    const save = buttonByText(container, 'Save Changes');
    expect(save.disabled).toBe(false);
    save.click();

    await vi.waitFor(() => {
      expect(updateRoomUniversal).toHaveBeenCalledWith('r1', true);
    });
    expect(updateRoom).not.toHaveBeenCalled();
  });

  it('keeps a neutral permanent-delete action in every active room row', async () => {
    const layout = makeLayout();
    layout.initialized = true;
    layout.groups = [group('g1', [room('r1', { name: 'active-room' })], 'Lobby')];
    const ownerAPI = purgeAPI();
    const { container } = renderEditor(layout, {
      server: server(),
      roomPurgeApiFactory: () => ownerAPI
    });

    await vi.waitFor(() => expect(ownerAPI.capability).toHaveBeenCalledOnce());
    const action = buttonByTitle(
      container,
      'Permanently delete #active-room — Archive this room before deleting it permanently.'
    );
    expect(action.disabled).toBe(true);
    expect(action.querySelector('.uil--trash-alt')).not.toBeNull();
    expect(container.querySelector('[data-testid="archived-room-purge-panel"]')).toBeNull();
  });

  it('keeps the complete action group inside the room row across wide and narrow cards', async () => {
    await page.viewport(1024, 768);

    try {
      const layout = makeLayout();
      layout.initialized = true;
      layout.groups = [
        group(
          'g1',
          [room('r1', { name: 'a-very-long-room-name', description: 'Responsive room row' })],
          'Lobby'
        )
      ];
      const { container } = renderEditor(layout);
      const card = container.querySelector('.room-group-card');
      const row = container.querySelector('.room-row');
      const copy = container.querySelector('.room-row-copy');
      const actions = container.querySelector('.room-row-actions');
      if (
        !(card instanceof HTMLElement) ||
        !(row instanceof HTMLElement) ||
        !(copy instanceof HTMLElement) ||
        !(actions instanceof HTMLElement)
      ) {
        throw new Error('room row geometry was unavailable');
      }

      card.style.width = '48rem';
      await vi.waitFor(() => {
        const rowBounds = row.getBoundingClientRect();
        const copyBounds = copy.getBoundingClientRect();
        const actionBounds = actions.getBoundingClientRect();
        expect(
          Math.abs(
            actionBounds.top + actionBounds.height / 2 - (copyBounds.top + copyBounds.height / 2)
          )
        ).toBeLessThanOrEqual(2);
        expect(actionBounds.right).toBeLessThanOrEqual(rowBounds.right + 1);
        expect(row.scrollWidth).toBeLessThanOrEqual(Math.ceil(rowBounds.width) + 1);
      });

      card.style.width = '26rem';
      await vi.waitFor(() => {
        const rowBounds = row.getBoundingClientRect();
        const copyBounds = copy.getBoundingClientRect();
        const actionBounds = actions.getBoundingClientRect();
        expect(actionBounds.top).toBeGreaterThan(copyBounds.top);
        expect(actionBounds.right).toBeLessThanOrEqual(rowBounds.right + 1);
        expect(actionBounds.left).toBeGreaterThanOrEqual(rowBounds.left - 1);
        expect(row.scrollWidth).toBeLessThanOrEqual(Math.ceil(rowBounds.width) + 1);
      });
    } finally {
      await page.viewport(414, 896);
    }
  });

  it('enables the row action only for an archived room with server-confirmed capability', async () => {
    const layout = makeLayout();
    layout.initialized = true;
    layout.groups = [group('g1', [room('r1', { name: 'retired-room', archived: true })], 'Lobby')];
    const deniedAPI = purgeAPI({ allowed: false });
    const denied = renderEditor(layout, {
      server: server(),
      roomPurgeApiFactory: () => deniedAPI
    });

    await vi.waitFor(() => expect(deniedAPI.capability).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(
        buttonByTitle(
          denied.container,
          'Permanently delete #retired-room — Only a server owner can permanently delete archived rooms.'
        ).disabled
      ).toBe(true);
    });

    const allowedLayout = makeLayout();
    allowedLayout.initialized = true;
    allowedLayout.groups = [
      group('g1', [room('r1', { name: 'retired-room', archived: true })], 'Lobby')
    ];
    const allowedAPI = purgeAPI();
    const allowed = renderEditor(allowedLayout, {
      server: server(),
      roomPurgeApiFactory: () => allowedAPI
    });

    await vi.waitFor(() => expect(allowedAPI.capability).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(buttonByTitle(allowed.container, 'Permanently delete #retired-room').disabled).toBe(
        false
      );
    });
  });

  it('keeps the archived-room action disabled when capability lookup fails', async () => {
    const layout = makeLayout();
    layout.initialized = true;
    layout.groups = [group('g1', [room('r1', { name: 'retired-room', archived: true })], 'Lobby')];
    const failingAPI = purgeAPI({
      capability: vi.fn().mockRejectedValue(new Error('network unavailable'))
    });
    const { container } = renderEditor(layout, {
      server: server(),
      roomPurgeApiFactory: () => failingAPI
    });

    await vi.waitFor(() => expect(failingAPI.capability).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(
        buttonByTitle(
          container,
          'Permanently delete #retired-room — Permanent deletion is temporarily unavailable.'
        ).disabled
      ).toBe(true);
    });
  });

  it('requires exact confirmation, purges the server, and clears only the selected offline room', async () => {
    const layout = makeLayout();
    layout.initialized = true;
    const target = room('R00000000000000', { name: 'retired-room', archived: true });
    layout.groups = [group('g1', [target], 'Lobby')];
    const ownerAPI = purgeAPI();
    const currentServer = server();
    const purgeLocalRoom = vi.fn().mockResolvedValue(undefined);
    const onroompurged = vi.fn().mockResolvedValue(undefined);
    const { container } = renderEditor(layout, {
      server: currentServer,
      roomPurgeApiFactory: () => ownerAPI,
      purgeLocalRoom,
      onroompurged
    });

    await vi.waitFor(() => expect(ownerAPI.capability).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(buttonByTitle(container, 'Permanently delete #retired-room').disabled).toBe(false)
    );
    const action = buttonByTitle(container, 'Permanently delete #retired-room');
    action.click();
    flushSync();

    const input = q(container, '#room-purge-confirmation') as HTMLInputElement;
    const submit = buttonByText(container, 'Delete room permanently');
    expect(submit.disabled).toBe(true);
    fill(input, 'RETIRED-ROOM');
    expect(submit.disabled).toBe(true);
    expect(container.textContent).toContain('must exactly match');
    fill(input, target.name);
    expect(submit.disabled).toBe(false);
    submit.click();

    await vi.waitFor(() => expect(ownerAPI.purge).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(purgeLocalRoom).toHaveBeenCalledOnce());
    expect(ownerAPI.purge).toHaveBeenCalledWith(target.id, target.name);
    expect(purgeLocalRoom).toHaveBeenCalledWith(currentServer, target.id);
    await vi.waitFor(() => expect(onroompurged).toHaveBeenCalledWith(target.id));
  });

  it('retries only encrypted local cleanup after the irreversible server purge succeeds', async () => {
    const layout = makeLayout();
    layout.initialized = true;
    const target = room('R00000000000000', { name: 'retired-room', archived: true });
    layout.groups = [group('g1', [target], 'Lobby')];
    const purge = vi.fn().mockResolvedValue({
      alreadyPurged: false,
      roomEventsDeleted: 1,
      rbacEventsDeleted: 0,
      assetEventsDeleted: 0,
      attachmentsDeleted: 0,
      linkPreviewAssetsDeleted: 0
    });
    const ownerAPI = purgeAPI({ purge });
    const purgeLocalRoom = vi
      .fn()
      .mockRejectedValueOnce(new Error('indexeddb unavailable'))
      .mockResolvedValueOnce(undefined);
    const onroompurged = vi.fn().mockResolvedValue(undefined);
    const { container } = renderEditor(layout, {
      server: server(),
      roomPurgeApiFactory: () => ownerAPI,
      purgeLocalRoom,
      onroompurged
    });

    await vi.waitFor(() => expect(ownerAPI.capability).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(buttonByTitle(container, 'Permanently delete #retired-room').disabled).toBe(false)
    );
    const action = buttonByTitle(container, 'Permanently delete #retired-room');
    action.click();
    flushSync();
    fill(q(container, '#room-purge-confirmation') as HTMLInputElement, target.name);
    buttonByText(container, 'Delete room permanently').click();

    await vi.waitFor(() => expect(container.textContent).toContain('Retry local cleanup'));
    expect(purge).toHaveBeenCalledOnce();
    expect(purgeLocalRoom).toHaveBeenCalledOnce();
    buttonByText(container, 'Retry local cleanup').click();

    await vi.waitFor(() => expect(purgeLocalRoom).toHaveBeenCalledTimes(2));
    expect(purge).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onroompurged).toHaveBeenCalledWith(target.id));
  });
});
