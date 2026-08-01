<script lang="ts">
  import { provideAppUiState } from '$lib/state/appUi.svelte';
  import { provideCallJoinController } from '$lib/state/callJoinController.svelte';
  import RoomPrimarySurfaceTabs from './RoomPrimarySurfaceTabs.svelte';

  let {
    width,
    hasActiveCall = false
  }: {
    width: number;
    hasActiveCall?: boolean;
  } = $props();

  const appUi = provideAppUiState();
  provideCallJoinController(appUi);
</script>

<div
  class="@container flex rounded-md border border-border bg-background p-4"
  style:width={`${width}px`}
>
  <RoomPrimarySurfaceTabs serverId="storybook" roomId="room" {hasActiveCall} />
</div>
