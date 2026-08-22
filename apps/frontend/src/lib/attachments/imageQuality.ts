/**
 * Client-side quality profiles for image attachments.
 *
 * Photos taken on modern devices are far larger than what a message needs.
 * The sender picks a profile before sending; the image is re-encoded in the
 * browser so the upload, the recipient's download and the stored asset all
 * shrink together. The original file is never mutated: the composer keeps it
 * and re-derives the prepared file whenever the profile changes.
 */

export const IMAGE_QUALITY_PROFILES = ['auto', 'sd', 'hd', 'original'] as const;

export type ImageQualityProfile = (typeof IMAGE_QUALITY_PROFILES)[number];

export const DEFAULT_IMAGE_QUALITY_PROFILE: ImageQualityProfile = 'auto';

/** Re-encoding target. `null` means the source file is sent untouched. */
export type ImageQualitySettings = {
  maxDimension: number;
  quality: number;
};

const SD_SETTINGS: ImageQualitySettings = { maxDimension: 854, quality: 0.68 };
const HD_SETTINGS: ImageQualitySettings = { maxDimension: 1920, quality: 0.84 };

/**
 * Images already small enough are left untouched by the automatic profile:
 * re-encoding them would cost quality without a meaningful size gain.
 */
const AUTO_KEEP_MAX_DIMENSION = HD_SETTINGS.maxDimension;
const AUTO_KEEP_MAX_BYTES = 1_500_000;

const STORAGE_KEY = 'towk:attachment-image-quality';

let profileFallback: ImageQualityProfile | null = null;

/**
 * Formats that must never be re-encoded: animation and vector data would be
 * flattened into a single raster frame.
 */
const NON_REENCODABLE_IMAGE_TYPES = new Set(['image/gif', 'image/svg+xml', 'image/apng']);

export function isQualityAdjustableImage(file: File): boolean {
  const type = file.type.toLowerCase();
  if (!type.startsWith('image/')) return false;
  return !NON_REENCODABLE_IMAGE_TYPES.has(type);
}

export function isImageQualityProfile(value: unknown): value is ImageQualityProfile {
  return typeof value === 'string' && (IMAGE_QUALITY_PROFILES as readonly string[]).includes(value);
}

/**
 * Resolves the re-encoding target for a source image, or `null` when the file
 * must be sent as-is.
 */
export function resolveImageQualitySettings(
  profile: ImageQualityProfile,
  source: { width: number; height: number; size: number }
): ImageQualitySettings | null {
  if (profile === 'original') return null;
  if (profile === 'sd') return SD_SETTINGS;
  if (profile === 'hd') return HD_SETTINGS;
  const largestSide = Math.max(source.width, source.height);
  if (largestSide <= AUTO_KEEP_MAX_DIMENSION && source.size <= AUTO_KEEP_MAX_BYTES) return null;
  return HD_SETTINGS;
}

/** Scale factor applied to a source image, never above 1 (no upscaling). */
export function imageScaleFactor(
  source: { width: number; height: number },
  maxDimension: number
): number {
  const largestSide = Math.max(source.width, source.height);
  if (largestSide <= 0) return 1;
  return Math.min(1, maxDimension / largestSide);
}

export function reencodedImageName(filename: string): string {
  const base = filename.replace(/\.[^./\\]+$/, '');
  return `${base || 'image'}.jpg`;
}

export function loadImageQualityProfile(): ImageQualityProfile {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isImageQualityProfile(stored)) {
      profileFallback = stored;
      return stored;
    }
  } catch {
    if (profileFallback) return profileFallback;
  }
  return profileFallback ?? DEFAULT_IMAGE_QUALITY_PROFILE;
}

export function saveImageQualityProfile(profile: ImageQualityProfile): void {
  profileFallback = profile;
  try {
    window.localStorage.setItem(STORAGE_KEY, profile);
  } catch {
    // The in-memory fallback still applies for this page lifetime.
  }
}

async function decodeImage(file: File): Promise<ImageBitmap> {
  // `from-image` keeps EXIF orientation, so a portrait photo stays portrait.
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

async function encodeCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  quality: number
): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Re-encodes one image for the selected profile. Returns the source file
 * unchanged when the profile keeps the original, when the format cannot be
 * re-encoded, or when re-encoding would not make the file smaller.
 */
export async function applyImageQuality(file: File, profile: ImageQualityProfile): Promise<File> {
  if (profile === 'original' || !isQualityAdjustableImage(file)) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeImage(file);
  } catch {
    // An undecodable image is still a valid upload: send it untouched.
    return file;
  }

  try {
    const settings = resolveImageQualitySettings(profile, {
      width: bitmap.width,
      height: bitmap.height,
      size: file.size
    });
    if (!settings) return file;

    const scale = imageScaleFactor(bitmap, settings.maxDimension);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await encodeCanvas(canvas, settings.quality);
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], reencodedImageName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified
    });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
