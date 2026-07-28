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
  class="inline-flex min-h-[52px] items-center gap-1 rounded-xl border border-border bg-surface p-1 max-[359px]:min-h-[48px] max-[359px]:gap-0.5 max-[359px]:p-0.5"
  role="tablist"
  aria-label={m['room.workspace.switcher']()}
  data-testid="room-primary-surface-tabs"
>
  <button
    type="button"
    role="tab"
    aria-selected={surface === 'messages'}
    aria-controls="room-messages-surface"
    class={[
      'min-h-[44px] cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors max-[359px]:w-[44px] max-[359px]:px-0',
      surface === 'messages'
        ? 'bg-surface-200 text-text shadow-sm'
        : 'text-muted hover:bg-surface-100 hover:text-text'
    ]}
    data-testid="room-messages-tab"
    onclick={showMessages}
  >
    <span class="iconify uil--comment-alt-lines min-[360px]:hidden" aria-hidden="true"></span>
    <span class="max-[359px]:sr-only">{m['room.workspace.messages']()}</span>
  </button>
  <button
    type="button"
    role="tab"
    aria-selected={surface === 'call'}
    aria-controls="room-call-surface"
    aria-busy={isJoining || undefined}
    disabled={isJoining}
    class={[
      'relative min-h-[44px] cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-wait max-[359px]:w-[44px] max-[359px]:px-0',
      surface === 'call'
        ? 'bg-accent/15 text-accent shadow-sm'
        : 'text-muted hover:bg-surface-100 hover:text-text'
    ]}
    data-testid="room-call-tab"
    onclick={showOrJoinCall}
  >
    <span class="inline-flex items-center gap-2">
      {#if isJoining}
        <span
          class="iconify animate-spin uil--spinner motion-reduce:animate-none"
          aria-hidden="true"
        ></span>
      {:else}
        <span class="iconify uil--phone" aria-hidden="true"></span>
      {/if}
      <span class="max-[359px]:sr-only">{m['room.workspace.call']()}</span>
      {#if hasActiveCall && !isJoining}
        <span class="relative inline-flex h-2 w-2" aria-hidden="true">
          <span
            class="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-50"
          ></span>
          <span class="relative inline-flex h-2 w-2 rounded-full bg-accent"></span>
        </span>
      {/if}
    </span>
  </button>
</div>
