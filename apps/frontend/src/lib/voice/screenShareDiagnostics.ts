import type { Track } from 'livekit-client';

export const SCREEN_SHARE_DIAGNOSTICS_INTERVAL_MS = 2_000;
export const SCREEN_SHARE_DIAGNOSTICS_HISTORY_LIMIT = 30;

export type ScreenShareDiagnosticsDirection = 'inbound' | 'outbound';
export type ScreenShareDiagnosticsHealth = 'excellent' | 'good' | 'degraded' | 'poor' | 'unknown';

export type ScreenShareDiagnosticsLayer = {
  id: string;
  rid: string | null;
  width: number | null;
  height: number | null;
  framesPerSecond: number | null;
  bitrateBps: number | null;
  targetBitrateBps: number | null;
  codec: string | null;
  scalabilityMode: string | null;
};

export type ScreenShareDiagnosticsSample = {
  collectedAt: number;
  rtpTimestamp: number | null;
  direction: ScreenShareDiagnosticsDirection;
  health: ScreenShareDiagnosticsHealth;
  width: number | null;
  height: number | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceFramesPerSecond: number | null;
  framesPerSecond: number | null;
  bitrateBps: number | null;
  targetBitrateBps: number | null;
  availableBitrateBps: number | null;
  packetsSent: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  packetLossPercent: number | null;
  jitterMs: number | null;
  roundTripTimeMs: number | null;
  framesSent: number | null;
  framesEncoded: number | null;
  framesReceived: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  frameDropPercent: number | null;
  keyFrames: number | null;
  freezeCount: number | null;
  totalFreezeDurationMs: number | null;
  pauseCount: number | null;
  totalPauseDurationMs: number | null;
  jitterBufferDelayMs: number | null;
  nackCount: number | null;
  pliCount: number | null;
  firCount: number | null;
  retransmittedPackets: number | null;
  retransmittedBytes: number | null;
  codec: string | null;
  encoderImplementation: string | null;
  decoderImplementation: string | null;
  powerEfficientCodec: boolean | null;
  qualityLimitationReason: string | null;
  qualityLimitationDurations: Record<string, number> | null;
  qualityLimitationResolutionChanges: number | null;
  activeLayerCount: number;
  layers: ScreenShareDiagnosticsLayer[];
  networkType: string | null;
  protocol: string | null;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  contentHint: string | null;
};

type StreamCounters = {
  timestamp: number;
  bytes: number | null;
};

export type ScreenShareDiagnosticsCounters = {
  timestamp: number | null;
  bytes: number | null;
  packets: number | null;
  packetsLost: number | null;
  framesReceived: number | null;
  framesDropped: number | null;
  framesForRate: number | null;
  jitterBufferDelay: number | null;
  jitterBufferEmittedCount: number | null;
  streams: Record<string, StreamCounters>;
};

export type ScreenShareDiagnosticsCollection = {
  sample: ScreenShareDiagnosticsSample;
  counters: ScreenShareDiagnosticsCounters;
};

type StickyDiagnosticsField = keyof Pick<
  ScreenShareDiagnosticsSample,
  | 'width'
  | 'height'
  | 'sourceWidth'
  | 'sourceHeight'
  | 'sourceFramesPerSecond'
  | 'framesPerSecond'
  | 'bitrateBps'
  | 'targetBitrateBps'
  | 'availableBitrateBps'
  | 'packetLossPercent'
  | 'jitterMs'
  | 'roundTripTimeMs'
  | 'frameDropPercent'
  | 'codec'
  | 'encoderImplementation'
  | 'decoderImplementation'
  | 'powerEfficientCodec'
  | 'qualityLimitationReason'
  | 'qualityLimitationDurations'
  | 'qualityLimitationResolutionChanges'
  | 'networkType'
  | 'protocol'
  | 'localCandidateType'
  | 'remoteCandidateType'
  | 'contentHint'
>;

type RtcStat = {
  id: string;
  type: string;
  timestamp?: number;
} & Record<string, unknown>;

