<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { HTMLImgAttributes } from 'svelte/elements';

  let {
    class: className,
    onload,
    onerror,
    ...rest
  }: HTMLImgAttributes & {
    onload?: (event: Event) => void;
    onerror?: (event: Event) => void;
  } = $props();
  let loaded = $state(false);
  let img: HTMLImageElement | null = $state(null);
  let currentSrc = $state<string | undefined>();

  function markLoadedIfBrowserAlreadyHasImage() {
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) loaded = true;
  }

  $effect(() => {
    const nextSrc = typeof rest.src === 'string' ? rest.src : undefined;
    if (nextSrc === currentSrc) return;

    currentSrc = nextSrc;
    loaded = false;
    void tick().then(markLoadedIfBrowserAlreadyHasImage);
  });

  onMount(() => {
    markLoadedIfBrowserAlreadyHasImage();
  });
</script>

<img
  bind:this={img}
  class={[className, !loaded && 'skeleton']}
  onload={(event) => {
    loaded = true;
    onload?.(event);
  }}
  onerror={(event) => {
    loaded = false;
    onerror?.(event);
  }}
  {...rest}
/>
