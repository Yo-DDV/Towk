<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import { shouldAutoFocus } from '$lib/utils/shouldAutoFocus';
  import { MOTION_DURATION, motionDuration } from '$lib/ui/motion.svelte';

  let {
    children,
    footer,
    visible = $bindable(false),
    title,
    size = 'md',
    tall = false,
    swipeToClose = false,
    describedBy,
    onclose
  }: {
    visible?: boolean;
    title?: string;
    size?: 'sm' | 'md' | 'lg';
    /** Allow content-heavy dialogs to use nearly the full dynamic viewport height. */
    tall?: boolean;
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

  const dialogId = $props.id();
  const titleId = `${dialogId}-title`;

  const sizeClasses = {
    sm: 'w-100 max-w-[60vw]',
    md: 'w-150 max-w-[80vw]',
    lg: 'w-200 max-w-[90vw]'
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
  aria-labelledby={title ? titleId : undefined}
  aria-describedby={describedBy}
>
  {#if visible || closing}
    <div
      class="dialog-tray rounded-lg border border-text/10 bg-surface-100 p-2 shadow-xl"
      class:swiping
      style:transform={swipeOffset ? `translate3d(0, ${swipeOffset}px, 0)` : undefined}
    >
      <div
        class={[
          'dialog-content overflow-y-auto rounded-md bg-background p-3',
          tall ? 'max-h-[calc(100dvh-2rem)]' : 'max-h-[78vh]'
        ]}
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

  .dialog-tray {
    transition: transform 160ms ease-out;
    will-change: transform;
  }

  .dialog-tray.swiping {
    transition: none;
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
</style>