type DiagnosticsTrack = Track & {
  sender?: Pick<RTCRtpSender, 'getStats'>;
  getRTCStatsReport?: () => Promise<RTCStatsReport | undefined>;
  mediaStreamTrack?: MediaStreamTrack;
  currentBitrate?: number;
};

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function sum(stats: RtcStat[], field: string): number | null {
  const values = stats.map((stat) => numberValue(stat[field])).filter((value) => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function max(stats: RtcStat[], field: string): number | null {
  const values = stats.map((stat) => numberValue(stat[field])).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function secondsToMs(value: number | null): number | null {
  return value === null ? null : round(value * 1_000, 2);
}

function safeDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || current < previous) return null;
  return current - previous;
}

function bitrate(
  bytes: number | null,
  timestamp: number | null,
  previousBytes: number | null,
  previousTimestamp: number | null
): number | null {
  const byteDelta = safeDelta(bytes, previousBytes);
  const timestampDelta = safeDelta(timestamp, previousTimestamp);
  if (byteDelta === null || timestampDelta === null || timestampDelta <= 0) return null;
  return round((byteDelta * 8 * 1_000) / timestampDelta, 0);
}

function ratePercent(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return round((numerator / denominator) * 100, 2);
}

function statKindIsVideo(stat: RtcStat): boolean {
  const kind = stringValue(stat.kind) ?? stringValue(stat.mediaType);
  return kind === null || kind === 'video';
}

function codecName(report: RTCStatsReport, stat: RtcStat): string | null {
  const codecId = stringValue(stat.codecId);
  if (!codecId) return null;
  const codec = report.get(codecId) as RtcStat | undefined;
  const mimeType = codec ? stringValue(codec.mimeType) : null;
  return mimeType?.replace(/^video\//i, '') ?? null;
}

function isAuxiliaryVideoRtp(report: RTCStatsReport, stat: RtcStat): boolean {
  const codecId = stringValue(stat.codecId);
  const codec = codecId ? (report.get(codecId) as RtcStat | undefined) : undefined;
  const mimeType = codec ? stringValue(codec.mimeType) : null;
  return /^video\/(rtx|red|ulpfec|flexfec(?:-03)?)$/i.test(mimeType ?? '');
}

function choosePrimary(stats: RtcStat[]): RtcStat | null {
  const activeStats = stats.filter((stat) => stat.active !== false);
  const candidates = activeStats.length ? activeStats : stats;
  return (
    [...candidates].sort((left, right) => {
      const leftArea = (numberValue(left.frameWidth) ?? 0) * (numberValue(left.frameHeight) ?? 0);
      const rightArea =
        (numberValue(right.frameWidth) ?? 0) * (numberValue(right.frameHeight) ?? 0);
      return rightArea - leftArea;
    })[0] ?? null
  );
}

function linkedStats(report: RTCStatsReport, stats: RtcStat[], type: string): RtcStat[] {
  const linked = stats
    .map((stat) => stringValue(stat.remoteId))
    .filter((id) => id !== null)
    .map((id) => report.get(id) as RtcStat | undefined)
    .filter((stat): stat is RtcStat => stat?.type === type);
  if (linked.length) return linked;

  const fallback: RtcStat[] = [];
  report.forEach((value) => {
    const stat = value as RtcStat;
    if (stat.type === type && statKindIsVideo(stat)) fallback.push(stat);
  });
  return fallback;
}

function linkedMediaSource(report: RTCStatsReport, primary: RtcStat): RtcStat | null {
  const sourceId = stringValue(primary.mediaSourceId);
  const linked = sourceId ? (report.get(sourceId) as RtcStat | undefined) : undefined;
  if (linked?.type === 'media-source' && statKindIsVideo(linked)) return linked;

  let source: RtcStat | null = null;
  report.forEach((value) => {
    const stat = value as RtcStat;
    if (!source && stat.type === 'media-source' && statKindIsVideo(stat)) source = stat;
  });
  return source;
}

function selectedCandidatePair(report: RTCStatsReport, primary: RtcStat | null): RtcStat | null {
  const transportId = primary ? stringValue(primary.transportId) : null;
  const transport = transportId ? (report.get(transportId) as RtcStat | undefined) : undefined;
  const pairId = transport ? stringValue(transport.selectedCandidatePairId) : null;
  if (pairId) return (report.get(pairId) as RtcStat | undefined) ?? null;

  let selected: RtcStat | null = null;
  report.forEach((value) => {
    const stat = value as RtcStat;
    if (
      stat.type === 'candidate-pair' &&
      stat.state === 'succeeded' &&
      (stat.nominated === true || selected === null)
    ) {
      selected = stat;
    }
  });
  return selected;
}

function candidate(report: RTCStatsReport, id: unknown): RtcStat | null {
  const candidateId = stringValue(id);
  return candidateId ? ((report.get(candidateId) as RtcStat | undefined) ?? null) : null;
}

function recordOfNumbers(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])
  );
  return entries.length ? Object.fromEntries(entries) : null;
}

