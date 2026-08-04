import { describe, expect, it, vi } from 'vitest';
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

describe('ParticipantMediaTelemetryPanel', () => {
  it('separates source and local reception, renders bounded history, and closes accessibly', async () => {
    const onclose = vi.fn();
    const rendered = render(ParticipantMediaTelemetryPanel, {
      props: {
        panelId: 'participant-telemetry-test',
        participantName: 'Alice',
        sourceMetrics: [
          {
            kind: 'camera',
            health: 'degraded',
            latencyMs: 280,
            jitterMs: 70,
            packetLossPercent: 4,
            bitrateKbps: 1_500,
            framesPerSecond: 24,
            width: 1_280,
            height: 720,
            qualityLimitationReason: 'bandwidth'
          }
        ],
        sourceAggregate: source,
        receptionAggregate: reception,
        diagnosis: 'source',
        history: [
          {
            bucketAt: 5_000,
            sourceHealth: 'degraded',
            receptionHealth: 'excellent',
            sourceLatencyMs: 280,
            receptionLatencyMs: 45,
            sourcePacketLossPercent: 4,
            receptionPacketLossPercent: 0
          }
        ],
        sourceTelemetryReceived: true,
        receptionTelemetrySupported: true,
        onclose
      }
    });

    const panel = document.getElementById('participant-telemetry-test')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
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
    expect(panel.textContent).toContain('The upload path is probably degraded');
    expect(panel.textContent).toContain('1280 × 720');
    expect(panel.textContent).toContain('280 ms');
    expect(panel.textContent).toContain('4 %');
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
          panelId: `participant-telemetry-${width}-${height}`,
          participantName: 'Participant avec un nom volontairement très long',
          sourceMetrics: [],
          sourceAggregate: source,
          receptionAggregate: reception,
          diagnosis: 'shared',
          history: [
            {
              bucketAt: 5_000,
              sourceHealth: 'degraded',
              receptionHealth: 'excellent',
              sourceLatencyMs: 280,
              receptionLatencyMs: 45,
              sourcePacketLossPercent: 4,
              receptionPacketLossPercent: 0
            },
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
          sourceTelemetryReceived: true,
          receptionTelemetrySupported: true,
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
