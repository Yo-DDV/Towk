<script lang="ts">
  import { onMount } from 'svelte';
  import type { MessageUploadProgressEntry } from '$lib/uploads/messageUploadProgressModel';
  import { computeUploadProgressPosition } from '$lib/uploads/uploadProgressPosition';
  import UploadStatusIsland from './UploadStatusIsland.svelte';

  let {
    entry,
    onRetry,
    onDismiss
  }: {
    entry: MessageUploadProgressEntry;
    onRetry?: () => void;
    onDismiss?: () => void;
  } = $props();

  let islandElement = $state<HTMLDivElement>();
  let positioned = $state(false);
  let positionStyle = $state('');

  onMount(() => {
    let anchor: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let frame = 0;

    const selector = entry.threadRootEventId
      ? '[data-testid="thread-reply-input"]'
      : '[data-testid="message-input"]';

    function findAnchor(): HTMLElement | null {
      const editor = document.querySelector<HTMLElement>(selector);
      const shell =
        editor?.closest<HTMLElement>('[data-testid="message-composer-shell"]') ?? null;
      if (!shell || !entry.isVoiceMessage) return shell;
      return shell.querySelector<HTMLElement>('[data-testid="voice-message-recorder"]') ?? shell;
    }

    function connectAnchor(nextAnchor: HTMLElement | null) {
      if (anchor === nextAnchor) return;
      resizeObserver?.disconnect();
      anchor = nextAnchor;
      resizeObserver = new ResizeObserver(schedulePosition);
      if (anchor) resizeObserver.observe(anchor);
      if (islandElement) resizeObserver.observe(islandElement);
    }

    function schedulePosition() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    }

    function updatePosition() {
      connectAnchor(findAnchor());
      if (!anchor || !islandElement) {
        positioned = false;
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const islandRect = islandElement.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const position = computeUploadProgressPosition(anchorRect, islandRect, {
        width: visualViewport?.width ?? window.innerWidth,
        height: visualViewport?.height ?? window.innerHeight,
        offsetTop: visualViewport?.offsetTop ?? 0,
        offsetLeft: visualViewport?.offsetLeft ?? 0
      });

      positionStyle = `top:${position.top}px;left:${position.left}px;width:${position.width}px`;
      positioned = true;
    }

    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', schedulePosition, true);
    window.visualViewport?.addEventListener('resize', schedulePosition);
    window.visualViewport?.addEventListener('scroll', schedulePosition);
    schedulePosition();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('scroll', schedulePosition, true);
      window.visualViewport?.removeEventListener('resize', schedulePosition);
      window.visualViewport?.removeEventListener('scroll', schedulePosition);
    };
  });
</script>

<div
  bind:this={islandElement}
  data-testid="positioned-upload-status-island"
  class="pointer-events-none fixed z-[70] transition-opacity duration-150 motion-reduce:transition-none"
  class:opacity-0={!positioned}
  class:opacity-100={positioned}
  style={positionStyle}
>
  <UploadStatusIsland {entry} {onRetry} {onDismiss} />
</div>
