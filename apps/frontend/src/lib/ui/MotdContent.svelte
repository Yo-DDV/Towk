<script lang="ts">
  import MarkdownHtml from './MarkdownHtml.svelte';

  let { motd }: { motd: string } = $props();

  let markdownModule: Promise<typeof import('$lib/markdown')> | null = null;

  function loadMarkdown() {
    markdownModule ??= import('$lib/markdown');
    return markdownModule;
  }
</script>

<span
  data-testid="motd-content"
  class="motd-content prose prose-compact max-w-none min-w-0 flex-1 truncate text-center text-sm whitespace-nowrap"
>
  {#await loadMarkdown()}
    {motd}
  {:then { renderMarkdown }}
    {#await renderMarkdown(motd)}
      {motd}
    {:then html}
      <MarkdownHtml {html} />
    {/await}
  {:catch}
    {motd}
  {/await}
</span>

<style>
  .motd-content,
  .motd-content :global(*) {
    white-space: nowrap;
  }
</style>
