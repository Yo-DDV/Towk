import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
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
        updatedAt: Date.now(),
        onclose
      }
    });

    const panel = document.getElementById('participant-telemetry-test')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.textContent).toContain('Source to server');
    expect(panel.textContent).toContain('Reception on this device');
    expect(panel.textContent).toContain('The source path is probably degraded');
    expect(panel.textContent).toContain('1280 × 720');
    expect(panel.querySelectorAll('polyline')).toHaveLength(2);
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
        updatedAt: null,
        onclose: vi.fn()
      }
    });
    const panel = document.getElementById('participant-telemetry-unavailable')!;
    expect(panel.textContent).toContain('Source telemetry is unavailable');
    expect(panel.textContent).toContain('Reception on this device');
    rendered.unmount();
  });
});
