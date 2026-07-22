<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { HTMLImgAttributes } from 'svelte/elements';
  import { hasLoadedImageSource, rememberLoadedImageSource } from './imageLoadMemory';

  let {
    class: className,
    src,
    onload,
    onerror,
    ...rest
  }: HTMLImgAttributes & {
    onload?: (event: Event) => void;
    onerror?: (event: Event) => void;
  } = $props();
  function isKnownLoadedSource(src: unknown): boolean {
    return typeof src === 'string' && hasLoadedImageSource(src);
  }

  const sourceLoadedFromMemory = $derived(isKnownLoadedSource(src));
  let loaded = $state(false);
  let img: HTMLImageElement | null = $state(null);
  let currentSrc = $state<string | undefined>();

  function markLoadedIfBrowserAlreadyHasImage() {
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      loaded = true;
      rememberLoadedImageSource(img.currentSrc || img.src || currentSrc);
    }
  }

  $effect(() => {
    const nextSrc = typeof src === 'string' ? src : undefined;
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
  class={[className, !(loaded || sourceLoadedFromMemory) && 'skeleton']}
  {src}
  onload={(event) => {
    loaded = true;
    if (event.currentTarget instanceof HTMLImageElement) {
      rememberLoadedImageSource(event.currentTarget.currentSrc || event.currentTarget.src);
    }
    onload?.(event);
  }}
  onerror={(event) => {
    loaded = false;
    onerror?.(event);
  }}
  {...rest}
/>
