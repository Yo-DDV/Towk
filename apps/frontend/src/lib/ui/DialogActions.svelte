<!--
@component

Responsive action group for dialogs and dialog-owned forms. Actions stack and
fill the available width in compact containers, then become a right-aligned,
wrapping row when their own container is wide enough. Container queries keep
the layout correct when a dialog is narrow inside a wide viewport.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="dialog-actions-container">
  <div class="dialog-actions">
    {@render children()}
  </div>
</div>

<style>
  .dialog-actions-container {
    container-name: dialog-actions;
    container-type: inline-size;
    width: 100%;
  }

  .dialog-actions {
    display: grid;
    gap: 0.5rem;
  }

  .dialog-actions :global(button),
  .dialog-actions :global(a) {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    justify-content: center;
    text-align: center;
    text-wrap: balance;
  }

  @container dialog-actions (min-width: 24rem) {
    .dialog-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .dialog-actions :global(button),
    .dialog-actions :global(a) {
      width: auto;
      max-width: 100%;
    }
  }
</style>
