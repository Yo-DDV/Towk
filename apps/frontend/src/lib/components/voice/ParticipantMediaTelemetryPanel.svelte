<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import {
    type ParticipantMediaAggregate,
    type ParticipantMediaDiagnosis,
    type ParticipantMediaMetric,
    type ParticipantMediaTelemetryHistoryPoint
  } from '$lib/voice/participantMediaTelemetry';

  let {
    panelId,
    participantName,
    sourceMetrics,
    sourceAggregate,
    receptionAggregate,
    diagnosis,
    history,
    sourceTelemetryReceived = false,
    receptionTelemetrySupported = false,
    onclose
  }: {
    panelId: string;
    participantName: string;
    sourceMetrics: ParticipantMediaMetric[];
    sourceAggregate: ParticipantMediaAggregate | null;
    receptionAggregate: ParticipantMediaAggregate | null;
    diagnosis: ParticipantMediaDiagnosis;
    history: ParticipantMediaTelemetryHistoryPoint[];
    sourceTelemetryReceived?: boolean;
    receptionTelemetrySupported?: boolean;
    onclose: () => void;
  } = $props();

  let dialogElement: HTMLElement | null = $state(null);
  let closeButton: HTMLButtonElement | null = $state(null);
  const chartWidth = 320;
  const chartHeight = 72;
  let charts = $derived([
    chartModel(
      'latency',
      m['voice.media_telemetry_latency'](),
      'ms',
      history.map((point) => point.sourceLatencyMs),
      history.map((point) => point.receptionLatencyMs),
      100
    ),
    chartModel(
      'packet-loss',
      m['voice.media_telemetry_packet_loss'](),
      '%',
      history.map((point) => point.sourcePacketLossPercent),
      history.map((point) => point.receptionPacketLossPercent),
      5
    )
  ]);

  onMount(() => closeButton?.focus());

  function onkeydown(event: KeyboardEvent): void {
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

  function chartModel(
    id: string,
    label: string,
    unit: string,
    sourceValues: Array<number | null>,
    receptionValues: Array<number | null>,
    minimumMaximum: number
  ) {
    const available = [...sourceValues, ...receptionValues].filter(
      (value): value is number => value !== null
    );
    const maximum = niceMaximum(available, minimumMaximum);
    return {
      id,
      label,
      unit,
      maximum,
      sourceSegments: polylineSegments(sourceValues, maximum),
      receptionSegments: polylineSegments(receptionValues, maximum),
      sourceLatest: latestValue(sourceValues),
      receptionLatest: latestValue(receptionValues),
      sourceLatestPoint: latestPoint(sourceValues, maximum),
      receptionLatestPoint: latestPoint(receptionValues, maximum),
      hasValues: available.length > 0
    };
  }

  function niceMaximum(values: number[], minimum: number): number {
    const peak = Math.max(minimum, ...values);
    const magnitude = 10 ** Math.floor(Math.log10(peak));
    const normalized = peak / magnitude;
    const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return Math.max(minimum, nice * magnitude);
  }

  function polylineSegments(values: Array<number | null>, maximum: number): string[] {
    const firstBucketAt = history[0]?.bucketAt ?? 0;
    const lastBucketAt = history.at(-1)?.bucketAt ?? firstBucketAt;
    const duration = Math.max(1, lastBucketAt - firstBucketAt);
    const segments: string[][] = [];
    let current: string[] = [];
    values.forEach((value, index) => {
      if (value === null) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      const bucketAt = history[index]?.bucketAt ?? firstBucketAt;
      const x =
        firstBucketAt === lastBucketAt
          ? chartWidth
          : ((bucketAt - firstBucketAt) / duration) * chartWidth;
      const y = chartHeight - (Math.min(maximum, value) / maximum) * (chartHeight - 8) - 4;
      current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    if (current.length) segments.push(current);
    return segments.map((segment) => segment.join(' '));
  }

  function latestValue(values: Array<number | null>): number | null {
    for (let index = values.length - 1; index >= 0; index -= 1) {
      if (values[index] !== null) return values[index]!;
    }
    return null;
  }

  function latestPoint(values: Array<number | null>, maximum: number) {
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = values[index];
      if (value === null) continue;
      const firstBucketAt = history[0]?.bucketAt ?? 0;
      const lastBucketAt = history.at(-1)?.bucketAt ?? firstBucketAt;
      const duration = Math.max(1, lastBucketAt - firstBucketAt);
      const bucketAt = history[index]?.bucketAt ?? firstBucketAt;
      return {
        x:
          firstBucketAt === lastBucketAt
            ? chartWidth
            : ((bucketAt - firstBucketAt) / duration) * chartWidth,
        y: chartHeight - (Math.min(maximum, value) / maximum) * (chartHeight - 8) - 4,
        value
      };
    }
    return null;
  }

  function formatChartValue(value: number | null, unit: string): string {
    return value === null
      ? m['voice.connection_metric_unavailable']()
      : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
  }

  function formatChartAxis(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function historyTime(index: number): string {
    const point = history[index];
    return point
      ? new Date(point.bucketAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      : '';
  }

  function metricLabel(kind: ParticipantMediaMetric['kind']): string {
    return kind === 'microphone'
      ? m['voice.media_telemetry_microphone']()
      : kind === 'camera'
        ? m['voice.media_telemetry_camera']()
        : m['voice.media_telemetry_screen']();
  }

  function metricIcon(kind: ParticipantMediaMetric['kind']): string {
    return kind === 'microphone'
      ? 'uil--microphone'
      : kind === 'camera'
        ? 'uil--video'
        : 'uil--desktop';
  }

  function format(value: number | null, unit: string): string {
    return value === null
      ? m['voice.connection_metric_unavailable']()
      : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;
  }

  function healthLabel(health: ParticipantMediaMetric['health']): string {
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

  function limitationLabel(
    limitation: Exclude<ParticipantMediaMetric['qualityLimitationReason'], null>
  ): string {
    return limitation === 'bandwidth'
      ? m['voice.media_telemetry_limit_bandwidth']()
      : limitation === 'cpu'
        ? m['voice.media_telemetry_limit_cpu']()
        : m['voice.media_telemetry_limit_other']();
  }

  function aggregateRows(aggregate: ParticipantMediaAggregate | null) {
    return [
      [m['voice.media_telemetry_latency'](), format(aggregate?.latencyMs ?? null, ' ms')],
      [m['voice.media_telemetry_packet_loss'](), format(aggregate?.packetLossPercent ?? null, '%')],
      [m['voice.media_telemetry_jitter'](), format(aggregate?.jitterMs ?? null, ' ms')]
    ] as const;
  }

  function diagnosisLabel(value: ParticipantMediaDiagnosis): string {
    return value === 'source'
      ? m['voice.media_telemetry_diagnosis_source']()
      : value === 'receiver'
        ? m['voice.media_telemetry_diagnosis_receiver']()
        : value === 'shared'
          ? m['voice.media_telemetry_diagnosis_shared']()
          : m['voice.media_telemetry_diagnosis_unknown']();
  }
</script>

<svelte:window {onkeydown} />

<div
  class="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
  data-testid="participant-media-telemetry-backdrop"
>
  <div
    bind:this={dialogElement}
    id={panelId}
    role="dialog"
    aria-modal="true"
    aria-label={m['voice.media_telemetry_title']({ name: participantName })}
    class="@container flex h-[min(100dvh,52rem)] max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl border border-text/15 bg-surface-100 text-text shadow-2xl sm:h-auto sm:max-h-[min(52rem,calc(100dvh-2rem))] sm:max-w-[56rem] sm:rounded-2xl"
    data-testid="participant-media-telemetry-panel"
  >
    <header class="flex shrink-0 items-start gap-3 border-b border-text/10 px-3 py-2.5">
      <span class="mt-1 iconify shrink-0 text-lg text-primary uil--chart-line" aria-hidden="true"
      ></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold">
          {m['voice.media_telemetry_title']({ name: participantName })}
        </span>
        <span class="mt-0.5 block text-xs text-muted">{diagnosisLabel(diagnosis)}</span>
      </span>
      <button
        bind:this={closeButton}
        type="button"
        class="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md text-muted outline-none hover:bg-surface-300 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        aria-label={m['voice.media_telemetry_close']()}
        data-testid="participant-media-telemetry-close"
        onclick={onclose}
      >
        <span class="iconify text-lg uil--times" aria-hidden="true"></span>
      </button>
    </header>

    <div
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4"
      data-testid="participant-media-telemetry-scroll"
    >
      <div class="grid gap-3 @min-[520px]:grid-cols-2">
        <section class="rounded-lg border border-text/10 bg-surface-200/70 p-3">
          <h3 class="text-xs font-semibold tracking-wide text-text uppercase">
            {m['voice.media_telemetry_source']()}
          </h3>
          <p class="mt-1 text-xs text-muted">{m['voice.media_telemetry_source_hint']()}</p>
          {#if sourceAggregate}
            <dl class="mt-2 grid grid-cols-1 gap-2 @min-[300px]:grid-cols-3">
              {#each aggregateRows(sourceAggregate) as row (row[0])}
                <div class="min-w-0 rounded-md bg-surface-100 px-2 py-1.5">
                  <dt class="truncate text-[0.6875rem] text-muted">{row[0]}</dt>
                  <dd class="truncate text-xs font-semibold tabular-nums">{row[1]}</dd>
                </div>
              {/each}
            </dl>
          {:else}
            <p
              class="mt-2 rounded-md bg-surface-100 px-2.5 py-2 text-xs leading-relaxed text-muted"
            >
              {sourceTelemetryReceived
                ? m['voice.media_telemetry_source_idle']()
                : m['voice.media_telemetry_unavailable']()}
            </p>
          {/if}
        </section>

        <section class="rounded-lg border border-text/10 bg-surface-200/70 p-3">
          <h3 class="text-xs font-semibold tracking-wide text-text uppercase">
            {m['voice.media_telemetry_reception']()}
          </h3>
          <p class="mt-1 text-xs text-muted">{m['voice.media_telemetry_reception_hint']()}</p>
          {#if receptionAggregate}
            <dl class="mt-2 grid grid-cols-1 gap-2 @min-[300px]:grid-cols-3">
              {#each aggregateRows(receptionAggregate) as row (row[0])}
                <div class="min-w-0 rounded-md bg-surface-100 px-2 py-1.5">
                  <dt class="truncate text-[0.6875rem] text-muted">{row[0]}</dt>
                  <dd class="truncate text-xs font-semibold tabular-nums">{row[1]}</dd>
                </div>
              {/each}
            </dl>
          {:else}
            <p
              class="mt-2 rounded-md bg-surface-100 px-2.5 py-2 text-xs leading-relaxed text-muted"
            >
              {receptionTelemetrySupported
                ? m['voice.media_telemetry_reception_idle']()
                : m['voice.media_telemetry_reception_unavailable']()}
            </p>
          {/if}
        </section>
      </div>

      <section class="mt-3 rounded-lg border border-text/10 bg-surface-200/70 p-3">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-xs font-semibold tracking-wide text-text uppercase">
            {m['voice.media_telemetry_history']()}
          </h3>
          <span class="text-[0.6875rem] text-muted"
            >{m['voice.media_telemetry_history_window']()}</span
          >
        </div>
        {#if history.length && charts.some((chart) => chart.hasValues)}
          <div class="mt-3 grid gap-3 @min-[640px]:grid-cols-2">
            {#each charts as chart (chart.id)}
              <article
                class="min-w-0 rounded-md bg-surface-100 p-2.5"
                data-testid={`participant-media-telemetry-chart-${chart.id}`}
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <h4 class="text-xs font-semibold">{chart.label} ({chart.unit})</h4>
                  <div class="flex flex-wrap gap-1 text-[0.6875rem] tabular-nums">
                    <span class="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                      {m['voice.media_telemetry_source']()}: {formatChartValue(
                        chart.sourceLatest,
                        chart.unit
                      )}
                    </span>
                    <span class="rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                      {m['voice.media_telemetry_reception']()}: {formatChartValue(
                        chart.receptionLatest,
                        chart.unit
                      )}
                    </span>
                  </div>
                </div>
                {#if chart.hasValues}
                  <div class="mt-2 grid grid-cols-[2.75rem_minmax(0,1fr)] gap-1">
                    <div
                      class="flex h-[72px] flex-col justify-between text-right text-[0.625rem] leading-none text-muted tabular-nums"
                      aria-hidden="true"
                    >
                      <span>{formatChartAxis(chart.maximum)}</span>
                      <span>{formatChartAxis(chart.maximum / 2)}</span>
                      <span>0</span>
                    </div>
                    <svg
                      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                      class="h-[72px] w-full overflow-visible"
                      role="img"
                      aria-label={`${chart.label}: ${m['voice.media_telemetry_history_label']()}`}
                      preserveAspectRatio="none"
                    >
                      <path d={`M0 4 H${chartWidth}`} class="stroke-text/10" fill="none" />
                      <path
                        d={`M0 ${chartHeight / 2} H${chartWidth}`}
                        class="stroke-text/10"
                        fill="none"
                      />
                      <path
                        d={`M0 ${chartHeight - 4} H${chartWidth}`}
                        class="stroke-text/10"
                        fill="none"
                      />
                      {#each chart.sourceSegments as segment (segment)}
                        <polyline
                          points={segment}
                          class="fill-none stroke-primary [stroke-width:2.5] opacity-100 transition-opacity duration-300 [stroke-linecap:round] [stroke-linejoin:round]"
                          vector-effect="non-scaling-stroke"
                        />
                      {/each}
                      {#each chart.receptionSegments as segment (segment)}
                        <polyline
                          points={segment}
                          class="fill-none stroke-warning [stroke-width:2] opacity-100 transition-opacity duration-300 [stroke-dasharray:5_4] [stroke-linecap:round] [stroke-linejoin:round]"
                          vector-effect="non-scaling-stroke"
                        />
                      {/each}
                      {#if chart.sourceLatestPoint}
                        <circle
                          cx={chart.sourceLatestPoint.x}
                          cy={chart.sourceLatestPoint.y}
                          r="3"
                          class="fill-primary stroke-surface-100 [stroke-width:1.5]"
                        >
                          <title
                            >{m['voice.media_telemetry_source']()}: {formatChartValue(
                              chart.sourceLatestPoint.value,
                              chart.unit
                            )}</title
                          >
                        </circle>
                      {/if}
                      {#if chart.receptionLatestPoint}
                        <circle
                          cx={chart.receptionLatestPoint.x}
                          cy={chart.receptionLatestPoint.y}
                          r="3"
                          class="fill-warning stroke-surface-100 [stroke-width:1.5]"
                        >
                          <title
                            >{m['voice.media_telemetry_reception']()}: {formatChartValue(
                              chart.receptionLatestPoint.value,
                              chart.unit
                            )}</title
                          >
                        </circle>
                      {/if}
                    </svg>
                    <div aria-hidden="true"></div>
                    <div class="flex justify-between text-[0.625rem] text-muted tabular-nums">
                      <span>{historyTime(0)}</span>
                      <span>{historyTime(history.length - 1)}</span>
                    </div>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {:else}
          <p class="mt-2 text-xs text-muted">{m['voice.media_telemetry_history_empty']()}</p>
        {/if}
      </section>

      <section class="mt-3">
        <h3 class="text-xs font-semibold tracking-wide text-text uppercase">
          {m['voice.media_telemetry_paths']()}
        </h3>
        {#if sourceMetrics.length}
          <div class="mt-2 grid gap-2 @min-[600px]:grid-cols-2">
            {#each sourceMetrics as metric (metric.kind)}
              <article class="rounded-lg border border-text/10 bg-surface-200/70 p-3">
                <header class="flex items-center gap-2">
                  <span
                    class={['iconify shrink-0 text-base text-primary', metricIcon(metric.kind)]}
                    aria-hidden="true"
                  ></span>
                  <h4 class="text-sm font-semibold">{metricLabel(metric.kind)}</h4>
                  <span
                    class="ml-auto rounded-full bg-surface-300 px-2 py-0.5 text-[0.6875rem] font-medium"
                    >{healthLabel(metric.health)}</span
                  >
                </header>
                <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt class="text-muted">{m['voice.media_telemetry_bitrate']()}</dt>
                  <dd class="text-right tabular-nums">{format(metric.bitrateKbps, ' kb/s')}</dd>
                  <dt class="text-muted">{m['voice.media_telemetry_packet_loss']()}</dt>
                  <dd class="text-right tabular-nums">{format(metric.packetLossPercent, '%')}</dd>
                  <dt class="text-muted">{m['voice.media_telemetry_jitter']()}</dt>
                  <dd class="text-right tabular-nums">{format(metric.jitterMs, ' ms')}</dd>
                  <dt class="text-muted">{m['voice.media_telemetry_latency']()}</dt>
                  <dd class="text-right tabular-nums">{format(metric.latencyMs, ' ms')}</dd>
                  {#if metric.kind !== 'microphone'}
                    <dt class="text-muted">{m['voice.media_telemetry_fps']()}</dt>
                    <dd class="text-right tabular-nums">{format(metric.framesPerSecond, '')}</dd>
                    <dt class="text-muted">{m['voice.media_telemetry_resolution']()}</dt>
                    <dd class="text-right tabular-nums">
                      {metric.width !== null && metric.height !== null
                        ? `${metric.width} × ${metric.height}`
                        : m['voice.connection_metric_unavailable']()}
                    </dd>
                  {/if}
                  {#if metric.qualityLimitationReason}
                    <dt class="text-muted">{m['voice.media_telemetry_limited_by']()}</dt>
                    <dd class="text-right">{limitationLabel(metric.qualityLimitationReason)}</dd>
                  {/if}
                </dl>
              </article>
            {/each}
          </div>
        {:else}
          <p class="mt-2 rounded-lg border border-text/10 bg-surface-200/70 p-3 text-xs text-muted">
            {sourceTelemetryReceived
              ? m['voice.media_telemetry_source_idle']()
              : m['voice.media_telemetry_unavailable']()}
          </p>
        {/if}
      </section>

      <p
        class="mt-3 rounded-lg border border-text/10 bg-surface-200/50 p-2.5 text-[0.6875rem] leading-4 text-muted"
      >
        {m['voice.media_telemetry_privacy']()}
      </p>
    </div>
  </div>
</div>
