<!--
@component

Opt-in “stats for nerds” panel for one live screen-share track. Collection is
strictly local, starts only while this component is mounted, and stops on close.
-->
<script lang="ts">
  import type { Track } from 'livekit-client';
  import type { Attachment } from 'svelte/attachments';
  import * as m from '$lib/i18n/messages';
  import { getFormattingLocale } from '$lib/i18n/runtime';
  import {
    appendScreenShareDiagnosticsSample,
    collectScreenShareDiagnostics,
    mergeScreenShareDiagnosticsSample,
    SCREEN_SHARE_DIAGNOSTICS_INTERVAL_MS,
    screenShareDiagnosticsSampleIsPartial,
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
  let partialSample = $state(false);
  let formattingLocale = $derived(getFormattingLocale());

  $effect(() => {
    const activeTrack = track;
    const activeDirection = direction;
    let counters: ScreenShareDiagnosticsCounters | null = null;
    let cancelled = false;
    let inFlight = false;
    let consecutiveFailures = 0;
    sample = null;
    history = [];
    loading = true;
    unavailable = false;
    partialSample = false;

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
        partialSample = screenShareDiagnosticsSampleIsPartial(nextSample);
        sample = nextSample;
        history = appendScreenShareDiagnosticsSample(history, nextSample);
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
        return 'border-success/30 bg-success/10 text-success';
      case 'good':
        return 'border-accent/30 bg-accent/10 text-accent';
      case 'degraded':
        return 'border-warning/30 bg-warning/10 text-warning';
      case 'poor':
        return 'border-danger/30 bg-danger/10 text-danger';
      default:
        return 'border-text/10 bg-surface-200 text-muted';
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

  function qualityLimitValue(current: ScreenShareDiagnosticsSample): string {
    if (!current.qualityLimitationReason) return '—';
    const durations = current.qualityLimitationDurations
      ? Object.entries(current.qualityLimitationDurations)
          .sort((left, right) => right[1] - left[1])
          .map(([reason, duration]) => `${reason} ${formatNumber(duration, 1)} s`)
          .join(' · ')
      : '';
    return durations
      ? `${current.qualityLimitationReason} · ${durations}`
      : current.qualityLimitationReason;
  }

  function retransmissionValue(current: ScreenShareDiagnosticsSample): string {
    if (current.retransmittedPackets === null && current.retransmittedBytes === null) return '—';
    return `${formatNumber(current.retransmittedPackets)} · ${formatBytes(current.retransmittedBytes)}`;
  }

  function feedbackValue(current: ScreenShareDiagnosticsSample): string {
    return `${formatNumber(current.nackCount)} NACK · ${formatNumber(current.pliCount)} PLI · ${formatNumber(current.firCount)} FIR`;
  }

  function codecImplementation(current: ScreenShareDiagnosticsSample): string {
    return current.direction === 'outbound'
      ? (current.encoderImplementation ?? '—')
      : (current.decoderImplementation ?? '—');
  }

  function trendPoints(
    items: ScreenShareDiagnosticsSample[],
    read: (item: ScreenShareDiagnosticsSample) => number | null
  ): Array<{ collectedAt: number; value: number | null }> {
    return items.map((item) => ({ collectedAt: item.collectedAt, value: read(item) }));
  }

  function chartTarget(...values: Array<number | null>): number | null {
    const finiteValues = values.filter(
      (item): item is number => item !== null && Number.isFinite(item)
    );
    return finiteValues.length ? Math.max(...finiteValues) : null;
  }

  function fpsChartTarget(current: ScreenShareDiagnosticsSample): number {
    return Math.max(current.sourceFramesPerSecond ?? 0, current.framesPerSecond ?? 0, 30);
  }

  function diagnosticHighlights(current: ScreenShareDiagnosticsSample): string[] {
    const highlights: string[] = [];

    if (
      current.qualityLimitationReason !== null &&
      !['none', 'other'].includes(current.qualityLimitationReason)
    ) {
      highlights.push(
        `${m['voice.screen_stats_quality_limit']()}: ${current.qualityLimitationReason}`
      );
    }

    if (current.roundTripTimeMs !== null && current.roundTripTimeMs >= 300) {
      highlights.push(
        `${m['voice.screen_stats_rtt']()}: ${formatMilliseconds(current.roundTripTimeMs)}`
      );
    }

    if (current.jitterMs !== null && current.jitterMs >= 50) {
      highlights.push(
        `${m['voice.screen_stats_jitter']()}: ${formatMilliseconds(current.jitterMs)}`
      );
    }

    if (current.framesPerSecond !== null && current.framesPerSecond < 24) {
      highlights.push(
        `${m['voice.screen_stats_fps']()}: ${formatNumber(current.framesPerSecond, 1)} FPS`
      );
    }

    if (current.packetLossPercent !== null && current.packetLossPercent >= 2) {
      highlights.push(
        `${m['voice.screen_stats_packet_loss']()}: ${formatPercent(current.packetLossPercent)}`
      );
    }

    if (current.frameDropPercent !== null && current.frameDropPercent >= 3) {
      highlights.push(
        `${m['voice.screen_stats_frame_drop']()}: ${formatPercent(current.frameDropPercent)}`
      );
    }

    return highlights.slice(0, 4);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onclose();
  }

  function stopPanelInteraction(event: Event): void {
    event.stopPropagation();
  }

  const mountPanelInDocumentBody: Attachment<HTMLDivElement> = (node) => {
    if (typeof document === 'undefined') return;

    const placeholder = document.createComment('screen-share-diagnostics');
    const parent = node.parentNode;
    const previousBodyOverflow = document.body.style.overflow;

    parent?.insertBefore(placeholder, node);
    document.body.appendChild(node);
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      node.remove();
      placeholder.remove();
    };
  };

  const focusOnMount: Attachment<HTMLButtonElement> = (node) => {
    node.focus();
  };
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  id={panelId}
  role="dialog"
  aria-modal="true"
  aria-label={m['voice.screen_stats_title']()}
  aria-describedby={`${panelId}-privacy`}
  tabindex="-1"
  class="screen-share-diagnostics-panel @container fixed z-[10000] flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-text/15 bg-background/95 text-text shadow-2xl backdrop-blur-xl"
  data-testid="screen-share-diagnostics-panel"
  onpointerdown={stopPanelInteraction}
  onclick={stopPanelInteraction}
  onkeydown={stopPanelInteraction}
  ontouchstart={stopPanelInteraction}
  onwheel={stopPanelInteraction}
  {@attach mountPanelInDocumentBody}
>
  <header
    class="flex shrink-0 items-center gap-2 border-b border-border/80 bg-surface-100/90 px-3 py-2"
  >
    <span class="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
      <span class="absolute inline-flex h-full w-full rounded-full bg-success opacity-25"></span>
      <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-success"></span>
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="truncate text-sm font-semibold">{m['voice.screen_stats_title']()}</h2>
        <span
          class="rounded-full border border-text/10 bg-surface-200 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase"
        >
          {direction === 'outbound'
            ? m['voice.screen_stats_sending']()
            : m['voice.screen_stats_receiving']()}
        </span>
      </div>
      <p id={`${panelId}-privacy`} class="truncate text-[10px] text-muted">
        {m['voice.screen_stats_local_only']()}
      </p>
    </div>
    <button
      type="button"
      class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-[background-color,color,scale] hover:bg-surface-200 hover:text-text focus-visible:outline-2 focus-visible:outline-primary active:scale-[0.96]"
      title={m['voice.screen_stats_close']()}
      aria-label={m['voice.screen_stats_close']()}
      data-testid="screen-share-diagnostics-close"
      onclick={onclose}
      {@attach focusOnMount}
    >
      <span class="iconify text-lg uil--times" aria-hidden="true"></span>
    </button>
  </header>

  <div
    class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-2 @min-[560px]:p-3"
  >
    {#if loading && !sample}
      <div class="flex min-h-40 items-center justify-center gap-2 text-sm text-muted">
        <span class="iconify animate-spin text-lg uil--spinner" aria-hidden="true"></span>
        <span>{m['voice.screen_stats_loading']()}</span>
      </div>
    {:else if unavailable && !sample}
      <div class="flex min-h-40 flex-col items-center justify-center gap-2 px-5 text-center">
        <span class="iconify text-2xl text-warning uil--chart-line" aria-hidden="true"></span>
        <p class="text-sm font-medium">{m['voice.screen_stats_unavailable']()}</p>
        <p class="text-xs text-muted">{m['voice.screen_stats_retrying']()}</p>
      </div>
    {:else if sample}
      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <span
            class={[
              'rounded-full border px-2.5 py-1 text-xs font-semibold',
              healthClass(sample.health)
            ]}
          >
            {healthLabel(sample.health)}
          </span>
        </div>

        {#if partialSample || unavailable || diagnosticHighlights(sample).length}
          <div
            class="flex flex-col gap-2 rounded-md border border-text/10 bg-surface-100/65 p-2 text-xs @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:justify-between"
          >
            <div class="flex items-center gap-2 text-muted">
              <span class="iconify shrink-0 uil--info-circle" aria-hidden="true"></span>
              <span>
                {#if unavailable}
                  {m['voice.screen_stats_retrying']()}
                {:else if partialSample}
                  {m['voice.screen_stats_partial_sample']()}
                {:else}
                  {m['voice.screen_stats_observed_causes']()}
                {/if}
              </span>
            </div>
            {#if diagnosticHighlights(sample).length}
              <ul class="flex flex-wrap gap-1.5">
                {#each diagnosticHighlights(sample) as highlight}
                  <li
                    class="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
                  >
                    {highlight}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}

        <div class="grid grid-cols-2 gap-2 @min-[560px]:grid-cols-3 @min-[900px]:grid-cols-6">
          <div class="rounded-md border border-text/10 bg-surface-100/80 p-2.5">
            <div class="text-[10px] font-medium text-muted">
              {m['voice.screen_stats_resolution']()}
            </div>
            <div class="mt-1 truncate text-base font-semibold tabular-nums">
              {formatResolution(sample.width, sample.height)}
            </div>
          </div>
          <div class="rounded-md border border-text/10 bg-surface-100/80 p-2.5">
            <div class="text-[10px] font-medium text-muted">{m['voice.screen_stats_fps']()}</div>
            <div class="mt-1 text-base font-semibold tabular-nums">
              {formatNumber(sample.framesPerSecond, 1)} FPS
            </div>
          </div>
          <div class="rounded-md border border-text/10 bg-surface-100/80 p-2.5">
            <div class="text-[10px] font-medium text-muted">
              {m['voice.screen_stats_bitrate']()}
            </div>
            <div class="mt-1 text-base font-semibold tabular-nums">
              {formatBitrate(sample.bitrateBps)}
            </div>
          </div>
          <div class="rounded-md border border-text/10 bg-surface-100/80 p-2.5">
            <div class="text-[10px] font-medium text-muted">
              {m['voice.screen_stats_packet_loss']()}
            </div>
            <div class="mt-1 text-base font-semibold tabular-nums">
              {formatPercent(sample.packetLossPercent)}
            </div>
          </div>
          <div class="rounded-md border border-text/10 bg-surface-100/80 p-2.5">
            <div class="text-[10px] font-medium text-muted">{m['voice.screen_stats_rtt']()}</div>
            <div class="mt-1 text-base font-semibold tabular-nums">
              {formatMilliseconds(sample.roundTripTimeMs)}
            </div>
          </div>
          <div class="rounded-md border border-text/10 bg-surface-100/80 p-2.5">
            <div class="text-[10px] font-medium text-muted">{m['voice.screen_stats_codec']()}</div>
            <div class="mt-1 truncate font-mono text-base font-semibold">
              {sample.codec ?? '—'}
            </div>
          </div>
        </div>

        <section aria-labelledby={`${panelId}-trends`}>
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <h3
              id={`${panelId}-trends`}
              class="text-[11px] font-semibold tracking-wide text-muted uppercase"
            >
              {m['voice.screen_stats_last_60_seconds']()}
            </h3>
          </div>
          <div class="grid grid-cols-1 gap-2 @min-[560px]:grid-cols-3">
            <ScreenShareSparkline
              label={m['voice.screen_stats_bitrate']()}
              value={formatBitrate(sample.bitrateBps)}
              points={trendPoints(history, (item) => item.bitrateBps)}
              targetValue={chartTarget(
                sample.bitrateBps,
                sample.targetBitrateBps,
                sample.availableBitrateBps
              )}
            />
            <ScreenShareSparkline
              label={m['voice.screen_stats_fps']()}
              value={`${formatNumber(sample.framesPerSecond, 1)} FPS`}
              points={trendPoints(history, (item) => item.framesPerSecond)}
              color="warning"
              targetValue={fpsChartTarget(sample)}
            />
            <ScreenShareSparkline
              label={m['voice.screen_stats_packet_loss']()}
              value={formatPercent(sample.packetLossPercent)}
              points={trendPoints(history, (item) => item.packetLossPercent)}
              color="danger"
              targetValue={5}
            />
          </div>
        </section>

        <section class="rounded-md border border-text/10 bg-surface-100/35">
          <div class="flex min-h-11 items-center gap-2 px-3 py-2 text-sm font-semibold">
            <span class="iconify text-muted uil--wrench" aria-hidden="true"></span>
            <span>{m['voice.screen_stats_technical_details']()}</span>
          </div>
          <div class="space-y-2 border-t border-border/70 p-2">
            <div class="grid grid-cols-1 gap-2 @min-[700px]:grid-cols-3">
              <section class="rounded-md border border-text/10 bg-surface-100/55 p-3">
                <h3 class="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                  <span class="iconify text-muted uil--exchange" aria-hidden="true"></span>
                  {m['voice.screen_stats_transport']()}
                </h3>
                <dl class="space-y-2 text-xs">
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_available_bandwidth']()}</dt>
                    <dd class="font-medium tabular-nums">
                      {formatBitrate(sample.availableBitrateBps)}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_rtt']()}</dt>
                    <dd class="font-medium tabular-nums">
                      {formatMilliseconds(sample.roundTripTimeMs)}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_jitter']()}</dt>
                    <dd class="font-medium tabular-nums">{formatMilliseconds(sample.jitterMs)}</dd>
                  </div>
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_packets']()}</dt>
                    <dd class="font-medium break-words tabular-nums">{packetsValue(sample)}</dd>
                  </div>
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_candidate_path']()}</dt>
                    <dd class="font-mono text-[11px] font-medium break-words">
                      {candidatePath(sample)}
                    </dd>
                  </div>
                </dl>
              </section>

              <section class="rounded-md border border-text/10 bg-surface-100/55 p-3">
                <h3 class="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                  <span class="iconify text-muted uil--processor" aria-hidden="true"></span>
                  {m['voice.screen_stats_video_pipeline']()}
                </h3>
                <dl class="space-y-2 text-xs">
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_codec']()}</dt>
                    <dd class="font-mono text-[11px] font-medium">{sample.codec ?? '—'}</dd>
                  </div>
                  {#if direction === 'outbound'}
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_source_resolution']()}</dt>
                      <dd class="font-medium tabular-nums">
                        {formatResolution(sample.sourceWidth, sample.sourceHeight)}
                      </dd>
                    </div>
                  {/if}
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_frames']()}</dt>
                    <dd class="font-medium break-words tabular-nums">{framesValue(sample)}</dd>
                  </div>
                  {#if direction === 'inbound'}
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_frame_drop']()}</dt>
                      <dd class="font-medium tabular-nums">
                        {formatPercent(sample.frameDropPercent)}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_freezes']()}</dt>
                      <dd class="font-medium tabular-nums">
                        {formatNumber(sample.freezeCount)} · {formatDuration(
                          sample.totalFreezeDurationMs
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_jitter_buffer']()}</dt>
                      <dd class="font-medium tabular-nums">
                        {formatMilliseconds(sample.jitterBufferDelayMs)}
                      </dd>
                    </div>
                  {/if}
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_implementation']()}</dt>
                    <dd class="font-mono text-[11px] font-medium break-words">
                      {codecImplementation(sample)}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_power_efficient']()}</dt>
                    <dd class="font-medium">
                      {sample.powerEfficientCodec === null
                        ? '—'
                        : sample.powerEfficientCodec
                          ? m['voice.screen_stats_yes']()
                          : m['voice.screen_stats_no']()}
                    </dd>
                  </div>
                  {#if sample.contentHint}
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_content_hint']()}</dt>
                      <dd class="font-mono text-[11px] font-medium">{sample.contentHint}</dd>
                    </div>
                  {/if}
                </dl>
              </section>

              <section class="rounded-md border border-text/10 bg-surface-100/55 p-3">
                <h3 class="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                  <span class="iconify text-muted uil--signal-alt-3" aria-hidden="true"></span>
                  {direction === 'outbound'
                    ? m['voice.screen_stats_congestion_control']()
                    : m['voice.screen_stats_reception_details']()}
                </h3>
                <dl class="space-y-2 text-xs">
                  {#if direction === 'outbound'}
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_target_bitrate']()}</dt>
                      <dd class="font-medium tabular-nums">
                        {formatBitrate(sample.targetBitrateBps)}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_quality_limit']()}</dt>
                      <dd class="font-mono text-[11px] font-medium break-words">
                        {qualityLimitValue(sample)}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_resolution_changes']()}</dt>
                      <dd class="font-medium tabular-nums">
                        {formatNumber(sample.qualityLimitationResolutionChanges)}
                      </dd>
                    </div>
                  {:else}
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_key_frames']()}</dt>
                      <dd class="font-medium tabular-nums">{formatNumber(sample.keyFrames)}</dd>
                    </div>
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_pauses']()}</dt>
                      <dd class="font-medium tabular-nums">
                        {formatNumber(sample.pauseCount)} · {formatDuration(
                          sample.totalPauseDurationMs
                        )}
                      </dd>
                    </div>
                  {/if}
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_layers']()}</dt>
                    <dd class="font-medium tabular-nums">
                      {formatNumber(sample.activeLayerCount)}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-muted">{m['voice.screen_stats_feedback']()}</dt>
                    <dd class="font-mono text-[11px] font-medium break-words">
                      {feedbackValue(sample)}
                    </dd>
                  </div>
                  {#if direction === 'outbound'}
                    <div>
                      <dt class="text-muted">{m['voice.screen_stats_retransmissions']()}</dt>
                      <dd class="font-medium break-words tabular-nums">
                        {retransmissionValue(sample)}
                      </dd>
                    </div>
                  {/if}
                </dl>
              </section>
            </div>

            {#if direction === 'outbound' && sample.layers.length > 1}
              <section class="overflow-hidden rounded-md border border-text/10 bg-surface-100/55">
                <h3 class="border-b border-border/70 px-3 py-2 text-xs font-semibold">
                  {m['voice.screen_stats_layers']()}
                </h3>
                <div class="overflow-x-auto">
                  <table class="w-full min-w-[520px] text-left text-xs tabular-nums">
                    <thead class="text-[10px] text-muted uppercase">
                      <tr
                        ><th class="px-3 py-2">RID</th><th class="px-3 py-2"
                          >{m['voice.screen_stats_resolution']()}</th
                        ><th class="px-3 py-2">FPS</th><th class="px-3 py-2"
                          >{m['voice.screen_stats_bitrate']()}</th
                        ><th class="px-3 py-2">{m['voice.screen_stats_target_bitrate']()}</th><th
                          class="px-3 py-2">Mode</th
                        ></tr
                      >
                    </thead>
                    <tbody class="divide-y divide-border/60">
                      {#each sample.layers as layer (layer.id)}
                        <tr
                          ><td class="px-3 py-2 font-mono">{layer.rid ?? '—'}</td><td
                            class="px-3 py-2">{formatResolution(layer.width, layer.height)}</td
                          ><td class="px-3 py-2">{formatNumber(layer.framesPerSecond, 1)}</td><td
                            class="px-3 py-2">{formatBitrate(layer.bitrateBps)}</td
                          ><td class="px-3 py-2">{formatBitrate(layer.targetBitrateBps)}</td><td
                            class="px-3 py-2 font-mono">{layer.scalabilityMode ?? '—'}</td
                          ></tr
                        >
                      {/each}
                    </tbody>
                  </table>
                </div>
              </section>
            {/if}
          </div>
        </section>

        {#if unavailable}
          <p
            class="flex items-center gap-1.5 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            <span class="iconify uil--exclamation-triangle" aria-hidden="true"></span>
            {m['voice.screen_stats_retrying']()}
          </p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .screen-share-diagnostics-panel {
    --diagnostics-safe-top: env(safe-area-inset-top, 0px);
    --diagnostics-safe-right: env(safe-area-inset-right, 0px);
    --diagnostics-safe-bottom: env(safe-area-inset-bottom, 0px);
    --diagnostics-safe-left: env(safe-area-inset-left, 0px);
    top: calc(var(--diagnostics-safe-top) + 0.5rem);
    right: calc(var(--diagnostics-safe-right) + 0.5rem);
    bottom: calc(var(--diagnostics-safe-bottom) + 0.5rem);
    left: calc(var(--diagnostics-safe-left) + 0.5rem);
    height: calc(100vh - var(--diagnostics-safe-top) - var(--diagnostics-safe-bottom) - 1rem);
    height: calc(100dvh - var(--diagnostics-safe-top) - var(--diagnostics-safe-bottom) - 1rem);
    overscroll-behavior: contain;
    touch-action: pan-y;
  }

  .screen-share-diagnostics-panel :global([class*='overflow-y-auto']) {
    -webkit-overflow-scrolling: touch;
  }

  @media (min-width: 720px) {
    .screen-share-diagnostics-panel {
      top: calc(var(--diagnostics-safe-top) + 1rem);
      right: calc(var(--diagnostics-safe-right) + 1rem);
      bottom: calc(var(--diagnostics-safe-bottom) + 1rem);
      left: calc(var(--diagnostics-safe-left) + 1rem);
      height: calc(100vh - var(--diagnostics-safe-top) - var(--diagnostics-safe-bottom) - 2rem);
      height: calc(100dvh - var(--diagnostics-safe-top) - var(--diagnostics-safe-bottom) - 2rem);
    }
  }
</style>
