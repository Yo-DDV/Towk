import type { Track } from 'livekit-client';

export const PARTICIPANT_NETWORK_QUALITY_INTERVAL_MS = 2_000;

export type ParticipantNetworkHealth = 'excellent' | 'good' | 'degraded' | 'poor' | 'unknown';
export type ParticipantNetworkWarningMetric = 'packetLoss' | 'jitter' | null;

export type ParticipantNetworkQuality = {
  health: ParticipantNetworkHealth;
  jitterMs: number | null;
  packetLossPercent: number | null;
  warningMetric: ParticipantNetworkWarningMetric;
};

export type ParticipantNetworkCounters = {
  packetsLost: number | null;
  packetsReceived: number | null;
};

type StatsTrack = Track & {
  getRTCStatsReport?: () => Promise<RTCStatsReport | undefined>;
};

type RtcStat = {
  type: string;
} & Record<string, unknown>;

export async function collectParticipantNetworkQuality(
  track: Track,
  previous: ParticipantNetworkCounters | null
): Promise<{
  counters: ParticipantNetworkCounters;
  quality: ParticipantNetworkQuality;
} | null> {
  const report = await (track as StatsTrack).getRTCStatsReport?.();
  if (!report) return null;

  const inbound: RtcStat[] = [];
  report.forEach((value) => {
    const stat = value as RtcStat;
    const kind = stringValue(stat.kind) ?? stringValue(stat.mediaType);
    if (stat.type === 'inbound-rtp' && (kind === 'audio' || kind === 'video' || kind === null)) {
      inbound.push(stat);
    }
  });
  if (!inbound.length) return null;

  const counters = {
    packetsLost: sum(inbound, 'packetsLost'),
    packetsReceived: sum(inbound, 'packetsReceived')
  };
  const lost = counterDelta(counters.packetsLost, previous?.packetsLost ?? null);
  const received = counterDelta(counters.packetsReceived, previous?.packetsReceived ?? null);
  const packetLossPercent = ratePercent(lost, received);
  const jitterSeconds = max(inbound, 'jitter');
  const jitterMs = jitterSeconds === null ? null : round(jitterSeconds * 1_000, 1);

  return {
    counters,
    quality: {
      health: classifyNetworkHealth(packetLossPercent, jitterMs),
      jitterMs,
      packetLossPercent,
      warningMetric: selectParticipantNetworkWarningMetric(packetLossPercent, jitterMs)
    }
  };
}

/**
 * Selects the metric that actually triggered the strongest visible warning.
 * Packet-loss counters are normally present even at 0%, so presence alone
 * must never hide a more severe jitter signal.
 */
export function selectParticipantNetworkWarningMetric(
  packetLossPercent: number | null,
  jitterMs: number | null
): ParticipantNetworkWarningMetric {
  const lossSeverity = networkHealthSeverity(classifyNetworkHealth(packetLossPercent, null));
  const jitterSeverity = networkHealthSeverity(classifyNetworkHealth(null, jitterMs));
  const warningSeverity = networkHealthSeverity('degraded');

  if (lossSeverity < warningSeverity && jitterSeverity < warningSeverity) return null;
  return jitterSeverity > lossSeverity ? 'jitter' : 'packetLoss';
}

function networkHealthSeverity(health: ParticipantNetworkHealth): number {
  switch (health) {
    case 'excellent':
      return 0;
    case 'good':
      return 1;
    case 'degraded':
      return 2;
    case 'poor':
      return 3;
    case 'unknown':
      return -1;
  }
}

export function classifyNetworkHealth(
  packetLossPercent: number | null,
  jitterMs: number | null
): ParticipantNetworkHealth {
  if (packetLossPercent === null && jitterMs === null) return 'unknown';
  if ((packetLossPercent ?? 0) >= 10 || (jitterMs ?? 0) >= 150) return 'poor';
  if ((packetLossPercent ?? 0) >= 3 || (jitterMs ?? 0) >= 60) return 'degraded';
  if ((packetLossPercent ?? 0) >= 1 || (jitterMs ?? 0) >= 30) return 'good';
  return 'excellent';
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sum(stats: RtcStat[], field: string): number | null {
  const values = stats.map((stat) => numberValue(stat[field])).filter((value) => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function max(stats: RtcStat[], field: string): number | null {
  const values = stats.map((stat) => numberValue(stat[field])).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

function counterDelta(current: number | null, previous: number | null): number | null {
  if (current === null) return null;
  if (previous === null || current < previous) return Math.max(0, current);
  return Math.max(0, current - previous);
}

function ratePercent(lost: number | null, received: number | null): number | null {
  if (lost === null || received === null || lost + received <= 0) return null;
  return round((lost / (lost + received)) * 100, 1);
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
