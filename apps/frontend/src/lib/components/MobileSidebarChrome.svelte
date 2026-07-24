<script lang="ts">
  import type { Snippet } from 'svelte';
  import ServerGutter from '$lib/ServerGutter.svelte';
  import { mobileNavigationSwipe } from '$lib/hooks/useMobileNavigationSwipe.svelte';
  import { SIDEBAR_PANEL_WIDTH_PX, sidebarSwipe } from '$lib/hooks/useSidebarSwipe.svelte';
  import * as m from '$lib/i18n/messages';
  import { sidebarNav } from '$lib/state/globals.svelte';

  let { children }: { children?: Snippet } = $props();

  const progress = $derived(sidebarNav.isMobile ? sidebarNav.progress : 1);
  const dragging = $derived(sidebarNav.dragOffset !== null);
  const mobileClosed = $derived(sidebarNav.isMobile && progress === 0 && !dragging);
  const tx = $derived((progress - 1) * SIDEBAR_PANEL_WIDTH_PX);
  const mobileTransform = $derived(
    sidebarNav.isMobile ? `translate3d(${tx}px, 0, 0)` : undefined
  );
</script>

{#if sidebarNav.isMobile}
  <button
    type="button"
    use:sidebarSwipe
    data-app-sidebar="true"
    data-testid="mobile-sidebar-backdrop"
    class={[
      'fixed inset-0 top-11 z-40 touch-none bg-black/50 md:hidden',
      !dragging && 'sidebar-mobile-backdrop-anim',
      mobileClosed && 'pointer-events-none'
    ]}
    style:opacity={progress}
    disabled={mobileClosed}
    tabindex={mobileClosed ? -1 : 0}
    aria-hidden={mobileClosed}
    onclick={() => sidebarNav.close()}
    aria-label={m['common.close_sidebar']()}
  ></button>
{/if}

<div
  use:mobileNavigationSwipe
  data-testid="mobile-navigation-swipe-region"
  class="mobile-navigation-swipe-region flex min-h-0 flex-1 flex-row"
>
  <div
    use:sidebarSwipe
    data-app-sidebar="true"
    data-testid="mobile-sidebar-panel"
    class={[
      'z-50 min-h-0 flex-col self-stretch bg-background',
      'max-md:fixed max-md:top-11 max-md:bottom-0 max-md:left-0 max-md:w-17 max-md:touch-pan-y',
      // Mobile: always rendered so we can animate transform.
      // Desktop: hide entirely when closed (no overlay; layout reflows).
      sidebarNav.isMobile ? 'flex' : sidebarNav.isOpen ? 'flex' : 'hidden',
      // Mobile-only: hide via `visibility: hidden` after the close
      // transition, so Playwright / accessibility tooling correctly see
      // the sidebar as not-visible while the slide-out animation works.
      mobileClosed && 'sidebar-mobile-closed',
      !dragging && 'sidebar-mobile-anim'
    ]}
    style:transform={mobileTransform}
  >
    <ServerGutter />
  </div>

  {@render children?.()}
</div>

<style>
  :global(.mobile-navigation-swipe-region) {
    --mobile-navigation-safe-left: env(safe-area-inset-left, 0px);
    --mobile-navigation-safe-right: env(safe-area-inset-right, 0px);
    --mobile-navigation-safe-bottom: env(safe-area-inset-bottom, 0px);
  }

  /*
		Mobile sidebar animation — slide via transform, plus a delayed visibility
		swap so the off-screen panel is reported as `visibility: hidden` (not just
		visually hidden by transform) once the close animation finishes. This
		matters for accessibility tooling and Playwright's `toBeVisible()`.

		Open  → transform animates 360ms, visibility flips to `visible` immediately.
		Close → transform animates 360ms, visibility flips to `hidden` AFTER 360ms.
	*/
  @media (max-width: 767px) {
    :global(.sidebar-mobile-backdrop-anim) {
      transition: opacity 320ms ease-out;
    }
    :global(.sidebar-mobile-anim) {
      visibility: visible;
      backface-visibility: hidden;
      transition:
        transform 360ms cubic-bezier(0.22, 1, 0.36, 1),
        visibility 0s linear 0s;
      will-change: transform;
    }
    :global(.sidebar-mobile-anim.sidebar-mobile-closed) {
      visibility: hidden;
      transition:
        transform 360ms cubic-bezier(0.22, 1, 0.36, 1),
        visibility 0s linear 360ms;
    }
  }

  @media (max-width: 767px) and (prefers-reduced-motion: reduce) {
    :global(.sidebar-mobile-backdrop-anim),
    :global(.sidebar-mobile-anim),
    :global(.sidebar-mobile-anim.sidebar-mobile-closed) {
      transition: none;
    }
  }
</style>
