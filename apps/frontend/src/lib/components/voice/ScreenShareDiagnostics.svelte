<!--
@component

Responsive disclosure around the local screen-share diagnostics collector.
Touch-first phones, tablets and Fold devices open a compact preview first;
desktop pointer activation keeps the detailed diagnostics view.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Track } from 'livekit-client';
  import * as m from '$lib/i18n/messages';
  import { getFormattingLocale } from '$lib/i18n/runtime';
  import {
    collectScreenShareDiagnostics,
    mergeScreenShareDiagnosticsSample,
    SCREEN_SHARE_DIAGNOSTICS_INTERVAL_MS,
    type ScreenShareDiagnosticsCounters,
    type ScreenShareDiagnosticsDirection,
    type ScreenShareDiagnosticsHealth,
    type ScreenShareDiagnosticsSample
  } from '$lib/voice/screenShareDiagnostics';
  import ScreenShareDiagnosticsView from './ScreenShareDiagnosticsView.svelte';

  let {
    track,
    direction,
    panelId,
    onclose
  }: {
    track: Track;
    direction: ScreenShareDiagnosticsDirection;
    panelId: string;
    onclose: () => void;
  } = $props();

  type Presentation = 'compact' | 'expanded';

  const touchFirstDisclosure = usesTouchFirstDisclosure();
  let presentation = $state<Presentation>(touchFirstDisclosure ? 'compact' : 'expanded');
  let sample = $state<ScreenShareDiagnosticsSample | null>(null);
  let loading = $state(touchFirstDisclosure);
  let unavailable = $state(false);
  let dialogElement: HTMLElement | null = $state(null);
  let closeButton: HTMLButtonElement | null = $state(null);
  let expandButton: HTMLButtonElement | null = $state(null);
  let formattingLocale = $derived(getFormattingLocale());
  let removeClickShield: (() => void) | null = null;

  $effect(() => {
    if (presentation !== 'compact') return;
    const activeTrack = track;
    const activeDirection = direction;
    let counters: ScreenShareDiagnosticsCounters | null = null;
    let cancelled = false;
    let inFlight = false;

    const collect = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const result = await collectScreenShareDiagnostics({
          track: activeTrack,
          direction: activeDirection,
          previous: counters
        });
        if (cancelled) return;
        counters = result.counters;
        sample = mergeScreenShareDiagnosticsSample(sample, result.sample);
        unavailable = false;
      } catch {
        if (!cancelled) unavailable = true;
      } finally {
        if (!cancelled) loading = false;
        inFlight = false;
      }
    };

    void collect();
    const interval = window.setInterval(collect, SCREEN_SHARE_DIAGNOSTICS_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  });

  onMount(() => {
    const frame = requestAnimationFrame(() => {
      (presentation === 'compact' ? expandButton : closeButton)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  });

  function usesTouchFirstDisclosure(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    const coarseAndNoHover = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const coarsePrimaryPointer = window.matchMedia('(pointer: coarse)').matches;
    const noPrimaryHover = window.matchMedia('(hover: none)').matches;
    if (coarseAndNoHover || coarsePrimaryPointer || noPrimaryHover) return true;

    const maxTouchPoints = navigator.maxTouchPoints ?? 0;
    if (maxTouchPoints < 1) return false;
    return (
      /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && maxTouchPoints > 1)
    );
  }

  function expand(): void {
    presentation = 'expanded';
    requestAnimationFrame(() => {
      document.getElementById(panelId)?.focus({ preventScroll: true });
    });
  }

  function closeFromBackdrop(event: PointerEvent): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    if (event.pointerType === 'touch') armPostDismissClickShield(event);
    onclose();
  }

  function armPostDismissClickShield(pointerEvent: PointerEvent): void {
    removeClickShield?.();
    const armedAt = performance.now();
    const pointerX = pointerEvent.clientX;
    const pointerY = pointerEvent.clientY;
    let timeoutId = 0;

    const remove = () => {
      window.removeEventListener('click', suppressClick, true);
      window.clearTimeout(timeoutId);
      if (removeClickShield === remove) removeClickShield = null;
    };
    const suppressClick = (event: MouseEvent) => {
      const elapsed = performance.now() - armedAt;
      const distance = Math.hypot(event.clientX - pointerX, event.clientY - pointerY);
      remove();
      if (elapsed > 450 || distance > 18) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener('click', suppressClick, true);
    timeoutId = window.setTimeout(remove, 450);
    removeClickShield = remove;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (presentation !== 'compact') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }
    if (event.key !== 'Tab' || !dialogElement) return;
    const focusable = Array.from(
      dialogElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hasAttribute('hidden'));
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function formatNumber(value: number | null, maximumFractionDigits = 0): string {
    if (value === null) return '—';
    return new Intl.NumberFormat(formattingLocale, { maximumFractionDigits }).format(value);
  }

  function formatBitrate(value: number | null): string {
    if (value === null) return '—';
    if (value >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)} Mb/s`;
    if (value >= 1_000) return `${formatNumber(value / 1_000, 0)} kb/s`;
    return `${formatNumber(value)} b/s`;
  }

  function formatResolution(width: number | null, height: number | null): string {
    return width === null || height === null ? '—' : `${width} × ${height}`;
  }

  function formatPercent(value: number | null): string {
    return value === null ? '—' : `${formatNumber(value, 2)} %`;
  }

  function formatMilliseconds(value: number | null): string {
    return value === null ? '—' : `${formatNumber(value, value < 10 ? 1 : 0)} ms`;
  }

  function healthLabel(health: ScreenShareDiagnosticsHealth): string {
    return health === 'excellent'
      ? m['voice.screen_stats_health_excellent']()
      : health === 'good'
        ? m['voice.screen_stats_health_good']()
        : health === 'degraded'
          ? m['voice.screen_stats_health_degraded']()
          : health === 'poor'
            ? m['voice.screen_stats_health_poor']()
            : m['voice.screen_stats_health_unknown']();
  }

  function healthClass(health: ScreenShareDiagnosticsHealth): string {
    return health === 'excellent'
      ? 'bg-success/15 text-success'
      : health === 'good'
        ? 'bg-accent/15 text-accent'
        : health === 'degraded'
          ? 'bg-warning/15 text-warning'
          : health === 'poor'
            ? 'bg-danger/15 text-danger'
            : 'bg-white/10 text-white/75';
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if presentation === 'expanded'}
  <ScreenShareDiagnosticsView {track} {direction} {panelId} {onclose} />
{:else}
  <div
    class="screen-share-preview-backdrop fixed inset-0 z-[100] flex items-end justify-center overflow-hidden bg-black/45 p-2 sm:items-center sm:p-4"
    data-testid="screen-share-diagnostics-preview-backdrop"
    onpointerdown={closeFromBackdrop}
  >
    <aside
      bind:this={dialogElement}
      id={panelId}
      role="dialog"
      aria-modal="true"
      aria-label={m['voice.screen_stats_title']()}
      class="screen-share-preview @container flex max-h-[min(38rem,calc(100dvh-1rem))] w-[min(38rem,calc(100vw-1rem))] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/88 text-white shadow-2xl backdrop-blur-xl"
      data-testid="screen-share-diagnostics-preview"
    >
      <header class="flex min-h-16 shrink-0 items-center gap-2.5 border-b border-white/10 px-2.5 sm:px-3.5">
        <span class="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span class="absolute inline-flex h-full w-full rounded-full bg-success opacity-25"></span>
          <span class="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-xs font-semibold tracking-wide text-white/90 uppercase sm:text-sm">
            {m['voice.screen_stats_title']()}
          </h2>
          <p class="truncate text-[10px] text-white/60 sm:text-[11px]">{m['voice.screen_stats_local_only']()}</p>
        </div>
        {#if sample}
          <span
            class={[
              'inline-flex h-7 max-w-[34vw] shrink-0 items-center rounded-full border border-white/10 px-2 text-[0.6875rem] font-semibold whitespace-nowrap',
              healthClass(sample.health)
            ]}
            data-testid="screen-share-diagnostics-preview-health"
          >
            <span class="truncate">{healthLabel(sample.health)}</span>
          </span>
        {/if}
        <button
          bind:this={closeButton}
          type="button"
          class="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl text-white/75 outline-none hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
          aria-label={m['voice.screen_stats_close']()}
          data-testid="screen-share-diagnostics-preview-close"
          onclick={onclose}
        >
          <span class="iconify text-lg uil--times" aria-hidden="true"></span>
        </button>
      </header>

      <div class="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain p-2.5 sm:p-3">
        {#if loading && !sample}
          <div class="flex min-h-24 items-center justify-center gap-2 text-xs text-white/70">
            <span class="iconify animate-spin text-base uil--spinner" aria-hidden="true"></span>
            <span>{m['voice.screen_stats_loading']()}</span>
          </div>
        {:else if unavailable && !sample}
          <div class="flex min-h-24 flex-col items-center justify-center gap-1.5 px-3 text-center">
            <span class="iconify text-xl text-warning uil--chart-line" aria-hidden="true"></span>
            <p class="text-xs font-medium">{m['voice.screen_stats_unavailable']()}</p>
            <p class="text-[11px] text-white/60">{m['voice.screen_stats_retrying']()}</p>
          </div>
        {:else if sample}
          <dl class="screen-share-preview-grid grid grid-cols-1 gap-1.5 text-[11px] leading-tight tabular-nums @min-[320px]:grid-cols-2">
            <div><dt>{m['voice.screen_stats_resolution']()}</dt><dd>{formatResolution(sample.width, sample.height)}</dd></div>
            <div><dt>{m['voice.screen_stats_fps']()}</dt><dd>{formatNumber(sample.framesPerSecond, 1)} FPS</dd></div>
            <div><dt>{m['voice.screen_stats_bitrate']()}</dt><dd>{formatBitrate(sample.bitrateBps)}</dd></div>
            <div><dt>{m['voice.screen_stats_packet_loss']()}</dt><dd>{formatPercent(sample.packetLossPercent)}</dd></div>
            <div><dt>{m['voice.screen_stats_rtt']()}</dt><dd>{formatMilliseconds(sample.roundTripTimeMs)}</dd></div>
            <div><dt>{m['voice.screen_stats_jitter']()}</dt><dd>{formatMilliseconds(sample.jitterMs)}</dd></div>
          </dl>
        {/if}

        <button
          bind:this={expandButton}
          type="button"
          class="mt-2.5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold text-white outline-none transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
          data-testid="screen-share-diagnostics-expand"
          onclick={expand}
        >
          <span class="iconify text-lg text-accent uil--expand-arrows-alt" aria-hidden="true"></span>
          {m['voice.screen_stats_technical_details']()}
        </button>
      </div>
    </aside>
  </div>
{/if}

<style>
  .screen-share-preview-backdrop { animation: screen-share-preview-backdrop-in 160ms ease-out both; }
  .screen-share-preview {
    margin-bottom: env(safe-area-inset-bottom);
    transform-origin: bottom center;
    animation: screen-share-preview-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
    -webkit-backdrop-filter: blur(20px) saturate(115%);
    backdrop-filter: blur(20px) saturate(115%);
  }
  .screen-share-preview-grid > div {
    display: grid;
    grid-template-columns: minmax(0, 46%) minmax(0, 1fr);
    min-height: 2.75rem;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    border: 1px solid rgb(255 255 255 / 0.09);
    border-radius: 0.65rem;
    background: rgb(255 255 255 / 0.05);
    padding: 0.5rem 0.625rem;
  }
  .screen-share-preview-grid dt,
  .screen-share-preview-grid dd { min-width: 0; overflow-wrap: anywhere; }
  .screen-share-preview-grid dt { color: rgb(255 255 255 / 0.62); }
  .screen-share-preview-grid dd { text-align: right; color: rgb(255 255 255 / 0.92); font-weight: 600; }

  :global(.screen-share-diagnostics-overlay) {
    max-width: min(46rem, calc(100vw - max(1rem, env(safe-area-inset-left) + env(safe-area-inset-right))));
    max-height: calc(100vh - max(1rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)));
  }
  @supports (height: 100dvh) {
    :global(.screen-share-diagnostics-overlay) {
      max-height: calc(100dvh - max(1rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)));
    }
  }
  @media (max-width: 600px) {
    :global(.screen-share-diagnostics-overlay) {
      width: auto !important;
      right: max(0.35rem, env(safe-area-inset-right)) !important;
      left: max(0.35rem, env(safe-area-inset-left)) !important;
      bottom: max(0.35rem, env(safe-area-inset-bottom)) !important;
      max-width: none !important;
      border-radius: 1rem;
    }
  }
  @media (max-height: 520px) and (orientation: landscape) {
    :global(.screen-share-diagnostics-overlay) {
      top: max(0.35rem, env(safe-area-inset-top)) !important;
      bottom: max(0.35rem, env(safe-area-inset-bottom)) !important;
      width: min(46rem, calc(100vw - 1rem)) !important;
      max-height: none !important;
      margin-inline: auto;
    }
    .screen-share-preview { max-height: calc(100dvh - 0.75rem); }
  }
  @supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    .screen-share-preview { background: rgb(15 15 15 / 0.98); }
  }
  @keyframes screen-share-preview-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes screen-share-preview-in { from { opacity: 0; transform: translateY(8px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @media (prefers-reduced-motion: reduce) { .screen-share-preview-backdrop, .screen-share-preview { animation: none; } }
  @media (prefers-reduced-transparency: reduce) { .screen-share-preview { background: rgb(15 15 15 / 0.98); -webkit-backdrop-filter: none; backdrop-filter: none; } }
  @media (forced-colors: active) {
    .screen-share-preview, .screen-share-preview-grid > div { border-color: CanvasText; background: Canvas; color: CanvasText; box-shadow: none; }
  }
</style>
