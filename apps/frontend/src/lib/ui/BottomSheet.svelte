<script lang="ts">
  import * as m from '$lib/i18n/messages';
  import type { Snippet } from 'svelte';
  import { panGesture } from '$lib/hooks/panGesture.svelte';
  import { MOTION_DURATION, motionDuration } from '$lib/ui/motion.svelte';

  let {
    children,
    visible = $bindable(false),
    ariaLabel,
    dismissOnExternalInteraction = true,
    onclose
  }: {
    visible?: boolean;
    children: Snippet;
    /** Accessible name for the native dialog surface. */
    ariaLabel?: string;
    dismissOnExternalInteraction?: boolean;
    onclose?: () => void;
  } = $props();

  let dialogEl: HTMLDialogElement | undefined;
  let contentEl: HTMLElement | undefined;
  let closing = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let dragging = $state(false);
  let dragOffsetY = $state(0);
  // Tracks whether the most recent pointer/touch press landed inside the sheet content.
  // Snapshotting at press start (rather than reading the click event's target /
  // coordinates) sidesteps mobile touch-to-click synthesis races where the
  // virtual keyboard appears between touchstart and click — re-positioning the
  // dialog and skewing both `e.target` and `e.clientY` by the time click fires.
  let pointerDownInsideContent = false;

  // Threshold past which a release commits to closing (in px of drag, relative
  // to the sheet's own height).
  const DRAG_CLOSE_FRACTION = 0.5;
  // Downward fling velocity (px/ms) that always closes regardless of distance.
  const FLING_CLOSE_VELOCITY = 0.5;

  function syncSheetVisibility(node: HTMLDialogElement) {
    dialogEl = node;
    if (visible) {
      closing = false;
      if (!node.open) node.showModal();
    } else if (node.open && !closing) {
      node.close();
    }
  }

  function registerContent(node: HTMLElement) {
    contentEl = node;
  }

  function trackVisualViewport(node: HTMLDialogElement) {
    const viewport = window.visualViewport;

    function updateBounds() {
      const top = Math.max(0, viewport?.offsetTop ?? 0);
      const height = Math.max(0, viewport?.height ?? window.innerHeight);
      node.style.top = `${top}px`;
      node.style.height = `${height}px`;
      node.style.maxHeight = `${height}px`;
    }

    viewport?.addEventListener('resize', updateBounds);
    viewport?.addEventListener('scroll', updateBounds);
    viewport?.addEventListener('scrollend', updateBounds);
    window.addEventListener('resize', updateBounds);
    updateBounds();

    return () => {
      viewport?.removeEventListener('resize', updateBounds);
      viewport?.removeEventListener('scroll', updateBounds);
      viewport?.removeEventListener('scrollend', updateBounds);
      window.removeEventListener('resize', updateBounds);
    };
  }

  function rememberPressTarget(target: EventTarget | null) {
    const content = contentEl;
    pointerDownInsideContent = !!content && target instanceof Node && content.contains(target);
  }

  function handleNativeClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }

    // A persistent sheet is closed only by an explicit application action
    // (handle, swipe, selection, or parent state). Some WebKit/iOS close
    // requests bypass the event ordering used by backdrop/focus heuristics.
    // If the user agent closes the native dialog while the bound state is
    // still visible and no explicit close is running, restore it.
    if (!dismissOnExternalInteraction && visible && !closing) {
      const dialog = dialogEl;
      queueMicrotask(() => {
        if (visible && dialog === dialogEl && dialog?.isConnected && !dialog.open) {
          dialog.showModal();
        }
      });
      return;
    }

    visible = false;
    closing = false;
    dragging = false;
    dragOffsetY = 0;
    onclose?.();
  }

  function close() {
    if (!dialogEl?.open || closing) return;
    closing = true;
    const duration = motionDuration(MOTION_DURATION.expressive);
    if (duration === 0) {
      dialogEl?.close();
      return;
    }
    closeTimer = setTimeout(() => {
      closeTimer = null;
      dialogEl?.close();
    }, duration);
  }
</script>

