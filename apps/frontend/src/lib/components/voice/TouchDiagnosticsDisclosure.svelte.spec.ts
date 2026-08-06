import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Track } from 'livekit-client';
import '../../../app.css';
import ParticipantMediaTelemetryPanel from './ParticipantMediaTelemetryPanel.svelte';
import ScreenShareDiagnostics from './ScreenShareDiagnostics.svelte';

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

function useTabletWithFineSecondaryPointer() {
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    mediaQueryList(
      query,
      query === '(hover: none) and (pointer: coarse)' ||
        query === '(pointer: coarse)' ||
        query === '(hover: none)' ||
        query === '(any-hover: hover) and (any-pointer: fine)'
    )
  );
}

function statsReport(): RTCStatsReport {
  const stat = {
    id: 'video',
    type: 'inbound-rtp',
    kind: 'video',
    timestamp: 3_000,
    bytesReceived: 1_750_000,
    packetsReceived: 1_900,
    packetsLost: 3,
    frameWidth: 1920,
    frameHeight: 1080,
    framesPerSecond: 30,
    framesReceived: 960,
    framesDecoded: 955,
    framesDropped: 5,
    jitter: 0.012,
    codecId: 'codec',
    transportId: 'transport'
  };
  const codec = { id: 'codec', type: 'codec', timestamp: stat.timestamp, mimeType: 'video/AV1' };
  const transport = { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' };
  const pair = {
    id: 'pair',
    type: 'candidate-pair',
    state: 'succeeded',
    nominated: true,
    currentRoundTripTime: 0.08,
    availableIncomingBitrate: 8_000_000,
    localCandidateId: 'local',
    remoteCandidateId: 'remote'
  };
  const items = new Map<string, Record<string, unknown>>([
    [stat.id, stat],
    [codec.id, codec],
    [transport.id, transport],
    [pair.id, pair],
    ['local', { id: 'local', type: 'local-candidate', candidateType: 'host', protocol: 'udp' }],
    ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'relay' }]
  ]);
  return {
    get: (id: string) => items.get(id),
    forEach: (callback: (value: RTCStats, key: string, parent: RTCStatsReport) => void) => {
      for (const [id, item] of items) {
        callback(item as unknown as RTCStats, id, items as unknown as RTCStatsReport);
      }
    }
  } as RTCStatsReport;
}

const participantProps = {
  participantName: 'Participant tablette',
  sourceMetrics: [],
  sourceAggregate: {
    health: 'good' as const,
    latencyMs: 37.8,
    jitterMs: 11.3,
    packetLossPercent: 0
  },
  receptionAggregate: null,
  diagnosis: 'unknown' as const,
  history: [],
  sourceTelemetryReceived: true,
  receptionTelemetrySupported: false,
  onclose: vi.fn()
};

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.querySelectorAll('[data-telemetry-test-fixture]').forEach((element) => element.remove());
  await page.viewport(1280, 720);
});

