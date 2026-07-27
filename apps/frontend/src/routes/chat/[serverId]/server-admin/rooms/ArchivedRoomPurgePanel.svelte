<script lang="ts">
  import {
    createRoomPurgeAPI,
    RoomPurgeAPIError,
    type RoomPurgeAPI,
    type RoomPurgeAPIConfig,
    type RoomPurgeErrorCode
  } from '$lib/api-client/roomPurge';
  import { roomPurgeMessages as rp } from '$lib/i18n/roomPurgeMessages';
  import {
    purgeDeletedRoomForServer,
    type PurgeOfflineRoom
  } from '$lib/pwa/roomDeletionCleanup';
  import type {
    AdminRoomInfo,
    AdminRoomLayoutStore
  } from '$lib/state/server/adminRoomLayout.svelte';
  import { serverRegistry, type RegisteredServer } from '$lib/state/server/registry.svelte';
  import { Pill } from '$lib/ui';
  import { toast } from '$lib/ui/toast';
  import * as m from '$lib/i18n/messages';
  import { SvelteSet } from 'svelte/reactivity';
  import PermanentRoomPurgeDialog from './PermanentRoomPurgeDialog.svelte';

  type RoomPurgeAPIFactory = (config: RoomPurgeAPIConfig) => RoomPurgeAPI;
  type PurgeDeletedRoom = (
    server: RegisteredServer | null | undefined,
    roomId: string,
    purge?: PurgeOfflineRoom
  ) => Promise<void>;

  let {
    layout,
    server,
    onroompurged,
    apiFactory = createRoomPurgeAPI,
    purgeLocalRoom = purgeDeletedRoomForServer
  }: {
    layout: AdminRoomLayoutStore;
    server: RegisteredServer;
    onroompurged?: (roomId: string) => void | Promise<void>;
    apiFactory?: RoomPurgeAPIFactory;
    purgeLocalRoom?: PurgeDeletedRoom;
  } = $props();

  const api = $derived(
    apiFactory({
      serverId: server.id,
      baseUrl: server.url,
      bearerToken: server.token,
      onAuthenticationRequired: (serverId) => serverRegistry.handleAuthenticationRequired(serverId)
    })
  );

  let capability = $state<'loading' | 'allowed' | 'denied' | 'error'>('loading');
  let selectedRoom = $state<AdminRoomInfo | null>(null);
  let dialogVisible = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let serverPurgeCompleted = $state(false);
  let localCleanupPending = $state(false);
  let serverReportedAlreadyPurged = $state(false);

  const archivedRooms = $derived.by(() => {
    const seen = new SvelteSet<string>();
    const rooms: AdminRoomInfo[] = [];
    for (const group of layout.groups) {
      for (const room of group.rooms ?? []) {
        if (!room.archived || seen.has(room.id)) continue;
        seen.add(room.id);
        rooms.push(room);
      }
    }
    return rooms;
  });

  $effect(() => {
    const currentAPI = api;
    const controller = new AbortController();
    capability = 'loading';
    void currentAPI
      .capability(controller.signal)
      .then((result) => {
        capability = result.canPurgeArchivedRooms ? 'allowed' : 'denied';
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        capability = 'error';
      });
    return () => controller.abort();
  });

  function openPurgeDialog(room: AdminRoomInfo) {
    selectedRoom = room;
    error = null;
    serverPurgeCompleted = false;
    localCleanupPending = false;
    serverReportedAlreadyPurged = false;
    dialogVisible = true;
  }

  function handleDialogClose() {
    if (loading) return;
    dialogVisible = false;
    selectedRoom = null;
    error = null;
    serverPurgeCompleted = false;
    localCleanupPending = false;
    serverReportedAlreadyPurged = false;
  }

  function localizedError(caught: unknown): string {
    if (!(caught instanceof RoomPurgeAPIError)) return rp.errorInternal();
    const messages: Record<RoomPurgeErrorCode, () => string> = {
      authentication_required: rp.errorAuthenticationRequired,
      authentication_unavailable: rp.errorAuthenticationUnavailable,
      forbidden: rp.errorForbidden,
      invalid_room_id: rp.errorInvalidRoomID,
      confirmation_mismatch: rp.errorConfirmationMismatch,
      room_not_archived: rp.errorRoomNotArchived,
      purge_in_progress: rp.errorPurgeInProgress,
      purge_not_quiescent: rp.errorPurgeNotQuiescent,
      room_not_found: rp.errorRoomNotFound,
      timed_out: rp.errorTimedOut,
      interrupted: rp.errorInterrupted,
      temporarily_unavailable: rp.errorTemporarilyUnavailable,
      invalid_request: rp.errorInvalidRequest,
      invalid_response: rp.errorInvalidResponse,
      network_error: rp.errorNetwork,
      internal_error: rp.errorInternal
    };
    const base = messages[caught.code]?.() ?? rp.errorInternal();
    return caught.retryAfterSeconds
      ? `${base} ${rp.retryHint(caught.retryAfterSeconds)}`
      : base;
  }

  async function purgeSelectedRoom(confirmation: string) {
    const room = selectedRoom;
    if (!room || loading) return;
    loading = true;
    error = null;

    if (!serverPurgeCompleted) {
      try {
        const result = await api.purge(room.id, confirmation);
        serverReportedAlreadyPurged = result.alreadyPurged;
        serverPurgeCompleted = true;
      } catch (caught) {
        error = localizedError(caught);
        loading = false;
        return;
      }
    }

    try {
      await purgeLocalRoom(server, room.id);
      localCleanupPending = false;
    } catch {
      localCleanupPending = true;
      error = rp.localCleanupError();
      loading = false;
      return;
    }

    loading = false;
    dialogVisible = false;
    toast.success(
      serverReportedAlreadyPurged ? rp.alreadyPurged(room.name) : rp.success(room.name)
    );
    try {
      await onroompurged?.(room.id);
    } catch (caught) {
      console.error('Failed to refresh room state after permanent deletion:', caught);
    }
  }
