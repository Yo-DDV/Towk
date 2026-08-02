import type { Track } from 'livekit-client';

export const PARTICIPANT_NETWORK_QUALITY_INTERVAL_MS = 2_000;
export const PARTICIPANT_NETWORK_QUALITY_WINDOW_SIZE = 5;
const PARTICIPANT_NETWORK_DEGRADATION_SAMPLES = 3;
const PARTICIPANT_NETWORK_RECOVERY_SAMPLES = 2;

export type ParticipantNetworkHealth = 'excellent' | 'good' | 'degraded' | 'poor' | 'unknown';
export type ParticipantNetworkWarningMetric = 'packetLoss' | 'jitter' | 'latency' | null;

export type ParticipantNetworkQuality = {
  health: ParticipantNetworkHealth;
  jitterMs: number | null;
  latencyMs: number | null;
  packetLossPercent: number | null;
  warningMetric: ParticipantNetworkWarningMetric;
};

export type ParticipantNetworkQualitySmoothing = {
  samples: ParticipantNetworkQuality[];
  health: ParticipantNetworkHealth;
  degradationStreak: number;
  recoveryStreak: number;
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

  const stats: RtcStat[] = [];
  const inbound: RtcStat[] = [];
  report.forEach((value) => {
    const stat = value as RtcStat;
    stats.push(stat);
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
  const latencyMs = roundTripTimeMs(stats);

  return {
    counters,
    quality: {
      health: classifyNetworkHealth(packetLossPercent, jitterMs, latencyMs),
      jitterMs,
      latencyMs,
      packetLossPercent,
      warningMetric: selectParticipantNetworkWarningMetric(packetLossPercent, jitterMs, latencyMs)
    }
  };
}

export function aggregateParticipantNetworkQuality(
  qualities: ParticipantNetworkQuality[]
): ParticipantNetworkQuality | null {
  if (!qualities.length) return null;

  const packetLossValues = qualities
    .map((quality) => quality.packetLossPercent)
    .filter((value): value is number => value !== null);
  const jitterValues = qualities
    .map((quality) => quality.jitterMs)
    .filter((value): value is number => value !== null);
  const packetLossPercent = packetLossValues.length ? Math.max(...packetLossValues) : null;
  const jitterMs = jitterValues.length ? Math.max(...jitterValues) : null;
  const latencyValues = qualities
    .map((quality) => quality.latencyMs)
    .filter((value): value is number => value !== null);
  const latencyMs = latencyValues.length ? Math.max(...latencyValues) : null;

  const aggregate = {
    health: classifyNetworkHealth(packetLossPercent, jitterMs, latencyMs),
    jitterMs,
    latencyMs,
    packetLossPercent,
    warningMetric: selectParticipantNetworkWarningMetric(packetLossPercent, jitterMs, latencyMs)
  };
  const hasUnknownTrack = qualities.some((quality) => quality.health === 'unknown');
  if (
    hasUnknownTrack &&
    networkHealthSeverity(aggregate.health) < networkHealthSeverity('degraded')
  ) {
    return null;
  }
  return aggregate;
}

/**
 * Selects the metric that actually triggered the strongest visible warning.
 * Packet-loss counters are normally present even at 0%, so presence alone
 * must never hide a more severe jitter signal.
 */
export function selectParticipantNetworkWarningMetric(
  packetLossPercent: number | null,
  jitterMs: number | null,
  latencyMs: number | null = null
): ParticipantNetworkWarningMetric {
  const lossSeverity = networkHealthSeverity(classifyNetworkHealth(packetLossPercent, null, null));
  const jitterSeverity = networkHealthSeverity(classifyNetworkHealth(null, jitterMs, null));
  const latencySeverity = networkHealthSeverity(classifyNetworkHealth(null, null, latencyMs));
  const warningSeverity = networkHealthSeverity('degraded');

  if (
    lossSeverity < warningSeverity &&
    jitterSeverity < warningSeverity &&
    latencySeverity < warningSeverity
  ) {
    return null;
  }
  if (latencySeverity > Math.max(lossSeverity, jitterSeverity)) return 'latency';
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
  jitterMs: number | null,
  latencyMs: number | null = null
): ParticipantNetworkHealth {
  if (packetLossPercent === null && jitterMs === null && latencyMs === null) return 'unknown';
  if ((packetLossPercent ?? 0) >= 10 || (jitterMs ?? 0) >= 150 || (latencyMs ?? 0) >= 500) {
    return 'poor';
  }
  if ((packetLossPercent ?? 0) >= 3 || (jitterMs ?? 0) >= 60 || (latencyMs ?? 0) >= 250) {
    return 'degraded';
  }
  if ((packetLossPercent ?? 0) >= 1 || (jitterMs ?? 0) >= 30 || (latencyMs ?? 0) >= 150) {
    return 'good';
  }
  return 'excellent';
}

export function updateParticipantNetworkQualitySmoothing(
  previous: ParticipantNetworkQualitySmoothing | null,
  sample: ParticipantNetworkQuality
): { state: ParticipantNetworkQualitySmoothing; quality: ParticipantNetworkQuality } {
  const samples = [...(previous?.samples ?? []), sample].slice(
    -PARTICIPANT_NETWORK_QUALITY_WINDOW_SIZE
  );
  const packetLossPercent = averageMetric(samples, 'packetLossPercent');
  const jitterMs = averageMetric(samples, 'jitterMs');
  const latencyMs = averageMetric(samples, 'latencyMs');
  const targetHealth = classifyNetworkHealth(packetLossPercent, jitterMs, latencyMs);
  const currentHealth = previous?.health ?? 'unknown';
  const sampleSeverity = networkHealthSeverity(sample.health);
  const currentSeverity = networkHealthSeverity(currentHealth);
  let degradationStreak = previous?.degradationStreak ?? 0;
  let recoveryStreak = previous?.recoveryStreak ?? 0;
  let health = currentHealth;

  if (sample.health === 'unknown') {
    degradationStreak = 0;
    recoveryStreak = 0;
  } else if (currentHealth === 'unknown') {
    recoveryStreak = 0;
    if (sampleSeverity < networkHealthSeverity('degraded')) {
      health = targetHealth;
      degradationStreak = 0;
    } else {
      degradationStreak += 1;
      if (degradationStreak >= PARTICIPANT_NETWORK_DEGRADATION_SAMPLES) {
        health = targetHealth;
      }
    }
  } else if (sampleSeverity > currentSeverity) {
    degradationStreak += 1;
    recoveryStreak = 0;
    if (
      degradationStreak >= PARTICIPANT_NETWORK_DEGRADATION_SAMPLES &&
      networkHealthSeverity(targetHealth) > currentSeverity
    ) {
      health = targetHealth;
    }
  } else if (sampleSeverity < currentSeverity) {
    recoveryStreak += 1;
    degradationStreak = 0;
    if (
      recoveryStreak >= PARTICIPANT_NETWORK_RECOVERY_SAMPLES &&
      networkHealthSeverity(targetHealth) < currentSeverity
    ) {
      health = targetHealth;
    }
  } else {
    degradationStreak = 0;
    recoveryStreak = 0;
  }

  const quality = {
    health,
    packetLossPercent,
    jitterMs,
    latencyMs,
    warningMetric:
      health === 'degraded' || health === 'poor'
        ? selectParticipantNetworkWarningMetric(packetLossPercent, jitterMs, latencyMs)
        : null
  };
  return {
    state: { samples, health, degradationStreak, recoveryStreak },
    quality
  };
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

function roundTripTimeMs(stats: RtcStat[]): number | null {
  const selectedPairIds = new Set(
    stats
      .filter((stat) => stat.type === 'transport')
      .map((stat) => stringValue(stat.selectedCandidatePairId))
      .filter((value): value is string => value !== null)
  );
  const selectedPairs = stats.filter(
    (stat) => stat.type === 'candidate-pair' && selectedPairIds.has(String(stat.id))
  );
  const nominatedPairs = stats.filter(
    (stat) =>
      stat.type === 'candidate-pair' &&
      stat.state === 'succeeded' &&
      (stat.nominated === true || stat.selected === true)
  );
  const pairLatency = max(
    selectedPairs.length ? selectedPairs : nominatedPairs,
    'currentRoundTripTime'
  );
  const remoteLatency = max(
    stats.filter(
      (stat) => stat.type === 'remote-inbound-rtp' || stat.type === 'remote-outbound-rtp'
    ),
    'roundTripTime'
  );
  const seconds = remoteLatency ?? pairLatency;
  return seconds === null ? null : round(seconds * 1_000, 1);
}

function averageMetric(
  samples: ParticipantNetworkQuality[],
  field: 'packetLossPercent' | 'jitterMs' | 'latencyMs'
): number | null {
  const values = samples.map((sample) => sample[field]).filter((value) => value !== null);
  return values.length
    ? round(values.reduce((total, value) => total + value, 0) / values.length, 1)
    : null;
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