describe('touch-first diagnostics disclosure', () => {
  it('keeps the participant preview first even when the tablet exposes a fine secondary pointer', () => {
    useTabletWithFineSecondaryPointer();
    const rendered = render(ParticipantMediaTelemetryPanel, {
      props: { ...participantProps, panelId: 'participant-tablet-preview' }
    });

    const preview = document.getElementById('participant-tablet-preview')!;
    expect(preview.dataset.testid).toBe('participant-media-telemetry-compact');
    expect(preview.querySelector('[data-testid="participant-media-telemetry-expand"]')).not.toBeNull();
    expect(preview.querySelector('[data-testid="participant-media-telemetry-scroll"]')).toBeNull();
    rendered.unmount();
  });

  it('keeps participant preview and detail contained on phone, Fold and tablet viewports', async () => {
    useTabletWithFineSecondaryPointer();
    for (const [width, height] of [
      [280, 653],
      [320, 568],
      [717, 512],
      [820, 1180]
    ] as const) {
      await page.viewport(width, height);
      const rendered = render(ParticipantMediaTelemetryPanel, {
        props: { ...participantProps, panelId: `participant-touch-${width}-${height}` }
      });
      const preview = document.getElementById(`participant-touch-${width}-${height}`)!;
      const previewRect = preview.getBoundingClientRect();
      expect(previewRect.left).toBeGreaterThanOrEqual(-1);
      expect(previewRect.top).toBeGreaterThanOrEqual(-1);
      expect(previewRect.right).toBeLessThanOrEqual(width + 1);
      expect(previewRect.bottom).toBeLessThanOrEqual(height + 1);
      expect(preview.scrollWidth).toBeLessThanOrEqual(preview.clientWidth);

      preview
        .querySelector<HTMLButtonElement>('[data-testid="participant-media-telemetry-expand"]')!
        .click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const detail = document.getElementById(`participant-touch-${width}-${height}`)!;
      const detailRect = detail.getBoundingClientRect();
      expect(detail.dataset.testid).toBe('participant-media-telemetry-panel');
      expect(detailRect.left).toBeGreaterThanOrEqual(-1);
      expect(detailRect.top).toBeGreaterThanOrEqual(-1);
      expect(detailRect.right).toBeLessThanOrEqual(width + 1);
      expect(detailRect.bottom).toBeLessThanOrEqual(height + 1);
      expect(
        detail.querySelector<HTMLElement>('[data-testid="participant-media-telemetry-scroll"]')!
          .scrollWidth
      ).toBeLessThanOrEqual(
        detail.querySelector<HTMLElement>('[data-testid="participant-media-telemetry-scroll"]')!
          .clientWidth
      );
      rendered.unmount();
    }
  });

  it('opens screen-share statistics as a compact touch preview before explicit expansion', async () => {
    useTabletWithFineSecondaryPointer();
    const getRTCStatsReport = vi.fn(async () => statsReport());
    const rendered = render(ScreenShareDiagnostics, {
      props: {
        track: { getRTCStatsReport } as unknown as Track,
        direction: 'inbound',
        panelId: 'screen-share-touch-preview',
        onclose: vi.fn()
      }
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const preview = document.getElementById('screen-share-touch-preview')!;
    expect(preview.dataset.testid).toBe('screen-share-diagnostics-preview');
    expect(preview.getAttribute('role')).toBe('dialog');
    expect(preview.textContent).toContain('1920 × 1080');
    expect(preview.querySelector('[data-testid="screen-share-diagnostics-expand"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="screen-share-diagnostics-panel"]')).toBeNull();

    preview
      .querySelector<HTMLButtonElement>('[data-testid="screen-share-diagnostics-expand"]')!
      .click();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById('screen-share-touch-preview')?.dataset.testid).toBe(
      'screen-share-diagnostics-panel'
    );
    rendered.unmount();
  });

  it('contains the screen-share preview on phone, Fold and tablet viewports', async () => {
    useTabletWithFineSecondaryPointer();
    const getRTCStatsReport = vi.fn(async () => statsReport());
    for (const [width, height] of [
      [280, 653],
      [320, 568],
      [717, 512],
      [820, 1180]
    ] as const) {
      await page.viewport(width, height);
      const rendered = render(ScreenShareDiagnostics, {
        props: {
          track: { getRTCStatsReport } as unknown as Track,
          direction: 'inbound',
          panelId: `screen-share-touch-${width}-${height}`,
          onclose: vi.fn()
        }
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const preview = document.getElementById(`screen-share-touch-${width}-${height}`)!;
      const rect = preview.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(-1);
      expect(rect.top).toBeGreaterThanOrEqual(-1);
      expect(rect.right).toBeLessThanOrEqual(width + 1);
      expect(rect.bottom).toBeLessThanOrEqual(height + 1);
      expect(preview.scrollWidth).toBeLessThanOrEqual(preview.clientWidth);
      for (const selector of [
        '[data-testid="screen-share-diagnostics-preview-close"]',
        '[data-testid="screen-share-diagnostics-expand"]'
      ]) {
        const action = preview.querySelector<HTMLElement>(selector)!;
        expect(action.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
      rendered.unmount();
    }
  });

  it('keeps focus inside the touch screen-share preview', async () => {
    useTabletWithFineSecondaryPointer();
    const rendered = render(ScreenShareDiagnostics, {
      props: {
        track: { getRTCStatsReport: vi.fn(async () => statsReport()) } as unknown as Track,
        direction: 'inbound',
        panelId: 'screen-share-touch-focus',
        onclose: vi.fn()
      }
    });

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const preview = document.getElementById('screen-share-touch-focus')!;
    const close = preview.querySelector<HTMLButtonElement>(
      '[data-testid="screen-share-diagnostics-preview-close"]'
    )!;
    const expand = preview.querySelector<HTMLButtonElement>(
      '[data-testid="screen-share-diagnostics-expand"]'
    )!;
    expect(document.activeElement).toBe(expand);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);

    close.focus();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(document.activeElement).toBe(expand);
    rendered.unmount();
  });

  it('blocks the synthetic click behind the dismissed screen-share preview', () => {
    useTabletWithFineSecondaryPointer();
    const underlying = document.createElement('button');
    underlying.dataset.telemetryTestFixture = 'screen-underlying';
    document.body.append(underlying);
    const underlyingClick = vi.fn();
    underlying.addEventListener('click', underlyingClick);

    let unmount: () => void = () => undefined;
    const onclose = vi.fn(() => unmount());
    const rendered = render(ScreenShareDiagnostics, {
      props: {
        track: { getRTCStatsReport: vi.fn(async () => statsReport()) } as unknown as Track,
        direction: 'inbound',
        panelId: 'screen-share-touch-dismiss',
        onclose
      }
    });
    unmount = () => rendered.unmount();

    const backdrop = document.querySelector<HTMLElement>(
      '[data-testid="screen-share-diagnostics-preview-backdrop"]'
    )!;
    backdrop.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        clientX: 24,
        clientY: 24
      })
    );
    underlying.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        clientX: 24,
        clientY: 24
      })
    );

    expect(onclose).toHaveBeenCalledOnce();
    expect(underlyingClick).not.toHaveBeenCalled();
  });
});
