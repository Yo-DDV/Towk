import type { Participant, Track, TrackPublication } from 'livekit-client';

export const PARTICIPANT_MEDIA_TELEMETRY_TOPIC = 'towk.media-telemetry.v1';
export const PARTICIPANT_MEDIA_TELEMETRY_INTERVAL_MS = 2_000;
export const PARTICIPANT_MEDIA_TELEMETRY_STALE_MS = 6_000;
export const PARTICIPANT_MEDIA_TELEMETRY_MAX_BYTES = 1_200;
export const PARTICIPANT_MEDIA_TELEMETRY_HISTORY_BUCKET_MS = 5_000;
export const PARTICIPANT_MEDIA_TELEMETRY_HISTORY_LIMIT = 180;
const PARTICIPANT_MEDIA_TELEMETRY_MAX_CLOCK_SKEW_MS = 10_000;
const PARTICIPANT_MEDIA_TELEMETRY_MAX_AGE_MS = 8_000;
const PARTICIPANT_MEDIA_TELEMETRY_MIN_SOURCE_INTERVAL_MS = 750;
const MAX_SEQUENCE = 0x7fffffff;

export type ParticipantMediaKind = 'microphone' | 'camera' | 'screen';
export type ParticipantMediaHealth = 'excellent' | 'good' | 'degraded' | 'poor' | 'unknown';
export type ParticipantMediaDiagnosis = 'source' | 'receiver' | 'shared' | 'unknown';
export type ParticipantMediaQualityLimitation = 'bandwidth' | 'cpu' | 'other' | null;

export type ParticipantMediaMetric = {
  kind: ParticipantMediaKind;
  health: ParticipantMediaHealth;
  latencyMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
  bitrateKbps: number | null;
  framesPerSecond: number | null;
  width: number | null;
  height: number | null;
  qualityLimitationReason: ParticipantMediaQualityLimitation;
};

export type ParticipantMediaAggregate = Omit<
  ParticipantMediaMetric,
  'kind' | 'bitrateKbps' | 'framesPerSecond' | 'width' | 'height' | 'qualityLimitationReason'
>;

export type ParticipantMediaTelemetryPacket = {
  version: 1;
  sequence: number;
  sentAt: number;
  metrics: ParticipantMediaMetric[];
};

export type ParticipantMediaTelemetrySnapshot = ParticipantMediaTelemetryPacket & {
  receivedAt: number;
  aggregate: ParticipantMediaAggregate | null;
};

export type ParticipantMediaTelemetryHistoryPoint = {
  bucketAt: number;
  sourceHealth: ParticipantMediaHealth;
  receptionHealth: ParticipantMediaHealth;
  sourceLatencyMs: number | null;
  receptionLatencyMs: number | null;
  sourcePacketLossPercent: number | null;
  receptionPacketLossPercent: number | null;
};

export type ParticipantMediaOutboundCounters = {
  bytesSent: number | null;
  packetsSent: number | null;
  packetsLost: number | null;
  timestamp: number | null;
};

export type ParticipantMediaCollection = {
  metrics: ParticipantMediaMetric[];
  counters: Map<string, ParticipantMediaOutboundCounters>;
};

export type ParticipantTelemetryAcceptance = {
  sequence: number;
  sentAt: number;
  receivedAt: number;
};

type StatsTrack = Track & {
  getRTCStatsReport?: () => Promise<RTCStatsReport | undefined>;
  mediaStreamTrack?: MediaStreamTrack;
};

type RtcStat = { id?: string; type: string; timestamp?: number } & Record<string, unknown>;
type ParticipantLike = Pick<Participant, 'getTrackPublications'>;

type WireMetric = {
  k: 'm' | 'c' | 's';
  h: 'e' | 'g' | 'd' | 'p' | 'u';
  r?: number;
  j?: number;
  l?: number;
  b?: number;
  f?: number;
  w?: number;
  x?: number;
  q?: 'b' | 'c' | 'o';
};

