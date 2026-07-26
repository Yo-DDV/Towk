<script lang="ts">
  import { browser } from '$app/environment';
  import type { Snippet } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import { shouldAutoFocus } from '$lib/utils/shouldAutoFocus';
  import { MOTION_DURATION, motionDuration } from '$lib/ui/motion.svelte';

  let {
    children,
    footer,
    visible = $bindable(false),
    title,
    ariaLabel,
    size = 'md',
    tall = false,
    mobileFullScreen = false,
    swipeToClose = false,
    describedBy,
    onclose
  }: {
    visible?: boolean;
    title?: string;
    /** Accessible name used when the dialog does not render a visible title. */
    ariaLabel?: string;
    size?: 'sm' | 'md' | 'lg';
    /** Allow content-heavy dialogs to use nearly the full dynamic viewport height. */
    tall?: boolean;
    /** Promote the dialog to a viewport-filling sheet on narrow screens. */
    mobileFullScreen?: boolean;
    /** Show a dedicated, bounded vertical swipe handle for touch dismissal. */
    swipeToClose?: boolean;
    /** ID of an element that describes the dialog (forwarded to aria-describedby). */
    describedBy?: string;
    children: Snippet;
    footer?: Snippet;
    onclose?: () => void;
  } = $props();

  let dialogEl: HTMLDialogElement | undefined;
  let previouslyFocused: HTMLElement | null = null;
  let closing = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let pressStartedInside = true;
  let swipePointerId: number | null = null;
  let swipeStartY = 0;
  let swipeStartedAt = 0;
  let swipeOffset = $state(0);
  let swiping = $state(false);
  const mobileFullScreenQuery = '(max-width: 640px), (max-height: 620px)';

  function matchesMobileFullScreenViewport() {
    return browser && window.matchMedia(mobileFullScreenQuery).matches;
  }

  let mobileFullScreenViewport = $state(matchesMobileFullScreenViewport());

  const dialogId = $props.id();
  const titleId = `${dialogId}-title`;
  const useMobileFullScreen = $derived(mobileFullScreen && mobileFullScreenViewport);

  const sizeClasses = {
    sm: 'w-[calc(100vw-1.5rem)] max-w-md sm:w-100',
    md: 'w-[calc(100vw-1.5rem)] max-w-2xl sm:w-150',
    lg: 'w-[calc(100vw-1rem)] max-w-4xl sm:w-[calc(100vw-3rem)] lg:w-200'
  };

  function resetSwipe() {
    swipePointerId = null;
    swipeOffset = 0;
    swiping = false;
  }

  function syncDialogVisibility(node: HTMLDialogElement) {
    dialogEl = node;
    if (visible) {
      closing = false;
      pressStartedInside = true;
      resetSwipe();
      if (!node.open) {
        previouslyFocused =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        node.showModal();
      }
      if (shouldAutoFocus()) {
        queueMicrotask(() => {
          const fieldSelector =
            'input:not([type="hidden"]):not([disabled]),textarea:not([disabled]),select:not([disabled])';
          const active = document.activeElement;
          const alreadyOnField =
            active instanceof HTMLElement && node.contains(active) && active.matches(fieldSelector);
          if (alreadyOnField) return;
          const target =
            node.querySelector<HTMLElement>(fieldSelector) ??
            node.querySelector<HTMLElement>('button[type="submit"]:not([disabled])');
          target?.focus();
        });
      }
    } else if (node.open && !closing) {
      node.close();
    }
  }

  function handleNativeClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    visible = false;
    closing = false;
    resetSwipe();
    const focusTarget = previouslyFocused;
    previouslyFocused = null;
    queueMicrotask(() => {
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    });
    onclose?.();
  }

  function close() {
    if (!dialogEl?.open || closing) return;
    resetSwipe();
    closing = true;
    const duration = motionDuration(MOTION_DURATION.fast);
    if (duration === 0) {
      dialogEl.close();
      return;
    }
    closeTimer = setTimeout(() => {
      closeTimer = null;
      dialogEl?.close();
    }, duration);
  }

  function beginSwipe(event: PointerEvent) {
    if (!swipeToClose || closing || event.button !== 0) return;
    swipePointerId = event.pointerId;
    swipeStartY = event.clientY;
    swipeStartedAt = performance.now();
    swipeOffset = 0;
    swiping = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveSwipe(event: PointerEvent) {
    if (!swiping || swipePointerId !== event.pointerId) return;
    swipeOffset = Math.max(0, Math.min(event.clientY - swipeStartY, 320));
    event.preventDefault();
  }

  function finishSwipe(event: PointerEvent) {
    if (!swiping || swipePointerId !== event.pointerId) return;
    const elapsed = Math.max(1, performance.now() - swipeStartedAt);
    const velocity = swipeOffset / elapsed;
    const shouldClose = swipeOffset >= 96 || (swipeOffset >= 48 && velocity >= 0.55);
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    if (shouldClose) {
      close();
    } else {
      resetSwipe();
    }
    event.preventDefault();
  }

  $effect(() => {
    if (!browser || !mobileFullScreen) {
      mobileFullScreenViewport = false;
      return;
    }

    const query = window.matchMedia(mobileFullScreenQuery);
    const update = () => {
      mobileFullScreenViewport = query.matches;
    };
    update();
    query.addEventListener('change', update);

    return () => query.removeEventListener('change', update);
  });
</script>

<dialog
  {@attach syncDialogVisibility}
  onclose={handleNativeClose}
  oncancel={(e) => {
    e.preventDefault();
    close();
  }}
  onpointerdown={(e) => {
    pressStartedInside = e.target !== dialogEl;
  }}
  onclick={(e) => {
    if (e.detail === 0 || pressStartedInside) return;
    const content = dialogEl?.firstElementChild as HTMLElement | null;
    if (!content) return;
    const rect = content.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      close();
    }
  }}
  class="m-auto bg-transparent backdrop:bg-black/50 {sizeClasses[size]}"
  class:closing
  class:mobile-full-screen={useMobileFullScreen}
  style:position={useMobileFullScreen ? 'fixed' : undefined}
  style:inset={useMobileFullScreen ? '0' : undefined}
  style:width={useMobileFullScreen ? '100vw' : undefined}
  style:max-width={useMobileFullScreen ? 'none' : undefined}
  style:height={useMobileFullScreen ? '100dvh' : undefined}
  style:max-height={useMobileFullScreen ? 'none' : undefined}
  style:box-sizing={useMobileFullScreen ? 'border-box' : undefined}
  style:border={useMobileFullScreen ? '0' : undefined}
  style:margin={useMobileFullScreen ? '0' : undefined}
  style:padding={useMobileFullScreen ? '0' : undefined}
  style:overflow={useMobileFullScreen ? 'hidden' : undefined}
  aria-labelledby={title ? titleId : undefined}
  aria-label={title ? undefined : ariaLabel}
  aria-describedby={describedBy}
