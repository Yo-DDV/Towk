export const MAX_AVATAR_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_AVATAR_SOURCE_DIMENSION = 4096;
export const MAX_AVATAR_SOURCE_PIXELS = 16_777_216;
export const MAX_AVATAR_ANIMATION_FRAMES = 120;
export const MAX_AVATAR_ANIMATION_CUMULATIVE_PIXELS = 16_777_216;
export const MAX_AVATAR_ZOOM = 6;
export const AVATAR_FRAMING_HEADER = 'X-Towk-Avatar-Framing';
export const AVATAR_FRAMING_CAPABILITY = 'avatar-framing-v1';

export type AvatarFramingMode = 'crop' | 'contain';

export type AvatarSource = {
  width: number;
  height: number;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
};

export type AvatarFrameState = {
  mode: AvatarFramingMode;
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type AvatarCrop = {
  sourceWidth: number;
  sourceHeight: number;
  x: number;
  y: number;
  size: number;
};

export type AvatarFramingSelection =
  | { mode: 'crop'; crop: AvatarCrop }
  | { mode: 'contain'; sourceWidth: number; sourceHeight: number };

export class AvatarFileError extends Error {
  readonly code: 'type' | 'size' | 'dimensions' | 'animation' | 'decode';

  constructor(code: AvatarFileError['code'], message: string) {
    super(message);
    this.name = 'AvatarFileError';
    this.code = code;
  }
}

export function centeredAvatarFrame(mode: AvatarFramingMode = 'crop'): AvatarFrameState {
  return { mode, zoom: 1, offsetX: 0, offsetY: 0 };
}

export function avatarScale(
  source: Pick<AvatarSource, 'width' | 'height'>,
  stageSize: number,
  state: Pick<AvatarFrameState, 'mode' | 'zoom'>
): number {
  if (source.width <= 0 || source.height <= 0 || stageSize <= 0) return 0;
  const base =
    state.mode === 'crop'
      ? Math.max(stageSize / source.width, stageSize / source.height)
      : stageSize / Math.hypot(source.width, source.height);
  return base * (state.mode === 'crop' ? clamp(state.zoom, 1, MAX_AVATAR_ZOOM) : 1);
}

export function normalizeAvatarFrame(
  source: Pick<AvatarSource, 'width' | 'height'>,
  stageSize: number,
  state: AvatarFrameState
): AvatarFrameState {
  if (state.mode === 'contain') return centeredAvatarFrame('contain');

  const zoom = clamp(finiteOr(state.zoom, 1), 1, MAX_AVATAR_ZOOM);
  const scale = avatarScale(source, stageSize, { mode: 'crop', zoom });
  const maxX = Math.max(0, (source.width * scale - stageSize) / 2);
  const maxY = Math.max(0, (source.height * scale - stageSize) / 2);

  return {
    mode: 'crop',
    zoom,
    offsetX: clamp(finiteOr(state.offsetX, 0), -maxX, maxX),
    offsetY: clamp(finiteOr(state.offsetY, 0), -maxY, maxY)
  };
}

export function resizeAvatarFrame(
  source: Pick<AvatarSource, 'width' | 'height'>,
  previousStageSize: number,
  nextStageSize: number,
  state: AvatarFrameState
): AvatarFrameState {
  if (state.mode === 'contain') return centeredAvatarFrame('contain');
  if (nextStageSize <= 0) return normalizeAvatarFrame(source, nextStageSize, state);
  const ratio = previousStageSize > 0 ? nextStageSize / previousStageSize : 1;
  return normalizeAvatarFrame(source, nextStageSize, {
    ...state,
    offsetX: state.offsetX * ratio,
    offsetY: state.offsetY * ratio
  });
}

export function panAvatarFrame(
  source: Pick<AvatarSource, 'width' | 'height'>,
  stageSize: number,
  state: AvatarFrameState,
  deltaX: number,
  deltaY: number
): AvatarFrameState {
  if (state.mode === 'contain') return centeredAvatarFrame('contain');
  return normalizeAvatarFrame(source, stageSize, {
    ...state,
    offsetX: state.offsetX + finiteOr(deltaX, 0),
    offsetY: state.offsetY + finiteOr(deltaY, 0)
  });
}

export function zoomAvatarFrameAt(
  source: Pick<AvatarSource, 'width' | 'height'>,
  stageSize: number,
  state: AvatarFrameState,
  nextZoom: number,
  pointX = stageSize / 2,
  pointY = stageSize / 2
): AvatarFrameState {
  if (state.mode === 'contain') return centeredAvatarFrame('contain');

  const current = normalizeAvatarFrame(source, stageSize, state);
  const zoom = clamp(finiteOr(nextZoom, current.zoom), 1, MAX_AVATAR_ZOOM);
  if (Math.abs(zoom - current.zoom) < 1e-6) return current;

  const oldScale = avatarScale(source, stageSize, current);
  const newScale = avatarScale(source, stageSize, { mode: 'crop', zoom });
  const centeredPointX = finiteOr(pointX, stageSize / 2) - stageSize / 2;
  const centeredPointY = finiteOr(pointY, stageSize / 2) - stageSize / 2;

  const sourcePointX = (centeredPointX - current.offsetX) / oldScale;
  const sourcePointY = (centeredPointY - current.offsetY) / oldScale;

  return normalizeAvatarFrame(source, stageSize, {
    mode: 'crop',
    zoom,
    offsetX: centeredPointX - sourcePointX * newScale,
    offsetY: centeredPointY - sourcePointY * newScale
  });
}

export function avatarCropFromFrame(
  source: Pick<AvatarSource, 'width' | 'height'>,
  stageSize: number,
  state: AvatarFrameState
): AvatarCrop | null {
  if (state.mode === 'contain') return null;

  const normalized = normalizeAvatarFrame(source, stageSize, state);
  const scale = avatarScale(source, stageSize, normalized);
  if (scale <= 0) return null;

  // The cover base scale is stageSize / min(source dimensions), so the
  // selected source square depends only on zoom. Computing it directly avoids
  // a one-pixel rounding flip when a responsive dialog changes stage size.
  const exactSize = Math.min(source.width, source.height) / normalized.zoom;
  const size = clamp(Math.round(exactSize), 1, Math.min(source.width, source.height));
  const centerX = source.width / 2 - normalized.offsetX / scale;
  const centerY = source.height / 2 - normalized.offsetY / scale;
  const x = clamp(Math.round(centerX - size / 2), 0, source.width - size);
  const y = clamp(Math.round(centerY - size / 2), 0, source.height - size);

  return {
    sourceWidth: source.width,
    sourceHeight: source.height,
    x,
    y,
    size
  };
}

export function encodeAvatarFramingHeader(selection: AvatarFramingSelection): string {
  if (selection.mode === 'contain') {
    validateSourceDimensions(selection.sourceWidth, selection.sourceHeight);
    return `v1:contain:${selection.sourceWidth}:${selection.sourceHeight}`;
  }

  const crop = selection.crop;
  validateSourceDimensions(crop.sourceWidth, crop.sourceHeight);
  for (const value of [crop.x, crop.y, crop.size]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new TypeError('avatar crop values must be unsigned 32-bit integers');
    }
  }
  if (crop.size <= 0) {
    throw new TypeError('avatar crop dimensions must be positive');
  }
  if (crop.x + crop.size > crop.sourceWidth || crop.y + crop.size > crop.sourceHeight) {
    throw new TypeError('avatar crop must stay inside the source image');
  }
  return `v1:crop:${crop.sourceWidth}:${crop.sourceHeight}:${crop.x}:${crop.y}:${crop.size}`;
}

