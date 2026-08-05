<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    ParticipantMediaAggregate,
    ParticipantMediaDiagnosis,
    ParticipantMediaMetric,
    ParticipantMediaTelemetryHistoryPoint
  } from '$lib/voice/participantMediaTelemetry';
  import ParticipantMediaTelemetryPanelView from './ParticipantMediaTelemetryPanelView.svelte';

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

  type InputModality = 'keyboard' | 'pointer' | 'unknown';

  const touchFirstDisclosure = usesTouchFirstDisclosure();
  let inputModality: InputModality = 'unknown';
  let removeClickShield: (() => void) | null = null;
  let removeFocusRestoreGuard: (() => void) | null = null;

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

    window.addEventListener('pointerdown', markPointerInput, true);
    window.addEventListener('keydown', markKeyboardInput, true);
    return () => {
      window.removeEventListener('pointerdown', markPointerInput, true);
      window.removeEventListener('keydown', markKeyboardInput, true);
    };
  });

  function usesTouchFirstDisclosure(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    const coarsePrimaryPointer = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const finePointerAvailable = window.matchMedia(
      '(any-hover: hover) and (any-pointer: fine)'
    ).matches;
    return coarsePrimaryPointer && !finePointerAvailable;
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
      if (!(target instanceof HTMLElement) || target.getAttribute('aria-controls') !== panelId) {
        return;
      }
      event.stopPropagation();
      remove();
    };

    window.addEventListener('focus', suppressTelemetryPreviewFocus, true);
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(remove);
    });
    removeFocusRestoreGuard = remove;
  }

  function closePanel(): void {
    if (touchFirstDisclosure && inputModality === 'pointer') {
      // The parent restores focus to the quality trigger. Suppress only that
      // focus event's preview handler, while preserving the focus itself.
      armTouchFocusRestoreGuard();
    }
    onclose();
  }
</script>

<ParticipantMediaTelemetryPanelView
  {panelId}
  {participantName}
  {sourceMetrics}
  {sourceAggregate}
  {receptionAggregate}
  {diagnosis}
  {history}
  {sourceTelemetryReceived}
  {receptionTelemetrySupported}
  onclose={closePanel}
/>

