<!--
@component

Registers the touch-only native context-menu guard for message rows. Mount this
component once at the root layout level.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { installNativeMessageContextMenuGuard } from '$lib/utils/nativeMessageContextMenuGuard';

  onMount(() => installNativeMessageContextMenuGuard(document));
</script>

<style>
  /* Safari/iOS does not consistently expose a cancelable contextmenu event for
     touch-and-hold callouts, so keep the WebKit fallback scoped to messages. */
  :global(.message-row),
  :global(.message-row *) {
    -webkit-touch-callout: none;
  }
</style>
