<!--
@component

Displays a link preview as a rich glass card: the site's presentation image
leads when the server found one, followed by site name, title and description.
YouTube URLs render a YouTubeEmbed instead. Supports dismiss (composer) and
delete (posted message) actions.

The card renders the same frame while the server metadata is still in flight,
so the composer shows the link's origin immediately and the fetched title and
description land in place instead of replacing a differently sized skeleton.

**Props:**
- `preview` - The LinkPreview data to display
- `pendingUrl` - Render the loading state for this URL instead of `preview`
- `onDismiss` - Callback when user dismisses the preview (composer mode)
- `showDismiss` - Whether to show the dismiss button (default: true)
- `canDelete` - Whether the user can delete this preview (default: false)
- `roomId` - Room ID (required when canDelete is true, for confirmation dialog)
- `eventId` - Message body ID (required when canDelete is true, for confirmation dialog)
-->
<script lang="ts" module>
  import { LinkPreviewViewDocument } from '$lib/render/types';

  export const LinkPreviewViewData = LinkPreviewViewDocument;
</script>

<script lang="ts">
  import type { LinkPreviewView } from '$lib/render/types';
  import type { RenderType } from '$lib/render/data';
  import { useRenderData } from '$lib/render/data';
  import { describeLinkOrigin } from '$lib/linkPreview';
  import SkeletonImg from '$lib/ui/SkeletonImg.svelte';
  import { pushState } from '$app/navigation';
  import * as m from '$lib/i18n/messages';
  import ContextMenu from '$lib/ui/ContextMenu.svelte';
  import { toast } from '$lib/ui/toast';
  import YouTubeEmbed from './YouTubeEmbed.svelte';

  let {
    preview: rawPreview,
    pendingUrl,
    onDismiss,
    showDismiss = true,
    canDelete = false,
    roomId,
    eventId
  }: {
    preview?: RenderType<typeof LinkPreviewViewData> | LinkPreviewView;
    pendingUrl?: string;
    onDismiss?: () => void;
    showDismiss?: boolean;
    canDelete?: boolean;
    roomId?: string;
    eventId?: string;
  } = $props();

  const preview = $derived(
    useRenderData(
      LinkPreviewViewData,
      rawPreview as RenderType<typeof LinkPreviewViewData> | undefined
    )
  );

  const url = $derived(preview?.url ?? pendingUrl ?? '');
  const pending = $derived(!preview && Boolean(pendingUrl));
  const origin = $derived(describeLinkOrigin(url));
  const imageUrl = $derived(preview?.imageUrl ?? '');
  const siteName = $derived(preview?.siteName || origin.host);
  const title = $derived(preview?.title ?? '');
  const description = $derived(preview?.description ?? '');

  /**
   * A wide presentation image leads the card; a small or square one — usually
   * a logo — sits beside the text instead, where covering a 40:21 banner
   * would crop it into noise. The image is probed off-screen, so the layout
   * is decided once and the card never re-flows around a broken image.
   */
  let imageLayout = $state<'hero' | 'thumb' | 'none'>('none');
  $effect(() => {
    imageLayout = 'none';
    if (!imageUrl) return;
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      const wide = probe.naturalWidth >= 320 && probe.naturalWidth >= probe.naturalHeight * 1.2;
      imageLayout = wide ? 'hero' : 'thumb';
    };
    probe.src = imageUrl;
    return () => {
      cancelled = true;
    };
  });

  // Context menu state
  let contextMenuPos = $state<{ x: number; y: number } | null>(null);

  function openDeleteConfirmation() {
    if (!roomId || !eventId) return;
    pushState('', {
      modal: {
        type: 'deleteLinkPreview',
        roomId,
        eventId,
        previewUrl: url
      }
    });
  }

  function handleContextMenu(e: MouseEvent) {
    if (!canDelete) return;
    e.preventDefault();
    e.stopPropagation();
    contextMenuPos = { x: e.clientX, y: e.clientY };
  }

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(m['preview.copy_url_success']());
    } catch {
      toast.error(m['preview.copy_url_failed']());
    }
    contextMenuPos = null;
  }

  function handleOpenLink() {
    window.open(url, '_blank', 'noopener,noreferrer');
    contextMenuPos = null;
  }

  function handleDeleteFromMenu() {
    openDeleteConfirmation();
    contextMenuPos = null;
  }
