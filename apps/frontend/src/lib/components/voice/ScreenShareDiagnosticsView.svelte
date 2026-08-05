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
    appendScreenShareDiagnosticsSample,
    collectScreenShareDiagnostics,
    mergeScreenShareDiagnosticsSample,
    SCREEN_SHARE_DIAGNOSTICS_INTERVAL_MS,
    type ScreenShareDiagnosticsCounters,
    type ScreenShareDiagnosticsDirection,
    type ScreenShareDiagnosticsHealth,
    type ScreenShareDiagnosticsSample
  } from '$lib/voice/screenShareDiagnostics';
  import ScreenShareSparkline from './ScreenShareSparkline.svelte';

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
  let history = $state<ScreenShareDiagnosticsSample[]>([]);
  let loading = $state(true);
  let unavailable = $state(false);
  let technicalDetailsOpen = $state(false);
  let stale = $state(false);
  let formattingLocale = $derived(getFormattingLocale());

  $effect(() => {
    const activeTrack = track;
    const activeDirection = direction;
    let counters: ScreenShareDiagnosticsCounters | null = null;
    let cancelled = false;
    let inFlight = false;
    let consecutiveFailures = 0;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    sample = null;
    history = [];
    technicalDetailsOpen = false;
    loading = true;
    unavailable = false;
    stale = false;

    const scheduleStaleState = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        if (!cancelled) stale = true;
      }, SCREEN_SHARE_DIAGNOSTICS_INTERVAL_MS * 2 + 500);
    };

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
        const nextSample = mergeScreenShareDiagnosticsSample(sample, result.sample);
        sample = nextSample;
        history = appendScreenShareDiagnosticsSample(history, result.sample);
        unavailable = false;
        stale = false;
        scheduleStaleState();
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
      if (staleTimer) clearTimeout(staleTimer);
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

  function formatBytes(value: number | null): string {
    if (value === null) return '—';
    if (value >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)} MB`;
    if (value >= 1_000) return `${formatNumber(value / 1_000, 1)} kB`;
    return `${formatNumber(value)} B`;
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

  function formatDuration(value: number | null): string {
    if (value === null) return '—';
    return value >= 1_000 ? `${formatNumber(value / 1_000, 1)} s` : `${formatNumber(value)} ms`;
  }

  function sampleIsLive(): boolean {
    return !stale;
  }

  function displayedHealth(current: ScreenShareDiagnosticsSample): ScreenShareDiagnosticsHealth {
    return unavailable || !sampleIsLive() ? 'unknown' : current.health;
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

  function candidatePath(current: ScreenShareDiagnosticsSample): string {
    const candidates = [current.localCandidateType, current.remoteCandidateType].filter(Boolean);
    const path = candidates.length ? candidates.join(' → ') : '—';
    const context = [current.networkType, current.protocol?.toUpperCase()]
      .filter(Boolean)
      .join(' · ');
    return context ? `${path} · ${context}` : path;
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

  function eventDurationValue(
    count: number | null,
    durationMs: number | null,
    countDelta: number | null,
    durationDeltaMs: number | null
  ): string {
    const total = `${formatNumber(count)} · ${formatDuration(durationMs)}`;
    if (countDelta === null && durationDeltaMs === null) return total;
    return `${total} · Δ ${formatNumber(countDelta)} · ${formatDuration(durationDeltaMs)}`;
  }

  function feedbackValue(current: ScreenShareDiagnosticsSample): string {
    const total = `${formatNumber(current.nackCount)} NACK · ${formatNumber(current.pliCount)} PLI · ${formatNumber(current.firCount)} FIR`;
    if (
      current.nackCountDelta === null &&
      current.pliCountDelta === null &&
      current.firCountDelta === null
    ) {
      return total;
    }
    return `${total} · Δ ${formatNumber(current.nackCountDelta)} / ${formatNumber(current.pliCountDelta)} / ${formatNumber(current.firCountDelta)}`;
  }

  function retransmissionValue(current: ScreenShareDiagnosticsSample): string {
    if (current.retransmittedPackets === null && current.retransmittedBytes === null) return '—';
    return `${formatNumber(current.retransmittedPackets)} · ${formatBytes(current.retransmittedBytes)}`;
  }

  function codecImplementation(current: ScreenShareDiagnosticsSample): string {
    return current.direction === 'outbound'
      ? (current.encoderImplementation ?? '—')
      : (current.decoderImplementation ?? '—');
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
  class="screen-share-diagnostics-overlay @container pointer-events-auto fixed z-[100] flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/20 bg-black/90 text-white shadow-2xl backdrop-blur-xl"
  data-testid="screen-share-diagnostics-panel"
>
  <header
    class="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/10 px-3 py-2.5 @min-[36rem]:px-4"
  >
    <span class="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      <span class="absolute inline-flex h-full w-full rounded-full bg-success opacity-25"></span>
      <span class="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-1.5">
        <h2
          class="truncate text-xs font-semibold tracking-wide text-white/90 uppercase @min-[36rem]:text-sm"
        >
          {m['voice.screen_stats_title']()}
        </h2>
        <span
          class="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-white/70 uppercase"
        >
          {direction === 'outbound'
            ? m['voice.screen_stats_sending']()
            : m['voice.screen_stats_receiving']()}
        </span>
      </div>
      <p class="truncate text-[10px] text-white/60 @min-[36rem]:text-[11px]">
        {m['voice.screen_stats_local_only']()}
      </p>
    </div>
    <button
      type="button"
      class="flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-md text-white/75 transition-[background-color,color,scale] hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white active:scale-[0.96]"
      title={m['voice.screen_stats_close']()}
      aria-label={m['voice.screen_stats_close']()}
      data-testid="screen-share-diagnostics-close"
      onclick={onclose}
    >
      <span class="iconify text-lg uil--times" aria-hidden="true"></span>
    </button>
  </header>

  <div
    class="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain p-3 @min-[36rem]:p-4"
    data-testid="screen-share-diagnostics-scroll"
  >
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
      <div class="space-y-3">
        <div
          class="screen-share-diagnostics-status flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-3 py-2"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span
              class={[
                'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                healthClass(displayedHealth(sample))
              ]}
            >
              {healthLabel(displayedHealth(sample))}
            </span>
            {#if qualityLimitValue(sample)}
              <span
                class="min-w-0 truncate rounded-full border border-warning/30 bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning"
              >
                {m['voice.screen_stats_quality_limit']()}: {qualityLimitValue(sample)}
              </span>
            {/if}
          </div>
          <span class="flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-white/70">
            <span
              class={['h-1.5 w-1.5 rounded-full', sampleIsLive() ? 'bg-success' : 'bg-warning']}
              aria-hidden="true"
            ></span>
            {sampleIsLive()
              ? m['voice.screen_stats_live']()
              : m['voice.screen_stats_health_unknown']()}
          </span>
        </div>

        <dl
          class="screen-share-diagnostics-grid text-[11px] leading-tight tabular-nums"
          data-testid="screen-share-diagnostics-summary"
          aria-live="off"
        >
          <div data-screen-share-metric="resolution">
            <dt>{m['voice.screen_stats_resolution']()}</dt>
            <dd>{formatResolution(sample.width, sample.height)}</dd>
          </div>
          {#if direction === 'outbound'}
            <div data-screen-share-metric="source-resolution">
              <dt>{m['voice.screen_stats_source_resolution']()}</dt>
              <dd>{formatResolution(sample.sourceWidth, sample.sourceHeight)}</dd>
            </div>
          {/if}
          <div data-screen-share-metric="fps">
            <dt>{m['voice.screen_stats_fps']()}</dt>
            <dd>{formatNumber(sample.framesPerSecond, 1)} FPS</dd>
          </div>
          <div data-screen-share-metric="bitrate">
            <dt>{m['voice.screen_stats_bitrate']()}</dt>
            <dd>{formatBitrate(sample.bitrateBps)}</dd>
          </div>
          <div data-screen-share-metric="bandwidth">
            <dt>{m['voice.screen_stats_available_bandwidth']()}</dt>
            <dd>{formatBitrate(sample.availableBitrateBps)}</dd>
          </div>
          <div data-screen-share-metric="packet-loss">
            <dt>{m['voice.screen_stats_packet_loss']()}</dt>
            <dd>{formatPercent(sample.packetLossPercent)}</dd>
          </div>
          <div data-screen-share-metric="packets">
            <dt>{m['voice.screen_stats_packets']()}</dt>
            <dd>{packetsValue(sample)}</dd>
          </div>
          <div data-screen-share-metric="frames">
            <dt>{m['voice.screen_stats_frames']()}</dt>
            <dd>{framesValue(sample)}</dd>
          </div>
          {#if direction === 'inbound'}
            <div data-screen-share-metric="frame-drop">
              <dt>{m['voice.screen_stats_frame_drop']()}</dt>
              <dd>{formatPercent(sample.frameDropPercent)}</dd>
            </div>
          {/if}
          <div data-screen-share-metric="rtt-jitter">
            <dt>{m['voice.screen_stats_rtt']()} / {m['voice.screen_stats_jitter']()}</dt>
            <dd>
              {formatMilliseconds(sample.roundTripTimeMs)} / {formatMilliseconds(sample.jitterMs)}
            </dd>
          </div>
          <div data-screen-share-metric="codec">
            <dt>{m['voice.screen_stats_codec']()}</dt>
            <dd class="font-mono">{sample.codec ?? '—'}</dd>
          </div>
        </dl>

        <details
          class="group overflow-hidden rounded-md border border-white/10 bg-white/[0.035]"
          data-testid="screen-share-diagnostics-details"
          bind:open={technicalDetailsOpen}
        >
          <summary
            class="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-2 text-[11px] font-semibold text-white/80 focus-visible:outline-2 focus-visible:outline-white"
          >
            <span class="flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap">
              <span class="iconify text-sm text-white/55 uil--chart-line" aria-hidden="true"></span>
              {m['voice.screen_stats_technical_details']()}
            </span>
            <span
              class="iconify text-sm text-white/55 transition-transform uil--angle-down group-open:rotate-180"
              aria-hidden="true"
            ></span>
          </summary>

          {#if technicalDetailsOpen}
            <div class="space-y-2 border-t border-white/10 p-2">
              <section aria-labelledby={`${panelId}-trends`}>
                <h3
                  id={`${panelId}-trends`}
                  class="mb-1.5 truncate text-[10px] font-semibold tracking-wide whitespace-nowrap text-white/55 uppercase"
                >
                  {m['voice.screen_stats_last_60_seconds']()}
                </h3>
                <div class="diagnostics-trends grid grid-cols-1 gap-1.5 @min-[330px]:grid-cols-2">
                  <ScreenShareSparkline
                    label={m['voice.screen_stats_bitrate']()}
                    value={formatBitrate(sample.bitrateBps)}
                    points={history.map((item) => ({
                      collectedAt: item.collectedAt,
                      value: item.bitrateBps
                    }))}
                  />
                  <ScreenShareSparkline
                    label={m['voice.screen_stats_fps']()}
                    value={`${formatNumber(sample.framesPerSecond, 1)} FPS`}
                    points={history.map((item) => ({
                      collectedAt: item.collectedAt,
                      value: item.framesPerSecond
                    }))}
                    color="warning"
                  />
                  <ScreenShareSparkline
                    label={m['voice.screen_stats_packet_loss']()}
                    value={formatPercent(sample.packetLossPercent)}
                    points={history.map((item) => ({
                      collectedAt: item.collectedAt,
                      value: item.packetLossPercent
                    }))}
                    color="danger"
                  />
                  <ScreenShareSparkline
                    label={m['voice.screen_stats_freezes']()}
                    value={formatDuration(sample.freezeDurationDeltaMs)}
                    points={history.map((item) => ({
                      collectedAt: item.collectedAt,
                      value: item.freezeDurationDeltaMs
                    }))}
                    color="danger"
                  />
                </div>
              </section>

              <section aria-labelledby={`${panelId}-transport`}>
                <h3
                  id={`${panelId}-transport`}
                  class="mb-1 truncate text-[10px] font-semibold tracking-wide whitespace-nowrap text-white/55 uppercase"
                >
                  {m['voice.screen_stats_transport']()}
                </h3>
                <dl class="screen-share-diagnostics-grid text-[11px] leading-tight tabular-nums">
                  <div>
                    <dt>{m['voice.screen_stats_available_bandwidth']()}</dt>
                    <dd>{formatBitrate(sample.availableBitrateBps)}</dd>
                  </div>
                  <div>
                    <dt>{m['voice.screen_stats_rtt']()} / {m['voice.screen_stats_jitter']()}</dt>
                    <dd>
                      {formatMilliseconds(sample.roundTripTimeMs)} / {formatMilliseconds(
                        sample.jitterMs
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{m['voice.screen_stats_packets']()}</dt>
                    <dd>{packetsValue(sample)}</dd>
                  </div>
                  <div>
                    <dt>{m['voice.screen_stats_candidate_path']()}</dt>
                    <dd class="font-mono">{candidatePath(sample)}</dd>
                  </div>
                  {#if direction === 'inbound'}
                    <div>
                      <dt>{m['voice.screen_stats_jitter_buffer']()}</dt>
                      <dd>{formatMilliseconds(sample.jitterBufferDelayMs)}</dd>
                    </div>
                  {/if}
                </dl>
              </section>

              <section aria-labelledby={`${panelId}-pipeline`}>
                <h3
                  id={`${panelId}-pipeline`}
                  class="mb-1 truncate text-[10px] font-semibold tracking-wide whitespace-nowrap text-white/55 uppercase"
                >
                  {m['voice.screen_stats_video_pipeline']()}
                </h3>
                <dl class="screen-share-diagnostics-grid text-[11px] leading-tight tabular-nums">
                  <div>
                    <dt>{m['voice.screen_stats_frames']()}</dt>
                    <dd>{framesValue(sample)}</dd>
                  </div>
                  <div>
                    <dt>{m['voice.screen_stats_codec']()}</dt>
                    <dd class="font-mono">{sample.codec ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{m['voice.screen_stats_implementation']()}</dt>
                    <dd class="font-mono">{codecImplementation(sample)}</dd>
                  </div>
                  <div>
                    <dt>{m['voice.screen_stats_power_efficient']()}</dt>
                    <dd>
                      {sample.powerEfficientCodec === null
                        ? '—'
                        : sample.powerEfficientCodec
                          ? m['voice.screen_stats_yes']()
                          : m['voice.screen_stats_no']()}
                    </dd>
                  </div>
                  {#if direction === 'inbound'}
                    <div>
                      <dt>{m['voice.screen_stats_frame_drop']()}</dt>
                      <dd>{formatPercent(sample.frameDropPercent)}</dd>
                    </div>
                    <div>
                      <dt>{m['voice.screen_stats_key_frames']()}</dt>
                      <dd>{formatNumber(sample.keyFrames)}</dd>
                    </div>
                    <div>
                      <dt>{m['voice.screen_stats_freezes']()}</dt>
                      <dd>
                        {eventDurationValue(
                          sample.freezeCount,
                          sample.totalFreezeDurationMs,
                          sample.freezeCountDelta,
                          sample.freezeDurationDeltaMs
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{m['voice.screen_stats_pauses']()}</dt>
                      <dd>
                        {eventDurationValue(
                          sample.pauseCount,
                          sample.totalPauseDurationMs,
                          sample.pauseCountDelta,
                          sample.pauseDurationDeltaMs
                        )}
                      </dd>
                    </div>
                  {/if}
                  {#if sample.contentHint}
                    <div>
                      <dt>{m['voice.screen_stats_content_hint']()}</dt>
                      <dd class="font-mono">{sample.contentHint}</dd>
                    </div>
                  {/if}
                </dl>
              </section>

              <section aria-labelledby={`${panelId}-control`}>
                <h3
                  id={`${panelId}-control`}
                  class="mb-1 truncate text-[10px] font-semibold tracking-wide whitespace-nowrap text-white/55 uppercase"
                >
                  {direction === 'outbound'
                    ? m['voice.screen_stats_congestion_control']()
                    : m['voice.screen_stats_reception_details']()}
                </h3>
                <dl class="screen-share-diagnostics-grid text-[11px] leading-tight tabular-nums">
                  <div>
                    <dt>{m['voice.screen_stats_layers']()}</dt>
                    <dd>{formatNumber(sample.activeLayerCount)}</dd>
                  </div>
                  <div>
                    <dt>{m['voice.screen_stats_feedback']()}</dt>
                    <dd class="font-mono">{feedbackValue(sample)}</dd>
                  </div>
                  {#if direction === 'outbound'}
                    <div>
                      <dt>{m['voice.screen_stats_target_bitrate']()}</dt>
                      <dd>{formatBitrate(sample.targetBitrateBps)}</dd>
                    </div>
                    <div>
                      <dt>{m['voice.screen_stats_quality_limit']()}</dt>
                      <dd class="font-mono">{qualityLimitValue(sample) ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>{m['voice.screen_stats_resolution_changes']()}</dt>
                      <dd>{formatNumber(sample.qualityLimitationResolutionChanges)}</dd>
                    </div>
                    <div>
                      <dt>{m['voice.screen_stats_retransmissions']()}</dt>
                      <dd>{retransmissionValue(sample)}</dd>
                    </div>
                  {/if}
                </dl>
              </section>

              {#if sample.layers.length > 1}
                <section aria-labelledby={`${panelId}-layers`}>
                  <h3
                    id={`${panelId}-layers`}
                    class="mb-1 truncate text-[10px] font-semibold tracking-wide whitespace-nowrap text-white/55 uppercase"
                  >
                    {m['voice.screen_stats_layers']()}
                  </h3>
                  <ul class="space-y-1 text-[10px] tabular-nums">
                    {#each sample.layers as layer (layer.id)}
                      <li class="rounded-sm bg-white/[0.055] px-2 py-1.5">
                        <div class="flex min-w-0 items-center justify-between gap-2">
                          <span class="truncate font-mono font-semibold"
                            >{layer.rid ?? layer.id}</span
                          >
                          <span class="shrink-0 text-white/65">
                            {`${formatResolution(layer.width, layer.height)} · ${formatNumber(
                              layer.framesPerSecond,
                              1
                            )} FPS`}
                          </span>
                        </div>
                        <div
                          class="mt-0.5 truncate whitespace-nowrap text-white/55"
                          title={`${formatBitrate(layer.bitrateBps)} · ${formatBitrate(
                            layer.targetBitrateBps
                          )} · ${layer.scalabilityMode ?? layer.codec ?? '—'}`}
                        >
                          {formatBitrate(layer.bitrateBps)} · {formatBitrate(
                            layer.targetBitrateBps
                          )} ·
                          {layer.scalabilityMode ?? layer.codec ?? '—'}
                        </div>
                      </li>
                    {/each}
                  </ul>
                </section>
              {/if}
            </div>
          {/if}
        </details>

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
    right: max(0.5rem, var(--diagnostics-safe-right));
    left: max(0.5rem, var(--diagnostics-safe-left));
    width: auto;
    max-width: 46rem;
    max-height: calc(100dvh - 1rem);
    margin-inline: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
    animation: diagnostics-panel-enter 160ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .screen-share-diagnostics-overlay :global([class*='overflow-y-auto']) {
    -webkit-overflow-scrolling: touch;
  }

  .screen-share-diagnostics-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.375rem;
  }

  @container (min-width: 32rem) {
    .screen-share-diagnostics-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .screen-share-diagnostics-grid > div {
    display: grid;
    grid-template-columns: minmax(0, 42%) minmax(0, 1fr);
    gap: 0.625rem;
    min-height: 2.75rem;
    align-items: center;
    border: 1px solid rgb(255 255 255 / 0.08);
    border-radius: 0.5rem;
    background: rgb(255 255 255 / 0.045);
    padding: 0.5rem 0.625rem;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    color: rgb(255 255 255 / 0.92);
    font-weight: 600;
  }

  @keyframes diagnostics-panel-enter {
    from {
      opacity: 0;
      scale: 0.985;
      translate: 0 0.5rem;
    }
    to {
      opacity: 1;
      scale: 1;
      translate: 0 0;
    }
  }

  .diagnostics-trends :global(figure) {
    border-color: rgb(255 255 255 / 0.1);
    background: rgb(255 255 255 / 0.055);
    color: rgb(255 255 255 / 0.92);
  }

  .diagnostics-trends :global(figcaption > span) {
    color: rgb(255 255 255 / 0.62);
  }

  .diagnostics-trends :global(figcaption > strong) {
    color: rgb(255 255 255 / 0.92);
  }

  @media (max-width: 460px), (max-height: 460px) {
    .screen-share-diagnostics-overlay {
      right: max(0.5rem, var(--diagnostics-safe-right));
      bottom: max(0.5rem, var(--diagnostics-safe-bottom));
      left: max(0.5rem, var(--diagnostics-safe-left));
      width: auto;
      max-height: calc(100% - 1rem);
      transform: none;
    }

    .screen-share-diagnostics-grid > div {
      grid-template-columns: minmax(0, 42%) minmax(0, 1fr);
    }
  }

  @media (max-height: 460px) {
    .screen-share-diagnostics-overlay {
      position: fixed;
      z-index: 100;
      top: max(0.5rem, var(--diagnostics-safe-top));
      right: auto;
      bottom: max(0.5rem, var(--diagnostics-safe-bottom));
      left: max(0.5rem, var(--diagnostics-safe-left));
      width: min(23rem, calc(100% - 1rem));
      max-height: none;
      transform: none;
    }
  }

  @media (max-width: 360px) {
    .screen-share-diagnostics-overlay {
      position: fixed;
      z-index: 100;
      top: max(0.5rem, var(--diagnostics-safe-top));
      right: max(0.5rem, var(--diagnostics-safe-right));
      bottom: max(0.5rem, var(--diagnostics-safe-bottom));
      left: max(0.5rem, var(--diagnostics-safe-left));
      width: auto;
      max-height: none;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .screen-share-diagnostics-overlay {
      animation: none;
    }
  }
</style>
