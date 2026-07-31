<script lang="ts">
  import { onDestroy } from 'svelte';
  import { RoomHistoryPurgeStatus } from '@towk/api-types/api/v1/rooms_pb';
  import { createRoomCommandAPI, type RoomHistoryPurgeOperationView } from '$lib/api-client/rooms';
  import * as m from '$lib/i18n/messages';
  import { localizedErrorMessage } from '$lib/i18n/localizedError';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import ContextMenu from '$lib/ui/ContextMenu.svelte';
  import FormDialog from '$lib/ui/FormDialog.svelte';
  import { TextInput } from '$lib/ui/form';
  import ToggleChip from '$lib/ui/ToggleChip.svelte';
  import { toast } from '$lib/ui/toast';

  type GovernanceRoom = {
    id: string;
    name: string;
    isLocked: boolean;
    revision: bigint;
    canLockRoom: boolean;
    canPurgeMessages: boolean;
  };

  let {
    room,
    mode = 'header',
    onrefresh,
    onhistorypurged
  }: {
    room: GovernanceRoom;
    mode?: 'header' | 'row';
    onrefresh?: () => void | Promise<void>;
    onhistorypurged?: (historyEpoch: bigint) => void | Promise<void>;
  } = $props();

  const connection = useConnection();
  const api = $derived.by(() => {
    const current = connection();
    return createRoomCommandAPI({
      serverId: current.serverId,
      baseUrl: current.connectBaseUrl,
      bearerToken: current.bearerToken
    });
  });

  let menuPosition = $state<{ x: number; y: number; alignRight: boolean } | null>(null);
  let policyPending = $state(false);
  let purgeVisible = $state(false);
  let purgePending = $state(false);
  let purgeError = $state<string | null>(null);
  let confirmationName = $state('');
  let confirmationTouched = $state(false);
  let operationTimer: ReturnType<typeof setTimeout> | null = null;

  const confirmationMatches = $derived(confirmationName === room.name);
  const confirmationError = $derived(
    confirmationTouched && !confirmationMatches
      ? m['room.governance.confirmation_error']({ room: room.name })
      : undefined
  );

  function openMenu(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menuPosition = {
      x: rect.right,
      y: rect.bottom + 4,
      alignRight: true
    };
  }

  async function togglePolicy() {
    if (!room.canLockRoom || policyPending) return;
    menuPosition = null;
    policyPending = true;
    try {
      const updated = room.isLocked
        ? await api.unlockRoom({ roomId: room.id, expectedRevision: room.revision })
        : await api.lockRoom({ roomId: room.id, expectedRevision: room.revision });
      if (!updated) throw new Error(m['common.error.not_found']());
      toast.success(
        room.isLocked
          ? m['room.governance.unlock_success']({ room: room.name })
          : m['room.governance.lock_success']({ room: room.name })
      );
      await onrefresh?.();
    } catch (error) {
      toast.error(localizedErrorMessage(error, m['room.governance.policy_update_failed']()));
      await onrefresh?.();
    } finally {
      policyPending = false;
    }
  }

  function openPurge() {
    if (!room.canPurgeMessages || purgePending) return;
    menuPosition = null;
    confirmationName = '';
    confirmationTouched = false;
    purgeError = null;
    purgeVisible = true;
  }

  function closePurge() {
    if (purgePending) return;
    purgeVisible = false;
    purgeError = null;
  }

  async function submitPurge() {
    confirmationTouched = true;
    if (!confirmationMatches || purgePending) return;
    purgePending = true;
    purgeError = null;
    try {
      const result = await api.purgeRoomHistory({
        roomId: room.id,
        expectedRevision: room.revision,
        confirmationName
      });
      if (!result.room || !result.operation) {
        throw new Error(m['common.error.not_found']());
      }
      purgeVisible = false;
      toast.success(m['room.governance.purge_committed']({ room: room.name }));
      await onhistorypurged?.(result.room.historyEpoch);
      await onrefresh?.();
      trackOperation(result.operation);
    } catch (error) {
      purgeError = localizedErrorMessage(error, m['room.governance.purge_failed']());
    } finally {
      purgePending = false;
    }
  }

  function trackOperation(operation: RoomHistoryPurgeOperationView) {
    if (operationTimer) clearTimeout(operationTimer);
    if (operation.status === RoomHistoryPurgeStatus.COMPLETED) {
      toast.success(m['room.governance.cleanup_completed']({ room: room.name }));
      return;
    }
    if (operation.status === RoomHistoryPurgeStatus.FAILED) {
      toast.error(m['room.governance.cleanup_failed']({ room: room.name }));
      return;
    }
    operationTimer = setTimeout(async () => {
      try {
        const next = await api.getRoomHistoryPurgeOperation(operation.id);
        if (next) trackOperation(next);
      } catch {
        // The durable operation continues server-side. A later room refresh
        // remains authoritative if this detached status read fails.
      }
    }, 1500);
  }

  onDestroy(() => {
    if (operationTimer) clearTimeout(operationTimer);
  });
</script>

