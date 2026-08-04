<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import {
    participantMediaHealthScore,
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
    updatedAt,
    isLocalParticipant = false,
    onclose
  }: {
    panelId: string;
    participantName: string;
    sourceMetrics: ParticipantMediaMetric[];
    sourceAggregate: ParticipantMediaAggregate | null;
    receptionAggregate: ParticipantMediaAggregate | null;
    diagnosis: ParticipantMediaDiagnosis;
    history: ParticipantMediaTelemetryHistoryPoint[];
    updatedAt: number | null;
    isLocalParticipant?: boolean;
    onclose: () => void;
  } = $props();

  let dialogElement: HTMLElement | null = $state(null);
  let closeButton: HTMLButtonElement | null = $state(null);
  const chartWidth = 320;
  const chartHeight = 72;
  let sourcePolyline = $derived(polyline(history.map((point) => point.sourceHealth)));
  let receptionPolyline = $derived(polyline(history.map((point) => point.receptionHealth)));

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

  function polyline(values: Array<ParticipantMediaTelemetryHistoryPoint['sourceHealth']>): string {
    if (!values.length) return '';
    const denominator = Math.max(1, values.length - 1);
    return values
      .map((health, index) => {
        const x = (index / denominator) * chartWidth;
        const y = chartHeight - (participantMediaHealthScore(health) / 3) * (chartHeight - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
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
          <dl class="mt-2 grid grid-cols-3 gap-2">
            {#each aggregateRows(sourceAggregate) as row (row[0])}
              <div class="min-w-0 rounded-md bg-surface-100 px-2 py-1.5">
                <dt class="truncate text-[0.6875rem] text-muted">{row[0]}</dt>
                <dd class="truncate text-xs font-semibold tabular-nums">{row[1]}</dd>
              </div>
            {/each}
          </dl>
        </section>

        <section class="rounded-lg border border-text/10 bg-surface-200/70 p-3">
          <h3 class="text-xs font-semibold tracking-wide text-text uppercase">
            {m['voice.media_telemetry_reception']()}
          </h3>
          <p class="mt-1 text-xs text-muted">{m['voice.media_telemetry_reception_hint']()}</p>
          {#if isLocalParticipant}
            <p
              class="mt-2 rounded-md bg-surface-100 px-2.5 py-2 text-xs leading-relaxed text-muted"
            >
              {m['voice.media_telemetry_reception_local']()}
            </p>
          {:else}
            <dl class="mt-2 grid grid-cols-3 gap-2">
              {#each aggregateRows(receptionAggregate) as row (row[0])}
                <div class="min-w-0 rounded-md bg-surface-100 px-2 py-1.5">
                  <dt class="truncate text-[0.6875rem] text-muted">{row[0]}</dt>
                  <dd class="truncate text-xs font-semibold tabular-nums">{row[1]}</dd>
                </div>
              {/each}
            </dl>
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
        {#if history.length}
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            class="mt-2 h-[72px] w-full overflow-visible"
            role="img"
            aria-label={m['voice.media_telemetry_history_label']()}
            preserveAspectRatio="none"
          >
            <path d={`M0 ${chartHeight - 4} H${chartWidth}`} class="stroke-text/10" fill="none" />
            <polyline
              points={sourcePolyline}
              class="fill-none stroke-primary [stroke-width:2.5]"
              vector-effect="non-scaling-stroke"
            />
            <polyline
              points={receptionPolyline}
              class="fill-none stroke-warning [stroke-width:2] [stroke-dasharray:5_4]"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-muted">
            <span class="inline-flex items-center gap-1.5"
              ><span class="h-0.5 w-4 bg-primary"></span>{m['voice.media_telemetry_source']()}</span
            >
            <span class="inline-flex items-center gap-1.5"
              ><span class="w-4 border-t-2 border-dashed border-warning"></span>{m[
                'voice.media_telemetry_reception'
              ]()}</span
            >
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
            {m['voice.media_telemetry_unavailable']()}
          </p>
        {/if}
      </section>

      <p
        class="mt-3 rounded-lg border border-text/10 bg-surface-200/50 p-2.5 text-[0.6875rem] leading-4 text-muted"
      >
        {m['voice.media_telemetry_privacy']()}
        {#if updatedAt !== null}
          · {m['voice.media_telemetry_sample_age']({
            seconds: Math.max(0, Math.round((Date.now() - updatedAt) / 1_000))
          })}
        {/if}
      </p>
    </div>
  </div>
</div>