function classifyHealth(
  sample: Omit<ScreenShareDiagnosticsSample, 'health'>
): ScreenShareDiagnosticsHealth {
  const hasSignal =
    sample.framesPerSecond !== null || sample.bitrateBps !== null || sample.width !== null;
  if (!hasSignal) return 'unknown';

  if (
    (sample.packetLossPercent !== null && sample.packetLossPercent >= 5) ||
    (sample.framesPerSecond !== null && sample.framesPerSecond < 12) ||
    (sample.frameDropPercent !== null && sample.frameDropPercent >= 8)
  ) {
    return 'poor';
  }

  if (
    (sample.packetLossPercent !== null && sample.packetLossPercent >= 2) ||
    (sample.framesPerSecond !== null && sample.framesPerSecond < 24) ||
    (sample.frameDropPercent !== null && sample.frameDropPercent >= 3) ||
    (sample.roundTripTimeMs !== null && sample.roundTripTimeMs >= 300) ||
    (sample.jitterMs !== null && sample.jitterMs >= 50) ||
    (sample.qualityLimitationReason !== null &&
      !['none', 'other'].includes(sample.qualityLimitationReason))
  ) {
    return 'degraded';
  }

  if (
    (sample.framesPerSecond === null || sample.framesPerSecond >= 28) &&
    (sample.packetLossPercent === null || sample.packetLossPercent < 0.5) &&
    (sample.roundTripTimeMs === null || sample.roundTripTimeMs < 150) &&
    (sample.jitterMs === null || sample.jitterMs < 20)
  ) {
    return 'excellent';
  }

  return 'good';
}

async function getReport(
  track: DiagnosticsTrack,
  direction: ScreenShareDiagnosticsDirection
): Promise<RTCStatsReport> {
  const report =
    direction === 'outbound' ? await track.sender?.getStats() : await track.getRTCStatsReport?.();
  if (!report) throw new Error('WebRTC statistics are unavailable for this screen-share track.');
  return report;
}

