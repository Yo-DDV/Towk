<script module lang="ts">
  let scrollOffset = 700;
  let notifyScroll: ((offset: number) => void) | undefined;

  export function setVirtualizerScrollOffset(offset: number) {
    scrollOffset = offset;
  }

  export function emitVirtualizerScroll(offset: number) {
    scrollOffset = offset;
    notifyScroll?.(offset);
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    data,
    children,
    onscroll
  }: {
    data: unknown[];
    children: Snippet<[unknown]>;
    onscroll?: (offset: number) => void;
  } = $props();

  $effect(() => {
    notifyScroll = onscroll;
    return () => {
      if (notifyScroll === onscroll) notifyScroll = undefined;
    };
  });

  let renderedIndex = $state<number | null>(null);
  let scrollCalls = $state(0);
  let lastAlignment = $state('');

  export function scrollToIndex(index: number, options?: { align?: string }) {
    renderedIndex = index;
    scrollCalls += 1;
    lastAlignment = options?.align ?? '';
  }

  export function getScrollSize() {
    return 1_000;
  }

  export function getScrollOffset() {
    return scrollOffset;
  }

  export function getViewportSize() {
    return 300;
  }

  export function findItemIndex() {
    return 0;
  }
</script>

<output data-testid="virtualizer-scroll-index">{renderedIndex ?? ''}</output>
<output data-testid="virtualizer-scroll-calls">{scrollCalls}</output>
<output data-testid="virtualizer-scroll-alignment">{lastAlignment}</output>
{#if renderedIndex !== null && data[renderedIndex] !== undefined}
  {@render children(data[renderedIndex])}
{/if}
