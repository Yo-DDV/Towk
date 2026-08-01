<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    stackOnNarrow = false,
    compactOnNarrow = false,
    afterTitle,
    actions
  }: {
    stackOnNarrow?: boolean;
    compactOnNarrow?: boolean;
    afterTitle?: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<div
  data-testid="pane-header-mock"
  data-stack-on-narrow={stackOnNarrow}
  data-compact-on-narrow={compactOnNarrow}
>
  {#if afterTitle}
    {@render afterTitle()}
  {/if}
  {#if actions}
    {@render actions()}
  {/if}
</div>