<style>
  :global([data-testid='participant-media-telemetry-panel'].telemetry-glass),
  :global([data-testid='participant-media-telemetry-compact'].telemetry-glass) {
    isolation: isolate;
    background-color: var(--color-surface-100);
    background-color: color-mix(in srgb, var(--color-surface-100) 86%, transparent);
  }

  :global([data-testid='participant-media-telemetry-panel'] .telemetry-card),
  :global([data-testid='participant-media-telemetry-panel'] .chart-card),
  :global([data-testid='participant-media-telemetry-compact'] .telemetry-card),
  :global([data-testid='participant-media-telemetry-compact'] .chart-card) {
    background-color: var(--color-surface-200);
    background-color: color-mix(in srgb, var(--color-surface-200) 72%, transparent);
  }

  :global([data-testid='participant-media-telemetry-panel'] .metric-tile),
  :global([data-testid='participant-media-telemetry-panel'] .chart-plot),
  :global([data-testid='participant-media-telemetry-compact'] .metric-tile),
  :global([data-testid='participant-media-telemetry-compact'] .chart-plot) {
    background-color: var(--color-surface-100);
    background-color: color-mix(in srgb, var(--color-surface-100) 62%, transparent);
  }

  :global(html [data-testid='participant-media-telemetry-panel'].telemetry-panel) {
    height: min(100vh, 52rem);
    max-height: 100vh;
  }

  :global([data-testid='participant-media-telemetry-panel'] .quality-badge),
  :global([data-testid='participant-media-telemetry-compact'] .quality-badge) {
    width: 8rem;
    min-width: 0;
    justify-content: center;
  }

  :global([data-testid='participant-media-telemetry-compact-table'] th),
  :global([data-testid='participant-media-telemetry-compact-table'] td) {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  :global([data-testid='participant-media-telemetry-compact-table'] thead th:not(:first-child) > span) {
    min-width: 0;
    max-width: 100%;
  }

  :global(
    [data-testid='participant-media-telemetry-compact-table']
      thead
      th:not(:first-child)
      > span
      > span:last-child
  ) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global([data-testid='participant-media-telemetry-compact-table'] tbody td) {
    line-height: 1.25;
  }

  @supports (height: 100dvh) {
    :global(html [data-testid='participant-media-telemetry-panel'].telemetry-panel) {
      height: min(100dvh, 52rem);
      max-height: 100dvh;
    }
  }

  @media (max-width: 639px) {
    :global([data-testid='participant-media-telemetry-panel'].telemetry-glass),
    :global([data-testid='participant-media-telemetry-compact'].telemetry-glass) {
      -webkit-backdrop-filter: blur(16px) saturate(112%);
      backdrop-filter: blur(16px) saturate(112%);
    }
  }

  @media (min-width: 640px) {
    :global(html [data-testid='participant-media-telemetry-panel'].telemetry-panel) {
      height: auto;
      max-height: min(52rem, calc(100vh - 2rem));
    }

    @supports (height: 100dvh) {
      :global(html [data-testid='participant-media-telemetry-panel'].telemetry-panel) {
        max-height: min(52rem, calc(100dvh - 2rem));
      }
    }
  }

  @media (max-width: 359px) {
    :global([data-testid='participant-media-telemetry-panel'] .quality-badge),
    :global([data-testid='participant-media-telemetry-compact'] .quality-badge) {
      width: min(4.75rem, 28vw);
    }
  }

  @media (prefers-reduced-transparency: reduce) {
    :global([data-testid='participant-media-telemetry-panel'].telemetry-glass),
    :global([data-testid='participant-media-telemetry-compact'].telemetry-glass) {
      background-color: var(--color-surface-100);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }

    :global([data-testid='participant-media-telemetry-panel'] .telemetry-card),
    :global([data-testid='participant-media-telemetry-panel'] .chart-card),
    :global([data-testid='participant-media-telemetry-compact'] .telemetry-card),
    :global([data-testid='participant-media-telemetry-compact'] .chart-card) {
      background-color: var(--color-surface-200);
    }

    :global([data-testid='participant-media-telemetry-panel'] .metric-tile),
    :global([data-testid='participant-media-telemetry-panel'] .chart-plot),
    :global([data-testid='participant-media-telemetry-compact'] .metric-tile),
    :global([data-testid='participant-media-telemetry-compact'] .chart-plot) {
      background-color: var(--color-surface-100);
    }
  }

  @media (prefers-contrast: more) {
    :global([data-testid='participant-media-telemetry-panel'].telemetry-glass),
    :global([data-testid='participant-media-telemetry-panel'] .telemetry-card),
    :global([data-testid='participant-media-telemetry-panel'] .metric-tile),
    :global([data-testid='participant-media-telemetry-panel'] .chart-card),
    :global([data-testid='participant-media-telemetry-panel'] .chart-plot),
    :global([data-testid='participant-media-telemetry-compact'].telemetry-glass),
    :global([data-testid='participant-media-telemetry-compact'] .telemetry-card),
    :global([data-testid='participant-media-telemetry-compact'] .metric-tile),
    :global([data-testid='participant-media-telemetry-compact'] .chart-card),
    :global([data-testid='participant-media-telemetry-compact'] .chart-plot) {
      border-color: currentColor;
      border-color: color-mix(in srgb, currentColor 32%, transparent);
      box-shadow: none;
    }
  }

  @media (forced-colors: active) {
    :global([data-testid='participant-media-telemetry-panel'].telemetry-glass),
    :global([data-testid='participant-media-telemetry-panel'] .telemetry-card),
    :global([data-testid='participant-media-telemetry-panel'] .metric-tile),
    :global([data-testid='participant-media-telemetry-panel'] .chart-card),
    :global([data-testid='participant-media-telemetry-panel'] .chart-plot),
    :global([data-testid='participant-media-telemetry-compact'].telemetry-glass),
    :global([data-testid='participant-media-telemetry-compact'] .telemetry-card),
    :global([data-testid='participant-media-telemetry-compact'] .metric-tile),
    :global([data-testid='participant-media-telemetry-compact'] .chart-card),
    :global([data-testid='participant-media-telemetry-compact'] .chart-plot) {
      border-color: CanvasText;
      background: Canvas;
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      box-shadow: none;
    }
  }
</style>
