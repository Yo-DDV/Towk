import { describe, expect, it } from 'vitest';
import type { Participant, Track } from 'livekit-client';
import {
  PARTICIPANT_MEDIA_TELEMETRY_HISTORY_LIMIT,
  PARTICIPANT_MEDIA_TELEMETRY_MAX_BYTES,
  appendParticipantMediaTelemetryHistory,
  classifyParticipantMediaDiagnosis,
  collectParticipantMediaTelemetry,
  createParticipantMediaTelemetrySnapshot,
  encodeParticipantMediaTelemetry,
  nextParticipantMediaTelemetrySequence,
  parseParticipantMediaTelemetry,
  shouldAcceptParticipantMediaTelemetry,
  type ParticipantMediaAggregate,
  type ParticipantMediaMetric,
  type ParticipantMediaTelemetryHistoryPoint
} from './participantMediaTelemetry';

function report(entries: Record<string, unknown>[]): RTCStatsReport {
  const items = new Map(entries.map((entry, index) => [String(entry.id ?? index), entry]));
  return {
    get: (id: string) => items.get(id) as RTCStats | undefined,
    forEach: (callback: (value: RTCStats, key: string, parent: RTCStatsReport) => void) => {
      for (const [id, entry] of items)
        callback(entry as unknown as RTCStats, id, items as unknown as RTCStatsReport);
    }
  } as RTCStatsReport;
}

const cameraMetric: ParticipantMediaMetric = {
  kind: 'camera',
  health: 'good',
  latencyMs: 82,
  jitterMs: 12,
  packetLossPercent: 0.5,
  bitrateKbps: 2_500,
  framesPerSecond: 30,
  width: 1_280,
  height: 720,
  qualityLimitationReason: null
};

const healthy: ParticipantMediaAggregate = {
  health: 'excellent',
  latencyMs: 40,
  jitterMs: 4,
  packetLossPercent: 0
};
const degraded: ParticipantMediaAggregate = {
  health: 'degraded',
  latencyMs: 300,
  jitterMs: 70,
  packetLossPercent: 4
};

describe('participant media telemetry wire contract', () => {
  it('round-trips compact metrics without carrying an identity or network address', () => {
    const payload = encodeParticipantMediaTelemetry(7, 10_000, [cameraMetric]);
    expect(payload).not.toBeNull();
    expect(payload!.byteLength).toBeLessThan(PARTICIPANT_MEDIA_TELEMETRY_MAX_BYTES);
    const text = new TextDecoder().decode(payload!);
    expect(text).not.toContain('identity');
    expect(text).not.toContain('candidate');
    expect(text).not.toContain('address');

    const parsed = parseParticipantMediaTelemetry(payload!, 12_000);
    expect(parsed).toEqual({ version: 1, sequence: 7, sentAt: 10_000, metrics: [cameraMetric] });
    expect(createParticipantMediaTelemetrySnapshot(parsed!, 12_000).aggregate?.health).toBe('good');
  });

  it('rejects oversized, stale, future, malformed, duplicate-kind and identity-bearing payloads', () => {
    expect(parseParticipantMediaTelemetry(new Uint8Array(), 10_000)).toBeNull();
    expect(
      parseParticipantMediaTelemetry(
        new Uint8Array(PARTICIPANT_MEDIA_TELEMETRY_MAX_BYTES + 1),
        10_000
      )
    ).toBeNull();
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    expect(
      parseParticipantMediaTelemetry(encode({ v: 2, s: 1, t: 9_000, m: [] }), 10_000)
    ).toBeNull();
    expect(
      parseParticipantMediaTelemetry(encode({ v: 1, s: 1, t: 1_000, m: [] }), 10_000)
    ).toBeNull();
    expect(
      parseParticipantMediaTelemetry(encode({ v: 1, s: 1, t: 30_000, m: [] }), 10_000)
    ).toBeNull();
    expect(
      parseParticipantMediaTelemetry(
        encode({ v: 1, s: 1, t: 9_000, m: [], identity: 'forged' }),
        10_000
      )
    ).toBeNull();
    expect(
      parseParticipantMediaTelemetry(
        encode({
          v: 1,
          s: 1,
          t: 9_000,
          m: [
            { k: 'c', h: 'g' },
            { k: 'c', h: 'p' }
          ]
        }),
        10_000
      )
    ).toBeNull();
    expect(
      parseParticipantMediaTelemetry(
        encode({ v: 1, s: 1, t: 9_000, m: [{ k: 'm', h: 'g', f: 30 }] }),
        10_000
      )
    ).toBeNull();
  });

  it('rejects replayed or implausibly frequent source packets', () => {
    const previous = { sequence: 4, sentAt: 10_000, receivedAt: 10_100 };
    const packet = { version: 1 as const, sequence: 5, sentAt: 10_500, metrics: [] };
    expect(shouldAcceptParticipantMediaTelemetry(previous, packet, 10_600)).toBe(false);
    expect(
      shouldAcceptParticipantMediaTelemetry(previous, { ...packet, sentAt: 11_000 }, 11_100)
    ).toBe(true);
    expect(
      shouldAcceptParticipantMediaTelemetry(
        previous,
        { ...packet, sequence: 4, sentAt: 11_000 },
        11_100
      )
    ).toBe(false);
  });
});

