import { describe, expect, it, vi } from 'vitest';
import type { Track } from 'livekit-client';
import {
  appendScreenShareDiagnosticsSample,
  collectScreenShareDiagnostics,
  mergeScreenShareDiagnosticsSample,
  SCREEN_SHARE_DIAGNOSTICS_HISTORY_LIMIT,
  type ScreenShareDiagnosticsSample
} from './screenShareDiagnostics';

type Stat = { id: string; type: string; timestamp?: number } & Record<string, unknown>;

function statsReport(...stats: Stat[]): RTCStatsReport {
  const items = new Map(stats.map((stat) => [stat.id, stat]));
  return {
    get: (id: string) => items.get(id),
    forEach: (callback: (value: RTCStats, key: string, parent: RTCStatsReport) => void) => {
      for (const [id, stat] of items)
        callback(stat as RTCStats, id, items as unknown as RTCStatsReport);
    }
  } as RTCStatsReport;
}

function remoteTrack(reports: RTCStatsReport[]): Track {
  const getRTCStatsReport = vi.fn();
  for (const report of reports) getRTCStatsReport.mockResolvedValueOnce(report);
  return { getRTCStatsReport } as unknown as Track;
}

function localTrack(reports: RTCStatsReport[]): Track {
  const getStats = vi.fn();
  for (const report of reports) getStats.mockResolvedValueOnce(report);
  return { sender: { getStats } } as unknown as Track;
}