>
  {#if visible || closing}
    <div
      class="dialog-tray rounded-lg border border-text/10 bg-surface-100 p-2 shadow-xl"
      class:swiping
      style:min-height={useMobileFullScreen ? '100dvh' : undefined}
      style:border={useMobileFullScreen ? '0' : undefined}
      style:border-radius={useMobileFullScreen ? '0' : undefined}
      style:padding={useMobileFullScreen ? '0' : undefined}
      style:transform={swipeOffset ? `translate3d(0, ${swipeOffset}px, 0)` : undefined}
    >
      <div
        class={[
          'dialog-content overflow-y-auto rounded-md bg-background p-3',
          tall ? 'max-h-[calc(100dvh-2rem)]' : 'max-h-[78vh]'
        ]}
        style:min-height={useMobileFullScreen ? '100dvh' : undefined}
        style:max-height={useMobileFullScreen ? '100dvh' : undefined}
        style:border-radius={useMobileFullScreen ? '0' : undefined}
        style:padding-top={useMobileFullScreen
          ? 'max(0.75rem, env(safe-area-inset-top))'
          : undefined}
        style:padding-bottom={useMobileFullScreen
          ? 'max(0.75rem, env(safe-area-inset-bottom))'
          : undefined}
      >
        {#if swipeToClose}
          <div
            class="dialog-swipe-handle -mx-1 -mt-2 mb-1 grid min-h-11 cursor-grab touch-none place-items-center active:cursor-grabbing"
            role="presentation"
            aria-hidden="true"
            onpointerdown={beginSwipe}
            onpointermove={moveSwipe}
            onpointerup={finishSwipe}
            onpointercancel={finishSwipe}
          >
            <span class="h-1.5 w-12 rounded-full bg-text/20"></span>
          </div>
        {/if}

        <header class={['flex items-start justify-between gap-3', title ? 'mb-4' : 'mb-2']}>
          {#if title}
            <h2 id={titleId} class="text-xl font-semibold text-text">{title}</h2>
          {:else}
            <span></span>
          {/if}
          <button
            type="button"
            onclick={close}
            class="-m-1 grid min-h-11 min-w-11 shrink-0 cursor-pointer place-items-center rounded-md text-text/50 transition-colors hover:bg-surface-200 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label={m['ui.close']()}
          >
            <span class="iconify text-xl uil--times" aria-hidden="true"></span>
          </button>
        </header>

        <div class="text-text">
          {@render children()}
        </div>

        {#if footer}
          <footer class="mt-6">
            {@render footer()}
          </footer>
        {/if}
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog[open] {
    animation: fade-in 100ms ease-out;
  }

  dialog[open]::backdrop {
    animation: backdrop-fade-in 100ms ease-out;
  }

  dialog[open].closing {
    animation: fade-out 100ms ease-in forwards;
  }

  dialog[open].closing::backdrop {
    animation: backdrop-fade-out 100ms ease-in forwards;
  }

  dialog[open].mobile-full-screen {
    animation: mobile-full-screen-fade-in 100ms ease-out;
  }

  dialog[open].mobile-full-screen.closing {
    animation: mobile-full-screen-fade-out 100ms ease-in forwards;
  }

  .dialog-tray {
    transition: transform 160ms ease-out;
    will-change: transform;
  }

  .dialog-tray.swiping {
    transition: none;
  }

  @media (max-width: 640px), (max-height: 620px) {
    dialog[open].mobile-full-screen {
      width: 100vw !important;
      max-width: none !important;
      height: 100dvh;
      max-height: none;
      margin: 0;
      padding: 0;
    }

    dialog[open].mobile-full-screen > .dialog-tray {
      min-height: 100dvh;
      border: 0;
      border-radius: 0;
      padding: 0;
    }

    dialog[open].mobile-full-screen .dialog-content {
      min-height: 100dvh;
      max-height: 100dvh;
      border-radius: 0;
      padding-top: max(0.75rem, env(safe-area-inset-top));
      padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    dialog[open],
    dialog[open]::backdrop,
    dialog[open].closing,
    dialog[open].closing::backdrop {
      animation-duration: 1ms;
    }

    .dialog-tray {
      transition-duration: 1ms;
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes fade-out {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.95);
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

  @keyframes mobile-full-screen-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes mobile-full-screen-fade-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
</style>