type WirePacket = { v: 1; s: number; t: number; m: WireMetric[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export async function collectParticipantMediaTelemetry(
  participant: ParticipantLike,
  previousCounters: ReadonlyMap<string, ParticipantMediaOutboundCounters>,
  collectedAt = Date.now()
): Promise<ParticipantMediaCollection> {
  const nextCounters = new Map<string, ParticipantMediaOutboundCounters>();
  const metricsByKind = new Map<ParticipantMediaKind, ParticipantMediaMetric[]>();

  for (const publication of participant.getTrackPublications()) {
    const track = publication.track as StatsTrack | undefined;
    const kind = track ? mediaKindForSource(track.source) : null;
    if (!track || !kind || publication.isMuted) continue;

    const counterKey = telemetryCounterKey(publication, track, kind);
    const result = await collectOutboundTrackMetric(
      track,
      kind,
      previousCounters.get(counterKey) ?? null,
      collectedAt
    ).catch(() => null);
    if (!result) continue;
    nextCounters.set(counterKey, result.counters);
    const existing = metricsByKind.get(kind) ?? [];
    existing.push(result.metric);
    metricsByKind.set(kind, existing);
  }

  const metrics = (['microphone', 'camera', 'screen'] as const).flatMap((kind) => {
    const values = metricsByKind.get(kind);
    return values?.length ? [aggregateMetricsForKind(kind, values)] : [];
  });
  return { metrics, counters: nextCounters };
}

export function encodeParticipantMediaTelemetry(
  sequence: number,
  sentAt: number,
  metrics: ParticipantMediaMetric[]
): Uint8Array | null {
  if (!validSequence(sequence) || !validTimestamp(sentAt)) return null;
  const wire: WirePacket = {
    v: 1,
    s: sequence,
    t: Math.trunc(sentAt),
    m: metrics.slice(0, 3).map(metricToWire)
  };
  const payload = encoder.encode(JSON.stringify(wire));
  return payload.byteLength <= PARTICIPANT_MEDIA_TELEMETRY_MAX_BYTES ? payload : null;
}

export function parseParticipantMediaTelemetry(
  payload: Uint8Array,
  receivedAt = Date.now()
): ParticipantMediaTelemetryPacket | null {
  if (
    payload.byteLength === 0 ||
    payload.byteLength > PARTICIPANT_MEDIA_TELEMETRY_MAX_BYTES ||
    !validTimestamp(receivedAt)
  ) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(payload));
  } catch {
    return null;
  }
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['v', 's', 't', 'm'])) return null;
  if (value.v !== 1 || !validSequence(value.s) || !validTimestamp(value.t)) return null;
  const sentAt = value.t as number;
  if (
    sentAt > receivedAt + PARTICIPANT_MEDIA_TELEMETRY_MAX_CLOCK_SKEW_MS ||
    receivedAt - sentAt > PARTICIPANT_MEDIA_TELEMETRY_MAX_AGE_MS ||
    !Array.isArray(value.m) ||
    value.m.length > 3
  ) {
    return null;
  }

  const metrics: ParticipantMediaMetric[] = [];
  const kinds = new Set<ParticipantMediaKind>();
  for (const candidate of value.m) {
    const metric = metricFromWire(candidate);
    if (!metric || kinds.has(metric.kind)) return null;
    kinds.add(metric.kind);
    metrics.push(metric);
  }
  return { version: 1, sequence: value.s as number, sentAt, metrics };
}

export function shouldAcceptParticipantMediaTelemetry(
  previous: ParticipantTelemetryAcceptance | null,
  packet: ParticipantMediaTelemetryPacket,
  receivedAt: number
): boolean {
  if (!previous) return true;
  return (
    packet.sequence > previous.sequence &&
    packet.sentAt > previous.sentAt &&
    packet.sentAt - previous.sentAt >= PARTICIPANT_MEDIA_TELEMETRY_MIN_SOURCE_INTERVAL_MS &&
    receivedAt >= previous.receivedAt
  );
}

