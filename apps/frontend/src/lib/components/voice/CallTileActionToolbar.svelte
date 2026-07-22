<!--
@component

Hover toolbar for call participant tiles. It intentionally reuses Towk's
quiet surface and border language instead of media-player chrome.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    testId,
    placement = 'overlay',
    forceVisible = false,
    children
  }: {
    testId?: string;
    placement?: 'overlay' | 'inline';
    forceVisible?: boolean;
    children: Snippet;
  } = $props();
</script>

<div
  class={[
    'call-tile-action-toolbar z-10 flex shrink-0 gap-0.5 rounded-md border border-text/10 bg-surface-100 p-0.5 shadow-sm transition-opacity',
    placement === 'overlay'
      ? 'absolute top-1.5 right-1.5 max-w-[calc(100%-0.75rem)] flex-wrap justify-end'
      : 'relative self-center',
    forceVisible
      ? 'pointer-events-auto opacity-100'
      : 'pointer-events-none opacity-0 group-focus-within/media:pointer-events-auto group-focus-within/media:opacity-100 group-hover/media:pointer-events-auto group-hover/media:opacity-100'
  ]}
  data-testid={testId}
>
  {@render children()}
</div>

<style>
  @media (hover: none), (pointer: coarse) {
    .call-tile-action-toolbar {
      pointer-events: auto;
      opacity: 1;
    }

    .call-tile-action-toolbar :global(button) {
      width: 44px;
      height: 44px;
    }
  }
</style>
