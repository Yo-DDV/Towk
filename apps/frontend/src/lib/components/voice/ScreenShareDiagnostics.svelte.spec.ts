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
    freezeCount: 1 + sample,
    totalFreezesDuration: 0.5 + sample * 0.75,
    pauseCount: sample,
    totalPausesDuration: sample * 5.25,
    jitter: 0.012,
    jitterBufferDelay: 2 + sample * 0.75,
    jitterBufferEmittedCount: 1_000 + sample * 900,
    nackCount: 3 + sample * 2,
    pliCount: 1 + sample,
    firCount: sample,
    decoderImplementation: 'Dav1d',
    powerEfficientDecoder: true,
    codecId: 'codec',
    transportId: 'transport'
  };
  const codec = { id: 'codec', type: 'codec', timestamp: stat.timestamp, mimeType: 'video/AV1' };
  const transport = {
    id: 'transport',
    type: 'transport',
    selectedCandidatePairId: 'pair'
  };
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
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('aria-modal')).toBeNull();
    expect(panel.className).toContain('fixed');
    expect(panel.querySelector('details')).not.toBeNull();
    expect(
      panel.querySelector('[data-testid="screen-share-diagnostics-close"]')?.className
    ).toContain('h-[44px]');
    expect(panel.querySelector('summary')?.className).toContain('min-h-[44px]');
    expect(panel.textContent).toContain('Technical details');
    expect(panel.textContent).toContain('Local metrics');
    expect(panel.textContent).not.toContain('Updated');
    expect(panel.textContent).not.toContain('Transport');

    const technicalDetails = panel.querySelector<HTMLDetailsElement>(
      '[data-testid="screen-share-diagnostics-details"]'
    )!;
    (panel.querySelector('summary') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);

    expect(technicalDetails.open).toBe(true);
    expect(panel.textContent).toContain('Transport');
    expect(panel.textContent).toContain('RTP packets');
    expect(panel.textContent).toContain('Jitter-buffer delay');
    expect(panel.textContent).toContain('Freezes');
    expect(panel.textContent).toContain('Playback pauses');
    expect(panel.textContent).toContain('ICE candidate path');
    expect(panel.textContent).toContain('RTP feedback');
    expect(panel.textContent).toContain('AV1');
    expect(panel.querySelectorAll('svg')).toHaveLength(4);
    for (const cell of panel.querySelectorAll<HTMLElement>(
      '[data-testid="screen-share-diagnostics-details"] dt, [data-testid="screen-share-diagnostics-details"] dd'
    )) {
      const style = getComputedStyle(cell);
      expect(style.whiteSpace).toBe('nowrap');
      expect(style.overflow).toBe('hidden');
      expect(style.textOverflow).toBe('ellipsis');
    }
    for (const caption of panel.querySelectorAll<HTMLElement>(
      'figcaption > span, figcaption > strong'
    )) {
      expect(caption.className).toContain('whitespace-nowrap');
    }
    for (const heading of panel.querySelectorAll<HTMLElement>('details h3')) {
      expect(heading.className).toContain('whitespace-nowrap');
      expect(heading.className).toContain('truncate');
    }

    await vi.advanceTimersByTimeAsync(4_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(3);
    expect(panel.querySelector('[data-testid="screen-share-diagnostics-details"]')).toBe(
      technicalDetails
    );
    expect(technicalDetails.open).toBe(true);
    expect(panel.textContent).toContain('Transport');

    rendered.unmount();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(3);
    expect(document.getElementById('diagnostics-test')).toBeNull();
  });

  it('keeps the compact summary stable and fully visible while values refresh', async () => {
    vi.useFakeTimers({ now: 1_000 });
    let sample = 0;
    const getRTCStatsReport = vi.fn(async () => statsReport(sample++));
    const rendered = render(ScreenShareDiagnostics, {
      props: {
        track: { getRTCStatsReport } as unknown as Track,
        direction: 'inbound',
        panelId: 'diagnostics-stable-layout-test',
        onclose: vi.fn()
      }
    });
    Object.assign(rendered.container.style, {
      position: 'relative',
      containerType: 'inline-size',
      width: '800px',
      height: '600px'
    });

    await vi.advanceTimersByTimeAsync(0);
    const panel = document.getElementById('diagnostics-stable-layout-test')!;
    const summary = panel.querySelector<HTMLElement>(
      '[data-testid="screen-share-diagnostics-summary"]'
    )!;
    const firstMetric = summary.querySelector<HTMLElement>(
      '[data-screen-share-metric="resolution"]'
    )!;
    const scroller = panel.querySelector<HTMLElement>(
      '[data-testid="screen-share-diagnostics-scroll"]'
    )!;

    expect(summary.children.length).toBeGreaterThanOrEqual(10);
    expect(summary.getAttribute('aria-live')).toBe('off');
    expect(panel.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth);
    expect(getComputedStyle(summary).gridTemplateColumns.split(' ').length).toBe(
      panel.getBoundingClientRect().width >= 512 ? 2 : 1
    );
    expect(scroller.scrollHeight).toBeLessThanOrEqual(scroller.clientHeight + 1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(2);
    expect(summary.querySelector('[data-screen-share-metric="resolution"]')).toBe(firstMetric);
    expect(scroller.scrollTop).toBe(0);
    expect(scroller.scrollHeight).toBeLessThanOrEqual(scroller.clientHeight + 1);
    expect(panel.textContent).not.toContain('Updated');

    const viewportPanelHeight = panel.getBoundingClientRect().height;
    Object.assign(rendered.container.style, { height: '462px' });
    expect(panel.getBoundingClientRect().height).toBeCloseTo(viewportPanelHeight, 0);
    expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight);

    Object.assign(rendered.container.style, { width: '700px', height: '600px' });
    expect(getComputedStyle(panel).position).toBe('fixed');

    Object.assign(rendered.container.style, { width: '320px', height: '568px' });
    const mobilePanelRect = panel.getBoundingClientRect();
    expect(mobilePanelRect.left).toBeGreaterThanOrEqual(0);
    expect(mobilePanelRect.right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(getComputedStyle(summary).gridTemplateColumns.split(' ')).toHaveLength(1);
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    rendered.unmount();
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

  it('keeps the last successful sample visible while a later collection is stalled', async () => {
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
    expect(panel.textContent).toContain('1920 × 1080');
    expect(panel.textContent).toContain('Live');
    expect(panel.textContent).not.toContain('Updated');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(2);
    expect(panel.textContent).toContain('1920 × 1080');
    expect(panel.textContent).toContain('Collecting');
    expect(panel.textContent).not.toContain('Excellent');
    rendered.unmount();
  });

  it('keeps visible cards stable without a transient warning when the next browser sample is partial', async () => {
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
    expect(panel.textContent).not.toContain('Partial sample');
    rendered.unmount();
  });

  it('keeps the last successful sample visible through one transient stats failure', async () => {
    vi.useFakeTimers({ now: 1_000 });
    const getRTCStatsReport = vi
      .fn<() => Promise<RTCStatsReport | undefined>>()
      .mockResolvedValueOnce(statsReport(0))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(statsReport(2));
    const rendered = render(ScreenShareDiagnostics, {
      props: {
        track: { getRTCStatsReport } as unknown as Track,
        direction: 'inbound',
        panelId: 'diagnostics-transient-failure-test',
        onclose: vi.fn()
      }
    });

    await vi.advanceTimersByTimeAsync(0);
    const panel = document.getElementById('diagnostics-transient-failure-test')!;
    expect(panel.textContent).toContain('1920 × 1080');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(2);
    expect(panel.textContent).toContain('1920 × 1080');
    expect(panel.textContent).not.toContain('Towk will retry on the next sample.');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(getRTCStatsReport).toHaveBeenCalledTimes(3);
    expect(panel.textContent).toContain('1920 × 1080');
    rendered.unmount();
  });
});