export function createParticipantMediaTelemetrySnapshot(
  packet: ParticipantMediaTelemetryPacket,
  receivedAt: number
): ParticipantMediaTelemetrySnapshot {
  return {
    ...packet,
    receivedAt,
    aggregate: aggregateParticipantMediaMetrics(packet.metrics)
  };
}

export function aggregateParticipantMediaMetrics(
  metrics: ParticipantMediaMetric[]
): ParticipantMediaAggregate | null {
  if (!metrics.length) return null;
  const health = metrics.reduce<ParticipantMediaHealth>(
    (worst, metric) =>
      healthSeverity(metric.health) > healthSeverity(worst) ? metric.health : worst,
    'unknown'
  );
  return {
    health,
    latencyMs: maximum(metrics.map((metric) => metric.latencyMs)),
    jitterMs: maximum(metrics.map((metric) => metric.jitterMs)),
    packetLossPercent: maximum(metrics.map((metric) => metric.packetLossPercent))
  };
}

export function classifyParticipantMediaDiagnosis(
  source: ParticipantMediaAggregate | null,
  reception: ParticipantMediaAggregate | null
): ParticipantMediaDiagnosis {
  const sourceSeverity = source ? healthSeverity(source.health) : -1;
  const receptionSeverity = reception ? healthSeverity(reception.health) : -1;
  const warningSeverity = healthSeverity('degraded');

  if (sourceSeverity >= warningSeverity && receptionSeverity >= warningSeverity) return 'shared';
  if (
    sourceSeverity >= warningSeverity &&
    receptionSeverity >= 0 &&
    receptionSeverity < warningSeverity
  ) {
    return 'source';
  }
  if (
    receptionSeverity >= warningSeverity &&
    sourceSeverity >= 0 &&
    sourceSeverity < warningSeverity
  ) {
    return 'receiver';
  }
  return 'unknown';
}

export function appendParticipantMediaTelemetryHistory(
  history: ParticipantMediaTelemetryHistoryPoint[],
  receivedAt: number,
  source: ParticipantMediaAggregate | null,
  reception: ParticipantMediaAggregate | null
): ParticipantMediaTelemetryHistoryPoint[] {
  const bucketAt =
    Math.floor(receivedAt / PARTICIPANT_MEDIA_TELEMETRY_HISTORY_BUCKET_MS) *
    PARTICIPANT_MEDIA_TELEMETRY_HISTORY_BUCKET_MS;
  const point: ParticipantMediaTelemetryHistoryPoint = {
    bucketAt,
    sourceHealth: source?.health ?? 'unknown',
    receptionHealth: reception?.health ?? 'unknown',
    sourceLatencyMs: source?.latencyMs ?? null,
    receptionLatencyMs: reception?.latencyMs ?? null,
    sourcePacketLossPercent: source?.packetLossPercent ?? null,
    receptionPacketLossPercent: reception?.packetLossPercent ?? null
  };
  const next = history.filter(
    (candidate) =>
      candidate.bucketAt >=
        bucketAt -
          PARTICIPANT_MEDIA_TELEMETRY_HISTORY_BUCKET_MS *
            (PARTICIPANT_MEDIA_TELEMETRY_HISTORY_LIMIT - 1) && candidate.bucketAt !== bucketAt
  );
  next.push(point);
  return next.slice(-PARTICIPANT_MEDIA_TELEMETRY_HISTORY_LIMIT);
}

export function participantMediaHealthScore(health: ParticipantMediaHealth): number {
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
      return 1.5;
  }
}

export function nextParticipantMediaTelemetrySequence(current: number): number {
  return current >= MAX_SEQUENCE ? 0 : current + 1;
}