describe('screen-share diagnostics collection', () => {
  it('normalizes receiver WebRTC stats and derives interval rates from RTP timestamps', async () => {
    const first = statsReport(
      {
        id: 'inbound',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: 1_000,
        codecId: 'codec',
        transportId: 'transport',
        bytesReceived: 1_000_000,
        packetsReceived: 1_000,
        packetsLost: 10,
        frameWidth: 1920,
        frameHeight: 1080,
        framesPerSecond: 30,
        framesReceived: 900,
        framesDecoded: 890,
        framesDropped: 10,
        keyFramesDecoded: 4,
        jitter: 0.008,
        jitterBufferDelay: 2,
        jitterBufferEmittedCount: 1_000,
        freezeCount: 1,
        totalFreezesDuration: 0.5,
        nackCount: 3,
        pliCount: 1,
        firCount: 0,
        decoderImplementation: 'Dav1d',
        powerEfficientDecoder: true
      },
      { id: 'codec', type: 'codec', mimeType: 'video/AV1', clockRate: 90_000 },
      { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' },
      {
        id: 'pair',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        availableIncomingBitrate: 8_000_000,
        currentRoundTripTime: 0.075,
        localCandidateId: 'local',
        remoteCandidateId: 'remote'
      },
      {
        id: 'local',
        type: 'local-candidate',
        candidateType: 'host',
        protocol: 'udp',
        networkType: 'wifi'
      },
      { id: 'remote', type: 'remote-candidate', candidateType: 'relay', protocol: 'udp' }
    );
    const second = statsReport(
      {
        id: 'inbound',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: 3_000,
        codecId: 'codec',
        transportId: 'transport',
        bytesReceived: 2_000_000,
        packetsReceived: 1_980,
        packetsLost: 30,
        frameWidth: 1920,
        frameHeight: 1080,
        framesPerSecond: 29,
        framesReceived: 1_500,
        framesDecoded: 1_490,
        framesDropped: 20,
        keyFramesDecoded: 7,
        jitter: 0.012,
        jitterBufferDelay: 4.4,
        jitterBufferEmittedCount: 2_000,
        freezeCount: 2,
        totalFreezesDuration: 1.5,
        nackCount: 7,
        pliCount: 2,
        firCount: 1,
        decoderImplementation: 'Dav1d',
        powerEfficientDecoder: true
      },
      { id: 'codec', type: 'codec', mimeType: 'video/AV1', clockRate: 90_000 },
      { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' },
      {
        id: 'pair',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        availableIncomingBitrate: 7_500_000,
        currentRoundTripTime: 0.08,
        localCandidateId: 'local',
        remoteCandidateId: 'remote'
      },
      {
        id: 'local',
        type: 'local-candidate',
        candidateType: 'host',
        protocol: 'udp',
        networkType: 'wifi'
      },
      { id: 'remote', type: 'remote-candidate', candidateType: 'relay', protocol: 'udp' }
    );
    const track = remoteTrack([first, second]);

    const initial = await collectScreenShareDiagnostics({
      track,
      direction: 'inbound',
      collectedAt: 1_100
    });
    const update = await collectScreenShareDiagnostics({
      track,
      direction: 'inbound',
      previous: initial.counters,
      collectedAt: 3_100
    });

    expect(initial.sample.bitrateBps).toBeNull();
    expect(update.sample).toMatchObject({
      direction: 'inbound',
      width: 1920,
      height: 1080,
      framesPerSecond: 29,
      bitrateBps: 4_000_000,
      packetLossPercent: 2,
      jitterMs: 12,
      roundTripTimeMs: 80,
      codec: 'AV1',
      decoderImplementation: 'Dav1d',
      framesDecoded: 1490,
      framesDropped: 20,
      freezeCount: 2,
      totalFreezeDurationMs: 1500,
      jitterBufferDelayMs: 2.4,
      availableBitrateBps: 7_500_000,
      networkType: 'wifi',
      protocol: 'udp',
      localCandidateType: 'host',
      remoteCandidateType: 'relay',
      powerEfficientCodec: true
    });
    expect(update.sample.frameDropPercent).toBeCloseTo(1.67, 2);
  });

  it('aggregates sender simulcast layers and remote feedback without summing FPS', async () => {
    const report = (timestamp: number, multiplier: number) =>
      statsReport(
        {
          id: 'high',
          type: 'outbound-rtp',
          kind: 'video',
          timestamp,
          codecId: 'codec',
          remoteId: 'remote-high',
          transportId: 'transport',
          rid: 'h',
          bytesSent: 1_000_000 * multiplier,
          packetsSent: 1_000 * multiplier,
          framesSent: 60 * multiplier,
          framesEncoded: 60 * multiplier,
          frameWidth: 1920,
          frameHeight: 1080,
          framesPerSecond: 30,
          targetBitrate: 5_000_000,
          retransmittedPacketsSent: 4 * multiplier,
          retransmittedBytesSent: 20_000 * multiplier,
          nackCount: 2 * multiplier,
          pliCount: multiplier,
          firCount: 0,
          qualityLimitationReason: 'bandwidth',
          qualityLimitationDurations: { none: 5, bandwidth: 3 },
          qualityLimitationResolutionChanges: 2,
          encoderImplementation: 'libvpx',
          powerEfficientEncoder: false,
          scalabilityMode: 'L1T3'
        },
        {
          id: 'low',
          type: 'outbound-rtp',
          kind: 'video',
          timestamp,
          codecId: 'codec',
          remoteId: 'remote-low',
          transportId: 'transport',
          rid: 'l',
          bytesSent: 250_000 * multiplier,
          packetsSent: 250 * multiplier,
          framesSent: 30 * multiplier,
          framesEncoded: 30 * multiplier,
          frameWidth: 640,
          frameHeight: 360,
          framesPerSecond: 15,
          targetBitrate: 1_000_000,
          qualityLimitationReason: 'none'
        },
        {
          id: 'remote-high',
          type: 'remote-inbound-rtp',
          timestamp,
          packetsLost: 10 * multiplier,
          jitter: 0.007,
          roundTripTime: 0.07
        },
        {
          id: 'remote-low',
          type: 'remote-inbound-rtp',
          timestamp,
          packetsLost: 2 * multiplier,
          jitter: 0.009,
          roundTripTime: 0.09
        },
        { id: 'codec', type: 'codec', mimeType: 'video/VP9' },
        { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' },
        {
          id: 'pair',
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          availableOutgoingBitrate: 9_000_000,
          currentRoundTripTime: 0.085
        }
      );
    const track = localTrack([report(1_000, 1), report(3_000, 2)]);

    const initial = await collectScreenShareDiagnostics({ track, direction: 'outbound' });
    const update = await collectScreenShareDiagnostics({
      track,
      direction: 'outbound',
      previous: initial.counters
    });

    expect(update.sample).toMatchObject({
      direction: 'outbound',
      width: 1920,
      height: 1080,
      framesPerSecond: 30,
      bitrateBps: 5_000_000,
      targetBitrateBps: 6_000_000,
      packetLossPercent: 0.96,
      roundTripTimeMs: 90,
      jitterMs: 9,
      codec: 'VP9',
      encoderImplementation: 'libvpx',
      qualityLimitationReason: 'bandwidth',
      qualityLimitationResolutionChanges: 2,
      availableBitrateBps: 9_000_000,
      activeLayerCount: 2,
      powerEfficientCodec: false
    });
    expect(update.sample.layers).toHaveLength(2);
    expect(update.sample.layers[0]).toMatchObject({ rid: 'h', bitrateBps: 4_000_000 });
    expect(update.sample.layers[1]).toMatchObject({ rid: 'l', bitrateBps: 1_000_000 });
  });

  it('uses media-source only for capture data and derives encoded FPS from RTP deltas', async () => {
    const report = (timestamp: number, framesEncoded: number) =>
      statsReport(
        {
          id: 'outbound',
          type: 'outbound-rtp',
          kind: 'video',
          timestamp,
          mediaSourceId: 'source',
          bytesSent: 500_000,
          packetsSent: 500,
          framesEncoded
        },
        {
          id: 'source',
          type: 'media-source',
          kind: 'video',
          width: 1920,
          height: 1080,
          framesPerSecond: 60
        }
      );
    const track = localTrack([report(1_000, 60), report(3_000, 120)]);

    const initial = await collectScreenShareDiagnostics({ track, direction: 'outbound' });
    const result = await collectScreenShareDiagnostics({
      track,
      direction: 'outbound',
      previous: initial.counters
    });

    expect(result.sample).toMatchObject({
      width: null,
      height: null,
      sourceWidth: 1920,
      sourceHeight: 1080,
      sourceFramesPerSecond: 60,
      framesPerSecond: 30
    });
  });

  it('reports the highest active simulcast layer instead of an inactive larger layer', async () => {
    const track = localTrack([
      statsReport(
        {
          id: 'high',
          type: 'outbound-rtp',
          kind: 'video',
          timestamp: 1_000,
          active: false,
          bytesSent: 2_000_000,
          packetsSent: 2_000,
          frameWidth: 1920,
          frameHeight: 1080,
          framesPerSecond: 0
        },
        {
          id: 'low',
          type: 'outbound-rtp',
          kind: 'video',
          timestamp: 1_000,
          active: true,
          bytesSent: 500_000,
          packetsSent: 500,
          frameWidth: 640,
          frameHeight: 360,
          framesPerSecond: 30
        },
        {
          id: 'rtx',
          type: 'outbound-rtp',
          kind: 'video',
          timestamp: 1_000,
          active: true,
          codecId: 'rtx-codec',
          bytesSent: 250_000,
          packetsSent: 250
        },
        {
          id: 'rtx-codec',
          type: 'codec',
          mimeType: 'video/rtx'
        }
      )
    ]);

    const result = await collectScreenShareDiagnostics({ track, direction: 'outbound' });

    expect(result.sample).toMatchObject({
      width: 640,
      height: 360,
      framesPerSecond: 30,
      activeLayerCount: 1,
      packetsSent: 2_500
    });
    expect(result.sample.layers).toHaveLength(2);
  });

  it('marks rate fields unavailable when browser counters reset', async () => {
    const track = remoteTrack([
      statsReport({
        id: 'inbound',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: 2_000,
        bytesReceived: 2_000,
        packetsReceived: 20,
        packetsLost: 2
      }),
      statsReport({
        id: 'inbound',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: 4_000,
        bytesReceived: 200,
        packetsReceived: 2,
        packetsLost: 0
      })
    ]);
    const initial = await collectScreenShareDiagnostics({ track, direction: 'inbound' });
    const update = await collectScreenShareDiagnostics({
      track,
      direction: 'inbound',
      previous: initial.counters
    });

    expect(update.sample.bitrateBps).toBeNull();
    expect(update.sample.packetLossPercent).toBeNull();
  });

  it('derives FPS from frame counters when the browser omits framesPerSecond', async () => {
    const track = remoteTrack([
      statsReport({
        id: 'inbound',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: 1_000,
        framesDecoded: 100
      }),
      statsReport({
        id: 'inbound',
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: 3_000,
        framesDecoded: 160
      })
    ]);
    const initial = await collectScreenShareDiagnostics({ track, direction: 'inbound' });
    const update = await collectScreenShareDiagnostics({
      track,
      direction: 'inbound',
      previous: initial.counters
    });

    expect(initial.sample.framesPerSecond).toBeNull();
    expect(update.sample.framesPerSecond).toBe(30);
  });

  it('keeps only the bounded diagnostics history', () => {
    const samples = Array.from(
      { length: SCREEN_SHARE_DIAGNOSTICS_HISTORY_LIMIT + 4 },
      (_, index) => ({ collectedAt: index })
    ) as ScreenShareDiagnosticsSample[];

    const history = samples.reduce(appendScreenShareDiagnosticsSample, []);

    expect(history).toHaveLength(SCREEN_SHARE_DIAGNOSTICS_HISTORY_LIMIT);
    expect(history[0].collectedAt).toBe(4);
  });

  it('keeps the last stable display fields when a later WebRTC sample is partial', async () => {
    const track = remoteTrack([
      statsReport(
        {
          id: 'inbound',
          type: 'inbound-rtp',
          kind: 'video',
          timestamp: 1_000,
          bytesReceived: 1_000,
          packetsReceived: 100,
          packetsLost: 0,
          frameWidth: 1920,
          frameHeight: 1080,
          framesPerSecond: 30,
          framesReceived: 30,
          framesDecoded: 30,
          framesDropped: 0,
          codecId: 'codec'
        },
        { id: 'codec', type: 'codec', mimeType: 'video/H264' }
      ),
      statsReport(
        {
          id: 'inbound',
          type: 'inbound-rtp',
          kind: 'video',
          timestamp: 3_000,
          bytesReceived: 401_000,
          packetsReceived: 300,
          packetsLost: 0,
          frameWidth: 1920,
          frameHeight: 1080,
          framesPerSecond: 30,
          framesReceived: 90,
          framesDecoded: 90,
          framesDropped: 0,
          codecId: 'codec'
        },
        { id: 'codec', type: 'codec', mimeType: 'video/H264' }
      ),
      statsReport(
        {
          id: 'inbound',
          type: 'inbound-rtp',
          kind: 'video',
          timestamp: 5_000,
          packetsReceived: 500,
          packetsLost: 0,
          framesReceived: 150,
          framesDecoded: 150,
          codecId: 'codec'
        },
        { id: 'codec', type: 'codec', mimeType: 'video/H264' }
      )
    ]);

    const first = await collectScreenShareDiagnostics({ track, direction: 'inbound' });
    const stable = await collectScreenShareDiagnostics({
      track,
      direction: 'inbound',
      previous: first.counters
    });
    const partial = await collectScreenShareDiagnostics({
      track,
      direction: 'inbound',
      previous: stable.counters
    });

    const merged = mergeScreenShareDiagnosticsSample(stable.sample, partial.sample);

    expect(partial.sample.width).toBeNull();
    expect(partial.sample.bitrateBps).toBeNull();
    expect(merged.width).toBe(1920);
    expect(merged.height).toBe(1080);
    expect(merged.framesPerSecond).toBe(30);
    expect(merged.bitrateBps).toBe(stable.sample.bitrateBps);
    expect(merged.codec).toBe('H264');
  });
});
