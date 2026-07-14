<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import { callFullscreenMedia } from '$lib/state/callFullscreenMedia.svelte';
  import VideoThumbnail from './VideoThumbnail.svelte';

  let closeButton = $state<HTMLButtonElement | null>(null);

  function close(): void {
    callFullscreenMedia.close();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      closeButton?.focus();
    }
  }

  onMount(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => closeButton?.focus());

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if callFullscreenMedia.current}
  {@const media = callFullscreenMedia.current}
  <div
    class="call-fullscreen-media fixed inset-0 z-[9999] bg-black text-white"
    role="dialog"
    aria-modal="true"
    aria-labelledby="call-fullscreen-media-title"
    data-testid="call-fullscreen-media-overlay"
  >
    <header
      class="call-fullscreen-media-header absolute top-0 right-0 left-0 z-10 flex min-w-0 items-center gap-3 bg-gradient-to-b from-black/85 to-transparent p-3 pb-8"
    >
      <h2 id="call-fullscreen-media-title" class="min-w-0 flex-1 truncate text-sm font-medium">
        {media.name}
      </h2>
      <button
        bind:this={closeButton}
        type="button"
        class="flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:bg-white/25"
        aria-label={m['media.close_fullscreen_video']()}
        data-testid="call-fullscreen-media-close"
        onclick={close}
      >
        <span class="iconify text-2xl uil--times" aria-hidden="true"></span>
      </button>
    </header>

    <main class="h-full min-h-0 w-full min-w-0">
      <VideoThumbnail
        track={media.track}
        name={media.name}
        user={media.user}
        showIdentityOverlay={false}
        fit={media.kind === 'screen' ? 'contain' : 'cover'}
        fill
      />
    </main>
  </div>
{/if}

<style>
  .call-fullscreen-media {
    --call-safe-area-top: env(safe-area-inset-top, 0px);
    --call-safe-area-right: env(safe-area-inset-right, 0px);
    --call-safe-area-bottom: env(safe-area-inset-bottom, 0px);
    --call-safe-area-left: env(safe-area-inset-left, 0px);

    width: 100vw;
    min-height: 100vh;
    height: 100dvh;
    padding-top: var(--call-safe-area-top);
    padding-right: var(--call-safe-area-right);
    padding-bottom: var(--call-safe-area-bottom);
    padding-left: var(--call-safe-area-left);
  }

  .call-fullscreen-media-header {
    padding-top: calc(var(--call-safe-area-top) + 0.75rem);
    padding-right: calc(var(--call-safe-area-right) + 0.75rem);
    padding-left: calc(var(--call-safe-area-left) + 0.75rem);
  }
</style>