async function collectOutboundTrackMetric(
  track: StatsTrack,
  kind: ParticipantMediaKind,
  previous: ParticipantMediaOutboundCounters | null,
  collectedAt: number
): Promise<{ metric: ParticipantMediaMetric; counters: ParticipantMediaOutboundCounters } | null> {
  const report = await track.getRTCStatsReport?.();
  if (!report) return null;

  const stats: RtcStat[] = [];
  report.forEach((value) => stats.push(value as RtcStat));
  const outbound = stats.filter((stat) => {
    const mediaType = stringValue(stat.kind) ?? stringValue(stat.mediaType);
    return (
      stat.type === 'outbound-rtp' &&
      stat.isRemote !== true &&
      (mediaType === null || mediaType === mediaTypeForKind(kind))
    );
  });
  if (!outbound.length) return null;
  const remoteInbound = stats.filter((stat) => stat.type === 'remote-inbound-rtp');

  const timestamp = maximum(outbound.map((stat) => numberValue(stat.timestamp))) ?? collectedAt;
  const counters: ParticipantMediaOutboundCounters = {
    bytesSent: sum(outbound, 'bytesSent'),
    packetsSent: sum(outbound, 'packetsSent'),
    packetsLost: sum(remoteInbound, 'packetsLost'),
    timestamp
  };
  const elapsedMs = counterDelta(counters.timestamp, previous?.timestamp ?? null);
  const bytesDelta = counterDelta(counters.bytesSent, previous?.bytesSent ?? null);
  const packetsDelta = counterDelta(counters.packetsSent, previous?.packetsSent ?? null);
  const lostDelta = counterDelta(counters.packetsLost, previous?.packetsLost ?? null);
  const bitrateKbps =
    elapsedMs && elapsedMs > 0 && bytesDelta !== null
      ? round((bytesDelta * 8) / elapsedMs, 1)
      : null;
  const packetLossPercent =
    packetsDelta !== null && packetsDelta > 0 && lostDelta !== null
      ? round((Math.min(lostDelta, packetsDelta) / packetsDelta) * 100, 1)
      : null;
  const jitterSeconds = maximum(remoteInbound.map((stat) => numberValue(stat.jitter)));
  const latencySeconds =
    maximum(remoteInbound.map((stat) => numberValue(stat.roundTripTime))) ??
    selectedCandidatePairLatency(stats);
  const jitterMs = jitterSeconds === null ? null : round(jitterSeconds * 1_000, 1);
  const latencyMs = latencySeconds === null ? null : round(latencySeconds * 1_000, 1);
  const framesPerSecond =
    kind === 'microphone'
      ? null
      : maximum(outbound.map((stat) => numberValue(stat.framesPerSecond)));
  const width =
    kind === 'microphone' ? null : maximum(outbound.map((stat) => numberValue(stat.frameWidth)));
  const height =
    kind === 'microphone' ? null : maximum(outbound.map((stat) => numberValue(stat.frameHeight)));
  const qualityLimitationReason = qualityLimitation(outbound);

  return {
    counters,
    metric: {
      kind,
      health: classifyHealth(packetLossPercent, jitterMs, latencyMs),
      latencyMs,
      jitterMs,
      packetLossPercent,
      bitrateKbps: boundedMetric(bitrateKbps, 0, 100_000),
      framesPerSecond: boundedMetric(framesPerSecond, 0, 240),
      width: boundedInteger(width, 1, 16_384),
      height: boundedInteger(height, 1, 16_384),
      qualityLimitationReason
    }
  };
}

function metricToWire(metric: ParticipantMediaMetric): WireMetric {
  const value: WireMetric = { k: kindToWire(metric.kind), h: healthToWire(metric.health) };
  assignWireNumber(value, 'r', metric.latencyMs);
  assignWireNumber(value, 'j', metric.jitterMs);
  assignWireNumber(value, 'l', metric.packetLossPercent);
  assignWireNumber(value, 'b', metric.bitrateKbps);
  assignWireNumber(value, 'f', metric.framesPerSecond);
  assignWireNumber(value, 'w', metric.width);
  assignWireNumber(value, 'x', metric.height);
  if (metric.qualityLimitationReason) value.q = limitationToWire(metric.qualityLimitationReason);
  return value;
}

