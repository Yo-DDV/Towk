<script lang="ts">
  import PaneHeader from './PaneHeader.svelte';

  let { width = '280px' }: { width?: string } = $props();
  const title = '# salon-avec-un-titre-tres-long';
  const actionLabel = 'Action de test';
</script>

<div class="overflow-hidden border border-border" style:width>
  <PaneHeader {title} compactOnNarrow>
    {#snippet actions()}
      <span class="inline-flex h-12 w-[88px] shrink-0 rounded-xl border border-border"></span>
      <span class="inline-flex h-10 w-[82px] shrink-0 rounded-xl border border-border"></span>
      <button type="button" class="pane-header-icon-button" aria-label={actionLabel}></button>
    {/snippet}
  </PaneHeader>
</div>
