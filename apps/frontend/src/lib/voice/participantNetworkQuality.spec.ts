import { describe, expect, it } from 'vitest';
import type { Track } from 'livekit-client';
import {
  aggregateParticipantNetworkQuality,
  classifyNetworkHealth,
  collectParticipantNetworkQuality,
  selectParticipantNetworkWarningMetric,
  updateParticipantNetworkQualitySmoothing
} from './participantNetworkQuality';
import type {
  ParticipantNetworkQuality,
  ParticipantNetworkQualitySmoothing
} from './participantNetworkQuality';

describe('participant network quality', () => {
  it('uses interval deltas instead of diluting a fresh loss spike with call history', async () => {
    const result = await collectParticipantNetworkQuality(
      statsTrack([
        {
          id: 'audio',
          type: 'inbound-rtp',
          kind: 'audio',
          packetsLost: 30,
          packetsReceived: 1_170,
          jitter: 0.08,
          transportId: 'transport'
        },
        {
          id: 'transport',
          type: 'transport',
          selectedCandidatePairId: 'candidate-pair'
        },
        {
          id: 'candidate-pair',
          type: 'candidate-pair',
          currentRoundTripTime: 0.14
        }
      ]),
      { packetsLost: 10, packetsReceived: 990 }
    );

    expect(result).toEqual({
      counters: { packetsLost: 30, packetsReceived: 1_170 },
      quality: {
        health: 'poor',
        jitterMs: 80,
        latencyMs: 140,
        packetLossPercent: 10,
        warningMetric: 'packetLoss'
      }
    });
  });

  it('handles counter resets without producing negative or impossible loss', async () => {
    const result = await collectParticipantNetworkQuality(
      statsTrack([
        {
          id: 'audio',
          type: 'inbound-rtp',
          kind: 'audio',
          packetsLost: 1,
          packetsReceived: 199,
          jitter: 0.012
        }
      ]),
      { packetsLost: 8, packetsReceived: 800 }
    );

    expect(result?.quality).toEqual({
      health: 'excellent',
      jitterMs: 12,
      latencyMs: null,
      packetLossPercent: 0.5,
      warningMetric: null
    });
  });

  it('classifies loss and jitter thresholds independently', () => {
    expect(classifyNetworkHealth(null, null, null)).toBe('unknown');
    expect(classifyNetworkHealth(0.4, 12, 100)).toBe('excellent');
    expect(classifyNetworkHealth(1, 12, 160)).toBe('good');
    expect(classifyNetworkHealth(3, 12, 260)).toBe('degraded');
    expect(classifyNetworkHealth(0, 12, 500)).toBe('poor');
  });

  it('reports jitter instead of a misleading 0% loss warning', () => {
    expect(selectParticipantNetworkWarningMetric(0, 75, 100)).toBe('jitter');
    expect(selectParticipantNetworkWarningMetric(0, 12, 300)).toBe('latency');
    expect(selectParticipantNetworkWarningMetric(12.4, 82, 800)).toBe('packetLoss');
    expect(selectParticipantNetworkWarningMetric(0.4, 12, 100)).toBeNull();
  });

  it('aggregates every active media track using the worst current signals', () => {
    expect(
      aggregateParticipantNetworkQuality([
        {
          health: 'excellent',
          jitterMs: 8,
          latencyMs: 90,
          packetLossPercent: 0,
          warningMetric: null
        },
        {
          health: 'poor',
          jitterMs: 170,
          latencyMs: 600,
          packetLossPercent: 12,
          warningMetric: 'jitter'
        }
      ])
    ).toEqual({
      health: 'poor',
      jitterMs: 170,
      latencyMs: 600,
      packetLossPercent: 12,
      warningMetric: 'packetLoss'
    });
    expect(aggregateParticipantNetworkQuality([])).toBeNull();
  });

  it('keeps the aggregate unknown when any active track has no usable signal', () => {
    expect(
      aggregateParticipantNetworkQuality([
        {
          health: 'excellent',
          jitterMs: 8,
          latencyMs: 90,
          packetLossPercent: 0,
          warningMetric: null
        },
        {
          health: 'unknown',
          jitterMs: null,
          latencyMs: null,
          packetLossPercent: null,
          warningMetric: null
        }
      ])
    ).toBeNull();
    expect(
      aggregateParticipantNetworkQuality([
        {
          health: 'poor',
          jitterMs: 170,
          latencyMs: 600,
          packetLossPercent: 12,
          warningMetric: 'packetLoss'
        },
        {
          health: 'unknown',
          jitterMs: null,
          latencyMs: null,
          packetLossPercent: null,
          warningMetric: null
        }
      ])
    ).toEqual({
      health: 'poor',
      jitterMs: 170,
      latencyMs: 600,
      packetLossPercent: 12,
      warningMetric: 'packetLoss'
    });
  });

  it('suppresses a brief drop but escalates sustained degradation', () => {
    let smoothing = null;
    for (const sample of [quality('excellent'), quality('excellent'), quality('excellent')]) {
      ({ state: smoothing } = updateParticipantNetworkQualitySmoothing(smoothing, sample));
    }
    expect(smoothing?.health).toBe('excellent');

    let update = updateParticipantNetworkQualitySmoothing(smoothing, quality('poor'));
    smoothing = update.state;
    expect(update.quality.health).toBe('excellent');
    update = updateParticipantNetworkQualitySmoothing(smoothing, quality('excellent'));
    smoothing = update.state;
    expect(update.quality.health).toBe('excellent');

    for (let index = 0; index < 3; index += 1) {
      update = updateParticipantNetworkQualitySmoothing(smoothing, quality('poor'));
      smoothing = update.state;
    }
    expect(update.quality.health).toBe('poor');
  });

  it('requires consecutive degraded samples when initial readings are unavailable', () => {
    let smoothing: ParticipantNetworkQualitySmoothing | null = null;

    for (let index = 0; index < 2; index += 1) {
      smoothing = updateParticipantNetworkQualitySmoothing(
        smoothing,
        quality('unknown', { packetLossPercent: null, jitterMs: null, latencyMs: null })
      ).state;
    }

    const firstDegraded = updateParticipantNetworkQualitySmoothing(
      smoothing,
      quality('poor', { packetLossPercent: 12, jitterMs: 90, latencyMs: 600 })
    );
    expect(firstDegraded.quality.health).toBe('unknown');

    const secondDegraded = updateParticipantNetworkQualitySmoothing(
      firstDegraded.state,
      quality('poor', { packetLossPercent: 12, jitterMs: 90, latencyMs: 600 })
    );
    expect(secondDegraded.quality.health).toBe('unknown');

    const thirdDegraded = updateParticipantNetworkQualitySmoothing(
      secondDegraded.state,
      quality('poor', { packetLossPercent: 12, jitterMs: 90, latencyMs: 600 })
    );
    expect(thirdDegraded.quality.health).toBe('poor');
  });

  it('reports bounded rolling averages and waits for stable recovery', () => {
    let smoothing = null;
    let update;
    for (let index = 0; index < 3; index += 1) {
      update = updateParticipantNetworkQualitySmoothing(
        smoothing,
        quality('poor', { packetLossPercent: 12, jitterMs: 90, latencyMs: 600 })
      );
      smoothing = update.state;
    }
    expect(update!.quality).toMatchObject({
      health: 'poor',
      packetLossPercent: 12,
      jitterMs: 90,
      latencyMs: 600
    });

    for (let index = 0; index < 5; index += 1) {
      update = updateParticipantNetworkQualitySmoothing(smoothing, quality('excellent'));
      smoothing = update.state;
    }
    expect(update!.state.samples).toHaveLength(5);
    expect(update!.quality).toMatchObject({
      health: 'excellent',
      packetLossPercent: 0.2,
      jitterMs: 10,
      latencyMs: 80
    });
  });
});

function quality(
  health: ParticipantNetworkQuality['health'],
  overrides: Partial<
    Pick<ParticipantNetworkQuality, 'packetLossPercent' | 'jitterMs' | 'latencyMs'>
  > = {}
): ParticipantNetworkQuality {
  const fallback = (excellent: number, poor: number) =>
    health === 'unknown' ? null : health === 'poor' ? poor : excellent;
  return {
    health,
    packetLossPercent: overrides.packetLossPercent ?? fallback(0.2, 20),
    jitterMs: overrides.jitterMs ?? fallback(10, 180),
    latencyMs: overrides.latencyMs ?? fallback(80, 700),
    warningMetric: health === 'poor' ? ('packetLoss' as const) : null
  };
}

function statsTrack(stats: Array<Record<string, unknown>>): Track {
  const report = new Map(stats.map((stat) => [String(stat.id), stat])) as unknown as RTCStatsReport;
  return {
    getRTCStatsReport: async () => report
  } as unknown as Track;
}
