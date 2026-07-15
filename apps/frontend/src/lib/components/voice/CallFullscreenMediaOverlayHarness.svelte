<script lang="ts">
  import { callFullscreenMedia } from '$lib/state/callFullscreenMedia.svelte';
  import CallFullscreenMediaOverlay from './CallFullscreenMediaOverlay.svelte';
</script>

{#if callFullscreenMedia.isOpen}
  <CallFullscreenMediaOverlay />
{/if}
