<script lang="ts" module>
  let vidstackElementsRegistered = false;
  let vidstackElementsPromise: Promise<void> | null = null;

  export async function preloadVideoPlayerElements(): Promise<void> {
    if (vidstackElementsRegistered) return;
    vidstackElementsPromise ??= Promise.all([
      import('vidstack/player'),
      import('vidstack/player/layouts'),
      import('vidstack/player/ui')
    ]).then(() => {
      vidstackElementsRegistered = true;
    });
    await vidstackElementsPromise;
  }
</script>

<script lang="ts">
  import { tick, onMount } from 'svelte';
  import type { VideoProcessingStatus } from '$lib/render/types';
  import { fullscreenVideo } from '$lib/state/globals.svelte';
  import * as m from '$lib/i18n/messages';

  import 'vidstack/player/styles/default/theme.css';
  import 'vidstack/player/styles/default/layouts/video.css';

  // Vidstack ships empty server stubs under the "default" export condition;
  // static imports in SvelteKit resolve those stubs during SSR and never
  // re-run on the client. We must dynamically import on mount and wait for
  // registration to complete before rendering the custom elements.
  let elementsReady = $state(vidstackElementsRegistered);
  let playerRequested = $state(false);
  let playerVisualReady = $state(false);
  let playerVisualReadyKey = '';

  onMount(async () => {
    await preloadVideoPlayerElements();
    elementsReady = true;
  });

  type Variant = {
    url: string;
    quality: string;
    width: number;
    height: number;
    size: number;
  };

  type VidstackVideoSource = {
    src: string;
    type: 'video/mp4';
    width?: number;
    height?: number;
  };

  let {
    status,
    variants = [],
    thumbnailUrl = null,
    width = null,
    height = null,
    reasonCode = null,
    filename,
    autoLoop = false,
    fallbackImageUrl = null,
    onMediaError
  }: {
    status: VideoProcessingStatus;
    variants?: Variant[];
    thumbnailUrl?: string | null;
    width?: number | null;
    height?: number | null;
    reasonCode?: string | null;
    filename: string;
    autoLoop?: boolean;
    fallbackImageUrl?: string | null;
    onMediaError?: () => void;
  } = $props();

  const AUTO_LOOP_MAX_WIDTH = 480;
  const AUTO_LOOP_MAX_HEIGHT = 320;
  const POSTED_VIDEO_MAX_WIDTH = 640;
  const POSTED_VIDEO_MAX_HEIGHT = 640;
  const VIEWPORT_HEIGHT_BUDGET = 72;
  const WIDESCREEN_RATIO = 16 / 9;
  const NEAR_SQUARE_LANDSCAPE_MAX_RATIO = 1.5;

  // Existing processed videos can carry stale encoded dimensions. Once the
  // browser loads the media, prefer its intrinsic display size for the frame.
  let measuredMedia = $state<{ src: string; width: number; height: number } | null>(null);
  let failedAutoLoopSource = $state<string | null>(null);

  const sortedVariants = $derived.by(() => sortVariantsByDisplayHeight(variants));
  const highestVariant = $derived(sortedVariants[0] ?? null);
  const lightestVariant = $derived(sortedVariants[sortedVariants.length - 1] ?? null);
  const autoLoopVariant = $derived(lightestVariant ?? highestVariant);

  const sourceDimensions = $derived.by(() => {
    if (measuredMedia && sortedVariants.some((variant) => variant.url === measuredMedia?.src)) {
      return measuredMedia;
    }
    return {
      width: positiveDimension(width) ?? positiveDimension(highestVariant?.width) ?? 480,
      height: positiveDimension(height) ?? positiveDimension(highestVariant?.height) ?? 270
    };
  });

  const frameDimensions = $derived.by(() => {
    const w = sourceDimensions.width;
    const h = sourceDimensions.height;
    const ratio = w / h;

    if (
      status === 'COMPLETED' &&
      highestVariant &&
      !autoLoop &&
      ratio >= 1 &&
      ratio < NEAR_SQUARE_LANDSCAPE_MAX_RATIO
    ) {
      return {
        width: Math.round(h * WIDESCREEN_RATIO),
        height: h
      };
    }

    return { width: w, height: h };
  });

  const displaySize = $derived.by(() => {
    const w = frameDimensions.width;
    const h = frameDimensions.height;
    const maxWidth = autoLoop ? AUTO_LOOP_MAX_WIDTH : POSTED_VIDEO_MAX_WIDTH;
    const maxHeight = autoLoop ? AUTO_LOOP_MAX_HEIGHT : POSTED_VIDEO_MAX_HEIGHT;
    const scale = Math.min(maxWidth / w, maxHeight / h, 1);
    return {
      width: Math.round(w * scale),
      height: Math.round(h * scale)
    };
  });

  const fitMode = $derived.by(() => {
    if (status !== 'COMPLETED' || !highestVariant || autoLoop) return 'contain';
    return frameDimensions.width / frameDimensions.height >
      sourceDimensions.width / sourceDimensions.height
      ? 'cover'
      : 'contain';
  });

  const frameStyle = $derived.by(() => {
    const viewportWidthBudget = Number(
      ((displaySize.width / displaySize.height) * VIEWPORT_HEIGHT_BUDGET).toFixed(3)
    );
    return [
      `width: min(100%, ${displaySize.width}px)`,
      `width: min(100%, ${displaySize.width}px, ${viewportWidthBudget}svh)`,
      `aspect-ratio: ${displaySize.width} / ${displaySize.height}`
    ].join('; ');
  });

  // Vidstack auto-detects media type from URL extensions, but our stable asset
  // URLs have no extension (/assets/files/...). Give every portable MP4 variant
  // an explicit type and dimensions so the player can keep quality selection
  // automatic instead of forcing the heaviest file for every inline playback.
  const videoSources = $derived.by(() => videoSourcesForVariants(sortedVariants));
  const hasPosterBridge = $derived(
    status === 'COMPLETED' && highestVariant && !autoLoop && Boolean(thumbnailUrl)
  );
  const showAutoLoopFallback = $derived(
    Boolean(
      autoLoop &&
      fallbackImageUrl &&
      autoLoopVariant &&
      failedAutoLoopSource === autoLoopVariant.url
    )
  );

  const failureMessage = $derived.by(() => {
    switch (reasonCode) {
      case 'original_missing':
        return m['media.video_original_missing']();
      case 'processing_failed':
        return m['media.video_processing_failed_retry']();
      default:
        return null;
    }
  });

  $effect(() => {
    const nextKey = [
      status,
      highestVariant?.url ?? '',
      thumbnailUrl ?? '',
      String(autoLoop)
    ].join('|');
    if (nextKey === playerVisualReadyKey) return;
    playerVisualReadyKey = nextKey;
    playerRequested = false;
    playerVisualReady = false;
  });

  function primePlayerElements() {
    void preloadVideoPlayerElements()
      .then(() => {
        elementsReady = true;
      })
      .catch(() => {
        // The poster card remains usable even if the enhancement fails.
      });
  }

  function activatePlayer() {
    playerRequested = true;
    playerVisualReady = false;
    primePlayerElements();
  }

  function positiveDimension(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  function sortVariantsByDisplayHeight(items: Variant[]): Variant[] {
    return [...items].sort((a, b) => {
      const heightDelta = (positiveDimension(b.height) ?? 0) - (positiveDimension(a.height) ?? 0);
      if (heightDelta !== 0) return heightDelta;
      const widthDelta = (positiveDimension(b.width) ?? 0) - (positiveDimension(a.width) ?? 0);
      if (widthDelta !== 0) return widthDelta;
      return (positiveDimension(b.size) ?? 0) - (positiveDimension(a.size) ?? 0);
    });
  }

  function videoSourcesForVariants(items: Variant[]): VidstackVideoSource[] {
    return items
      .filter((variant) => variant.url)
      .map((variant) => ({
        src: variant.url,
        type: 'video/mp4',
        width: positiveDimension(variant.width) ?? undefined,
        height: positiveDimension(variant.height) ?? undefined
      }));
  }

  function syncVideoDimensions(video: HTMLVideoElement) {
    if (!highestVariant) return;
    const videoWidth = positiveDimension(video.videoWidth);
    const videoHeight = positiveDimension(video.videoHeight);
    if (!videoWidth || !videoHeight) return;
    measuredMedia = {
      src: video.currentSrc || video.src || autoLoopVariant?.url || highestVariant.url,
      width: videoWidth,
      height: videoHeight
    };
  }

  function handleVideoMetadata(event: Event) {
    if (event.currentTarget instanceof HTMLVideoElement) {
      syncVideoDimensions(event.currentTarget);
    }
  }

  function handleAutoLoopError() {
    if (!autoLoopVariant || failedAutoLoopSource === autoLoopVariant.url) return;
    failedAutoLoopSource = autoLoopVariant.url;
    onMediaError?.();
  }

  function observePlayerVideo(node: HTMLElement) {
    let video: HTMLVideoElement | null = null;
    let removeVideoListener: (() => void) | null = null;

    function bindVideo() {
      const nextVideo = node.querySelector('video');
      if (nextVideo === video) return;

      removeVideoListener?.();
      video = nextVideo;
      removeVideoListener = null;

      if (!video) return;
      const handleMetadata = () => syncVideoDimensions(video!);
      video.addEventListener('loadedmetadata', handleMetadata);
      removeVideoListener = () => video?.removeEventListener('loadedmetadata', handleMetadata);
      syncVideoDimensions(video);
    }

    bindVideo();
    const observer = new MutationObserver(bindVideo);
    observer.observe(node, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      removeVideoListener?.();
    };
  }

  // Intercept Vidstack's fullscreen request — the <media-player> lives inside
  // virtua's virtualized list, so native fullscreen would cause virtua to
  // unmount the DOM node. Instead, open our CSS overlay outside the list.
  function interceptFullscreenRequest(node: HTMLElement) {
    function handleFullscreenRequest(e: Event) {
      e.preventDefault();
      if (!highestVariant) return;

      const video = node.querySelector('video');
      if (video) video.pause();

      fullscreenVideo.open(highestVariant.url, thumbnailUrl ?? null, video?.currentTime ?? 0);

      // Request native fullscreen on the overlay after Svelte renders it.
      // tick() preserves the user activation from this click event.
      tick().then(() => {
        document
          .querySelector('.fullscreen-overlay')
          ?.requestFullscreen()
          .catch(() => {});
      });
    }

    // Use capture phase so we intercept before Vidstack's internal handler.
    node.addEventListener('media-enter-fullscreen-request', handleFullscreenRequest, true);
    return () => {
      node.removeEventListener('media-enter-fullscreen-request', handleFullscreenRequest, true);
    };
  }

  function enableAutoQualitySelection(node: HTMLElement) {
    const player = node as HTMLElement & {
      qualities?: { autoSelect?: () => void };
    };
    let cancelled = false;

    async function selectAutomatically() {
      await tick();
      if (cancelled) return;
      try {
        player.qualities?.autoSelect?.();
      } catch {
        // Quality auto-selection is an enhancement. Playback must continue if
        // the custom element has not exposed the quality controller yet.
      }
    }

    void selectAutomatically();
    node.addEventListener('can-play', selectAutomatically, { once: true });
    node.addEventListener('provider-change', selectAutomatically, { once: true });

    return () => {
      cancelled = true;
      node.removeEventListener('can-play', selectAutomatically);
      node.removeEventListener('provider-change', selectAutomatically);
    };
  }

  function attachMediaPlayer(node: HTMLElement) {
    const cleanupFullscreen = interceptFullscreenRequest(node);
    const cleanupVideoObserver = observePlayerVideo(node);
    const cleanupQualitySelection = enableAutoQualitySelection(node);
    const markReady = () => {
      playerVisualReady = true;
    };
    const fallbackReadyTimer = window.setTimeout(markReady, 900);

    node.addEventListener('can-play', markReady, { once: true });
    node.addEventListener('loaded-metadata', markReady, { once: true });

    return () => {
      window.clearTimeout(fallbackReadyTimer);
      node.removeEventListener('can-play', markReady);
      node.removeEventListener('loaded-metadata', markReady);
      cleanupFullscreen();
      cleanupVideoObserver();
      cleanupQualitySelection();
    };
  }
</script>

{#if status === 'COMPLETED' && autoLoopVariant && autoLoop}
  <!-- Converted GIFs use a native <video> for reliable autoplay + loop behavior. -->
  <div class="embed-frame" style={frameStyle}>
    {#if showAutoLoopFallback}
      <img
        src={fallbackImageUrl!}
        alt={filename}
        loading="lazy"
        class="block h-full w-full object-contain"
      />
    {:else}
      <video
        autoplay
        loop
        muted
        playsinline
        poster={thumbnailUrl ?? fallbackImageUrl ?? undefined}
        data-autoloop
        onerror={handleAutoLoopError}
        onloadedmetadata={handleVideoMetadata}
        class="block h-full w-full object-contain"
      >
        <source src={autoLoopVariant.url} type="video/mp4" onerror={handleAutoLoopError} />
      </video>
    {/if}
  </div>
{:else if status === 'COMPLETED' && highestVariant && playerRequested && elementsReady}
  <div class="embed-frame video-player-frame" style={frameStyle}>
    {#if hasPosterBridge}
      <img
        src={thumbnailUrl!}
        alt=""
        aria-hidden="true"
        loading="eager"
        decoding="async"
        fetchpriority="high"
        onerror={onMediaError}
        class={['video-poster-bridge pointer-events-none', playerVisualReady && 'opacity-0']}
      />
    {/if}
    <media-player
      {@attach attachMediaPlayer}
      src={videoSources}
      playsinline
      autoplay
      onerror={onMediaError}
      data-fit={fitMode}
      class="block h-full w-full"
    >
      <media-provider>
        {#if thumbnailUrl}
          <media-poster
            class="vds-poster"
            src={thumbnailUrl}
            alt={filename}
            onerror={onMediaError}
          ></media-poster>
        {/if}
      </media-provider>
      <media-video-layout></media-video-layout>
    </media-player>
  </div>
{:else if status === 'COMPLETED' && highestVariant}
  <button
    type="button"
    class="embed-frame video-player-poster-shell video-preview-button"
    style={frameStyle}
    aria-label={m['media.video_alt']()}
    title={filename}
    data-testid="video-player-poster-shell"
    aria-busy={playerRequested && !elementsReady}
    onpointerenter={primePlayerElements}
    onfocus={primePlayerElements}
    onclick={activatePlayer}
  >
    {#if thumbnailUrl}
      <img
        src={thumbnailUrl}
        alt={filename}
        loading="eager"
        decoding="async"
        fetchpriority="high"
        onerror={onMediaError}
        class="h-full w-full object-contain"
      />
      <span class="video-preview-play" aria-hidden="true">
        {#if playerRequested && !elementsReady}
          <span class="h-5 w-5 animate-spin rounded-full border-2 border-white/70 border-t-transparent"></span>
        {:else}
          <span class="iconify text-3xl uil--play"></span>
        {/if}
      </span>
    {:else}
      <span class="iconify text-lg text-muted uil--video"></span>
      <span class="max-w-full truncate text-sm text-muted">{filename}</span>
    {/if}
  </button>
{:else if status === 'PENDING' || status === 'PROCESSING'}
  <div class="embed-frame flex items-center gap-3 px-4 py-3" style={frameStyle}>
    <div class="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-transparent"></div>
    <div class="text-sm text-muted">
      {status === 'PENDING' ? m['media.video_queued']() : m['media.video_processing']()}
    </div>
  </div>
{:else if status === 'FAILED'}
  <div class="embed-frame flex items-center gap-3 px-4 py-3" style={frameStyle}>
    <span class="iconify text-lg text-red-400 uil--exclamation-triangle"></span>
    <div class="text-sm text-muted">
      {m['media.video_processing_failed']()}
      {#if failureMessage}
        <span class="block text-xs text-muted/70">{failureMessage}</span>
      {/if}
    </div>
  </div>
{:else}
  <div class="embed-frame flex items-center gap-2 px-3 py-2">
    <span class="iconify text-lg text-muted uil--video"></span>
    <span class="text-sm">{filename}</span>
  </div>
{/if}

<style>
  /* Hide menus from Vidstack's default layout — not useful for embedded chat videos. */
  :global(media-player .vds-settings-menu),
  :global(media-player .vds-chapters-menu) {
    display: none !important;
  }

  :global(media-player[data-fit='cover'] media-provider),
  :global(media-player[data-fit='cover'] [data-media-provider]),
  :global(media-player[data-fit='cover'] video),
  :global(media-player[data-fit='cover'] .vds-poster),
  :global(media-player[data-fit='cover'] .vds-poster img) {
    height: 100%;
    width: 100%;
  }

  :global(media-player[data-fit='cover'] video),
  :global(media-player[data-fit='cover'] .vds-poster),
  :global(media-player[data-fit='cover'] .vds-poster img) {
    object-fit: cover;
    object-position: top center;
  }

  .video-player-frame {
    position: relative;
    overflow: hidden;
  }

  .video-poster-bridge {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: block;
    height: 100%;
    width: 100%;
    object-fit: contain;
    background: var(--color-background, #111);
    transition: opacity 120ms ease;
  }

  .video-player-poster-shell {
    display: flex;
    position: relative;
    min-width: 0;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    overflow: hidden;
  }

  .video-preview-button {
    appearance: none;
    cursor: pointer;
    padding: 0;
    color: white;
    transition:
      border-color 140ms ease,
      filter 140ms ease,
      transform 140ms ease;
  }

  .video-preview-button:hover,
  .video-preview-button:focus-visible {
    border-color: color-mix(in srgb, var(--color-primary, #f97316) 72%, white 18%);
    filter: brightness(1.04);
  }

  .video-preview-button:active {
    transform: scale(0.995);
  }

  .video-preview-play {
    position: absolute;
    inset: 50% auto auto 50%;
    display: flex;
    height: 3.5rem;
    width: 3.5rem;
    transform: translate(-50%, -50%);
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: rgb(0 0 0 / 0.52);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.16);
    backdrop-filter: blur(6px);
  }

  @media (prefers-reduced-motion: reduce) {
    .video-preview-button {
      transition: none;
    }
  }
</style>