</script>

{#if preview?.embedType === 'youtube' && preview.embedId}
  <YouTubeEmbed
    videoId={preview.embedId}
    url={preview.url}
    {onDismiss}
    {showDismiss}
    {canDelete}
    {roomId}
    {eventId}
  />
{:else if pending || imageUrl || title || description || preview?.siteName}
  <!-- eslint-disable svelte/no-navigation-without-resolve -- the preview URL is a third-party URL, not an internal SvelteKit route -->
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    data-testid={pending ? 'link-preview-pending' : 'link-preview-card'}
    class="preview-card group/preview"
    oncontextmenu={handleContextMenu}
  >
    {#if imageLayout === 'hero'}
      <span class="preview-hero">
        <SkeletonImg src={imageUrl} alt="" class="preview-hero-img" decoding="async" />
      </span>
    {/if}
    <span class="preview-body">
      {#if imageLayout === 'thumb'}
        <SkeletonImg src={imageUrl} alt="" class="preview-thumb" decoding="async" />
      {:else if imageLayout !== 'hero'}
        <span class="preview-monogram" aria-hidden="true">{origin.monogram}</span>
      {/if}
      <span class="preview-text">
        <span class="preview-site">{siteName}</span>
        {#if pending}
          <span class="preview-path">{origin.path || origin.host}</span>
          <span class="preview-shimmer preview-shimmer-title" aria-hidden="true"></span>
          <span class="preview-shimmer preview-shimmer-text" aria-hidden="true"></span>
        {:else}
          {#if title}
            <span class="preview-title">{title}</span>
          {/if}
          {#if description}
            <span class="preview-description">{description}</span>
          {/if}
        {/if}
      </span>
    </span>
    {#if showDismiss && onDismiss}
      <button
        type="button"
        onclick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss?.();
        }}
        class="embed-control-button md:group-hover/preview:opacity-100"
        aria-label={m['preview.dismiss']()}
      >
        <span class="iconify text-sm uil--times"></span>
      </button>
    {:else if canDelete}
      <button
        type="button"
        onclick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openDeleteConfirmation();
        }}
        class="embed-control-button md:group-hover/preview:opacity-100"
        aria-label={m['preview.delete']()}
      >
        <span class="iconify text-sm uil--times"></span>
      </button>
    {/if}
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->

  <!-- Context menu (posted message mode only) -->
  {#if contextMenuPos}
    <ContextMenu position={contextMenuPos} onclose={() => (contextMenuPos = null)}>
      <div class="menu-section">
        <nav class="sidebar-nav">
          <button class="sidebar-item" onclick={handleOpenLink} role="menuitem">
            <span class="sidebar-icon iconify uil--external-link-alt"></span>
            {m['preview.open_link']()}
          </button>
          <button class="sidebar-item" onclick={handleCopyUrl} role="menuitem">
            <span class="sidebar-icon iconify uil--copy"></span>
            {m['preview.copy_url']()}
          </button>
          {#if canDelete}
            <button
              class="sidebar-item text-danger hover:text-danger"
              onclick={handleDeleteFromMenu}
              role="menuitem"
            >
              <span class="sidebar-icon iconify uil--trash-alt"></span>
              {m['preview.delete']()}
            </button>
          {/if}
        </nav>
      </div>
    </ContextMenu>
  {/if}
{/if}

<style>
  /* A rich embed inside one liquid-glass frame: the presentation image leads
     when the site offers one, and the frame is identical while loading, so
     nothing reflows when the fetched metadata lands. */
  .preview-card {
    container-type: inline-size;
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 27rem;
    margin-block: 0.375rem;
    border-radius: 1rem;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    background-color: var(--liquid-glass-solid);
    box-shadow:
      inset 0 0 0 1px var(--liquid-glass-border),
      inset 0 1px 0 var(--liquid-glass-edge-light),
      inset 0 -1px 0 var(--liquid-glass-edge-shadow),
      0 1px 2px var(--liquid-glass-key-shadow),
      0 10px 24px -20px var(--liquid-glass-ambient-shadow);
    transition: box-shadow 170ms ease;
  }

  @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    .preview-card {
      background-color: var(--liquid-glass-translucent);
      -webkit-backdrop-filter: blur(16px) saturate(100%);
      backdrop-filter: blur(16px) saturate(100%);
    }
  }

  .preview-card:hover,
  .preview-card:focus-visible {
    box-shadow:
      inset 0 0 0 1px var(--liquid-glass-border-strong),
      inset 0 1px 0 var(--liquid-glass-edge-light),
      0 2px 4px var(--liquid-glass-key-shadow),
      0 16px 30px -22px var(--liquid-glass-ambient-shadow);
  }

  .preview-hero {
    display: block;
    width: 100%;
    aspect-ratio: 40 / 21;
    max-height: 14rem;
    overflow: hidden;
    box-shadow: inset 0 -1px 0 var(--liquid-glass-border);
  }

  .preview-card :global(.preview-hero-img) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .preview-card:hover :global(.preview-hero-img),
  .preview-card:focus-visible :global(.preview-hero-img) {
    transform: scale(1.02);
  }

  .preview-body {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.875rem 0.75rem;
  }

  /* Fallback tile when the site publishes no image: the link colour on glass,
     nothing else, so the palette stays surface + orange. */
  .preview-monogram {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    border-radius: 0.75rem;
    font-size: 1.375rem;
    font-weight: 600;
    line-height: 1;
    color: var(--color-link, currentColor);
    background-color: color-mix(in srgb, var(--color-link, currentColor) 12%, transparent);
    box-shadow: inset 0 0 0 1px var(--liquid-glass-border);
  }

  .preview-card :global(.preview-thumb) {
    flex: none;
    width: 3rem;
    height: 3rem;
    border-radius: 0.75rem;
    object-fit: cover;
    box-shadow: inset 0 0 0 1px var(--liquid-glass-border);
  }

  .preview-text {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 0.125rem;
    justify-content: center;
  }

  .preview-site {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-link, currentColor);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-title {
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--color-text-top, currentColor);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .preview-description,
  .preview-path {
    font-size: 0.75rem;
    line-height: 1.35;
    color: var(--color-muted, currentColor);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .preview-path {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }

  .preview-shimmer {
    height: 0.625rem;
    margin-top: 0.25rem;
    border-radius: 0.3125rem;
    background: linear-gradient(
      90deg,
      var(--liquid-glass-busy),
      color-mix(in srgb, var(--liquid-glass-busy) 35%, transparent),
      var(--liquid-glass-busy)
    );
    background-size: 200% 100%;
    animation: preview-shimmer 1.1s ease-in-out infinite;
  }

  .preview-shimmer-title {
    width: 72%;
  }

  .preview-shimmer-text {
    width: 45%;
  }

  @keyframes preview-shimmer {
    from {
      background-position: 150% 0;
    }
    to {
      background-position: -50% 0;
    }
  }

  /* Narrow bubbles: shorter hero, smaller tile, one description line.
     The query targets descendants; a container never matches itself. */
  @container (max-width: 20rem) {
    .preview-hero {
      max-height: 10rem;
    }

    .preview-monogram {
      width: 2.5rem;
      height: 2.5rem;
      font-size: 1.125rem;
    }

    .preview-description {
      -webkit-line-clamp: 1;
      line-clamp: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .preview-card,
    .preview-card :global(.preview-hero-img) {
      transition: none;
    }

    .preview-card:hover :global(.preview-hero-img),
    .preview-card:focus-visible :global(.preview-hero-img) {
      transform: none;
    }

    .preview-shimmer {
      animation: none;
    }
  }
</style>
