<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    class: className = ''
  }: {
    children: Snippet;
    class?: string;
  } = $props();
</script>

<div
  data-testid="app-content-frame"
  class="app-content-frame flex min-h-0 flex-1 bg-background transition-opacity duration-300 md:overflow-hidden md:rounded-2xl {className}"
>
  {@render children()}
</div>
