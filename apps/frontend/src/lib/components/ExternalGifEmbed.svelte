<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { externalGifMessages as gm } from '$lib/i18n/externalGifMessages';
  import {
    shouldObserveExternalGif,
    type ExternalGifDescriptor,
    type ExternalGifLoadState
  } from '$lib/externalGif';

  const LOAD_TIMEOUT_MS = 20_000;
  const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

  let {
    gif,
    autoLoad = false
  }: {
    gif: ExternalGifDescriptor;
    autoLoad?: boolean;
  } = $props();

  function initialReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(REDUCED_MOTION_QUERY).matches
    );
  }

  let root = $state<HTMLElement | null>(null);
  let loadState = $state<ExternalGifLoadState>('idle');
  let loadOrigin = $state<'manual' | 'auto' | null>(null);
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  let pageVisible = $state(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  let reducedMotion = $state(initialReducedMotion());
  let hiddenByUser = $state(false);
  let attempt = $state(0);
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let failureReason = $state<'network' | 'offline' | null>(null);
  let mediaIdentity = $state<string | null>(null);
  let activeMediaElement = $state<HTMLIFrameElement | HTMLVideoElement | HTMLImageElement | null>(
    null
  );
  let hydrationReady = $state(false);
  let suppressedByPersistedPreview = $state(false);

  function clearLoadTimeout() {
    if (!timeout) return;
    clearTimeout(timeout);
    timeout = null;
  }

  function resetMedia() {
    clearLoadTimeout();
    activeMediaElement = null;
    hiddenByUser = false;
    failureReason = null;
    loadOrigin = null;
    loadState = 'idle';
    attempt += 1;
  }

  function stopAutomaticLoad() {
    if (loadOrigin !== 'auto') return;
    clearLoadTimeout();
    activeMediaElement = null;
    failureReason = null;
    loadOrigin = null;
    loadState = 'idle';
    attempt += 1;
  }

  function startLoad(origin: 'manual' | 'auto' = 'manual') {
    clearLoadTimeout();
    activeMediaElement = null;
    hiddenByUser = false;

    // `navigator.onLine` is only a hint. Automatic loads stay conservative,
    // while an explicit user action may still reach a fresh browser cache.
    if (!online && origin === 'auto') return;

    failureReason = null;
    loadOrigin = origin;
    attempt += 1;
    loadState = 'loading';
    timeout = setTimeout(() => {
      activeMediaElement = null;
      failureReason = online ? 'network' : 'offline';
      loadOrigin = null;
      loadState = 'failed';
      timeout = null;
    }, LOAD_TIMEOUT_MS);
  }

  function handleLoaded(event: Event) {
    if (loadState !== 'loading' || event.currentTarget !== activeMediaElement) return;
    clearLoadTimeout();
    failureReason = null;
    loadState = 'loaded';
  }

  function handleFailed(event: Event) {
    if (loadState !== 'loading' || event.currentTarget !== activeMediaElement) return;
    clearLoadTimeout();
    activeMediaElement = null;
    failureReason = online ? 'network' : 'offline';
    loadOrigin = null;
    loadState = 'failed';
  }

  function hideMedia() {
    clearLoadTimeout();
    activeMediaElement = null;
    hiddenByUser = true;
    failureReason = null;
    loadOrigin = null;
    loadState = 'idle';
    attempt += 1;
  }

  onMount(() => {
    // A persisted OpenGraph card is historical server-issued state. The
    // message row renders that card after MessageContent, so detect it only
    // after hydration and keep this enhancement hidden. No provider element
    // is mounted before this check completes. A standalone component has no
    // message article and must remain visible.
    const article = root?.closest('[role="article"]');
    suppressedByPersistedPreview = Boolean(
      article?.querySelector('[data-testid="link-preview-card"]')
    );
    hydrationReady = true;
  });

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

  onMount(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => {
      const nextReducedMotion = mediaQuery.matches;
      reducedMotion = nextReducedMotion;
      if (nextReducedMotion) stopAutomaticLoad();
    };
    sync();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync);
      return () => mediaQuery.removeEventListener('change', sync);
    }

    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(sync);
      return () => mediaQuery.removeListener(sync);
    }
  });

  onMount(() => {
    const updateVisibility = () => {
      pageVisible = document.visibilityState === 'visible';
      if (!pageVisible && loadState === 'loading') stopAutomaticLoad();
    };
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  });

  onMount(() => {
    const updateOnline = () => {
      online = navigator.onLine;
      if (!online && loadState === 'loading' && loadOrigin === 'auto') {
        stopAutomaticLoad();
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
    if (!autoLoad && loadState === 'loading' && loadOrigin === 'auto') {
      stopAutomaticLoad();
    }
  });

  $effect(() => {
    const intersectionObserverAvailable =
      typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function';
    if (
      !root ||
      !hydrationReady ||
      suppressedByPersistedPreview ||
      !shouldObserveExternalGif({
        autoLoad,
        reducedMotion,
        hiddenByUser,
        online,
        pageVisible,
        loadState,
        intersectionObserverAvailable
      })
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        const canStillAutoLoad = shouldObserveExternalGif({
          autoLoad,
          reducedMotion,
          hiddenByUser,
          online,
          pageVisible: pageVisible && document.visibilityState === 'visible',
          loadState,
          intersectionObserverAvailable: true
        });
        if (!canStillAutoLoad) return;
        observer.disconnect();
        startLoad('auto');
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
  class={[
    'external-gif-embed inline-flex max-w-full flex-col overflow-hidden rounded-lg border border-border bg-background',
    gif.renderMode === 'iframe' ? 'w-full max-w-xl' : 'w-full sm:w-fit sm:min-w-80 sm:max-w-xl'
  ]}
  data-testid="external-gif-embed"
  data-provider={gif.provider}
  data-media-provider={gif.provider}
  data-render-mode={gif.renderMode}
  data-auto-load={autoLoad ? 'enabled' : 'disabled'}
  data-state={loadState}
  data-load-origin={loadOrigin ?? undefined}
  aria-busy={loadState === 'loading'}
  hidden={!hydrationReady || suppressedByPersistedPreview}
  data-suppressed-by-preview={suppressedByPersistedPreview || undefined}
>
  {#if loadState === 'loading' || loadState === 'loaded'}
    <div
      class={[
        'relative flex max-w-full items-center justify-center overflow-hidden bg-black/10',
        gif.renderMode === 'iframe' ? 'aspect-video min-h-48 w-full' : 'w-full sm:w-fit'
      ]}
      data-testid="external-gif-media"
    >
      {#key attempt}
        {#if gif.renderMode === 'iframe'}
          <iframe
            bind:this={activeMediaElement}
            src={gif.resourceUrl}
            title={gm.mediaTitle(gif.providerLabel)}
            class="h-full min-h-48 w-full border-0"
            loading="lazy"
            sandbox="allow-scripts allow-same-origin"
            allow="autoplay"
            referrerpolicy="no-referrer"
            onload={handleLoaded}
          ></iframe>
        {:else if gif.renderMode === 'video'}
          <video
            bind:this={activeMediaElement}
            src={gif.resourceUrl}
            aria-label={gm.mediaTitle(gif.providerLabel)}
            class="block h-auto max-h-[36rem] w-full max-w-full bg-black object-contain sm:w-auto sm:min-w-80"
            autoplay={!reducedMotion}
            controls={reducedMotion}
            muted
            loop
            playsinline
            preload="metadata"
            onloadedmetadata={handleLoaded}
            onerror={handleFailed}
          ></video>
        {:else}
          <img
            bind:this={activeMediaElement}
            src={gif.resourceUrl}
            alt={gm.mediaTitle(gif.providerLabel)}
            class="block h-auto max-h-[36rem] w-full max-w-full object-contain sm:w-auto sm:min-w-80"
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
          class="absolute inset-0 flex items-center justify-center bg-black/25 px-4 text-center text-sm text-white backdrop-blur-[1px]"
          role="status"
          aria-live="polite"
        >
          {gm.loading()}
        </div>
      {/if}
    </div>
  {:else}
    <div
      class={[
        'flex w-full flex-col items-center justify-center gap-3 bg-surface-100 px-5 py-6 text-center',
        gif.renderMode === 'iframe' ? 'aspect-video min-h-48' : 'min-h-40 sm:min-w-80'
      ]}
      data-testid="external-gif-fallback"
    >
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
        <button
          type="button"
          class="btn btn-primary min-h-11 px-3 py-2 text-sm"
          onclick={() => startLoad('manual')}
        >
          {loadState === 'failed' ? gm.retry() : gm.load()}
        </button>
        <a
          class="btn-ghost btn min-h-11 px-3 py-2 text-sm"
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

  {#if loadState === 'loading' || loadState === 'loaded'}
    <div
      class="flex min-h-10 w-full items-center justify-between gap-2 border-t border-border bg-surface-100 px-2.5 text-xs"
      data-testid="external-gif-controls"
    >
      <span class="truncate text-muted">{gif.providerLabel}</span>
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="inline-flex min-h-10 items-center rounded px-2 text-muted hover:bg-surface-200 hover:text-text"
          onclick={hideMedia}
        >
          {gm.hide()}
        </button>
        <span aria-hidden="true" class="text-muted/50">·</span>
        <a
          class="inline-flex min-h-10 items-center rounded px-2 text-muted hover:bg-surface-200 hover:text-text"
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
