<!--
@component

Opt-in “stats for nerds” overlay for one live screen-share track. Collection is
strictly local, starts only while this component is mounted, and stops on close.
-->
<script lang="ts">
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

  let sample = $state<ScreenShareDiagnosticsSample | null>(null);
  let loading = $state(true);
  let unavailable = $state(false);
  let formattingLocale = $derived(getFormattingLocale());

  $effect(() => {
    const activeTrack = track;
    const activeDirection = direction;
    let counters: ScreenShareDiagnosticsCounters | null = null;
    let cancelled = false;
    let inFlight = false;
    let consecutiveFailures = 0;
    sample = null;
    loading = true;
    unavailable = false;

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
        consecutiveFailures = 0;
        counters = result.counters;
        sample = mergeScreenShareDiagnosticsSample(sample, result.sample);
        unavailable = false;
      } catch {
        if (!cancelled) {
          consecutiveFailures += 1;
          unavailable = !sample || consecutiveFailures >= 2;
        }
      } finally {
        if (!cancelled) loading = false;
        inFlight = false;
      }
    };

    void collect();
    const interval = setInterval(collect, SCREEN_SHARE_DIAGNOSTICS_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  });

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
    switch (health) {
      case 'excellent':
        return m['voice.screen_stats_health_excellent']();
      case 'good':
        return m['voice.screen_stats_health_good']();
      case 'degraded':
        return m['voice.screen_stats_health_degraded']();
      case 'poor':
        return m['voice.screen_stats_health_poor']();
      default:
        return m['voice.screen_stats_health_unknown']();
    }
  }

  function healthClass(health: ScreenShareDiagnosticsHealth): string {
    switch (health) {
      case 'excellent':
        return 'border-success/40 bg-success/20 text-success';
      case 'good':
        return 'border-accent/40 bg-accent/20 text-accent';
      case 'degraded':
        return 'border-warning/45 bg-warning/20 text-warning';
      case 'poor':
        return 'border-danger/45 bg-danger/20 text-danger';
      default:
        return 'border-white/15 bg-white/10 text-white/80';
    }
  }

  function packetsValue(current: ScreenShareDiagnosticsSample): string {
    if (current.direction === 'outbound') {
      return m['voice.screen_stats_packets_out']({
        sent: formatNumber(current.packetsSent),
        lost: formatNumber(current.packetsLost)
      });
    }
    return m['voice.screen_stats_packets_in']({
      received: formatNumber(current.packetsReceived),
      lost: formatNumber(current.packetsLost)
    });
  }

  function framesValue(current: ScreenShareDiagnosticsSample): string {
    if (current.direction === 'outbound') {
      return m['voice.screen_stats_frames_out']({
        sent: formatNumber(current.framesSent),
        encoded: formatNumber(current.framesEncoded)
      });
    }
    return m['voice.screen_stats_frames_in']({
      received: formatNumber(current.framesReceived),
      decoded: formatNumber(current.framesDecoded),
      dropped: formatNumber(current.framesDropped)
    });
  }

  function qualityLimitValue(current: ScreenShareDiagnosticsSample): string | null {
    if (!current.qualityLimitationReason || current.qualityLimitationReason === 'none') return null;
    return current.qualityLimitationReason;
  }

  function closeFromKeyboard(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    onclose();
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    closeFromKeyboard(event);
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<aside
  id={panelId}
  role="region"
  aria-label={m['voice.screen_stats_title']()}
  tabindex="-1"
  class="screen-share-diagnostics-overlay @container pointer-events-auto absolute z-30 flex min-w-0 flex-col overflow-hidden rounded-md border border-white/15 bg-black/85 text-white shadow-2xl backdrop-blur-md"
  data-testid="screen-share-diagnostics-panel"
>
  <header class="flex min-h-10 shrink-0 items-center gap-2 border-b border-white/10 px-2 py-1.5">
    <span class="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      <span class="absolute inline-flex h-full w-full rounded-full bg-success opacity-25"></span>
      <span class="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-1.5">
        <h2 class="truncate text-[11px] font-semibold tracking-wide text-white/85 uppercase">
          {m['voice.screen_stats_title']()}
        </h2>
        <span
          class="rounded-full border border-white/10 bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white/65 uppercase"
        >
          {direction === 'outbound'
            ? m['voice.screen_stats_sending']()
            : m['voice.screen_stats_receiving']()}
        </span>
      </div>
    </div>
    <button
      type="button"
      class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-white/75 transition-[background-color,color,scale] hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white active:scale-[0.96]"
      title={m['voice.screen_stats_close']()}
      aria-label={m['voice.screen_stats_close']()}
      data-testid="screen-share-diagnostics-close"
      onclick={onclose}
    >
      <span class="iconify text-lg uil--times" aria-hidden="true"></span>
    </button>
  </header>

  <div class="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-2 py-2">
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
      <div class="space-y-2">
        <div class="flex min-w-0 items-center gap-2">
          <span
            class={[
              'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
              healthClass(sample.health)
            ]}
          >
            {healthLabel(sample.health)}
          </span>
          {#if qualityLimitValue(sample)}
            <span
              class="min-w-0 truncate rounded-full border border-warning/30 bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning"
            >
              {m['voice.screen_stats_quality_limit']()}: {qualityLimitValue(sample)}
            </span>
          {/if}
        </div>

        <dl class="screen-share-diagnostics-grid text-[11px] leading-tight tabular-nums">
          <div>
            <dt>{m['voice.screen_stats_resolution']()}</dt>
            <dd>{formatResolution(sample.width, sample.height)}</dd>
          </div>
          {#if direction === 'outbound'}
            <div>
              <dt>{m['voice.screen_stats_source_resolution']()}</dt>
              <dd>{formatResolution(sample.sourceWidth, sample.sourceHeight)}</dd>
            </div>
          {/if}
          <div>
            <dt>{m['voice.screen_stats_fps']()}</dt>
            <dd>{formatNumber(sample.framesPerSecond, 1)} FPS</dd>
          </div>
          <div>
            <dt>{m['voice.screen_stats_bitrate']()}</dt>
            <dd>{formatBitrate(sample.bitrateBps)}</dd>
          </div>
          <div>
            <dt>{m['voice.screen_stats_available_bandwidth']()}</dt>
            <dd>{formatBitrate(sample.availableBitrateBps)}</dd>
          </div>
          <div>
            <dt>{m['voice.screen_stats_packet_loss']()}</dt>
            <dd>{formatPercent(sample.packetLossPercent)}</dd>
          </div>
          <div>
            <dt>{m['voice.screen_stats_packets']()}</dt>
            <dd>{packetsValue(sample)}</dd>
          </div>
          <div>
            <dt>{m['voice.screen_stats_frames']()}</dt>
            <dd>{framesValue(sample)}</dd>
          </div>
          {#if direction === 'inbound'}
            <div>
              <dt>{m['voice.screen_stats_frame_drop']()}</dt>
              <dd>{formatPercent(sample.frameDropPercent)}</dd>
            </div>
          {/if}
          <div>
            <dt>{m['voice.screen_stats_rtt']()} / {m['voice.screen_stats_jitter']()}</dt>
            <dd>
              {formatMilliseconds(sample.roundTripTimeMs)} / {formatMilliseconds(sample.jitterMs)}
            </dd>
          </div>
          <div>
            <dt>{m['voice.screen_stats_codec']()}</dt>
            <dd class="font-mono">{sample.codec ?? '—'}</dd>
          </div>
        </dl>

        {#if unavailable}
          <p
            class="flex items-center gap-1.5 rounded-sm border border-warning/25 bg-warning/10 px-2 py-1.5 text-[11px] text-warning"
          >
            <span class="iconify shrink-0 uil--exclamation-triangle" aria-hidden="true"></span>
            {m['voice.screen_stats_retrying']()}
          </p>
        {/if}
      </div>
    {/if}
  </div>
</aside>

<style>
  .screen-share-diagnostics-overlay {
    --diagnostics-safe-top: env(safe-area-inset-top, 0px);
    --diagnostics-safe-right: env(safe-area-inset-right, 0px);
    --diagnostics-safe-bottom: env(safe-area-inset-bottom, 0px);
    --diagnostics-safe-left: env(safe-area-inset-left, 0px);
    top: max(0.5rem, var(--diagnostics-safe-top));
    left: max(0.5rem, var(--diagnostics-safe-left));
    width: min(23rem, calc(100% - 1rem));
    max-height: min(22rem, calc(100% - 1rem));
    overscroll-behavior: contain;
    touch-action: pan-y;
  }

  .screen-share-diagnostics-overlay :global([class*='overflow-y-auto']) {
    -webkit-overflow-scrolling: touch;
  }

  .screen-share-diagnostics-grid {
    display: grid;
    gap: 0.25rem;
  }

  .screen-share-diagnostics-grid > div {
    display: grid;
    grid-template-columns: minmax(0, 45%) minmax(0, 1fr);
    gap: 0.5rem;
    align-items: baseline;
    border-radius: 0.25rem;
    background: rgb(255 255 255 / 0.055);
    padding: 0.375rem 0.5rem;
  }

  .screen-share-diagnostics-grid dt {
    min-width: 0;
    color: rgb(255 255 255 / 0.62);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .screen-share-diagnostics-grid dd {
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: right;
    color: rgb(255 255 255 / 0.92);
    font-weight: 600;
  }

  @media (max-width: 460px), (max-height: 460px) {
    .screen-share-diagnostics-overlay {
      right: max(0.5rem, var(--diagnostics-safe-right));
      bottom: max(0.5rem, var(--diagnostics-safe-bottom));
      width: auto;
      max-height: calc(100% - 1rem);
    }

    .screen-share-diagnostics-grid > div {
      grid-template-columns: minmax(0, 42%) minmax(0, 1fr);
    }
  }
</style>