function validateSourceDimensions(width: number, height: number): void {
  for (const value of [width, height]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_AVATAR_SOURCE_DIMENSION) {
      throw new TypeError('avatar source dimensions are invalid');
    }
  }
  if (width * height > MAX_AVATAR_SOURCE_PIXELS) {
    throw new TypeError('avatar source dimensions exceed the supported pixel limit');
  }
}

export async function inspectAvatarFile(file: File): Promise<AvatarSource> {
  if (file.size <= 0) throw new AvatarFileError('decode', 'empty avatar file');
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    throw new AvatarFileError('size', 'avatar file exceeds the upload limit');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const source = inspectAvatarBytes(bytes);
  if (source.width <= 0 || source.height <= 0) {
    throw new AvatarFileError('decode', 'avatar dimensions are invalid');
  }
  if (
    source.width > MAX_AVATAR_SOURCE_DIMENSION ||
    source.height > MAX_AVATAR_SOURCE_DIMENSION ||
    source.width * source.height > MAX_AVATAR_SOURCE_PIXELS
  ) {
    throw new AvatarFileError('dimensions', 'avatar dimensions exceed the supported limit');
  }
  return source;
}

export function inspectAvatarBytes(bytes: Uint8Array): AvatarSource {
  if (isPNG(bytes)) {
    ensureLength(bytes, 24);
    if (readU32BE(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') {
      throw new AvatarFileError('decode', 'invalid PNG header');
    }
    return source(readU32BE(bytes, 16), readU32BE(bytes, 20), 'image/png');
  }
  if (isGIF(bytes)) {
    return inspectGIF(bytes);
  }
  if (isJPEG(bytes)) {
    return inspectJPEG(bytes);
  }
  if (isWebP(bytes)) {
    return inspectWebP(bytes);
  }
  throw new AvatarFileError('type', 'unsupported avatar image type');
}

function inspectGIF(bytes: Uint8Array): AvatarSource {
  ensureLength(bytes, 13);
  const width = readU16LE(bytes, 6);
  const height = readU16LE(bytes, 8);
  let offset = 13;
  const packed = bytes[10];
  if ((packed & 0x80) !== 0) {
    offset += 3 * (1 << ((packed & 0x07) + 1));
  }
  if (offset > bytes.length) throw new AvatarFileError('decode', 'invalid GIF color table');

  let frames = 0;
  let cumulativePixels = 0;
  const skipSubBlocks = () => {
    while (true) {
      if (offset >= bytes.length) throw new AvatarFileError('decode', 'truncated GIF data');
      const length = bytes[offset++];
      if (length === 0) return;
      if (offset + length > bytes.length) {
        throw new AvatarFileError('decode', 'truncated GIF data');
      }
      offset += length;
    }
  };

  while (offset < bytes.length) {
    const marker = bytes[offset];
    if (marker === 0x3b) {
      if (frames < 1) throw new AvatarFileError('decode', 'GIF has no frames');
      return source(width, height, 'image/gif');
    }
    if (marker === 0x21) {
      if (offset + 2 > bytes.length) throw new AvatarFileError('decode', 'truncated GIF extension');
      offset += 2;
      skipSubBlocks();
      continue;
    }
    if (marker !== 0x2c || offset + 10 > bytes.length) {
      throw new AvatarFileError('decode', 'invalid GIF block');
    }

    const frameWidth = readU16LE(bytes, offset + 5);
    const frameHeight = readU16LE(bytes, offset + 7);
    if (frameWidth <= 0 || frameHeight <= 0) {
      throw new AvatarFileError('decode', 'invalid GIF frame dimensions');
    }
    frames += 1;
    cumulativePixels += frameWidth * frameHeight;
    const fullCanvasPixels = width * height * frames;
    if (
      frames > MAX_AVATAR_ANIMATION_FRAMES ||
      cumulativePixels > MAX_AVATAR_ANIMATION_CUMULATIVE_PIXELS ||
      fullCanvasPixels > MAX_AVATAR_ANIMATION_CUMULATIVE_PIXELS
    ) {
      throw new AvatarFileError('animation', 'animated avatar exceeds the supported frame budget');
    }

    const framePacked = bytes[offset + 9];
    offset += 10;
    if ((framePacked & 0x80) !== 0) {
      offset += 3 * (1 << ((framePacked & 0x07) + 1));
    }
    if (offset >= bytes.length) throw new AvatarFileError('decode', 'truncated GIF image data');
    offset += 1; // LZW minimum code size
    skipSubBlocks();
  }
  throw new AvatarFileError('decode', 'truncated GIF data');
}

function inspectJPEG(bytes: Uint8Array): AvatarSource {
  let offset = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;

  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0xda) break;
    if (offset + 1 >= bytes.length) break;

    const segmentLength = readU16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const payloadOffset = offset + 2;
    const payloadLength = segmentLength - 2;

    if (marker === 0xe1) {
      orientation = readExifOrientation(bytes, payloadOffset, payloadLength) ?? orientation;
    } else if (isJPEGStartOfFrame(marker)) {
      if (segmentLength < 7) break;
      height = readU16BE(bytes, offset + 3);
      width = readU16BE(bytes, offset + 5);
    }
    offset += segmentLength;
  }

  if (width <= 0 || height <= 0) {
    throw new AvatarFileError('decode', 'could not read JPEG dimensions');
  }
  if (orientation >= 5 && orientation <= 8) {
    return source(height, width, 'image/jpeg');
  }
  return source(width, height, 'image/jpeg');
}

