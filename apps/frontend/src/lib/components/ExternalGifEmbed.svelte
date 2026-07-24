<script lang="ts">
  import { onDestroy } from 'svelte';
  import { externalGifMessages as gm } from '$lib/i18n/externalGifMessages';
  import type { ExternalGifDescriptor } from '$lib/externalGif';

  const LOAD_TIMEOUT_MS = 20_000;

  let {
    gif,
    autoLoad = false
  }: {
    gif: ExternalGifDescriptor;
    autoLoad?: boolean;
  } = $props();

  let root = $state<HTMLElement | null>(null);
  let loadState = $state<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  let reducedMotion = $state(false);
  let hiddenByUser = $state(false);
  let attempt = $state(0);
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let failureReason = $state<'network' | 'offline' | null>(null);
  let mediaIdentity = $state<string | null>(null);

  function clearLoadTimeout() {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  }

  function resetMedia() {
    clearLoadTimeout();
    hiddenByUser = false;
    failureReason = null;
    loadState = 'idle';
    attempt += 1;
  }

  function startLoad() {
    clearLoadTimeout();
    hiddenByUser = false;
    if (!online) {
      failureReason = 'offline';
      loadState = 'failed';
      return;
    }

    failureReason = null;
    attempt += 1;
    loadState = 'loading';
    timeout = setTimeout(() => {
      failureReason = online ? 'network' : 'offline';
      loadState = 'failed';
      timeout = null;
    }, LOAD_TIMEOUT_MS);
  }

  function handleLoaded() {
    clearLoadTimeout();
    failureReason = null;
    loadState = 'loaded';
  }

  function handleFailed() {
    clearLoadTimeout();
    failureReason = online ? 'network' : 'offline';
    loadState = 'failed';
  }

  function hideMedia() {
    clearLoadTimeout();
    hiddenByUser = true;
    failureReason = null;
    loadState = 'idle';
  }

  // Virtualized message rows can be reused for a different event. Never keep
  // the previous provider resource mounted when the descriptor changes.
  $effect(() => {
    const nextIdentity = `${gif.provider}:${gif.id}:${gif.resourceUrl}`;
    if (mediaIdentity === null) {
      mediaIdentity = nextIdentity;
      return;
    }
    if (nextIdentity === mediaIdentity) return;
    mediaIdentity = nextIdentity;
    resetMedia();
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => (reducedMotion = mediaQuery.matches);
    sync();
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const updateOnline = () => {
      online = navigator.onLine;
      if (!online && loadState === 'loading') {
        clearLoadTimeout();
        failureReason = 'offline';
        loadState = 'failed';
      } else if (online && failureReason === 'offline') {
        failureReason = null;
        loadState = 'idle';
      }
    };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  });

  $effect(() => {
    if (!root || !autoLoad || reducedMotion || hiddenByUser || !online || loadState !== 'idle') {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      startLoad();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          startLoad();
        }
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(root);
    return () => observer.disconnect();
  });

  onDestroy(clearLoadTimeout);
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- provider URLs are validated external destinations -->
<section
  bind:this={root}
  class="external-gif-embed mt-2 w-full max-w-md overflow-hidden rounded-lg border border-border bg-surface-200"
  data-testid="external-gif-embed"
  data-provider={gif.provider}
  data-state={loadState}
  aria-busy={loadState === 'loading'}
>
  {#if loadState === 'loading' || loadState === 'loaded'}
    <div class="relative flex min-h-36 items-center justify-center bg-black/10">
      {#key attempt}
        {#if gif.renderMode === 'iframe'}
          <iframe
            src={gif.resourceUrl}
            title={gm.mediaTitle(gif.providerLabel)}
            class="aspect-video w-full border-0"
            loading="lazy"
            sandbox="allow-scripts allow-same-origin"
            allow="autoplay"
            referrerpolicy="no-referrer"
            onload={handleLoaded}
          ></iframe>
        {:else if gif.renderMode === 'video'}
          <video
            src={gif.resourceUrl}
            aria-label={gm.mediaTitle(gif.providerLabel)}
            class="max-h-[28rem] w-full bg-black object-contain"
            autoplay={!reducedMotion}
            controls={reducedMotion}
            muted
            loop
            playsinline
            preload="metadata"
            onloadeddata={handleLoaded}
            onerror={handleFailed}
          ></video>
        {:else}
          <img
            src={gif.resourceUrl}
            alt={gm.mediaTitle(gif.providerLabel)}
            class="max-h-[28rem] w-full object-contain"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            onload={handleLoaded}
            onerror={handleFailed}
          />
        {/if}
      {/key}

      {#if loadState === 'loading'}
        <div
          class="absolute inset-0 flex items-center justify-center bg-surface/80 text-sm text-muted"
          role="status"
          aria-live="polite"
        >
          {gm.loading()}
        </div>
      {/if}
    </div>
  {:else}
    <div class="flex min-h-36 flex-col items-center justify-center gap-3 px-5 py-6 text-center">
      <span class="iconify text-3xl text-muted uil--image" aria-hidden="true"></span>
      <div class="max-w-sm text-sm text-muted" role="status" aria-live="polite">
        {#if loadState === 'failed'}
          {failureReason === 'offline' || !online ? gm.offline() : gm.loadFailed()}
        {:else if !online}
          {gm.offline()}
        {:else}
          {gm.privacyNotice(gif.providerLabel)}
        {/if}
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <button type="button" class="btn btn-primary btn-sm" onclick={startLoad} disabled={!online}>
          {loadState === 'failed' ? gm.retry() : gm.load()}
        </button>
        <a
          class="btn-ghost btn btn-sm"
          href={gif.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerpolicy="no-referrer"
        >
          {gm.openSource()}
        </a>
      </div>
    </div>
  {/if}

  {#if loadState === 'loaded'}
    <div class="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs">
      <span class="truncate text-muted">{gif.providerLabel}</span>
      <div class="flex shrink-0 gap-1">
        <button type="button" class="text-muted hover:text-text" onclick={hideMedia}>
          {gm.hide()}
        </button>
        <span aria-hidden="true" class="text-muted/50">·</span>
        <a
          class="text-muted hover:text-text"
          href={gif.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerpolicy="no-referrer"
        >
          {gm.openSource()}
        </a>
      </div>
    </div>
  {/if}
</section>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