describe('participant media telemetry sampling', () => {
  it('derives outbound bitrate, receiver loss, jitter and RTT from counter deltas', async () => {
    const track = {
      source: 'camera',
      mediaStreamTrack: { id: 'camera-track' },
      getRTCStatsReport: async () =>
        report([
          {
            id: 'outbound',
            type: 'outbound-rtp',
            kind: 'video',
            timestamp: 3_000,
            bytesSent: 1_500_000,
            packetsSent: 2_000,
            framesPerSecond: 30,
            frameWidth: 1_280,
            frameHeight: 720,
            qualityLimitationReason: 'bandwidth'
          },
          {
            id: 'remote-inbound',
            type: 'remote-inbound-rtp',
            packetsLost: 30,
            jitter: 0.07,
            roundTripTime: 0.28
          }
        ])
    } as unknown as Track;
    const participant = {
      getTrackPublications: () => [{ isMuted: false, track, trackSid: 'TR_camera' }]
    } as unknown as Participant;
    const previous = new Map([
      [
        'camera:TR_camera',
        { bytesSent: 1_000_000, packetsSent: 1_000, packetsLost: 10, timestamp: 1_000 }
      ]
    ]);

    const result = await collectParticipantMediaTelemetry(participant, previous, 3_000);
    expect(result.metrics).toEqual([
      {
        kind: 'camera',
        health: 'degraded',
        latencyMs: 280,
        jitterMs: 70,
        packetLossPercent: 2,
        bitrateKbps: 2_000,
        framesPerSecond: 30,
        width: 1_280,
        height: 720,
        qualityLimitationReason: 'bandwidth'
      }
    ]);
  });

  it('does not invent rates from the first cumulative counter sample', async () => {
    const track = {
      source: 'microphone',
      getRTCStatsReport: async () =>
        report([
          {
            type: 'outbound-rtp',
            kind: 'audio',
            timestamp: 2_000,
            bytesSent: 8_000,
            packetsSent: 50
          }
        ])
    } as unknown as Track;
    const participant = {
      getTrackPublications: () => [{ isMuted: false, track, trackSid: 'TR_microphone' }]
    } as unknown as Participant;
    const result = await collectParticipantMediaTelemetry(participant, new Map(), 2_000);
    expect(result.metrics[0]?.bitrateKbps).toBeNull();
    expect(result.metrics[0]?.packetLossPercent).toBeNull();
    expect(result.metrics[0]?.health).toBe('unknown');
  });
});

describe('participant media telemetry history and diagnosis', () => {
  it('attributes source-only, receiver-only and shared degradation without claiming certainty', () => {
    expect(classifyParticipantMediaDiagnosis(degraded, healthy)).toBe('source');
    expect(classifyParticipantMediaDiagnosis(healthy, degraded)).toBe('receiver');
    expect(classifyParticipantMediaDiagnosis(degraded, degraded)).toBe('shared');
    expect(classifyParticipantMediaDiagnosis(null, degraded)).toBe('unknown');
  });

  it('buckets history to five seconds and retains at most fifteen minutes', () => {
    let history: ParticipantMediaTelemetryHistoryPoint[] = [];
    for (let index = 0; index < PARTICIPANT_MEDIA_TELEMETRY_HISTORY_LIMIT + 20; index += 1) {
      history = appendParticipantMediaTelemetryHistory(
        history,
        index * 5_000 + 1,
        healthy,
        degraded
      );
    }
    expect(history).toHaveLength(PARTICIPANT_MEDIA_TELEMETRY_HISTORY_LIMIT);
    const updated = appendParticipantMediaTelemetryHistory(
      history,
      history.at(-1)!.bucketAt + 4_999,
      degraded,
      healthy
    );
    expect(updated).toHaveLength(PARTICIPANT_MEDIA_TELEMETRY_HISTORY_LIMIT);
    expect(updated.at(-1)?.sourceHealth).toBe('degraded');
  });

  it('wraps the bounded sequence counter', () => {
    expect(nextParticipantMediaTelemetrySequence(0x7fffffff)).toBe(0);
    expect(nextParticipantMediaTelemetrySequence(7)).toBe(8);
  });
});
