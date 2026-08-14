import { describe, expect, it } from 'vitest';
import {
  fitCaptureDimensions,
  normalizeCaptureQuality,
  resolveCaptureProfile,
  videoExtension
} from './captureQuality';

describe('capture quality', () => {
  it('keeps auto as the persisted default and resolves it to HD', () => {
    expect(normalizeCaptureQuality(null)).toBe('auto');
    expect(normalizeCaptureQuality('unexpected')).toBe('auto');
    expect(resolveCaptureProfile('auto')).toEqual(resolveCaptureProfile('hd'));
  });

  it('fits landscape and portrait captures without upscaling', () => {
    const hd = resolveCaptureProfile('hd');
    expect(fitCaptureDimensions(4000, 3000, hd)).toEqual({ width: 1440, height: 1080 });
    expect(fitCaptureDimensions(3000, 4000, hd)).toEqual({ width: 810, height: 1080 });
    expect(fitCaptureDimensions(640, 480, hd)).toEqual({ width: 640, height: 480 });
  });

  it('uses interoperable filename extensions', () => {
    expect(videoExtension('video/mp4;codecs=avc1')).toBe('mp4');
    expect(videoExtension('video/webm;codecs=vp8')).toBe('webm');
  });
});