function readExifOrientation(
  bytes: Uint8Array,
  payloadOffset: number,
  payloadLength: number
): number | null {
  if (payloadLength < 14 || ascii(bytes, payloadOffset, 6) !== 'Exif\0\0') return null;
  const tiff = payloadOffset + 6;
  const littleEndian = ascii(bytes, tiff, 2) === 'II';
  if (!littleEndian && ascii(bytes, tiff, 2) !== 'MM') return null;

  const read16 = (offset: number) =>
    littleEndian ? readU16LE(bytes, offset) : readU16BE(bytes, offset);
  const read32 = (offset: number) =>
    littleEndian ? readU32LE(bytes, offset) : readU32BE(bytes, offset);

  if (read16(tiff + 2) !== 42) return null;
  const ifdOffset = read32(tiff + 4);
  const ifd = tiff + ifdOffset;
  const payloadEnd = payloadOffset + payloadLength;
  if (ifd < tiff || ifd + 2 > payloadEnd) return null;

  const entries = read16(ifd);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > payloadEnd) return null;
    if (read16(entry) !== 0x0112) continue;
    if (read16(entry + 2) !== 3 || read32(entry + 4) !== 1) return null;
    const value = read16(entry + 8);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

function inspectWebP(bytes: Uint8Array): AvatarSource {
  ensureLength(bytes, 20);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = ascii(bytes, offset, 4);
    const length = readU32LE(bytes, offset + 4);
    const payload = offset + 8;
    if (payload + length > bytes.length) break;

    if (chunk === 'VP8X') {
      if (length < 10) throw new AvatarFileError('decode', 'truncated VP8X frame header');
      ensureLength(bytes, payload + 10);
      return source(
        1 + readU24LE(bytes, payload + 4),
        1 + readU24LE(bytes, payload + 7),
        'image/webp'
      );
    }
    if (chunk === 'VP8 ') {
      if (length < 10) throw new AvatarFileError('decode', 'truncated VP8 frame header');
      ensureLength(bytes, payload + 10);
      if (bytes[payload + 3] !== 0x9d || bytes[payload + 4] !== 0x01 || bytes[payload + 5] !== 0x2a) {
        throw new AvatarFileError('decode', 'invalid VP8 frame header');
      }
      return source(
        readU16LE(bytes, payload + 6) & 0x3fff,
        readU16LE(bytes, payload + 8) & 0x3fff,
        'image/webp'
      );
    }
    if (chunk === 'VP8L') {
      if (length < 5) throw new AvatarFileError('decode', 'truncated VP8L frame header');
      ensureLength(bytes, payload + 5);
      if (bytes[payload] !== 0x2f) {
        throw new AvatarFileError('decode', 'invalid VP8L frame header');
      }
      const dimensions =
        bytes[payload + 1] +
        bytes[payload + 2] * 0x100 +
        bytes[payload + 3] * 0x10000 +
        bytes[payload + 4] * 0x1000000;
      const width = 1 + (dimensions & 0x3fff);
      const height = 1 + ((dimensions >>> 14) & 0x3fff);
      return source(width, height, 'image/webp');
    }

    offset = payload + length + (length & 1);
  }
  throw new AvatarFileError('decode', 'could not read WebP dimensions');
}

function source(
  width: number,
  height: number,
  contentType: AvatarSource['contentType']
): AvatarSource {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new AvatarFileError('decode', 'avatar dimensions are invalid');
  }
  return { width, height, contentType };
}

function isPNG(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isGIF(bytes: Uint8Array): boolean {
  const signature = ascii(bytes, 0, 6);
  return signature === 'GIF87a' || signature === 'GIF89a';
}

function isJPEG(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isWebP(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

function isJPEGStartOfFrame(marker: number): boolean {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
    marker
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return '';
  let result = '';
  for (let index = offset; index < offset + length; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }
  return result;
}

function ensureLength(bytes: Uint8Array, length: number): void {
  if (bytes.length < length) throw new AvatarFileError('decode', 'truncated avatar image');
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  ensureLength(bytes, offset + 2);
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  ensureLength(bytes, offset + 2);
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  ensureLength(bytes, offset + 3);
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  ensureLength(bytes, offset + 4);
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  ensureLength(bytes, offset + 4);
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  );
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  const bounded = Math.min(max, Math.max(min, value));
  return Object.is(bounded, -0) ? 0 : bounded;
}
