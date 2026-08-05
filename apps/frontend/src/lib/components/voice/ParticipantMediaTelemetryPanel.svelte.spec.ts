import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../../app.css';
import ParticipantMediaTelemetryPanel from './ParticipantMediaTelemetryPanel.svelte';

const source = {
  health: 'degraded' as const,
  latencyMs: 280,
  jitterMs: 70,
  packetLossPercent: 4
};
const reception = {
  health: 'excellent' as const,
  latencyMs: 45,
  jitterMs: 5,
  packetLossPercent: 0
};

function mediaQueryList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true)
  };
}

function useCoarsePointer() {
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    mediaQueryList(query, query === '(hover: none) and (pointer: coarse)')
  );
}

const baseProps = {
  panelId: 'participant-telemetry-test',
  participantName: 'Alice',
  sourceMetrics: [
    {
      kind: 'camera' as const,
      health: 'degraded' as const,
      latencyMs: 280,
      jitterMs: 70,
      packetLossPercent: 4,
      bitrateKbps: 1_500,
      framesPerSecond: 24,
      width: 1_280,
      height: 720,
      qualityLimitationReason: 'bandwidth' as const
    }
  ],
  sourceAggregate: source,
  receptionAggregate: reception,
  diagnosis: 'source' as const,
  history: [
    {
      bucketAt: 5_000,
      sourceHealth: 'degraded' as const,
      receptionHealth: 'excellent' as const,
      sourceLatencyMs: 280,
      receptionLatencyMs: 45,
      sourcePacketLossPercent: 4,
      receptionPacketLossPercent: 0
    }
  ],
  sourceTelemetryReceived: true,
  receptionTelemetrySupported: true
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ParticipantMediaTelemetryPanel', () => {
  it('uses a stable quality badge, neutral glass cards, bounded history, and accessible close', () => {
    const onclose = vi.fn();
    const rendered = render(ParticipantMediaTelemetryPanel, {
      props: { ...baseProps, onclose }
    });

    const panel = document.getElementById('participant-telemetry-test')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('data-diagnosis')).toBe('source');
    expect(panel.closest('[data-testid="participant-media-telemetry-backdrop"]')).not.toBeNull();
    const panelRect = panel.getBoundingClientRect();
    expect(panelRect.left).toBeGreaterThanOrEqual(-1);
    expect(panelRect.top).toBeGreaterThanOrEqual(-1);
    expect(panelRect.right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(panelRect.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    const scroll = panel.querySelector<HTMLElement>(
      '[data-testid="participant-media-telemetry-scroll"]'
    )!;
    expect(getComputedStyle(scroll).overflowY).toBe('auto');
    expect(panel.textContent).toContain('Upload statistics');
    expect(panel.textContent).toContain('Download statistics');
    expect(panel.textContent).not.toContain('The upload path is probably degraded');
    expect(panel.textContent).toContain('1280 × 720');
    expect(panel.textContent).toContain('280 ms');
    expect(panel.textContent).toContain('4 %');

    const badge = panel.querySelector<HTMLElement>(
      '[data-testid="participant-media-telemetry-quality-badge"]'
    )!;
    expect(badge.dataset.quality).toBe('degraded');
    expect(badge.textContent).toContain('Degraded');
    expect(badge.getBoundingClientRect().height).toBeGreaterThanOrEqual(27);
    expect(panel.querySelector('header')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(63);

    const uploadCard = panel.querySelector<HTMLElement>('[data-telemetry-card="upload"]')!;
    const downloadCard = panel.querySelector<HTMLElement>('[data-telemetry-card="download"]')!;
    expect(uploadCard.className).not.toContain('border-accent');
    expect(downloadCard.className).not.toContain('border-warning');
    expect(uploadCard.className).not.toContain('inset_2px');
    expect(downloadCard.className).not.toContain('inset_2px');
    expect(getComputedStyle(uploadCard).backgroundImage).toBe('none');
    expect(getComputedStyle(downloadCard).backgroundImage).toBe('none');

    expect(
      panel.querySelectorAll('[data-testid^="participant-media-telemetry-chart-"]')
    ).toHaveLength(2);
    expect(panel.querySelectorAll('svg circle')).toHaveLength(4);
    expect(panel.querySelector('svg title')?.textContent).toContain('280 ms');
    const uploadLegend = panel.querySelector<HTMLElement>('[data-telemetry-series="upload"]')!;
    expect(uploadLegend).not.toBeNull();
    const mutedProbe = document.createElement('span');
    mutedProbe.className = 'text-muted';
    panel.append(mutedProbe);
    expect(uploadLegend.classList.contains('text-accent')).toBe(true);
    expect(getComputedStyle(uploadLegend).color).not.toBe(getComputedStyle(mutedProbe).color);
    mutedProbe.remove();
    expect(
      panel.querySelector<SVGPolylineElement>('polyline[data-telemetry-series="upload"]')
    ).not.toBeNull();
    expect(getComputedStyle(panel).animationName).not.toBe('none');
    expect(panel.textContent).not.toContain('sample age');
    const close = panel.querySelector<HTMLButtonElement>(
      '[data-testid="participant-media-telemetry-close"]'
    )!;
    expect(close.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    close.click();
    expect(onclose).toHaveBeenCalledOnce();
    rendered.unmount();
  });

  it('opens the light view first on coarse touch input and expands only from its explicit action', async () => {
    useCoarsePointer();
    const onclose = vi.fn();
    const rendered = render(ParticipantMediaTelemetryPanel, {
      props: { ...baseProps, onclose }
    });

    const compact = document.getElementById('participant-telemetry-test')!;
    expect(compact.getAttribute('data-testid')).toBe('participant-media-telemetry-compact');
    expect(compact.querySelector('[data-testid="participant-media-telemetry-compact-table"]')).not.toBeNull();
    expect(compact.querySelector('[data-testid="participant-media-telemetry-scroll"]')).toBeNull();
    const compactClose = compact.querySelector<HTMLButtonElement>(
      '[data-testid="participant-media-telemetry-compact-close"]'
    )!;
    expect(compactClose.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

    compact.querySelector<HTMLButtonElement>('[data-testid="participant-media-telemetry-expand"]')!.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const expanded = document.getElementById('participant-telemetry-test')!;
    expect(expanded.getAttribute('data-testid')).toBe('participant-media-telemetry-panel');
    expect(expanded.querySelector('[data-testid="participant-media-telemetry-scroll"]')).not.toBeNull();
    expect(onclose).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it('dismisses the touch light view from the backdrop or its visible close control', () => {
    useCoarsePointer();
    const outsideClose = vi.fn();
    const outsideRendered = render(ParticipantMediaTelemetryPanel, {
      props: { ...baseProps, panelId: 'participant-telemetry-outside', onclose: outsideClose }
    });
    const backdrop = document.querySelector<HTMLElement>(
      '[data-testid="participant-media-telemetry-backdrop"]'
    )!;
    backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(outsideClose).toHaveBeenCalledOnce();
    outsideRendered.unmount();

    const buttonClose = vi.fn();
    const buttonRendered = render(ParticipantMediaTelemetryPanel, {
      props: { ...baseProps, panelId: 'participant-telemetry-button', onclose: buttonClose }
    });
    document
      .querySelector<HTMLButtonElement>('[data-testid="participant-media-telemetry-compact-close"]')!
      .click();
    expect(buttonClose).toHaveBeenCalledOnce();
    buttonRendered.unmount();
  });

  it('reports telemetry as unavailable instead of borrowing local reception values', () => {
    const rendered = render(ParticipantMediaTelemetryPanel, {
      props: {
        panelId: 'participant-telemetry-unavailable',
        participantName: 'Legacy client',
        sourceMetrics: [],
        sourceAggregate: null,
        receptionAggregate: reception,
        diagnosis: 'unknown',
        history: [],
        sourceTelemetryReceived: false,
        receptionTelemetrySupported: true,
        onclose: vi.fn()
      }
    });
    const panel = document.getElementById('participant-telemetry-unavailable')!;
    expect(panel.textContent).toContain('Upload telemetry is unavailable');
    expect(panel.textContent).toContain('Download statistics');
    rendered.unmount();
  });

  it('shows the local participant download metrics instead of hiding them', () => {
    const rendered = render(ParticipantMediaTelemetryPanel, {
      props: {
        panelId: 'participant-telemetry-local',
        participantName: 'Local device',
        sourceMetrics: [],
        sourceAggregate: source,
        receptionAggregate: null,
        diagnosis: 'unknown',
        history: [],
        sourceTelemetryReceived: true,
        receptionTelemetrySupported: true,
        onclose: vi.fn()
      }
    });
    const panel = document.getElementById('participant-telemetry-local')!;
    expect(panel.textContent).toContain('Download statistics');
    expect(panel.textContent).toContain('No active download media is available to measure yet');
    expect(panel.textContent).not.toContain('Local reception does not apply');
    rendered.unmount();
  });

  it('stays readable without horizontal overflow across phone, Fold, tablet, and desktop sizes', async () => {
    const viewports = [
      [280, 653],
      [320, 568],
      [717, 512],
      [820, 1180],
      [1920, 1080]
    ] as const;
    for (const [width, height] of viewports) {
      await page.viewport(width, height);
      const rendered = render(ParticipantMediaTelemetryPanel, {
        props: {
          ...baseProps,
          panelId: `participant-telemetry-${width}-${height}`,
          participantName: 'Participant avec un nom volontairement très long',
          diagnosis: 'shared',
          history: [
            ...baseProps.history,
            {
              bucketAt: 10_000,
              sourceHealth: 'good',
              receptionHealth: 'excellent',
              sourceLatencyMs: 160,
              receptionLatencyMs: 52,
              sourcePacketLossPercent: 1.5,
              receptionPacketLossPercent: 0.2
            }
          ],
          onclose: vi.fn()
        }
      });
      const panel = document.getElementById(`participant-telemetry-${width}-${height}`)!;
      const rect = panel.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(-1);
      expect(rect.top).toBeGreaterThanOrEqual(-1);
      expect(rect.right).toBeLessThanOrEqual(width + 1);
      expect(rect.bottom).toBeLessThanOrEqual(height + 1);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(
        panel.querySelector<HTMLElement>('[data-testid="participant-media-telemetry-scroll"]')!
          .scrollWidth
      ).toBeLessThanOrEqual(
        panel.querySelector<HTMLElement>('[data-testid="participant-media-telemetry-scroll"]')!
          .clientWidth
      );
      expect(
        panel
          .querySelector<HTMLButtonElement>('[data-testid="participant-media-telemetry-close"]')!
          .getBoundingClientRect().height
      ).toBeGreaterThanOrEqual(44);
      rendered.unmount();
    }
    await page.viewport(1280, 720);
  });
});
