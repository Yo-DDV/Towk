<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import type {
    ParticipantMediaAggregate,
    ParticipantMediaDiagnosis,
    ParticipantMediaHealth,
    ParticipantMediaMetric,
    ParticipantMediaTelemetryHistoryPoint
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

  type Presentation = 'compact' | 'expanded';
  type InputModality = 'keyboard' | 'pointer' | 'unknown';

  const chartWidth = 360;
  const chartHeight = 104;
  const touchFirstDisclosure = usesTouchFirstDisclosure();
  let presentation = $state<Presentation>(touchFirstDisclosure ? 'compact' : 'expanded');
  let dialogElement: HTMLElement | null = $state(null);
  let closeButton: HTMLButtonElement | null = $state(null);
  let compactPrimaryButton: HTMLButtonElement | null = $state(null);
  let inputModality: InputModality = 'unknown';
  let removeClickShield: (() => void) | null = null;
  let removeFocusRestoreGuard: (() => void) | null = null;

  let overallHealth = $derived(resolveOverallHealth(sourceAggregate, receptionAggregate));
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

  onMount(() => {
    const markPointerInput = (event: PointerEvent) => {
      inputModality = 'pointer';
      if (
        event.pointerType === 'touch' &&
        event.target instanceof HTMLElement &&
        event.target.dataset.testid === 'participant-media-telemetry-backdrop'
      ) {
        armPostDismissClickShield(event);
      }
    };
    const markKeyboardInput = () => {
      inputModality = 'keyboard';
    };
    const focusFrame = requestAnimationFrame(() => {
      (presentation === 'compact' ? compactPrimaryButton : closeButton)?.focus();
    });

    window.addEventListener('pointerdown', markPointerInput, true);
    window.addEventListener('keydown', markKeyboardInput, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('pointerdown', markPointerInput, true);
      window.removeEventListener('keydown', markKeyboardInput, true);
    };
  });

  function usesTouchFirstDisclosure(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;

    // Do not reject a phone, tablet or Fold merely because a stylus, trackpad or
    // desktop-mode browser also exposes a fine secondary pointer. The primary
    // coarse/no-hover capabilities remain the authoritative signal here.
    const coarseAndNoHover = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const coarsePrimaryPointer = window.matchMedia('(pointer: coarse)').matches;
    const noPrimaryHover = window.matchMedia('(hover: none)').matches;
    if (coarseAndNoHover || coarsePrimaryPointer || noPrimaryHover) return true;

    const maxTouchPoints = navigator.maxTouchPoints ?? 0;
    if (maxTouchPoints < 1) return false;
    const mobileOrTabletUserAgent =
      /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && maxTouchPoints > 1);
    return mobileOrTabletUserAgent;
  }

  function expand(): void {
    presentation = 'expanded';
    requestAnimationFrame(() => closeButton?.focus());
  }

  function closePanel(): void {
    if (touchFirstDisclosure && inputModality === 'pointer') armTouchFocusRestoreGuard();
    onclose();
  }

  function closeFromBackdrop(event: PointerEvent): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    closePanel();
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

  function armTouchFocusRestoreGuard(): void {
    removeFocusRestoreGuard?.();
    let firstFrame = 0;
    let secondFrame = 0;

    const remove = () => {
      window.removeEventListener('focus', suppressTelemetryPreviewFocus, true);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      if (removeFocusRestoreGuard === remove) removeFocusRestoreGuard = null;
    };
    const suppressTelemetryPreviewFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.getAttribute('aria-controls') !== panelId) return;
      event.stopPropagation();
      remove();
    };

    window.addEventListener('focus', suppressTelemetryPreviewFocus, true);
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(remove);
    });
    removeFocusRestoreGuard = remove;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
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

  function resolveOverallHealth(
    source: ParticipantMediaAggregate | null,
    reception: ParticipantMediaAggregate | null
  ): ParticipantMediaHealth {
    const candidates = [source?.health, reception?.health].filter(
      (health): health is ParticipantMediaHealth => Boolean(health) && health !== 'unknown'
    );
    if (!candidates.length) return 'unknown';
    return candidates.reduce((worst, health) =>
      healthSeverity(health) > healthSeverity(worst) ? health : worst
    );
  }

  function healthSeverity(health: ParticipantMediaHealth): number {
    return health === 'poor'
      ? 4
      : health === 'degraded'
        ? 3
        : health === 'good'
          ? 2
          : health === 'excellent'
            ? 1
            : 0;
  }

  function healthLabel(health: ParticipantMediaHealth): string {
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

  function qualityBadgeClass(health: ParticipantMediaHealth): string {
    return health === 'excellent'
      ? 'bg-presence-online/10 text-presence-online'
      : health === 'good'
        ? 'bg-accent/10 text-accent'
        : health === 'degraded'
          ? 'bg-warning/10 text-warning'
          : health === 'poor'
            ? 'bg-danger/10 text-danger'
            : 'bg-surface-300/80 text-muted';
  }

  function format(value: number | null, unit: string): string {
    return value === null
      ? m['voice.connection_metric_unavailable']()
      : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;
  }

  function aggregateRows(aggregate: ParticipantMediaAggregate | null) {
    return [
      [m['voice.media_telemetry_latency'](), format(aggregate?.latencyMs ?? null, ' ms')],
      [m['voice.media_telemetry_packet_loss'](), format(aggregate?.packetLossPercent ?? null, ' %')],
      [m['voice.media_telemetry_jitter'](), format(aggregate?.jitterMs ?? null, ' ms')]
    ] as const;
  }

  function connectionMetricRows() {
    const upload = aggregateRows(sourceAggregate);
    const download = aggregateRows(receptionAggregate);
    return upload.map((row, index) => ({
      label: row[0],
      upload: row[1],
      download: download[index]![1]
    }));
  }

  function metricLabel(kind: ParticipantMediaMetric['kind']): string {
    return kind === 'microphone'
      ? m['voice.media_telemetry_microphone']()
      : kind === 'camera'
        ? m['voice.media_telemetry_camera']()
        : m['voice.media_telemetry_screen']();
  }

  function metricIcon(kind: ParticipantMediaMetric['kind']): string {
    return kind === 'microphone' ? 'uil--microphone' : kind === 'camera' ? 'uil--video' : 'uil--desktop';
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
      const x = firstBucketAt === lastBucketAt ? chartWidth : ((bucketAt - firstBucketAt) / duration) * chartWidth;
      const y = chartHeight - (Math.min(maximum, value) / maximum) * (chartHeight - 14) - 7;
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
        x: firstBucketAt === lastBucketAt ? chartWidth : ((bucketAt - firstBucketAt) / duration) * chartWidth,
        y: chartHeight - (Math.min(maximum, value) / maximum) * (chartHeight - 14) - 7,
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
</script>

<svelte:window {onkeydown} />

<div
  class={[
    'telemetry-backdrop fixed inset-0 z-[90] flex justify-center overflow-hidden',
    presentation === 'compact'
      ? 'items-end bg-black/40 p-2 sm:items-center sm:p-4'
      : 'items-end bg-black/65 p-0 sm:items-center sm:p-4'
  ]}
  data-presentation={presentation}
  data-testid="participant-media-telemetry-backdrop"
  onpointerdown={closeFromBackdrop}
>
  {#if presentation === 'compact'}
    <div
      bind:this={dialogElement}
      id={panelId}
      role="dialog"
      aria-modal="true"
      aria-label={m['voice.media_telemetry_title']({ name: participantName })}
      class="telemetry-compact telemetry-glass @container flex max-h-[min(36rem,calc(100dvh-1rem))] w-[min(36rem,calc(100vw-1rem))] min-w-0 flex-col overflow-hidden rounded-2xl border border-text/15 text-text shadow-2xl"
      data-diagnosis={diagnosis}
      data-testid="participant-media-telemetry-compact"
    >
      <header class="flex min-h-16 shrink-0 items-center gap-2 border-b border-text/10 px-2.5">
        <span class="iconify shrink-0 text-lg text-accent uil--chart-line" aria-hidden="true"></span>
        <h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
          {m['voice.media_telemetry_title']({ name: participantName })}
        </h2>
        <span
          class={[
            'quality-badge inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full border border-text/10 px-2 text-[0.6875rem] font-semibold whitespace-nowrap',
            qualityBadgeClass(overallHealth)
          ]}
          data-quality={overallHealth}
          data-testid="participant-media-telemetry-quality-badge"
        >
          <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true"></span>
          <span class="truncate">{healthLabel(overallHealth)}</span>
        </span>
        <button
          type="button"
          class="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl text-muted outline-none hover:bg-surface-300/80 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          aria-label={m['voice.media_telemetry_close']()}
          data-testid="participant-media-telemetry-compact-close"
          onclick={closePanel}
        >
          <span class="iconify text-lg uil--times" aria-hidden="true"></span>
        </button>
      </header>

      <div class="min-h-0 overflow-y-auto overscroll-contain p-2.5">
        <div class="overflow-hidden rounded-xl border border-text/10 bg-surface-100/55">
          <table
            class="w-full table-fixed border-separate border-spacing-0 text-left"
            aria-label={m['voice.media_telemetry_title']({ name: participantName })}
            data-testid="participant-media-telemetry-compact-table"
          >
            <thead>
              <tr>
                <th class="w-[38%] px-2 py-1.5" scope="col">
                  <span class="sr-only">{m['voice.media_telemetry_title']({ name: participantName })}</span>
                </th>
                <th class="px-1.5 py-1.5 text-right text-[0.625rem] font-semibold text-accent" scope="col">
                  <span class="inline-flex max-w-full items-center justify-end gap-1">
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
                    <span class="truncate">{m['voice.media_telemetry_source']()}</span>
                  </span>
                </th>
                <th class="px-1.5 py-1.5 text-right text-[0.625rem] font-semibold text-warning" scope="col">
                  <span class="inline-flex max-w-full items-center justify-end gap-1">
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
                    <span class="truncate">{m['voice.media_telemetry_reception']()}</span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {#each connectionMetricRows() as row (row.label)}
                <tr>
                  <th class="border-t border-text/10 px-2 py-2 text-[0.6875rem] leading-tight font-medium text-text/75" scope="row">
                    {row.label}
                  </th>
                  <td class="border-t border-text/10 px-1.5 py-2 text-right text-xs font-semibold break-words tabular-nums">
                    {row.upload}
                  </td>
                  <td class="border-t border-text/10 px-1.5 py-2 text-right text-xs font-semibold break-words tabular-nums">
                    {row.download}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <button
          bind:this={compactPrimaryButton}
          type="button"
          class="mt-2.5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-text/10 bg-surface-200/75 px-3 py-2 text-sm font-semibold text-text outline-none transition-colors hover:bg-surface-300/80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          data-testid="participant-media-telemetry-expand"
          onclick={expand}
        >
          <span class="iconify text-lg text-accent uil--expand-arrows-alt" aria-hidden="true"></span>
          {m['voice.media_telemetry_open']()}
        </button>
      </div>
    </div>
  {:else}
    <div
      bind:this={dialogElement}
      id={panelId}
      role="dialog"
      aria-modal="true"
      aria-label={m['voice.media_telemetry_title']({ name: participantName })}
      class="telemetry-panel telemetry-glass @container flex h-[min(100dvh,52rem)] max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl border border-text/15 text-text shadow-2xl sm:h-auto sm:max-h-[min(52rem,calc(100dvh-2rem))] sm:max-w-[min(68rem,calc(100vw-2rem))] sm:rounded-2xl"
      data-diagnosis={diagnosis}
      data-testid="participant-media-telemetry-panel"
    >
      <header class="flex min-h-16 shrink-0 items-center gap-2.5 border-b border-text/10 px-2.5 sm:px-3.5">
        <span class="iconify shrink-0 text-lg text-accent uil--chart-line" aria-hidden="true"></span>
        <h2 class="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
          {m['voice.media_telemetry_title']({ name: participantName })}
        </h2>
        <span
          class={[
            'quality-badge inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full border border-text/10 px-2 text-[0.6875rem] font-semibold whitespace-nowrap sm:text-xs',
            qualityBadgeClass(overallHealth)
          ]}
          data-quality={overallHealth}
          data-testid="participant-media-telemetry-quality-badge"
        >
          <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true"></span>
          <span class="truncate">{healthLabel(overallHealth)}</span>
        </span>
        <button
          bind:this={closeButton}
          type="button"
          class="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl text-muted outline-none hover:bg-surface-300/80 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          aria-label={m['voice.media_telemetry_close']()}
          data-testid="participant-media-telemetry-close"
          onclick={closePanel}
        >
          <span class="iconify text-lg uil--times" aria-hidden="true"></span>
        </button>
      </header>

      <div
        class="telemetry-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4"
        data-testid="participant-media-telemetry-scroll"
      >
        <div class="grid gap-3 @min-[540px]:grid-cols-2">
          <section class="telemetry-card rounded-xl border border-text/10 p-3" data-telemetry-card="upload">
            <div class="flex items-center gap-2">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent" aria-hidden="true">
                <span class="iconify text-base uil--upload"></span>
              </span>
              <h3 class="text-xs font-semibold tracking-wide text-accent uppercase">{m['voice.media_telemetry_source']()}</h3>
            </div>
            <p class="mt-1.5 text-xs leading-relaxed text-muted">{m['voice.media_telemetry_source_hint']()}</p>
            {#if sourceAggregate}
              <dl class="mt-2.5 grid grid-cols-1 gap-2 @min-[300px]:grid-cols-3">
                {#each aggregateRows(sourceAggregate) as row (row[0])}
                  <div class="metric-tile min-w-0 rounded-lg border border-text/10 px-2.5 py-2">
                    <dt class="min-h-7 text-[0.6875rem] leading-tight text-text/65">{row[0]}</dt>
                    <dd class="text-sm font-semibold break-words tabular-nums">{row[1]}</dd>
                  </div>
                {/each}
              </dl>
            {:else}
              <p class="metric-tile mt-2.5 rounded-lg border border-text/10 px-2.5 py-2 text-xs leading-relaxed text-muted">
                {sourceTelemetryReceived ? m['voice.media_telemetry_source_idle']() : m['voice.media_telemetry_unavailable']()}
              </p>
            {/if}
          </section>

          <section class="telemetry-card rounded-xl border border-text/10 p-3" data-telemetry-card="download">
            <div class="flex items-center gap-2">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning" aria-hidden="true">
                <span class="iconify text-base uil--download-alt"></span>
              </span>
              <h3 class="text-xs font-semibold tracking-wide text-warning uppercase">{m['voice.media_telemetry_reception']()}</h3>
            </div>
            <p class="mt-1.5 text-xs leading-relaxed text-muted">{m['voice.media_telemetry_reception_hint']()}</p>
            {#if receptionAggregate}
              <dl class="mt-2.5 grid grid-cols-1 gap-2 @min-[300px]:grid-cols-3">
                {#each aggregateRows(receptionAggregate) as row (row[0])}
                  <div class="metric-tile min-w-0 rounded-lg border border-text/10 px-2.5 py-2">
                    <dt class="min-h-7 text-[0.6875rem] leading-tight text-text/65">{row[0]}</dt>
                    <dd class="text-sm font-semibold break-words tabular-nums">{row[1]}</dd>
                  </div>
                {/each}
              </dl>
            {:else}
              <p class="metric-tile mt-2.5 rounded-lg border border-text/10 px-2.5 py-2 text-xs leading-relaxed text-muted">
                {receptionTelemetrySupported ? m['voice.media_telemetry_reception_idle']() : m['voice.media_telemetry_reception_unavailable']()}
              </p>
            {/if}
          </section>
        </div>

        <section class="telemetry-card mt-3 rounded-xl border border-text/10 p-3">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-xs font-semibold tracking-wide text-text uppercase">{m['voice.media_telemetry_history']()}</h3>
            <span class="shrink-0 text-[0.6875rem] text-muted">{m['voice.media_telemetry_history_window']()}</span>
          </div>
          {#if history.length && charts.some((chart) => chart.hasValues)}
            <div class="mt-3 grid gap-3 @min-[680px]:grid-cols-2">
              {#each charts as chart (chart.id)}
                <article class="chart-card min-w-0 rounded-xl border border-text/10 p-3" data-testid={`participant-media-telemetry-chart-${chart.id}`}>
                  <h4 class="text-xs font-semibold">{chart.label} ({chart.unit})</h4>
                  <div class="mt-2 flex flex-wrap gap-1.5 text-[0.6875rem] tabular-nums">
                    <span class="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-surface-300/65 px-2 py-1 font-medium text-accent" data-telemetry-series="upload">
                      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true"></span>
                      <span class="truncate">{m['voice.media_telemetry_source']()}: {formatChartValue(chart.sourceLatest, chart.unit)}</span>
                    </span>
                    <span class="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-surface-300/65 px-2 py-1 font-medium text-warning" data-telemetry-series="download">
                      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
                      <span class="truncate">{m['voice.media_telemetry_reception']()}: {formatChartValue(chart.receptionLatest, chart.unit)}</span>
                    </span>
                  </div>
                  <div class="mt-3 grid grid-cols-[2.75rem_minmax(0,1fr)] gap-1.5">
                    <div class="flex h-[104px] flex-col justify-between text-right text-[0.625rem] leading-none text-muted tabular-nums" aria-hidden="true">
                      <span>{chart.maximum.toLocaleString()}</span><span>{(chart.maximum / 2).toLocaleString()}</span><span>0</span>
                    </div>
                    <div class="chart-plot min-w-0 overflow-hidden rounded-lg border border-text/10 px-1.5 py-1">
                      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} class="h-[104px] w-full overflow-visible" role="img" aria-label={`${chart.label}: ${m['voice.media_telemetry_history_label']()}`} preserveAspectRatio="none">
                        <path d={`M0 7 H${chartWidth}`} class="stroke-text/10" fill="none" vector-effect="non-scaling-stroke" />
                        <path d={`M0 ${chartHeight / 2} H${chartWidth}`} class="stroke-text/10" fill="none" vector-effect="non-scaling-stroke" />
                        <path d={`M0 ${chartHeight - 7} H${chartWidth}`} class="stroke-text/10" fill="none" vector-effect="non-scaling-stroke" />
                        {#each chart.sourceSegments as segment (segment)}
                          <polyline points={segment} class="fill-none stroke-accent [stroke-width:2.5] [stroke-linecap:round] [stroke-linejoin:round]" data-telemetry-series="upload" vector-effect="non-scaling-stroke" />
                        {/each}
                        {#each chart.receptionSegments as segment (segment)}
                          <polyline points={segment} class="fill-none stroke-warning [stroke-width:2.25] [stroke-dasharray:5_4] [stroke-linecap:round] [stroke-linejoin:round]" data-telemetry-series="download" vector-effect="non-scaling-stroke" />
                        {/each}
                        {#if chart.sourceLatestPoint}
                          <circle cx={chart.sourceLatestPoint.x} cy={chart.sourceLatestPoint.y} r="3.5" class="fill-accent stroke-surface-100 [stroke-width:1.5]" data-telemetry-series="upload">
                            <title>{m['voice.media_telemetry_source']()}: {formatChartValue(chart.sourceLatestPoint.value, chart.unit)}</title>
                          </circle>
                        {/if}
                        {#if chart.receptionLatestPoint}
                          <circle cx={chart.receptionLatestPoint.x} cy={chart.receptionLatestPoint.y} r="3.5" class="fill-warning stroke-surface-100 [stroke-width:1.5]" data-telemetry-series="download">
                            <title>{m['voice.media_telemetry_reception']()}: {formatChartValue(chart.receptionLatestPoint.value, chart.unit)}</title>
                          </circle>
                        {/if}
                      </svg>
                    </div>
                    <div aria-hidden="true"></div>
                    <div class="flex justify-between text-[0.625rem] text-muted tabular-nums"><span>{historyTime(0)}</span><span>{historyTime(history.length - 1)}</span></div>
                  </div>
                </article>
              {/each}
            </div>
          {:else}
            <p class="mt-2 text-xs text-muted">{m['voice.media_telemetry_history_empty']()}</p>
          {/if}
        </section>

        <section class="mt-3">
          <h3 class="text-xs font-semibold tracking-wide text-text uppercase">{m['voice.media_telemetry_paths']()}</h3>
          {#if sourceMetrics.length}
            <div class="mt-2 grid gap-2 @min-[620px]:grid-cols-2">
              {#each sourceMetrics as metric (metric.kind)}
                <article class="telemetry-card rounded-xl border border-text/10 p-3">
                  <header class="flex min-h-0 items-center gap-2 border-0 p-0">
                    <span class={['iconify shrink-0 text-base text-accent', metricIcon(metric.kind)]} aria-hidden="true"></span>
                    <h4 class="text-sm font-semibold">{metricLabel(metric.kind)}</h4>
                    <span class={['ml-auto rounded-full border border-text/10 px-2 py-0.5 text-[0.6875rem] font-medium', qualityBadgeClass(metric.health)]}>{healthLabel(metric.health)}</span>
                  </header>
                  <dl class="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <dt class="text-muted">{m['voice.media_telemetry_bitrate']()}</dt><dd class="text-right tabular-nums">{format(metric.bitrateKbps, ' kb/s')}</dd>
                    <dt class="text-muted">{m['voice.media_telemetry_packet_loss']()}</dt><dd class="text-right tabular-nums">{format(metric.packetLossPercent, ' %')}</dd>
                    <dt class="text-muted">{m['voice.media_telemetry_jitter']()}</dt><dd class="text-right tabular-nums">{format(metric.jitterMs, ' ms')}</dd>
                    <dt class="text-muted">{m['voice.media_telemetry_latency']()}</dt><dd class="text-right tabular-nums">{format(metric.latencyMs, ' ms')}</dd>
                    {#if metric.kind !== 'microphone'}
                      <dt class="text-muted">{m['voice.media_telemetry_fps']()}</dt><dd class="text-right tabular-nums">{format(metric.framesPerSecond, '')}</dd>
                      <dt class="text-muted">{m['voice.media_telemetry_resolution']()}</dt>
                      <dd class="text-right tabular-nums">{metric.width !== null && metric.height !== null ? `${metric.width} × ${metric.height}` : m['voice.connection_metric_unavailable']()}</dd>
                    {/if}
                    {#if metric.qualityLimitationReason}
                      <dt class="text-muted">{m['voice.media_telemetry_limited_by']()}</dt><dd class="text-right">{limitationLabel(metric.qualityLimitationReason)}</dd>
                    {/if}
                  </dl>
                </article>
              {/each}
            </div>
          {:else}
            <p class="telemetry-card mt-2 rounded-xl border border-text/10 p-3 text-xs text-muted">{sourceTelemetryReceived ? m['voice.media_telemetry_source_idle']() : m['voice.media_telemetry_unavailable']()}</p>
          {/if}
        </section>

        <p class="telemetry-card mt-3 rounded-xl border border-text/10 p-2.5 text-[0.6875rem] leading-4 text-muted">{m['voice.media_telemetry_privacy']()}</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .telemetry-backdrop { animation: telemetry-backdrop-in 160ms ease-out both; }
  .telemetry-glass {
    isolation: isolate;
    background-color: var(--color-surface-100);
    background-color: color-mix(in srgb, var(--color-surface-100) 88%, transparent);
    -webkit-backdrop-filter: blur(22px) saturate(118%);
    backdrop-filter: blur(22px) saturate(118%);
    box-shadow: 0 28px 72px rgb(0 0 0 / 0.38), inset 0 1px 0 rgb(255 255 255 / 0.055);
  }
  .telemetry-card, .metric-tile, .chart-card, .chart-plot {
    background-color: var(--color-surface-200);
    background-color: color-mix(in srgb, var(--color-surface-200) 74%, transparent);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.035);
  }
  .metric-tile, .chart-plot {
    background-color: var(--color-surface-100);
    background-color: color-mix(in srgb, var(--color-surface-100) 64%, transparent);
  }
  .telemetry-panel { padding-top: env(safe-area-inset-top); transform-origin: bottom center; }
  .telemetry-compact { margin-bottom: env(safe-area-inset-bottom); transform-origin: bottom center; }
  .telemetry-panel, .telemetry-compact { animation: telemetry-panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both; }
  .quality-badge { width: 8rem; min-width: 0; max-width: min(8rem, 34vw); }
  .telemetry-scroll { padding-bottom: max(0.75rem, env(safe-area-inset-bottom)); scrollbar-gutter: stable; }
  @supports not (height: 100dvh) {
    .telemetry-panel { height: min(100vh, 52rem); max-height: 100vh; }
    .telemetry-compact { max-height: min(36rem, calc(100vh - 1rem)); }
  }
  @supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    .telemetry-glass { background-color: var(--color-surface-100); }
  }
  @keyframes telemetry-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes telemetry-panel-in { from { opacity: 0; transform: translateY(8px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @media (min-width: 640px) { .telemetry-panel, .telemetry-compact { transform-origin: center; } }
  @media (max-width: 359px) {
    .quality-badge { width: min(4.75rem, 28vw); max-width: min(4.75rem, 28vw); padding-inline: 0.4rem; }
    .telemetry-compact header, .telemetry-panel > header { gap: 0.35rem; padding-inline: 0.4rem; }
  }
  @media (max-height: 520px) and (orientation: landscape) {
    .telemetry-panel { height: 100dvh; max-height: 100dvh; border-radius: 0; }
    .telemetry-compact { max-height: calc(100dvh - 1rem); }
  }
  @media (prefers-reduced-motion: reduce) { .telemetry-backdrop, .telemetry-panel, .telemetry-compact { animation: none; } }
  @media (prefers-reduced-transparency: reduce) {
    .telemetry-glass { background-color: var(--color-surface-100); -webkit-backdrop-filter: none; backdrop-filter: none; }
    .telemetry-card, .metric-tile, .chart-card, .chart-plot { background-color: var(--color-surface-200); }
  }
  @media (forced-colors: active) {
    .telemetry-glass, .telemetry-card, .metric-tile, .chart-card, .chart-plot { border-color: CanvasText; background: Canvas; box-shadow: none; }
  }
</style>