<dialog
  {@attach syncSheetVisibility}
  {@attach trackVisualViewport}
  closedby={dismissOnExternalInteraction ? 'closerequest' : 'none'}
  onclose={handleNativeClose}
  oncancel={(e) => {
    e.preventDefault();
    if (!dismissOnExternalInteraction) return;
    // On Android Chrome, the virtual keyboard appearance fires a spurious
    // cancel event on the dialog. If the most recent pointerdown landed inside
    // the sheet content (e.g. the user just tapped an input), this cancel is
    // the keyboard race — not a real dismiss intent. The focus check below
    // isn't enough on its own because the cancel arrives before focus has
    // transferred to the tapped input.
    if (pointerDownInsideContent) return;
    // Also keep the focus-based guard for the Escape-key path with an input
    // already focused inside the sheet (external keyboard, or stale flag).
    const active = document.activeElement;
    if (
      active &&
      dialogEl?.contains(active) &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
    ) {
      return;
    }
    close();
  }}
  onpointerdown={(e) => {
    // Snapshot whether the press started inside the content. This drives the
    // click handler below; reading the click event's own target/coordinates is
    // unreliable on mobile because the virtual keyboard appearance between
    // touchstart and click re-positions the sheet.
    rememberPressTarget(e.target);
  }}
  ontouchstart={(e) => rememberPressTarget(e.target)}
  onfocusin={(e) => {
    // WebKit may transfer focus before the tapped input becomes
    // document.activeElement, then emit a native dialog cancel while opening
    // the keyboard. Preserve the internal target from focusin so that ordering
    // cannot be mistaken for a backdrop dismissal.
    rememberPressTarget(e.target);
  }}
  onclick={() => {
    // Only close when the original press landed on the backdrop, i.e. outside
    // the sheet content. Any tap inside the content (input focus, button) keeps
    // the sheet open regardless of what the synthesized click event reports.
    if (dismissOnExternalInteraction && !pointerDownInsideContent) close();
  }}
  class="bottom-sheet m-0 mt-auto w-full max-w-full bg-transparent p-0 backdrop:bg-black/50"
  class:closing
  aria-label={ariaLabel}
>
  <div
    {@attach registerContent}
    class="bottom-sheet-content pb-safe rounded-t-xl border-t border-border bg-surface"
    class:dragging
    style:transform={dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined}
  >
    <!--
      Drag handle: tap closes; drag down past 50% of sheet height (or with
      enough downward velocity) closes; otherwise the sheet snaps back.
      `touch-action: none` is required so the browser doesn't claim the
      vertical pan as a native scroll mid-drag.
    -->
    <button
      use:panGesture={{
        axis: 'y',
        enabled: () => !closing,
        shouldClaim: (dy) => dy > 0,
        onStart: () => {
          dragging = true;
        },
        onUpdate: (dy) => {
          dragOffsetY = Math.max(0, dy);
        },
        onEnd: (dy, vy) => {
          dragging = false;
          const sheetH = contentEl?.offsetHeight ?? 0;
          const past = sheetH > 0 && dy > sheetH * DRAG_CLOSE_FRACTION;
          if (past || vy > FLING_CLOSE_VELOCITY) {
            // Drag-close: transition inner offset DOWN to sheetH (same
            // direction as the dialog's slide-down keyframe). If we
            // transitioned back to 0 instead, the inner div would briefly
            // move UP while the dialog keyframe was still slow-starting,
            // producing a visible "bounce up before sliding down" glitch.
            dragOffsetY = sheetH;
            close();
          } else {
            // Snap back to fully open.
            dragOffsetY = 0;
          }
        },
        onCancel: () => {
          dragging = false;
          dragOffsetY = 0;
        }
      }}
      type="button"
      class="flex w-full cursor-pointer touch-none justify-center py-3"
      onclick={close}
      aria-label={m['ui.close']()}
    >
      <div class="h-1 w-10 rounded-full bg-muted/40"></div>
    </button>

    <!-- Content -->
    <div class="px-4 pb-4">
      {@render children()}
    </div>
  </div>
</dialog>

<style>
  /*
    Inner content has a transform transition so drag releases (snap-back to 0
    or settle-at-0 during close) animate smoothly. While `dragging` is true the
    transition is suppressed so the transform follows the finger 1:1.
  */
  .bottom-sheet-content {
    container-type: inline-size;
    max-height: 100%;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    transition: transform 200ms ease-out;
  }
  dialog.bottom-sheet > div.dragging {
    transition: none;
  }

  dialog.bottom-sheet[open] {
    position: fixed;
    right: 0;
    bottom: auto;
    left: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
    animation: slide-up 200ms ease-out;
  }

  dialog.bottom-sheet[open]::backdrop {
    animation: backdrop-fade-in 200ms ease-out;
  }

  dialog.bottom-sheet[open].closing {
    animation: slide-down 200ms ease-in forwards;
  }

  dialog.bottom-sheet[open].closing::backdrop {
    animation: backdrop-fade-out 200ms ease-in forwards;
  }

  @keyframes slide-up {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }

  @keyframes slide-down {
    from {
      transform: translateY(0);
    }
    to {
      transform: translateY(100%);
    }
  }

  @keyframes backdrop-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes backdrop-fade-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
</style>
