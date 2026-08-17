<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import {
    normalizeDesktopMotionPolicy,
    shouldAnimateComposer,
    type DesktopMotionPolicy
  } from '$lib/components/composer/composerMotion';

  const SHELL_SELECTOR = '[data-testid="message-composer-shell"].composer-focus-shell';
  const DESKTOP_POLICY_EVENT = 'towk:desktop-motion-policy';
  const INK_DURATION_MS = 180;

  interface ComposerMotionState {
    shell: HTMLElement;
    flare: HTMLSpanElement;
    ink: HTMLSpanElement;
    inkAnimation: Animation | null;
    composing: boolean;
    dispose: () => void;
  }

  function addMediaListener(query: MediaQueryList, listener: () => void): () => void {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }

  function caretRectInside(shell: HTMLElement): DOMRect | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;

    const range = selection.getRangeAt(0);
    if (!shell.contains(range.commonAncestorContainer)) return null;

    const clientRects = range.getClientRects();
    const rect =
      clientRects.length > 0 ? clientRects[clientRects.length - 1] : range.getBoundingClientRect();
    return rect.height > 0 || rect.width > 0 ? rect : null;
  }

  onMount(() => {
    if (
      typeof Element.prototype.animate !== 'function' ||
      !document.body
    ) {
      return;
    }

    const states = new SvelteMap<HTMLElement, ComposerMotionState>();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const forcedColors = window.matchMedia('(forced-colors: active)');
    let desktopPolicy: DesktopMotionPolicy = normalizeDesktopMotionPolicy(
      document.documentElement.dataset.towkMotion
    );

    function animationAllowed(state: ComposerMotionState): boolean {
      return shouldAnimateComposer({
        focused: state.shell.matches(':focus-within'),
        documentVisible: document.visibilityState === 'visible',
        reducedMotion: reducedMotion.matches,
        forcedColors: forcedColors.matches,
        desktopPolicy
      });
    }

    function refreshState(state: ComposerMotionState): void {
      const active = animationAllowed(state);
      state.shell.dataset.composerMotionActive = active ? 'true' : 'false';
    }

    function emitInkPulse(state: ComposerMotionState): void {
      if (!animationAllowed(state) || state.composing) return;
      const caret = caretRectInside(state.shell);
      if (!caret) return;

      const shellRect = state.shell.getBoundingClientRect();
      const x = Math.min(
        Math.max(caret.right - shellRect.left, 7),
        Math.max(7, shellRect.width - 7)
      );
      const y = Math.min(
        Math.max(caret.top + caret.height / 2 - shellRect.top, 7),
        Math.max(7, shellRect.height - 7)
      );
      const position = `translate3d(${x - 3}px, ${y - 3}px, 0)`;

      state.inkAnimation?.cancel();
      const pulse = state.ink.animate(
        [
          { opacity: 0, transform: `${position} scale(0.45)` },
          { opacity: 0.48, transform: `${position} scale(1)`, offset: 0.35 },
          { opacity: 0, transform: `${position} translateY(-1.5px) scale(1.22)` }
        ],
        {
          duration: INK_DURATION_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'none'
        }
      );
      state.inkAnimation = pulse;
      state.ink.dataset.active = 'true';
      void pulse.finished
        .catch(() => undefined)
        .finally(() => {
          if (state.inkAnimation === pulse) {
            state.inkAnimation = null;
            delete state.ink.dataset.active;
          }
        });
    }

    function attach(shell: HTMLElement): void {
      if (states.has(shell)) return;

      const flare = document.createElement('span');
      flare.className = 'composer-motion-flare';
      flare.setAttribute('aria-hidden', 'true');

      const beam = document.createElement('span');
      beam.className = 'composer-motion-beam';
      flare.append(beam);

      const ink = document.createElement('span');
      ink.className = 'composer-motion-ink';
      ink.setAttribute('aria-hidden', 'true');

      shell.append(flare, ink);
      shell.dataset.composerMotion = 'enhanced';

      let state!: ComposerMotionState;
      const handleFocus = () => queueMicrotask(() => refreshState(state));
      const handleInput = (event: Event) => {
        const inputEvent = event as InputEvent;
        if (inputEvent.isComposing || !inputEvent.inputType?.startsWith('insert')) return;
        queueMicrotask(() => emitInkPulse(state));
      };
      const handleCompositionStart = () => {
        state.composing = true;
      };
      const handleCompositionEnd = () => {
        state.composing = false;
        queueMicrotask(() => emitInkPulse(state));
      };

      const dispose = () => {
        shell.removeEventListener('focusin', handleFocus);
        shell.removeEventListener('focusout', handleFocus);
        shell.removeEventListener('input', handleInput);
        shell.removeEventListener('compositionstart', handleCompositionStart);
        shell.removeEventListener('compositionend', handleCompositionEnd);
        state.inkAnimation?.cancel();
        flare.remove();
        ink.remove();
        delete shell.dataset.composerMotion;
        delete shell.dataset.composerMotionActive;
        states.delete(shell);
      };

      state = {
        shell,
        flare,
        ink,
        inkAnimation: null,
        composing: false,
        dispose
      };
      states.set(shell, state);

      shell.addEventListener('focusin', handleFocus);
      shell.addEventListener('focusout', handleFocus);
      shell.addEventListener('input', handleInput);
      shell.addEventListener('compositionstart', handleCompositionStart);
      shell.addEventListener('compositionend', handleCompositionEnd);
      refreshState(state);
    }

    function scan(root: ParentNode = document): void {
      if (root instanceof HTMLElement && root.matches(SHELL_SELECTOR)) attach(root);
      root.querySelectorAll<HTMLElement>(SHELL_SELECTOR).forEach(attach);
    }

    function refreshAll(): void {
      states.forEach(refreshState);
    }

    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) scan(node);
        });
      }
      states.forEach((state) => {
        if (!state.shell.isConnected) state.dispose();
      });
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    function syncDesktopPolicy(): void {
      desktopPolicy = normalizeDesktopMotionPolicy(
        document.documentElement.dataset.towkMotion
      );
      refreshAll();
    }

    const handleDesktopPolicy = () => syncDesktopPolicy();
    const desktopPolicyObserver = new MutationObserver(syncDesktopPolicy);
    desktopPolicyObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-towk-motion']
    });

    const removeReducedMotionListener = addMediaListener(reducedMotion, refreshAll);
    const removeForcedColorsListener = addMediaListener(forcedColors, refreshAll);

    document.addEventListener('visibilitychange', refreshAll);
    document.addEventListener(DESKTOP_POLICY_EVENT, handleDesktopPolicy);
    scan();

    return () => {
      mutationObserver.disconnect();
      desktopPolicyObserver.disconnect();
      removeReducedMotionListener();
      removeForcedColorsListener();
      document.removeEventListener('visibilitychange', refreshAll);
      document.removeEventListener(DESKTOP_POLICY_EVENT, handleDesktopPolicy);
      [...states.values()].forEach((state) => state.dispose());
    };
  });
