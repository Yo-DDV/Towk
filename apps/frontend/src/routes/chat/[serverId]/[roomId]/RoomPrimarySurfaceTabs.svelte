<script lang="ts">
  import * as m from '$lib/i18n/messages';
  import { getAppUiState } from '$lib/state/appUi.svelte';
  import { getCallJoinController } from '$lib/state/callJoinController.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';

  let {
    serverId,
    roomId,
    hasActiveCall = false,
    onmessages
  }: {
    serverId: string;
    roomId: string;
    hasActiveCall?: boolean;
    onmessages?: () => void;
  } = $props();

  const appUi = getAppUiState();
  const callJoinController = getCallJoinController();
  const store = $derived(serverRegistry.tryGetStore(serverId));
  const voiceCall = $derived(store?.voiceCall);
  const surface = $derived(appUi.roomPrimarySurfaceFor(serverId, roomId));
  const isJoining = $derived(voiceCall?.isJoiningRoom(roomId) ?? false);

  function showMessages(): void {
    appUi.selectRoomPrimarySurface(serverId, roomId, 'messages');
    onmessages?.();
  }

  function showOrJoinCall(): void {
    if (isJoining) return;
    void callJoinController.request({
      serverId,
      roomId,
      expectedCallId: store?.activeCallRooms.getCallId(roomId) ?? undefined,
      source: 'room-header'
    });
  }
</script>

<div
  class="inline-flex min-h-[48px] shrink-0 items-center gap-px rounded-xl border border-border bg-surface p-px"
  role="tablist"
  aria-label={m['room.workspace.switcher']()}
  data-testid="room-primary-surface-tabs"
>
  <button
    type="button"
    role="tab"
    aria-label={m['room.workspace.messages']()}
    title={m['room.workspace.messages']()}
    aria-selected={surface === 'messages'}
    aria-controls="room-messages-surface"
    class={[
      'grid size-[44px] shrink-0 cursor-pointer place-items-center rounded-lg text-sm font-medium transition-colors @min-[720px]:w-auto @min-[720px]:grid-flow-col @min-[720px]:gap-1.5 @min-[720px]:px-2.5',
      surface === 'messages'
        ? 'bg-surface-200 text-text shadow-sm'
        : 'text-muted hover:bg-surface-100 hover:text-text'
    ]}
    data-testid="room-messages-tab"
    onclick={showMessages}
  >
    <span class="iconify uil--comment-alt-lines" aria-hidden="true"></span>
    <span class="sr-only @min-[720px]:not-sr-only" data-testid="room-messages-tab-label">
      {m['room.workspace.messages']()}
    </span>
  </button>
  <button
    type="button"
    role="tab"
    aria-label={m['room.workspace.call']()}
    title={m['room.workspace.call']()}
    aria-selected={surface === 'call'}
    aria-controls="room-call-surface"
    aria-busy={isJoining || undefined}
    disabled={isJoining}
    class={[
      'relative grid size-[44px] shrink-0 cursor-pointer place-items-center rounded-lg text-sm font-medium transition-colors disabled:cursor-wait @min-[720px]:w-auto @min-[720px]:grid-flow-col @min-[720px]:gap-1.5 @min-[720px]:px-2.5',
      surface === 'call'
        ? 'bg-accent/15 text-accent shadow-sm'
        : 'text-muted hover:bg-surface-100 hover:text-text'
    ]}
    data-testid="room-call-tab"
    onclick={showOrJoinCall}
  >
    {#if isJoining}
      <span class="iconify animate-spin uil--spinner motion-reduce:animate-none" aria-hidden="true"
      ></span>
    {:else}
      <span class="iconify uil--phone" aria-hidden="true"></span>
    {/if}
    <span class="sr-only @min-[720px]:not-sr-only" data-testid="room-call-tab-label">
      {m['room.workspace.call']()}
    </span>
    {#if hasActiveCall && !isJoining}
      <span
        class="absolute top-1.5 right-1.5 inline-flex h-2 w-2 @min-[720px]:relative"
        aria-hidden="true"
      >
        <span
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-50"
        ></span>
        <span class="relative inline-flex h-2 w-2 rounded-full bg-accent"></span>
      </span>
    {/if}
  </button>
</div>
