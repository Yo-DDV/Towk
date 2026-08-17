<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import {
    composerHaloKeyframes,
    normalizeDesktopMotionPolicy,
    shouldAnimateComposer,
    type DesktopMotionPolicy
  } from '$lib/components/composer/composerMotion';

  const SHELL_SELECTOR = '[data-testid="message-composer-shell"].composer-focus-shell';
  const DESKTOP_POLICY_EVENT = 'towk:desktop-motion-policy';
  const ORBIT_DURATION_MS = 4_200;
  const INK_DURATION_MS = 180;

  interface ComposerMotionState {
    shell: HTMLElement;
    flare: SVGSVGElement;
    ink: HTMLSpanElement;
    orbit: Animation[];
    inkAnimation: Animation | null;
    resizeObserver: ResizeObserver;
    composing: boolean;
    dispose: () => void;
  }

  function addMediaListener(query: MediaQueryList, listener: () => void): () => void {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }

  function borderRadiusFor(shell: HTMLElement): number {
    const parsed = Number.parseFloat(getComputedStyle(shell).borderTopLeftRadius);
    if (!Number.isFinite(parsed)) return 12;
    return Math.max(0, Math.min(parsed, shell.offsetWidth / 2, shell.offsetHeight / 2));
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
      typeof ResizeObserver === 'undefined' ||
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

      if (active) {
        state.orbit.forEach((animation) => void animation.play());
      } else {
        state.orbit.forEach((animation) => animation.pause());
      }
    }

    function rebuildOrbit(state: ComposerMotionState): void {
      const width = state.shell.offsetWidth;
      const height = state.shell.offsetHeight;
      if (width <= 0 || height <= 0) return;

      const previousTime = state.orbit[0]?.currentTime;
      state.orbit.forEach((animation) => animation.cancel());
      const svgWidth = width + 8;
      const svgHeight = height + 8;
      state.flare.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
      state.flare.querySelectorAll('rect').forEach((rect) => {
        rect.setAttribute('x', '4');
        rect.setAttribute('y', '4');
        rect.setAttribute('width', String(width));
        rect.setAttribute('height', String(height));
        rect.setAttribute('rx', String(borderRadiusFor(state.shell)));
      });
      state.orbit = [...state.flare.querySelectorAll<SVGRectElement>('rect')].map((rect) => {
        const animation = rect.animate(composerHaloKeyframes(), {
          duration: ORBIT_DURATION_MS,
          iterations: Number.POSITIVE_INFINITY,
          easing: 'linear',
          fill: 'both'
        });
        animation.pause();
        return animation;
      });
      if (typeof previousTime === 'number' && Number.isFinite(previousTime)) {
        state.orbit.forEach((animation) => {
          animation.currentTime = previousTime % ORBIT_DURATION_MS;
        });
      }
      refreshState(state);
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

      const flare = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      flare.setAttribute('class', 'composer-motion-flare');
      flare.setAttribute('aria-hidden', 'true');
      for (const layer of ['aura', 'trail', 'core']) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('pathLength', '1');
        rect.setAttribute('class', `composer-motion-${layer}`);
        flare.append(rect);
      }

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
      const resizeObserver = new ResizeObserver(() => rebuildOrbit(state));

      const dispose = () => {
        resizeObserver.disconnect();
        shell.removeEventListener('focusin', handleFocus);
        shell.removeEventListener('focusout', handleFocus);
        shell.removeEventListener('input', handleInput);
        shell.removeEventListener('compositionstart', handleCompositionStart);
        shell.removeEventListener('compositionend', handleCompositionEnd);
        state.orbit.forEach((animation) => animation.cancel());
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
        orbit: [],
        inkAnimation: null,
        resizeObserver,
        composing: false,
        dispose
      };
      states.set(shell, state);

      shell.addEventListener('focusin', handleFocus);
      shell.addEventListener('focusout', handleFocus);
      shell.addEventListener('input', handleInput);
      shell.addEventListener('compositionstart', handleCompositionStart);
      shell.addEventListener('compositionend', handleCompositionEnd);
      resizeObserver.observe(shell);
      rebuildOrbit(state);
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
  :global(.composer-focus-shell[data-composer-motion='enhanced']::before) {
    animation: none !important;
    opacity: 0 !important;
  }

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
    inset: -4px;
    z-index: 4;
    width: calc(100% + 8px);
    height: calc(100% + 8px);
    overflow: visible;
    pointer-events: none;
    transition: opacity 160ms ease;
    opacity: 0;
  }

  :global(.composer-motion-flare rect) {
    fill: none;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  :global(.composer-motion-aura) {
    stroke: color-mix(in srgb, #e8783b 25%, transparent);
    stroke-width: 10px;
    stroke-dasharray: 0.3 0.7;
    filter: blur(4px);
  }

  :global(.composer-motion-trail) {
    stroke: color-mix(in srgb, #e8783b 48%, transparent);
    stroke-width: 4px;
    stroke-dasharray: 0.2 0.8;
    filter: blur(1px);
  }

  :global(.composer-motion-core) {
    stroke: #f9a763;
    stroke-width: 1.6px;
    stroke-dasharray: 0.095 0.905;
    filter: drop-shadow(0 0 3px color-mix(in srgb, #f9a763 78%, transparent));
  }

  :global(.composer-focus-shell[data-composer-motion-active='true'] .composer-motion-flare) {
    opacity: 0.88;
    will-change: opacity;
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
