<script lang="ts">
  import { getCallJoinController } from '$lib/state/callJoinController.svelte';
  import * as m from '$lib/i18n/messages';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import CallDeviceJoinDialog from './CallDeviceJoinDialog.svelte';

  const controller = getCallJoinController();
  let deviceSelectionVisible = $derived(controller.deviceSelection !== null);
  let callSwitchVisible = $derived(controller.callSwitchConfirmation !== null);
</script>

{#if controller.deviceSelection}
  <CallDeviceJoinDialog
    bind:visible={deviceSelectionVisible}
    companionAllowed={controller.deviceSelection.companionAllowed}
    canShareScreen={controller.deviceSelection.canShareScreen}
    busy={controller.deviceSelectionBusy}
    oncompanion={() => void controller.chooseDeviceMode('companion')}
    ontransfer={() => void controller.chooseDeviceMode('transfer')}
    oncancel={() => controller.cancelDeviceSelection()}
  />
{/if}

{#if controller.callSwitchConfirmation}
  <ConfirmDialog
    bind:visible={callSwitchVisible}
    title={m['voice.already_in_another_call']()}
    tone="warning"
    actionLabel={m['voice.switch_call_action']()}
    actionIcon="iconify uil--exchange"
    loading={controller.callSwitchBusy}
    onconfirm={() => void controller.confirmCallSwitch()}
    onclose={() => controller.cancelCallSwitch()}
  >
    {m['voice.switch_call_message']()}
  </ConfirmDialog>
{/if}