export async function collectScreenShareDiagnostics({
  track,
  direction,
  previous,
  collectedAt = Date.now()
}: {
  track: Track;
  direction: ScreenShareDiagnosticsDirection;
  previous?: ScreenShareDiagnosticsCounters | null;
  collectedAt?: number;
}): Promise<ScreenShareDiagnosticsCollection> {
  const diagnosticsTrack = track as DiagnosticsTrack;
  const report = await getReport(diagnosticsTrack, direction);
  const rtpStats: RtcStat[] = [];
  report.forEach((value) => {
    const stat = value as RtcStat;
    const expectedType = direction === 'outbound' ? 'outbound-rtp' : 'inbound-rtp';
    if (stat.type === expectedType && statKindIsVideo(stat) && !isAuxiliaryVideoRtp(report, stat)) {
      rtpStats.push(stat);
    }
  });
  if (!rtpStats.length) throw new Error('No active video RTP statistics were reported.');

  const primary = choosePrimary(rtpStats)!;
  const mediaSource = direction === 'outbound' ? linkedMediaSource(report, primary) : null;
  const remoteFeedback =
    direction === 'outbound' ? linkedStats(report, rtpStats, 'remote-inbound-rtp') : [];
  const pair = selectedCandidatePair(report, primary);
  const localCandidate = pair ? candidate(report, pair.localCandidateId) : null;
  const remoteCandidate = pair ? candidate(report, pair.remoteCandidateId) : null;
  const timestamp = max(rtpStats, 'timestamp');
  const bytes = sum(rtpStats, direction === 'outbound' ? 'bytesSent' : 'bytesReceived');
  const packets = sum(rtpStats, direction === 'outbound' ? 'packetsSent' : 'packetsReceived');
  const packetsLost =
    direction === 'outbound' ? sum(remoteFeedback, 'packetsLost') : sum(rtpStats, 'packetsLost');
  const packetDelta = safeDelta(packets, previous?.packets ?? null);
  const lostDelta = safeDelta(packetsLost, previous?.packetsLost ?? null);
  const packetLossDenominator =
    direction === 'outbound'
      ? packetDelta
      : packetDelta === null || lostDelta === null
        ? null
        : packetDelta + lostDelta;
  const framesReceived = direction === 'inbound' ? sum(rtpStats, 'framesReceived') : null;
  const framesDropped = direction === 'inbound' ? sum(rtpStats, 'framesDropped') : null;
  const framesForRate = numberValue(
    primary[
      direction === 'outbound'
        ? numberValue(primary.framesEncoded) === null
          ? 'framesSent'
          : 'framesEncoded'
        : numberValue(primary.framesDecoded) === null
          ? 'framesReceived'
          : 'framesDecoded'
    ]
  );
  const frameReceivedDelta = safeDelta(framesReceived, previous?.framesReceived ?? null);
  const frameDroppedDelta = safeDelta(framesDropped, previous?.framesDropped ?? null);
  const jitterBufferDelay = direction === 'inbound' ? sum(rtpStats, 'jitterBufferDelay') : null;
  const jitterBufferEmittedCount =
    direction === 'inbound' ? sum(rtpStats, 'jitterBufferEmittedCount') : null;
  const jitterBufferDelayDelta = safeDelta(jitterBufferDelay, previous?.jitterBufferDelay ?? null);
  const jitterBufferEmittedDelta = safeDelta(
    jitterBufferEmittedCount,
    previous?.jitterBufferEmittedCount ?? null
  );

  const streams: Record<string, StreamCounters> = {};
  const layers = rtpStats
    .map((stat): ScreenShareDiagnosticsLayer => {
      const statTimestamp = numberValue(stat.timestamp) ?? timestamp ?? collectedAt;
      const statBytes = numberValue(stat[direction === 'outbound' ? 'bytesSent' : 'bytesReceived']);
      streams[stat.id] = { timestamp: statTimestamp, bytes: statBytes };
      const previousStream = previous?.streams[stat.id];
      return {
        id: stat.id,
        rid: stringValue(stat.rid),
        width: numberValue(stat.frameWidth),
        height: numberValue(stat.frameHeight),
        framesPerSecond: numberValue(stat.framesPerSecond),
        bitrateBps: bitrate(
          statBytes,
          statTimestamp,
          previousStream?.bytes ?? null,
          previousStream?.timestamp ?? null
        ),
        targetBitrateBps: numberValue(stat.targetBitrate),
        codec: codecName(report, stat),
        scalabilityMode: stringValue(stat.scalabilityMode)
      };
    })
    .sort(
      (left, right) =>
        (right.width ?? 0) * (right.height ?? 0) - (left.width ?? 0) * (left.height ?? 0)
    );

  const captureSettings = diagnosticsTrack.mediaStreamTrack?.getSettings?.();
  const remoteRoundTripTime = max(remoteFeedback, 'roundTripTime');
  const candidateRoundTripTime = pair ? numberValue(pair.currentRoundTripTime) : null;
  const roundTripTime =
    remoteRoundTripTime === null
      ? candidateRoundTripTime
      : candidateRoundTripTime === null
        ? remoteRoundTripTime
        : Math.max(remoteRoundTripTime, candidateRoundTripTime);
  const jitter = direction === 'outbound' ? max(remoteFeedback, 'jitter') : max(rtpStats, 'jitter');
  const primaryPowerEfficient = booleanValue(
    primary[direction === 'outbound' ? 'powerEfficientEncoder' : 'powerEfficientDecoder']
  );
  const frameDelta = safeDelta(framesForRate, previous?.framesForRate ?? null);
  const frameTimestampDelta = safeDelta(timestamp, previous?.timestamp ?? null);
  const derivedFramesPerSecond =
    frameDelta !== null && frameTimestampDelta !== null && frameTimestampDelta > 0
      ? round((frameDelta * 1_000) / frameTimestampDelta, 1)
      : null;
  const derivedBitrate = bitrate(
    bytes,
    timestamp,
    previous?.bytes ?? null,
    previous?.timestamp ?? null
  );
  const monitoredBitrate = numberValue(diagnosticsTrack.currentBitrate);
  const withoutHealth: Omit<ScreenShareDiagnosticsSample, 'health'> = {
    collectedAt,
    rtpTimestamp: timestamp,
    direction,
    width: numberValue(primary.frameWidth),
    height: numberValue(primary.frameHeight),
    sourceWidth: numberValue(captureSettings?.width) ?? numberValue(mediaSource?.width),
    sourceHeight: numberValue(captureSettings?.height) ?? numberValue(mediaSource?.height),
    sourceFramesPerSecond:
      numberValue(captureSettings?.frameRate) ?? numberValue(mediaSource?.framesPerSecond),
    framesPerSecond: max(rtpStats, 'framesPerSecond') ?? derivedFramesPerSecond,
    bitrateBps:
      derivedBitrate ??
      (monitoredBitrate !== null && monitoredBitrate > 0 ? monitoredBitrate : null),
    targetBitrateBps: direction === 'outbound' ? sum(rtpStats, 'targetBitrate') : null,
    availableBitrateBps: pair
      ? numberValue(
          pair[direction === 'outbound' ? 'availableOutgoingBitrate' : 'availableIncomingBitrate']
        )
      : null,
    packetsSent: direction === 'outbound' ? packets : null,
    packetsReceived: direction === 'inbound' ? packets : null,
    packetsLost,
    packetLossPercent: ratePercent(lostDelta, packetLossDenominator),
    jitterMs: secondsToMs(jitter),
    roundTripTimeMs: secondsToMs(roundTripTime),
    framesSent: direction === 'outbound' ? sum(rtpStats, 'framesSent') : null,
    framesEncoded: direction === 'outbound' ? sum(rtpStats, 'framesEncoded') : null,
    framesReceived,
    framesDecoded: direction === 'inbound' ? sum(rtpStats, 'framesDecoded') : null,
    framesDropped,
    frameDropPercent: ratePercent(frameDroppedDelta, frameReceivedDelta),
    keyFrames:
      direction === 'outbound'
        ? sum(rtpStats, 'keyFramesEncoded')
        : sum(rtpStats, 'keyFramesDecoded'),
    freezeCount: direction === 'inbound' ? sum(rtpStats, 'freezeCount') : null,
    totalFreezeDurationMs:
      direction === 'inbound' ? secondsToMs(sum(rtpStats, 'totalFreezesDuration')) : null,
    pauseCount: direction === 'inbound' ? sum(rtpStats, 'pauseCount') : null,
    totalPauseDurationMs:
      direction === 'inbound' ? secondsToMs(sum(rtpStats, 'totalPausesDuration')) : null,
    jitterBufferDelayMs:
      jitterBufferDelayDelta !== null &&
      jitterBufferEmittedDelta !== null &&
      jitterBufferEmittedDelta > 0
        ? round((jitterBufferDelayDelta / jitterBufferEmittedDelta) * 1_000, 2)
        : null,
    nackCount: sum(rtpStats, 'nackCount'),
    pliCount: sum(rtpStats, 'pliCount'),
    firCount: sum(rtpStats, 'firCount'),
    retransmittedPackets:
      direction === 'outbound' ? sum(rtpStats, 'retransmittedPacketsSent') : null,
    retransmittedBytes: direction === 'outbound' ? sum(rtpStats, 'retransmittedBytesSent') : null,
    codec: codecName(report, primary),
    encoderImplementation:
      direction === 'outbound' ? stringValue(primary.encoderImplementation) : null,
    decoderImplementation:
      direction === 'inbound' ? stringValue(primary.decoderImplementation) : null,
    powerEfficientCodec: primaryPowerEfficient,
    qualityLimitationReason:
      direction === 'outbound' ? stringValue(primary.qualityLimitationReason) : null,
    qualityLimitationDurations:
      direction === 'outbound' ? recordOfNumbers(primary.qualityLimitationDurations) : null,
    qualityLimitationResolutionChanges:
      direction === 'outbound' ? numberValue(primary.qualityLimitationResolutionChanges) : null,
    activeLayerCount: rtpStats.filter((stat) => stat.active !== false).length,
    layers,
    networkType: localCandidate ? stringValue(localCandidate.networkType) : null,
    protocol:
      (pair ? stringValue(pair.protocol) : null) ??
      (localCandidate ? stringValue(localCandidate.protocol) : null),
    localCandidateType: localCandidate ? stringValue(localCandidate.candidateType) : null,
    remoteCandidateType: remoteCandidate ? stringValue(remoteCandidate.candidateType) : null,
    contentHint: stringValue(diagnosticsTrack.mediaStreamTrack?.contentHint)
  };
  const sample: ScreenShareDiagnosticsSample = {
    ...withoutHealth,
    health: classifyHealth(withoutHealth)
  };
  return {
    sample,
    counters: {
      timestamp,
      bytes,
      packets,
      packetsLost,
      framesReceived,
      framesDropped,
      framesForRate,
      jitterBufferDelay,
      jitterBufferEmittedCount,
      streams
    }
  };
}

