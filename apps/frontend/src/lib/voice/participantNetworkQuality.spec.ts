import { describe, expect, it } from 'vitest';
import type { Track } from 'livekit-client';
import {
  classifyNetworkHealth,
  collectParticipantNetworkQuality,
  selectParticipantNetworkWarningMetric
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
          jitter: 0.08
        }
      ]),
      { packetsLost: 10, packetsReceived: 990 }
    );

    expect(result).toEqual({
      counters: { packetsLost: 30, packetsReceived: 1_170 },
      quality: {
        health: 'poor',
        jitterMs: 80,
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
      packetLossPercent: 0.5,
      warningMetric: null
    });
  });

  it('classifies loss and jitter thresholds independently', () => {
    expect(classifyNetworkHealth(null, null)).toBe('unknown');
    expect(classifyNetworkHealth(0.4, 12)).toBe('excellent');
    expect(classifyNetworkHealth(1, 12)).toBe('good');
    expect(classifyNetworkHealth(3, 12)).toBe('degraded');
    expect(classifyNetworkHealth(0, 150)).toBe('poor');
  });

  it('reports jitter instead of a misleading 0% loss warning', () => {
    expect(selectParticipantNetworkWarningMetric(0, 75)).toBe('jitter');
    expect(selectParticipantNetworkWarningMetric(12.4, 82)).toBe('packetLoss');
    expect(selectParticipantNetworkWarningMetric(0.4, 12)).toBeNull();
  });
});

function statsTrack(stats: Array<Record<string, unknown>>): Track {
  const report = new Map(stats.map((stat) => [String(stat.id), stat])) as unknown as RTCStatsReport;
  return {
    getRTCStatsReport: async () => report
  } as unknown as Track;
}
