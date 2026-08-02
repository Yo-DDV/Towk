export type MessageUploadPhase =
  | 'preparing'
  | 'uploading'
  | 'finalizing'
  | 'sending'
  | 'confirming'
  | 'confirmed'
  | 'failed';

export type MessageUploadFailureStage = Exclude<MessageUploadPhase, 'confirmed' | 'failed'>;

export type MessageUploadSample = {
  at: number;
  committedBytes: number;
};

export type MessageUploadProgressEntry = {
  id: string;
  serverId: string;
  roomId: string;
  threadRootEventId: string | null;
  phase: MessageUploadPhase;
  failureStage: MessageUploadFailureStage | null;
  fileName: string;
  fileIndex: number;
  fileCount: number;
  committedBytes: number;
  totalBytes: number;
  startedAt: number;
  updatedAt: number;
  estimatedRemainingMs: number | null;
  announcementPercent: number | null;
  samples: readonly MessageUploadSample[];
};

export type BeginMessageUploadInput = {
  id: string;
  serverId?: string;
  roomId: string;
  threadRootEventId?: string | null;
  fileNames: readonly string[];
  totalBytes: number;
  now?: number;
};

export type MessageUploadProgressUpdate = {
  phase: 'preparing' | 'uploading' | 'finalizing' | 'completed';
  fileName: string;
  fileIndex: number;
  fileCount: number;
  committedBytes: number;
  totalBytes: number;
};

const SAMPLE_WINDOW_MS = 15_000;
const MAX_SAMPLES = 12;
const MIN_RATE_WINDOW_MS = 1_000;
const MIN_RATE_BYTES = 64 * 1024;
const MAX_ETA_MS = 24 * 60 * 60 * 1_000;

export function createMessageUploadProgressEntry(
  input: BeginMessageUploadInput
): MessageUploadProgressEntry {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    serverId: input.serverId ?? '',
    roomId: input.roomId,
    threadRootEventId: input.threadRootEventId ?? null,
    phase: 'preparing',
    failureStage: null,
    fileName: input.fileNames[0] ?? '',
    fileIndex: 0,
    fileCount: input.fileNames.length,
    committedBytes: 0,
    totalBytes: Math.max(0, input.totalBytes),
    startedAt: now,
    updatedAt: now,
    estimatedRemainingMs: null,
    announcementPercent: null,
    samples: []
  };
}

export function applyMessageUploadProgress(
  entry: MessageUploadProgressEntry,
  update: MessageUploadProgressUpdate,
  now = Date.now()
): MessageUploadProgressEntry {
  if (entry.phase === 'confirmed' || entry.phase === 'failed') return entry;

  const committedBytes = clamp(update.committedBytes, 0, Math.max(0, update.totalBytes));
  const samples = appendSample(entry.samples, now, committedBytes, update.phase === 'uploading');
  const totalBytes = Math.max(0, update.totalBytes);
  const percent = totalBytes > 0 ? Math.floor((committedBytes / totalBytes) * 100) : null;
  const announcementPercent =
    percent === null ? null : Math.max(entry.announcementPercent ?? 0, Math.floor(percent / 10) * 10);

  return {
    ...entry,
    phase: update.phase === 'completed' ? 'finalizing' : update.phase,
    failureStage: null,
    fileName: update.fileName,
    fileIndex: clamp(Math.trunc(update.fileIndex), 0, Math.max(0, update.fileCount - 1)),
    fileCount: Math.max(0, Math.trunc(update.fileCount)),
    committedBytes,
    totalBytes,
    updatedAt: now,
    estimatedRemainingMs: estimateRemainingMs(
      samples,
      committedBytes,
      totalBytes,
      entry.estimatedRemainingMs
    ),
    announcementPercent,
    samples
  };
}

export function transitionMessageUploadProgress(
  entry: MessageUploadProgressEntry,
  phase: 'sending' | 'confirming' | 'confirmed',
  now = Date.now()
): MessageUploadProgressEntry {
  if (entry.phase === 'confirmed' || entry.phase === 'failed') return entry;
  return {
    ...entry,
    phase,
    failureStage: null,
    committedBytes: phase === 'sending' || phase === 'confirming' || phase === 'confirmed'
      ? entry.totalBytes
      : entry.committedBytes,
    updatedAt: now,
    estimatedRemainingMs: null,
    announcementPercent: phase === 'confirmed' ? 100 : entry.announcementPercent
  };
}

export function failMessageUploadProgress(
  entry: MessageUploadProgressEntry,
  now = Date.now()
): MessageUploadProgressEntry {
  if (entry.phase === 'confirmed') return entry;
  const failureStage: MessageUploadFailureStage =
    entry.phase === 'failed' ? (entry.failureStage ?? 'uploading') : entry.phase;
  return {
    ...entry,
    phase: 'failed',
    failureStage,
    updatedAt: now,
    estimatedRemainingMs: null
  };
}

export function uploadProgressPercent(entry: MessageUploadProgressEntry): number | null {
  if (entry.totalBytes <= 0) return null;
  return clamp(Math.round((entry.committedBytes / entry.totalBytes) * 100), 0, 100);
}

export function canRetryMessageUpload(entry: MessageUploadProgressEntry): boolean {
  return (
    entry.phase === 'failed' &&
    entry.failureStage !== null &&
    ['preparing', 'uploading', 'finalizing'].includes(entry.failureStage)
  );
}

function appendSample(
  samples: readonly MessageUploadSample[],
  at: number,
  committedBytes: number,
  record: boolean
): readonly MessageUploadSample[] {
  if (!record) return samples;
  const previous = samples.at(-1);
  if (previous && committedBytes <= previous.committedBytes) return samples;
  return [...samples, { at, committedBytes }]
    .filter((sample) => at - sample.at <= SAMPLE_WINDOW_MS)
    .slice(-MAX_SAMPLES);
}

function estimateRemainingMs(
  samples: readonly MessageUploadSample[],
  committedBytes: number,
  totalBytes: number,
  previousEstimate: number | null
): number | null {
  if (totalBytes <= committedBytes || samples.length < 2) return null;
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) return null;
  const elapsedMs = last.at - first.at;
  const transferredBytes = last.committedBytes - first.committedBytes;
  if (elapsedMs < MIN_RATE_WINDOW_MS || transferredBytes < MIN_RATE_BYTES) return null;

  const bytesPerMs = transferredBytes / elapsedMs;
  if (!Number.isFinite(bytesPerMs) || bytesPerMs <= 0) return null;
  const rawEstimate = clamp((totalBytes - committedBytes) / bytesPerMs, 0, MAX_ETA_MS);
  if (previousEstimate === null) return Math.round(rawEstimate);
  return Math.round(previousEstimate * 0.65 + rawEstimate * 0.35);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