export function appendScreenShareDiagnosticsSample(
  history: ScreenShareDiagnosticsSample[],
  sample: ScreenShareDiagnosticsSample
): ScreenShareDiagnosticsSample[] {
  return [...history, sample].slice(-SCREEN_SHARE_DIAGNOSTICS_HISTORY_LIMIT);
}

export function screenShareDiagnosticsHasVideoSignal(
  sample: ScreenShareDiagnosticsSample
): boolean {
  return (
    sample.width !== null ||
    sample.height !== null ||
    sample.framesPerSecond !== null ||
    sample.bitrateBps !== null ||
    sample.codec !== null
  );
}

export function screenShareDiagnosticsSampleIsPartial(
  sample: ScreenShareDiagnosticsSample
): boolean {
  if (!screenShareDiagnosticsHasVideoSignal(sample)) return true;
  return sample.width === null || sample.height === null || sample.framesPerSecond === null;
}

export function mergeScreenShareDiagnosticsSample(
  previous: ScreenShareDiagnosticsSample | null,
  next: ScreenShareDiagnosticsSample
): ScreenShareDiagnosticsSample {
  if (!previous) return next;

  const shouldKeepStableVideoFields = screenShareDiagnosticsSampleIsPartial(next);
  if (!shouldKeepStableVideoFields) return next;

  const stickyFields: StickyDiagnosticsField[] = [
    'width',
    'height',
    'sourceWidth',
    'sourceHeight',
    'sourceFramesPerSecond',
    'framesPerSecond',
    'bitrateBps',
    'targetBitrateBps',
    'availableBitrateBps',
    'packetLossPercent',
    'jitterMs',
    'roundTripTimeMs',
    'frameDropPercent',
    'codec',
    'encoderImplementation',
    'decoderImplementation',
    'powerEfficientCodec',
    'qualityLimitationReason',
    'qualityLimitationDurations',
    'qualityLimitationResolutionChanges',
    'networkType',
    'protocol',
    'localCandidateType',
    'remoteCandidateType',
    'contentHint'
  ];

  const merged: ScreenShareDiagnosticsSample = {
    ...next,
    health:
      next.health === 'unknown' && previous.health !== 'unknown' ? previous.health : next.health,
    activeLayerCount: next.activeLayerCount > 0 ? next.activeLayerCount : previous.activeLayerCount,
    layers: next.layers.length ? next.layers : previous.layers
  };

  for (const field of stickyFields) {
    if (merged[field] === null) {
      Object.assign(merged, { [field]: previous[field] });
    }
  }

  return merged;
}