</script>

<style>
  :global(.composer-motion-ink) {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 4;
    display: block;
    border-radius: 999px;
    pointer-events: none;
    opacity: 0;
  }

  :global(.composer-motion-flare) {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: block;
    overflow: hidden;
    padding: 1.35px;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    transition: opacity 160ms ease;
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
  }

  :global(.composer-focus-shell[data-composer-motion-active='true'] .composer-motion-flare) {
    opacity: 1;
  }

  :global(.composer-motion-beam) {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 44px;
    height: 300vmax;
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, #e8783b 14%, transparent) 18%,
      color-mix(in srgb, #e8783b 72%, transparent) 38%,
      #f9a763 50%,
      color-mix(in srgb, #e8783b 72%, transparent) 62%,
      color-mix(in srgb, #e8783b 14%, transparent) 82%,
      transparent 100%
    );
    transform-origin: 50% 50%;
    animation: composer-border-beam 4.8s linear infinite paused;
    will-change: transform;
  }

  :global(
    .composer-focus-shell[data-composer-motion-active='true'] .composer-motion-beam
  ) {
    animation-play-state: running;
  }

  :global(.composer-focus-shell[data-composer-motion='enhanced']::before) {
    animation: none !important;
    opacity: 0 !important;
  }

  :global(.composer-motion-ink) {
    width: 6px;
    height: 6px;
    background: rgba(232, 120, 59, 0.24);
    background: radial-gradient(
      circle,
      color-mix(in srgb, #f9a763 78%, transparent) 0 20%,
      color-mix(in srgb, #e8783b 32%, transparent) 48%,
      transparent 72%
    );
  }

  :global(.composer-motion-ink[data-active='true']) {
    will-change: transform, opacity;
  }

  @keyframes composer-border-beam {
    from {
      transform: translate(-50%, -50%) rotate(0deg);
    }

    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }

  @media (forced-colors: active) {
    :global(.composer-motion-flare),
    :global(.composer-motion-ink) {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.composer-motion-flare),
    :global(.composer-motion-ink) {
      display: none;
      transition: none;
    }
  }
</style>