function metricFromWire(value: unknown): ParticipantMediaMetric | null {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ['k', 'h', 'r', 'j', 'l', 'b', 'f', 'w', 'x', 'q'])
  ) {
    return null;
  }
  const kind = kindFromWire(value.k);
  const health = healthFromWire(value.h);
  if (!kind || !health) return null;
  const latencyMs = optionalBoundedNumber(value.r, 0, 60_000);
  const jitterMs = optionalBoundedNumber(value.j, 0, 60_000);
  const packetLossPercent = optionalBoundedNumber(value.l, 0, 100);
  const bitrateKbps = optionalBoundedNumber(value.b, 0, 100_000);
  const framesPerSecond = optionalBoundedNumber(value.f, 0, 240);
  const width = optionalBoundedInteger(value.w, 1, 16_384);
  const height = optionalBoundedInteger(value.x, 1, 16_384);
  if (
    [latencyMs, jitterMs, packetLossPercent, bitrateKbps, framesPerSecond, width, height].includes(
      undefined
    )
  ) {
    return null;
  }
  const limitation = limitationFromWire(value.q);
  if (limitation === undefined) return null;
  if (kind === 'microphone' && (framesPerSecond !== null || width !== null || height !== null))
    return null;
  if ((width === null) !== (height === null)) return null;
  return {
    kind,
    health,
    latencyMs: latencyMs ?? null,
    jitterMs: jitterMs ?? null,
    packetLossPercent: packetLossPercent ?? null,
    bitrateKbps: bitrateKbps ?? null,
    framesPerSecond: framesPerSecond ?? null,
    width: width ?? null,
    height: height ?? null,
    qualityLimitationReason: limitation
  };
}

function classifyHealth(
  packetLossPercent: number | null,
  jitterMs: number | null,
  latencyMs: number | null
): ParticipantMediaHealth {
  if (packetLossPercent === null && jitterMs === null && latencyMs === null) return 'unknown';
  if ((packetLossPercent ?? 0) >= 10 || (jitterMs ?? 0) >= 150 || (latencyMs ?? 0) >= 500)
    return 'poor';
  if ((packetLossPercent ?? 0) >= 3 || (jitterMs ?? 0) >= 60 || (latencyMs ?? 0) >= 250)
    return 'degraded';
  if ((packetLossPercent ?? 0) >= 1 || (jitterMs ?? 0) >= 30 || (latencyMs ?? 0) >= 150)
    return 'good';
  return 'excellent';
}

function aggregateMetricsForKind(
  kind: ParticipantMediaKind,
  metrics: ParticipantMediaMetric[]
): ParticipantMediaMetric {
  const aggregate = aggregateParticipantMediaMetrics(metrics)!;
  const limitation =
    metrics.find((metric) => metric.qualityLimitationReason)?.qualityLimitationReason ?? null;
  return {
    kind,
    ...aggregate,
    bitrateKbps: metrics.reduce((total, metric) => total + (metric.bitrateKbps ?? 0), 0) || null,
    framesPerSecond: maximum(metrics.map((metric) => metric.framesPerSecond)),
    width: maximum(metrics.map((metric) => metric.width)),
    height: maximum(metrics.map((metric) => metric.height)),
    qualityLimitationReason: limitation
  };
}

function telemetryCounterKey(
  publication: TrackPublication,
  track: StatsTrack,
  kind: ParticipantMediaKind
): string {
  const publicationSid = (publication as TrackPublication & { trackSid?: unknown }).trackSid;
  const stableId =
    typeof publicationSid === 'string' && publicationSid
      ? publicationSid
      : track.mediaStreamTrack?.id || kind;
  return `${kind}:${stableId}`;
}

function mediaKindForSource(source: Track['source']): ParticipantMediaKind | null {
  switch (source) {
    case 'microphone':
      return 'microphone';
    case 'camera':
      return 'camera';
    case 'screen_share':
      return 'screen';
    default:
      return null;
  }
}

function mediaTypeForKind(kind: ParticipantMediaKind): 'audio' | 'video' {
  return kind === 'microphone' ? 'audio' : 'video';
}

