<!--
@component

The **Server Sidebar** — wider sidebar to the right of the Server Gutter,
scoped to a single server. Owns the per-server pane's chrome: positioning,
mobile slide-in/-out, resize handle, and the current-user bar pinned to the
bottom. The actual contents (server banner + room list, settings nav, admin
nav, …) are passed in via the `children` snippet by `Chrome.svelte`.

See the "UI" section of `docs/GLOSSARY.md`.
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { SIDEBAR_PANEL_WIDTH_PX, sidebarSwipe } from '$lib/hooks/useSidebarSwipe.svelte';
  import { getServerSidebarMaxWidth } from '$lib/layout/serverSidebarSizing';
  import { sidebarNav } from '$lib/state/globals.svelte';
  import { serverSidebarWidth } from '$lib/state/serverSidebarWidth.svelte';
  import { SERVER_SIDEBAR_MIN_WIDTH } from '$lib/storage/serverSidebarWidth';
  import * as m from '$lib/i18n/messages';
  import CurrentUserBar from './CurrentUserBar.svelte';
  import ResizeHandle from './ResizeHandle.svelte';

  let {
    children,
    width,
    mobileWidth = 'max-md:w-64'
  }: {
    children: Snippet;
    /** Optional Tailwind class to lock the desktop width (e.g. "md:w-56"). When
     *  omitted, the sidebar uses the user's persisted resizable width and shows
     *  a drag handle. */
    width?: string;
    mobileWidth?: string;
  } = $props();

  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  let hasCoarsePointer = $state(false);

  // On mobile the panel slides as a single unit with the Server Gutter — both
  // apply the same translateX driven by `sidebarNav.progress`. On desktop the
  // sidebar toggles via `hidden`/`flex` (no overlay; layout reflows).
  const tx = $derived(sidebarNav.isMobile ? (sidebarNav.progress - 1) * SIDEBAR_PANEL_WIDTH_PX : 0);
  const dragging = $derived(sidebarNav.dragOffset !== null);
  const mobileClosed = $derived(sidebarNav.isMobile && sidebarNav.progress === 0 && !dragging);
  const resizable = $derived(!width);
  const effectiveMaxWidth = $derived(
    getServerSidebarMaxWidth({
      width: viewportWidth,
      height: viewportHeight,
      hasCoarsePointer
    })
  );
  const renderedWidth = $derived(Math.min(serverSidebarWidth.value, effectiveMaxWidth));

  onMount(() => {
    const coarsePointerQuery = window.matchMedia('(any-pointer: coarse)');

    const syncViewport = () => {
      viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      hasCoarsePointer = coarsePointerQuery.matches;
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);

    if (typeof coarsePointerQuery.addEventListener === 'function') {
      coarsePointerQuery.addEventListener('change', syncViewport);
    } else {
      coarsePointerQuery.addListener(syncViewport);
    }

    return () => {
      window.removeEventListener('resize', syncViewport);
      if (typeof coarsePointerQuery.removeEventListener === 'function') {
        coarsePointerQuery.removeEventListener('change', syncViewport);
      } else {
        coarsePointerQuery.removeListener(syncViewport);
      }
    };
  });
</script>

<div
  use:sidebarSwipe
  data-app-sidebar="true"
  data-testid="server-sidebar"
  class={[
    'server-sidebar relative z-50 flex min-w-0 flex-col overflow-hidden border-r border-border bg-background',
    width,
    mobileWidth,
    'md:flex-initial',
    // Mobile: fixed overlay positioned after the Server Gutter (~68px); touch-pan-y so
    // vertical scroll inside the panel still works while horizontal pans go to
    // the sidebar swipe action.
    'max-md:fixed max-md:top-11 max-md:bottom-0 max-md:left-17 max-md:touch-pan-y',
    // Mobile: always rendered so the slide animation is visible.
    // Desktop: hide entirely when closed.
    sidebarNav.isMobile ? '' : sidebarNav.isOpen ? '' : 'hidden',
    // Mobile-only: become `visibility: hidden` once the slide-out animation
    // completes (see .sidebar-mobile-anim styles in MobileSidebarChrome.svelte) so
    // accessibility tools and Playwright `toBeVisible()` agree the panel is
    // hidden, not just translated off-screen.
    mobileClosed && 'sidebar-mobile-closed',
    !dragging && 'sidebar-mobile-anim',
    resizable && 'server-sidebar--resizable'
  ]}
  style:--server-sidebar-width={resizable ? `${renderedWidth}px` : undefined}
  style:transform={sidebarNav.isMobile ? `translateX(${tx}px)` : undefined}
>
  {@render children()}
  <CurrentUserBar />
  {#if resizable && !sidebarNav.isMobile}
    <ResizeHandle
      width={renderedWidth}
      min={SERVER_SIDEBAR_MIN_WIDTH}
      max={effectiveMaxWidth}
      onResize={(w) => serverSidebarWidth.set(w)}
      onReset={() => serverSidebarWidth.reset()}
      label={m['ui.resize_handle.resize_sidebar']()}
    />
  {/if}
</div>

<style>
  @media (min-width: 768px) {
    .server-sidebar--resizable {
      width: var(--server-sidebar-width);
    }
  }

  /* Prevent a pre-hydration flash of the persisted 480 px desktop width on a
     Fold-like touch viewport. Runtime sizing uses the same geometry contract. */
  @media (min-width: 768px) and (max-width: 1280px) and (min-aspect-ratio: 4/5) and
    (max-aspect-ratio: 5/4) and (any-pointer: coarse) {
    .server-sidebar--resizable {
      max-width: clamp(16rem, 38vw, 22.5rem);
    }
  }
</style>
