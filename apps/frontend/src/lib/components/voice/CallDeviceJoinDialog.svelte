<script lang="ts">
  import Dialog from '$lib/ui/Dialog.svelte';
  import * as m from '$lib/i18n/messages';

  let {
    visible = $bindable(false),
    companionAllowed,
    canShareScreen,
    busy = false,
    oncompanion,
    ontransfer
  }: {
    visible?: boolean;
    companionAllowed: boolean;
    canShareScreen: boolean;
    busy?: boolean;
    oncompanion: () => void;
    ontransfer: () => void;
  } = $props();
</script>

<Dialog
  bind:visible
  title={m['voice.device_join_title']()}
  size="md"
  describedBy="call-device-join-description"
>
  <div class="flex flex-col gap-4">
    <p id="call-device-join-description" class="text-sm text-muted">
      {m['voice.device_join_description']()}
    </p>

    {#if !companionAllowed}
      <p class="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-text">
        {m['voice.device_limit_reached']()}
      </p>
    {/if}

    <button
      type="button"
      class="flex min-h-20 cursor-pointer flex-col items-start gap-1 rounded-md border border-text/10 bg-surface-100 p-4 text-left transition-colors hover:bg-surface-200 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!companionAllowed || busy}
      onclick={oncompanion}
      data-testid="call-join-companion"
    >
      <span class="font-semibold text-text">{m['voice.join_as_companion']()}</span>
      <span class="text-sm text-muted">
        {canShareScreen
          ? m['voice.companion_description']()
          : m['voice.companion_description_camera_only']()}
      </span>
    </button>

    <button
      type="button"
      class="flex min-h-20 cursor-pointer flex-col items-start gap-1 rounded-md border border-text/10 bg-surface-100 p-4 text-left transition-colors hover:bg-surface-200 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={busy}
      onclick={ontransfer}
      data-testid="call-join-transfer"
    >
      <span class="font-semibold text-text">{m['voice.transfer_call']()}</span>
      <span class="text-sm text-muted">{m['voice.transfer_description']()}</span>
    </button>

    <button
      type="button"
      class="btn-secondary min-h-11 w-full"
      disabled={busy}
      onclick={() => (visible = false)}
    >
      {m['common.cancel']()}
    </button>
  </div>
</Dialog>
