import { describe, expect, it } from 'vitest';
import {
  formatVoiceMessageTime,
  normalizedWaveformLevel,
  recorderFileExtension,
  reduceWaveformPeaks,
  selectVoiceRecorderMimeType,
  visualWaveformLevel,
  voiceMessageFilename
} from './policy';

describe('voice message policy', () => {
  it('selects the first browser-supported recorder format', () => {
    expect(selectVoiceRecorderMimeType((mime) => mime === 'audio/mp4')).toBe('audio/mp4');
    expect(selectVoiceRecorderMimeType(() => false)).toBeUndefined();
  });

  it('maps recorder formats to stable file extensions', () => {
    expect(recorderFileExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(recorderFileExtension('audio/mp4')).toBe('m4a');
    expect(recorderFileExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(voiceMessageFilename('audio/mp4', new Date('2026-07-15T12:34:56.789Z'))).toBe(
      'voice-message-2026-07-15T12-34-56-789Z.m4a'
    );
  });

  it('formats elapsed and long recording durations', () => {
    expect(formatVoiceMessageTime(0)).toBe('0:00');
    expect(formatVoiceMessageTime(61_900)).toBe('1:01');
    expect(formatVoiceMessageTime(3_661_000)).toBe('1:01:01');
    expect(formatVoiceMessageTime(Number.NaN)).toBe('0:00');
  });

  it('computes a bounded RMS level from analyser samples', () => {
    expect(normalizedWaveformLevel(new Uint8Array([128, 128, 128]))).toBe(0);
    expect(normalizedWaveformLevel(new Uint8Array([0, 255]))).toBe(1);
  });

  it('maps quiet waveform samples to visible UI levels without changing silence', () => {
    expect(visualWaveformLevel(0)).toBe(0);
    expect(visualWaveformLevel(Number.NaN)).toBe(0);
    expect(visualWaveformLevel(0.02)).toBeGreaterThan(0.25);
    expect(visualWaveformLevel(0.1)).toBeGreaterThan(0.45);
    expect(visualWaveformLevel(1.5)).toBe(1);
  });

  it('reduces arbitrary samples to a fixed, sanitized waveform', () => {
    expect(reduceWaveformPeaks([0.1, 0.7, 0.2, 0.9], 2)).toEqual([0.7, 0.9]);
    expect(reduceWaveformPeaks([-1, Number.NaN, 2], 3)).toEqual([0, 0, 1]);
    expect(reduceWaveformPeaks([], 3)).toEqual([0, 0, 0]);
  });
});
