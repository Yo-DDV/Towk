export const VOICE_MESSAGE_MAX_DURATION_MS = 20 * 60 * 1000;
export const VOICE_MESSAGE_MIN_DURATION_MS = 100;
export const VOICE_MESSAGE_DEFAULT_MAX_SIZE = 32 * 1024 * 1024;
export const VOICE_MESSAGE_WAVEFORM_PEAK_COUNT = 64;
export const VOICE_MESSAGE_AUDIO_BITS_PER_SECOND = 48_000;

export const VOICE_MESSAGE_RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus'
] as const;

export type VoiceMessageDraft = {
  file: File;
  durationMs: number;
  waveformPeaks: number[];
  objectUrl: string;
};

export type VoiceMessageMetadataInput = {
  file: File;
  durationMs: number;
  waveformPeaks: number[];
};

export function selectVoiceRecorderMimeType(
  isTypeSupported: (mimeType: string) => boolean
): string | undefined {
  return VOICE_MESSAGE_RECORDER_MIME_TYPES.find((mimeType) => isTypeSupported(mimeType));
}

export function recorderFileExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith('audio/mp4')) return 'm4a';
  if (normalized.startsWith('audio/ogg')) return 'ogg';
  return 'webm';
}

export function voiceMessageFilename(mimeType: string, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `voice-message-${timestamp}.${recorderFileExtension(mimeType)}`;
}

export function formatVoiceMessageTime(milliseconds: number): string {
  const safeMilliseconds = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const totalSeconds = Math.floor(safeMilliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function normalizedWaveformLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let squaredTotal = 0;
  for (const sample of samples) {
    const centered = (sample - 128) / 128;
    squaredTotal += centered * centered;
  }
  return Math.min(1, Math.sqrt(squaredTotal / samples.length) * 2.4);
}

export function visualWaveformLevel(level: number): number {
  const safeLevel = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  if (safeLevel <= 0) return 0;
  return Math.min(1, Math.max(0.16, Math.pow(safeLevel, 0.32)));
}

export function reduceWaveformPeaks(
  samples: readonly number[],
  targetCount = VOICE_MESSAGE_WAVEFORM_PEAK_COUNT
): number[] {
  const safeTarget = Math.max(1, Math.floor(targetCount));
  if (samples.length === 0) return Array.from({ length: safeTarget }, () => 0);

  return Array.from({ length: safeTarget }, (_, index) => {
    const start = Math.floor((index * samples.length) / safeTarget);
    const end = Math.max(start + 1, Math.floor(((index + 1) * samples.length) / safeTarget));
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < Math.min(end, samples.length); sampleIndex += 1) {
      const value = samples[sampleIndex];
      if (Number.isFinite(value)) peak = Math.max(peak, Math.max(0, Math.min(1, value)));
    }
    return Math.round(peak * 1000) / 1000;
  });
}
