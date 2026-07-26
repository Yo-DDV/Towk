<!--
@component

Tiny test double for Dialog used by ModalContainer specs.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    footer,
    title,
    describedBy
  }: {
    children: Snippet;
    footer?: Snippet;
    title: string;
    describedBy?: string;
  } = $props();
</script>

<dialog open aria-label={title} aria-describedby={describedBy}>
  <div>{@render children()}</div>
  {#if footer}
    <footer>{@render footer()}</footer>
  {/if}
</dialog>
