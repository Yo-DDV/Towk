import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_QUALITY_PROFILE,
  imageScaleFactor,
  isImageQualityProfile,
  isQualityAdjustableImage,
  reencodedImageName,
  resolveImageQualitySettings
} from './imageQuality';

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('image quality eligibility', () => {
  it.each([
    ['photo.jpg', 'image/jpeg'],
    ['photo.png', 'image/png'],
    ['photo.webp', 'image/webp'],
    ['photo.HEIC', 'IMAGE/HEIC']
  ])('accepts %s', (name, type) => {
    expect(isQualityAdjustableImage(file(name, type))).toBe(true);
  });

  it.each([
    ['loop.gif', 'image/gif'],
    ['logo.svg', 'image/svg+xml'],
    ['loop.apng', 'image/apng'],
    ['clip.mp4', 'video/mp4'],
    ['notes.pdf', 'application/pdf']
  ])('rejects %s', (name, type) => {
    expect(isQualityAdjustableImage(file(name, type))).toBe(false);
  });
});

describe('image quality profile parsing', () => {
  it('accepts the known profiles only', () => {
    expect(isImageQualityProfile('auto')).toBe(true);
    expect(isImageQualityProfile('original')).toBe(true);
    expect(isImageQualityProfile('ultra')).toBe(false);
    expect(isImageQualityProfile(null)).toBe(false);
    expect(isImageQualityProfile(2)).toBe(false);
  });

  it('defaults to the automatic profile', () => {
    expect(DEFAULT_IMAGE_QUALITY_PROFILE).toBe('auto');
  });
});

describe('image quality settings', () => {
  const large = { width: 4032, height: 3024, size: 5_000_000 };

  it('sends the original untouched', () => {
    expect(resolveImageQualitySettings('original', large)).toBeNull();
  });

  it('uses fixed targets for the explicit profiles', () => {
    expect(resolveImageQualitySettings('sd', large)).toEqual({ maxDimension: 854, quality: 0.68 });
    expect(resolveImageQualitySettings('hd', large)).toEqual({ maxDimension: 1920, quality: 0.84 });
  });

  it('keeps already small images untouched in automatic mode', () => {
    expect(
      resolveImageQualitySettings('auto', { width: 1280, height: 720, size: 400_000 })
    ).toBeNull();
  });

  it('re-encodes oversized or heavy images in automatic mode', () => {
    expect(resolveImageQualitySettings('auto', large)).toEqual({
      maxDimension: 1920,
      quality: 0.84
    });
    expect(
      resolveImageQualitySettings('auto', { width: 1280, height: 720, size: 4_000_000 })
    ).toEqual({ maxDimension: 1920, quality: 0.84 });
  });
});

describe('image scale factor', () => {
  it('scales down on the longest side', () => {
    expect(imageScaleFactor({ width: 4000, height: 2000 }, 2000)).toBe(0.5);
    expect(imageScaleFactor({ width: 2000, height: 4000 }, 2000)).toBe(0.5);
  });

  it('never upscales', () => {
    expect(imageScaleFactor({ width: 800, height: 600 }, 1920)).toBe(1);
  });

  it('tolerates a degenerate size', () => {
    expect(imageScaleFactor({ width: 0, height: 0 }, 1920)).toBe(1);
  });
});

describe('re-encoded filenames', () => {
  it.each([
    ['IMG_4032.HEIC', 'IMG_4032.jpg'],
    ['holiday.png', 'holiday.jpg'],
    ['no-extension', 'no-extension.jpg'],
    ['photo.2024.06.png', 'photo.2024.06.jpg'],
    ['.hidden', 'image.jpg']
  ])('renames %s', (input, expected) => {
    expect(reencodedImageName(input)).toBe(expected);
  });
});