{#if mode === 'header'}
  <button
    type="button"
    class={[
      'group/pane-header-icon-button pane-header-icon-button !h-[44px] !w-[44px]',
      menuPosition && 'pane-header-icon-button-active'
    ]}
    onclick={openMenu}
    disabled={policyPending || purgePending}
    title={m['room.governance.menu_label']()}
    aria-label={m['room.governance.menu_label']()}
    aria-haspopup="menu"
    aria-expanded={Boolean(menuPosition)}
    data-testid="room-governance-menu-button"
  >
    <span class="pane-header-icon-glyph uil--ellipsis-v" aria-hidden="true"></span>
  </button>
{:else}
  <ToggleChip
    square
    pressed={Boolean(menuPosition)}
    title={m['room.governance.menu_label']()}
    disabled={policyPending || purgePending}
    onclick={(event) => {
      event.stopPropagation();
      openMenu(event);
    }}
  >
    <span class="iconify text-base uil--ellipsis-v" aria-label={m['room.governance.menu_label']()}
    ></span>
  </ToggleChip>
{/if}

{#if menuPosition}
  <ContextMenu
    position={menuPosition}
    ariaLabel={m['room.governance.menu_label']()}
    class="w-80 max-w-[calc(100vw-1rem)]"
    onclose={() => (menuPosition = null)}
  >
    <div class="menu-section p-1.5">
      <div class="flex items-center gap-2 px-2.5 pt-1.5 pb-2">
        <span
          class={[
            'grid size-8 shrink-0 place-items-center rounded-lg',
            room.isLocked ? 'bg-warning/10 text-warning' : 'bg-surface-200 text-muted'
          ]}
          aria-hidden="true"
        >
          <span class={['iconify text-base', room.isLocked ? 'uil--lock' : 'uil--unlock']}></span>
        </span>
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold">#{room.name}</div>
          <div class="text-xs text-muted">
            {room.isLocked
              ? m['room.governance.locked_status']()
              : m['room.governance.open_status']()}
          </div>
        </div>
      </div>

      <nav class="sidebar-nav">
        {#if room.canLockRoom}
          <button
            type="button"
            class="group/policy sidebar-item min-h-14 items-start gap-3 px-2.5 py-2.5 text-left"
            onclick={togglePolicy}
            role="menuitem"
            disabled={policyPending}
            data-testid="room-policy-action"
          >
            <span
              class="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-200 transition-colors group-hover/policy:bg-surface-300"
              aria-hidden="true"
            >
              <span class={['iconify text-lg', room.isLocked ? 'uil--unlock' : 'uil--lock']}></span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block font-medium">
                {room.isLocked
                  ? m['room.governance.unlock_action']()
                  : m['room.governance.lock_action']()}
              </span>
              <span class="mt-0.5 block text-xs leading-4 text-muted">
                {room.isLocked
                  ? m['room.governance.unlock_description']()
                  : m['room.governance.lock_description']()}
              </span>
            </span>
          </button>
        {/if}

        {#if room.canPurgeMessages}
          <button
            type="button"
            class="group/purge sidebar-item min-h-14 items-start gap-3 px-2.5 py-2.5 text-left text-danger hover:text-danger"
            onclick={openPurge}
            role="menuitem"
            data-testid="room-history-purge-action"
          >
            <span
              class="grid size-9 shrink-0 place-items-center rounded-lg bg-danger/10 transition-colors group-hover/purge:bg-danger/15"
              aria-hidden="true"
            >
              <span class="iconify text-lg uil--history-alt"></span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block font-medium">{m['room.governance.purge_action']()}</span>
              <span class="mt-0.5 block text-xs leading-4 text-muted">
                {m['room.governance.purge_description']()}
              </span>
            </span>
          </button>
        {/if}
      </nav>
    </div>
  </ContextMenu>
{/if}

<FormDialog
  bind:visible={purgeVisible}
  title={m['room.governance.purge_title']({ room: room.name })}
  size="sm"
  tall
  submitLabel={m['room.governance.purge_submit']()}
  submitLoadingText={m['room.governance.purge_submitting']()}
  submitTone="danger"
  submitIcon="iconify uil--history-alt"
  loading={purgePending}
  disabled={!confirmationMatches}
  error={purgeError}
  onsubmit={submitPurge}
  onclose={closePurge}
>
  {#snippet description()}
    <div class="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 p-3.5">
      <span class="mt-0.5 iconify shrink-0 text-lg text-danger uil--exclamation-triangle"></span>
      <p class="text-sm leading-5">{m['room.governance.purge_warning']()}</p>
    </div>
  {/snippet}

  <TextInput
    id="room-history-purge-confirmation"
    label={m['room.governance.confirmation_label']({ room: room.name })}
    placeholder={m['room.governance.confirmation_placeholder']({ room: room.name })}
    bind:value={confirmationName}
    error={confirmationError}
    disabled={purgePending}
    required
    autocomplete="off"
    onkeydown={(event) => {
      if (event.key === 'Enter') event.preventDefault();
    }}
    oninput={() => {
      if (confirmationName.length > 0) confirmationTouched = true;
    }}
  />

</FormDialog>