</script>

{#if capability === 'allowed'}
  <section
    class="mt-8 overflow-hidden rounded-xl border border-danger/25 bg-surface-100 shadow-sm"
    aria-labelledby="archived-room-purge-title"
    data-testid="archived-room-purge-panel"
  >
    <header class="flex items-start gap-3 border-b border-danger/15 bg-danger/5 px-4 py-4 sm:px-5">
      <span
        class="grid size-11 shrink-0 place-items-center rounded-full bg-danger/10 text-danger"
        aria-hidden="true"
      >
        <span class="iconify uil--trash-alt text-2xl"></span>
      </span>
      <div class="min-w-0">
        <p class="text-xs font-semibold tracking-wide text-danger uppercase">
          {m['admin.common.danger_zone']()}
        </p>
        <h2 id="archived-room-purge-title" class="mt-0.5 text-lg font-semibold text-text">
          {rp.panelTitle()}
        </h2>
        <p class="mt-1 max-w-3xl text-sm leading-5 text-muted">{rp.panelSubtitle()}</p>
      </div>
    </header>

    {#if archivedRooms.length === 0}
      <p class="px-4 py-5 text-sm text-muted sm:px-5">{rp.noArchivedRooms()}</p>
    {:else}
      <ul class="divide-y divide-text/10">
        {#each archivedRooms as room (room.id)}
          <li class="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="truncate font-medium text-text">#{room.name}</span>
                <Pill tone="muted">{m['admin.rooms_admin.archived']()}</Pill>
              </div>
              {#if room.description}
                <p class="mt-1 line-clamp-2 text-sm text-muted">{room.description}</p>
              {/if}
            </div>
            <button
              type="button"
              class={[
                'btn-danger inline-flex min-h-11 w-full items-center justify-center gap-2 sm:w-auto',
                dialogVisible && selectedRoom?.id === room.id
                  ? 'ring-2 ring-danger ring-offset-2 ring-offset-surface-100'
                  : ''
              ]}
              onclick={() => openPurgeDialog(room)}
              disabled={loading}
              aria-label={rp.actionAria(room.name)}
              aria-pressed={dialogVisible && selectedRoom?.id === room.id}
            >
              <span class="iconify uil--trash-alt" aria-hidden="true"></span>
              {rp.deleteAction()}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{:else if capability === 'error'}
  <div
    class="mt-8 rounded-lg border border-warning/25 bg-warning/10 p-4 text-sm text-text/80"
    role="status"
  >
    <span class="iconify uil--exclamation-triangle mr-2 align-[-0.15em] text-lg text-warning" aria-hidden="true"></span>
    {rp.capabilityUnavailable()}
  </div>
{/if}

<PermanentRoomPurgeDialog
  bind:visible={dialogVisible}
  room={selectedRoom}
  {loading}
  retryingLocalCleanup={localCleanupPending}
  {error}
  onconfirm={(confirmation) => void purgeSelectedRoom(confirmation)}
  onclose={handleDialogClose}
/>