function selectedCandidatePairLatency(stats: RtcStat[]): number | null {
  const selectedIds = new Set(
    stats
      .filter((stat) => stat.type === 'transport')
      .map((stat) => stringValue(stat.selectedCandidatePairId))
      .filter((value): value is string => value !== null)
  );
  const pairs = stats.filter(
    (stat) =>
      stat.type === 'candidate-pair' &&
      (selectedIds.has(String(stat.id)) ||
        (stat.state === 'succeeded' && (stat.nominated === true || stat.selected === true)))
  );
  return maximum(pairs.map((stat) => numberValue(stat.currentRoundTripTime)));
}

function qualityLimitation(stats: RtcStat[]): ParticipantMediaQualityLimitation {
  for (const stat of stats) {
    const value = stringValue(stat.qualityLimitationReason);
    if (!value || value === 'none') continue;
    if (value === 'bandwidth') return 'bandwidth';
    if (value === 'cpu') return 'cpu';
    return 'other';
  }
  return null;
}

function healthSeverity(health: ParticipantMediaHealth): number {
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

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sum(stats: RtcStat[], field: string): number | null {
  const values = stats
    .map((stat) => numberValue(stat[field]))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function maximum(values: Array<number | null>): number | null {
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value)
  );
  return finite.length ? Math.max(...finite) : null;
}

function counterDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || current < previous) return null;
  return current - previous;
}

function boundedMetric(value: number | null, minimum: number, maximumValue: number): number | null {
  if (value === null || !Number.isFinite(value) || value < minimum || value > maximumValue)
    return null;
  return round(value, 1);
}

function boundedInteger(
  value: number | null,
  minimum: number,
  maximumValue: number
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const integer = Math.trunc(value);
  return integer >= minimum && integer <= maximumValue ? integer : null;
}

function optionalBoundedNumber(
  value: unknown,
  minimum: number,
  maximumValue: number
): number | null | undefined {
  if (value === undefined) return null;
  const number = numberValue(value);
  return number !== null && number >= minimum && number <= maximumValue
    ? round(number, 1)
    : undefined;
}

function optionalBoundedInteger(
  value: unknown,
  minimum: number,
  maximumValue: number
): number | null | undefined {
  if (value === undefined) return null;
  const number = numberValue(value);
  if (number === null || !Number.isInteger(number) || number < minimum || number > maximumValue)
    return undefined;
  return number;
}

function validSequence(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_SEQUENCE;
}

function validTimestamp(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function assignWireNumber<K extends keyof WireMetric>(
  target: WireMetric,
  key: K,
  value: number | null
): void {
  if (value !== null) Object.assign(target, { [key]: value });
}

function kindToWire(kind: ParticipantMediaKind): WireMetric['k'] {
  return kind === 'microphone' ? 'm' : kind === 'camera' ? 'c' : 's';
}

function kindFromWire(value: unknown): ParticipantMediaKind | null {
  return value === 'm' ? 'microphone' : value === 'c' ? 'camera' : value === 's' ? 'screen' : null;
}

function healthToWire(health: ParticipantMediaHealth): WireMetric['h'] {
  return health === 'excellent'
    ? 'e'
    : health === 'good'
      ? 'g'
      : health === 'degraded'
        ? 'd'
        : health === 'poor'
          ? 'p'
          : 'u';
}

function healthFromWire(value: unknown): ParticipantMediaHealth | null {
  return value === 'e'
    ? 'excellent'
    : value === 'g'
      ? 'good'
      : value === 'd'
        ? 'degraded'
        : value === 'p'
          ? 'poor'
          : value === 'u'
            ? 'unknown'
            : null;
}

function limitationToWire(
  value: Exclude<ParticipantMediaQualityLimitation, null>
): NonNullable<WireMetric['q']> {
  return value === 'bandwidth' ? 'b' : value === 'cpu' ? 'c' : 'o';
}

function limitationFromWire(value: unknown): ParticipantMediaQualityLimitation | undefined {
  if (value === undefined) return null;
  return value === 'b' ? 'bandwidth' : value === 'c' ? 'cpu' : value === 'o' ? 'other' : undefined;
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
