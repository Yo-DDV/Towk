<!--
@component

Phone icon button for joining voice calls. Shown in the room header.
Hidden when already in this call (the VoiceCallPanel provides leave controls).

States:
- Idle: phone icon (click to join)
- Connecting: spinner
- In call: hidden (panel handles it)
- Disabled: already in another call

**Props:**
- `roomId` - The room ID
- `livekitUrl` - The LiveKit server WebSocket URL
-->
<script lang="ts">
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import * as m from '$lib/i18n/messages';

  const stores = serverRegistry.getStore(getActiveServer());
  const voiceCallState = stores.voiceCall;
  import { toast } from '$lib/ui/toast';
  import { getVoiceCallJoinErrorMessage } from '$lib/state/server/voiceCall.svelte';
  import CallDeviceJoinDialog from './CallDeviceJoinDialog.svelte';

  let {
    roomId,
    livekitUrl
  }: {
    roomId: string;
    livekitUrl: string;
  } = $props();

  let isInThisCall = $derived(voiceCallState.isInCall(roomId));
  let isInAnotherCall = $derived(voiceCallState.isInAnyCall && !isInThisCall);
  let isConnecting = $derived(voiceCallState.connecting && voiceCallState.roomId === roomId);
  let deviceChoiceVisible = $state(false);
  let companionAllowed = $state(false);
  let deviceChoiceBusy = $state(false);

  async function handleJoin() {
    await joinWithMode('ask');
  }

  async function joinWithMode(mode: 'ask' | 'companion' | 'transfer') {
    if (mode !== 'ask') deviceChoiceBusy = true;
    try {
      const result = await voiceCallState.join(livekitUrl, roomId, mode);
      if (result.status === 'selection-required') {
        companionAllowed = result.companionAllowed;
        deviceChoiceVisible = true;
        return;
      }
      deviceChoiceVisible = false;
    } catch (err) {
      stores.handleVoiceCallJoinFailed(roomId);
      toast.error(getVoiceCallJoinErrorMessage(err));
    } finally {
      deviceChoiceBusy = false;
    }
  }
</script>

{#if isConnecting}
  <span
    class="group/pane-header-icon-button pane-header-icon-button"
    title={m['voice.connecting']()}
  >
    <span class="pane-header-icon-glyph animate-spin uil--spinner" aria-hidden="true"></span>
  </span>
{:else if !isInThisCall}
  <button
    type="button"
    class="group/pane-header-icon-button pane-header-icon-button"
    onclick={handleJoin}
    disabled={isInAnotherCall}
    title={isInAnotherCall ? m['voice.already_in_another_call']() : m['voice.join']()}
  >
    <span class="pane-header-icon-glyph uil--phone" aria-hidden="true"></span>
  </button>
{/if}

<CallDeviceJoinDialog
  bind:visible={deviceChoiceVisible}
  {companionAllowed}
  busy={deviceChoiceBusy}
  oncompanion={() => void joinWithMode('companion')}
  ontransfer={() => void joinWithMode('transfer')}
/>
