import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Track } from 'livekit-client';
import '../../../app.css';
import ScreenShareDiagnostics from './ScreenShareDiagnostics.svelte';

function statsReport(sample: number): RTCStatsReport {
  const stat = {
    id: 'video',
    type: 'inbound-rtp',
    kind: 'video',
    timestamp: 1_000 + sample * 2_000,
    bytesReceived: 1_000_000 + sample * 750_000,
    packetsReceived: 1_000 + sample * 900,
    packetsLost: 2 + sample,
    frameWidth: 1920,
    frameHeight: 1080,
    framesPerSecond: 30,
    framesReceived: 900 + sample * 60,
    framesDecoded: 895 + sample * 60,
    framesDropped: 5,
    codecId: 'codec'
  };
  const codec = { id: 'codec', type: 'codec', timestamp: stat.timestamp, mimeType: 'video/AV1' };
  const items = new Map<string, Record<string, unknown>>([
    [stat.id, stat],
    [codec.id, codec]
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

function partialStatsReport(sample: number): RTCStatsReport {
  const stat = {
    id: 'video',
    type: 'inbound-rtp',
    kind: 'video',
    timestamp: 1_000 + sample * 2_000,
    packetsReceived: 1_000 + sample * 900,
    packetsLost: 2 + sample,
    framesReceived: 900 + sample * 60,
    framesDecoded: 895 + sample * 60,
    codecId: 'codec'
  };
  const codec = { id: 'codec', type: 'codec', timestamp: stat.timestamp, mimeType: 'video/AV1' };
  const items = new Map<string, Record<string, unknown>>([
    [stat.id, stat],
    [codec.id, codec]
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

afterEach(() => {
  vi.useRealTimers();
});

describe('ScreenShareDiagnostics polling lifecycle', () => {
  it('polls every two seconds only while the opt-in panel is mounted', async () => {
    vi.useFakeTimers({ now: 1_000 });
    let sample = 0;
    const getRTCStatsReport = vi.fn(async () => statsReport(sample++));
    const track = { getRTCStatsReport } as unknown as Track;
    const rendered = render(ScreenShareDiagnostics, {
      props: {
        track,
        direction: 'inbound',
        panelId: 'diagnostics-test',
        onclose: vi.fn()
      }
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(1);
    const panel = document.getElementById('diagnostics-test')!;
    expect(panel.parentElement).toBe(document.body);
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.querySelector('details')).toBeNull();
    expect(panel.textContent).toContain('Technical details');
    expect(panel.textContent).toContain('Transport');
    expect(panel.textContent).toContain('AV1');

    await vi.advanceTimersByTimeAsync(4_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(3);

    rendered.unmount();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(3);
    expect(document.getElementById('diagnostics-test')).toBeNull();
  });

  it('shows an explicit unavailable state, keeps retrying, and recovers while open', async () => {
    vi.useFakeTimers({ now: 1_000 });
    const getRTCStatsReport = vi
      .fn<() => Promise<RTCStatsReport | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(statsReport(1));
    const rendered = render(ScreenShareDiagnostics, {
      props: {
        track: { getRTCStatsReport } as unknown as Track,
        direction: 'inbound',
        panelId: 'diagnostics-unavailable-test',
        onclose: vi.fn()
      }
    });

    await vi.advanceTimersByTimeAsync(0);
    let panel = document.getElementById('diagnostics-unavailable-test')!;
    expect(panel.textContent).toContain('Statistics are temporarily unavailable for this track.');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(2);
    panel = document.getElementById('diagnostics-unavailable-test')!;
    expect(panel.textContent).toContain('1920 × 1080');
    expect(panel.textContent).not.toContain(
      'Statistics are temporarily unavailable for this track.'
    );
    rendered.unmount();
  });

  it('never overlaps samples when browser statistics take longer than the polling interval', async () => {
    vi.useFakeTimers({ now: 1_000 });
    let resolveFirst!: (report: RTCStatsReport) => void;
    const firstReport = new Promise<RTCStatsReport>((resolve) => {
      resolveFirst = resolve;
    });
    const getRTCStatsReport = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockReturnValueOnce(firstReport)
      .mockResolvedValue(statsReport(1));
    const rendered = render(ScreenShareDiagnostics, {
      props: {
        track: { getRTCStatsReport } as unknown as Track,
        direction: 'inbound',
        panelId: 'diagnostics-slow-test',
        onclose: vi.fn()
      }
    });

    await vi.advanceTimersByTimeAsync(6_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(1);

    resolveFirst(statsReport(0));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(2);
    rendered.unmount();
  });

  it('ages the last successful sample while a later collection is stalled', async () => {
    vi.useFakeTimers({ now: 1_000 });
    const stalledReport = new Promise<RTCStatsReport>(() => {});
    const getRTCStatsReport = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockResolvedValueOnce(statsReport(0))
      .mockReturnValue(stalledReport);
    const rendered = render(ScreenShareDiagnostics, {
      props: {
        track: { getRTCStatsReport } as unknown as Track,
        direction: 'inbound',
        panelId: 'diagnostics-age-test',
        onclose: vi.fn()
      }
    });

    await vi.advanceTimersByTimeAsync(0);
    const panel = document.getElementById('diagnostics-age-test')!;
    expect(panel.textContent).toContain('Updated now');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(2);
    expect(panel.textContent).toContain('Updated 5 s ago');
    rendered.unmount();
  });

  it('keeps visible cards stable when the next browser sample is partial', async () => {
    vi.useFakeTimers({ now: 1_000 });
    const getRTCStatsReport = vi
      .fn<() => Promise<RTCStatsReport>>()
      .mockResolvedValueOnce(statsReport(0))
      .mockResolvedValue(partialStatsReport(1));
    const rendered = render(ScreenShareDiagnostics, {
      props: {
        track: { getRTCStatsReport } as unknown as Track,
        direction: 'inbound',
        panelId: 'diagnostics-partial-test',
        onclose: vi.fn()
      }
    });

    await vi.advanceTimersByTimeAsync(0);
    const panel = document.getElementById('diagnostics-partial-test')!;
    expect(panel.textContent).toContain('1920 × 1080');
    expect(panel.textContent).toContain('30 FPS');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(2);
    expect(panel.textContent).toContain('1920 × 1080');
    expect(panel.textContent).toContain('30 FPS');
    expect(panel.textContent).toContain('Partial sample');
    rendered.unmount();
  });
});
