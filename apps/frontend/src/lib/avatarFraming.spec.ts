import { describe, expect, it } from 'vitest';
import {
  AvatarFileError,
  avatarCropFromFrame,
  avatarScale,
  centeredAvatarFrame,
  encodeAvatarFramingHeader,
  inspectAvatarBytes,
  normalizeAvatarFrame,
  panAvatarFrame,
  resizeAvatarFrame,
  zoomAvatarFrameAt
} from './avatarFraming';

const landscape = { width: 1200, height: 800, contentType: 'image/png' as const };

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

function gifWithFrames(width: number, height: number, frames: number): Uint8Array {
  const bytes: number[] = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    width & 0xff, (width >>> 8) & 0xff,
    height & 0xff, (height >>> 8) & 0xff,
    0x80, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff
  ];
  for (let index = 0; index < frames; index += 1) {
    bytes.push(
      0x2c,
      0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00,
      0x00,
      0x02,
      0x02, 0x44, 0x01,
      0x00
    );
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}

function vp8xWebP(width: number, height: number, chunkLength = 10): Uint8Array {
  const payloadLength = Math.max(0, chunkLength);
  const bytes = new Uint8Array(12 + 8 + payloadLength + (payloadLength & 1));
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  const riffSize = bytes.length - 8;
  bytes[4] = riffSize & 0xff;
  bytes[5] = (riffSize >>> 8) & 0xff;
  bytes[6] = (riffSize >>> 16) & 0xff;
  bytes[7] = (riffSize >>> 24) & 0xff;
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8); // WEBPVP8X
  bytes[16] = payloadLength & 0xff;
  bytes[17] = (payloadLength >>> 8) & 0xff;
  bytes[18] = (payloadLength >>> 16) & 0xff;
  bytes[19] = (payloadLength >>> 24) & 0xff;
  if (payloadLength >= 10) {
    const encodedWidth = width - 1;
    const encodedHeight = height - 1;
    bytes[24] = encodedWidth & 0xff;
    bytes[25] = (encodedWidth >>> 8) & 0xff;
    bytes[26] = (encodedWidth >>> 16) & 0xff;
    bytes[27] = encodedHeight & 0xff;
    bytes[28] = (encodedHeight >>> 8) & 0xff;
    bytes[29] = (encodedHeight >>> 16) & 0xff;
  }
  return bytes;
}

function orientedJPEGHeader(width: number, height: number, orientation: number): Uint8Array {
  const exifPayload = new Uint8Array(32);
  exifPayload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // Exif\0\0
  const tiff = 6;
  exifPayload.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], tiff);
  exifPayload.set([0x01, 0x00], tiff + 8);
  exifPayload.set(
    [0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00],
    tiff + 10
  );

  const app1Length = exifPayload.length + 2;
  const sof = new Uint8Array([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00
  ]);
  const result = new Uint8Array(2 + 4 + exifPayload.length + sof.length + 2);
  let offset = 0;
  result.set([0xff, 0xd8, 0xff, 0xe1, (app1Length >>> 8) & 0xff, app1Length & 0xff], offset);
  offset += 6;
  result.set(exifPayload, offset);
  offset += exifPayload.length;
  result.set(sof, offset);
  offset += sof.length;
  result.set([0xff, 0xd9], offset);
  return result;
}

describe('avatar framing geometry', () => {
  it('starts with a centered cover crop', () => {
    expect(avatarCropFromFrame(landscape, 400, centeredAvatarFrame())).toEqual({
      sourceWidth: 1200,
      sourceHeight: 800,
      x: 200,
      y: 0,
      size: 800
    });
  });

  it('clamps panning so the square never exposes empty space', () => {
    const state = panAvatarFrame(landscape, 400, centeredAvatarFrame(), 10_000, -10_000);
    expect(state.offsetX).toBe(100);
    expect(state.offsetY).toBe(0);
    expect(avatarCropFromFrame(landscape, 400, state)).toEqual({
      sourceWidth: 1200,
      sourceHeight: 800,
      x: 0,
      y: 0,
      size: 800
    });
  });

  it('preserves the selected source crop when the responsive stage resizes', () => {
    const before = panAvatarFrame(
      landscape,
      400,
      zoomAvatarFrameAt(landscape, 400, centeredAvatarFrame(), 2),
      72,
      -24
    );
    const cropBefore = avatarCropFromFrame(landscape, 400, before);
    const after = resizeAvatarFrame(landscape, 400, 260, before);
    expect(avatarCropFromFrame(landscape, 260, after)).toEqual(cropBefore);
  });

  it('keeps the source point below the cursor stable while zooming', () => {
    const state = zoomAvatarFrameAt(landscape, 400, centeredAvatarFrame(), 2, 100, 200);
    expect(state.zoom).toBe(2);
    expect(state.offsetX).toBeCloseTo(100);
    expect(state.offsetY).toBeCloseTo(0);
    expect(avatarCropFromFrame(landscape, 400, state)).toEqual({
      sourceWidth: 1200,
      sourceHeight: 800,
      x: 300,
      y: 200,
      size: 400
    });
  });

  it('resets contain mode and omits crop metadata', () => {
    const state = normalizeAvatarFrame(landscape, 400, {
      mode: 'contain',
      zoom: 5,
      offsetX: 99,
      offsetY: 99
    });
    expect(state).toEqual(centeredAvatarFrame('contain'));
    expect(avatarCropFromFrame(landscape, 400, state)).toBeNull();
  });

  it('fits every full-image corner inside the circular avatar', () => {
    const scale = avatarScale(landscape, 400, centeredAvatarFrame('contain'));
    const halfWidth = (landscape.width * scale) / 2;
    const halfHeight = (landscape.height * scale) / 2;
    expect(Math.hypot(halfWidth, halfHeight)).toBeCloseTo(200);
  });

  it('encodes an overflow-safe transport value', () => {
    expect(
      encodeAvatarFramingHeader({
        mode: 'crop',
        crop: {
          sourceWidth: 1200,
          sourceHeight: 800,
          x: 200,
          y: 0,
          size: 800
        }
      })
    ).toBe('v1:crop:1200:800:200:0:800');
    expect(
      encodeAvatarFramingHeader({ mode: 'contain', sourceWidth: 1200, sourceHeight: 800 })
    ).toBe('v1:contain:1200:800');
    expect(() =>
      encodeAvatarFramingHeader({
        mode: 'crop',
        crop: { sourceWidth: 10, sourceHeight: 10, x: 4, y: 0, size: 7 }
      })
    ).toThrow('inside');
  });
});

describe('avatar source inspection', () => {
  it('reads PNG and GIF dimensions from authoritative bytes', () => {
    expect(inspectAvatarBytes(pngHeader(640, 480))).toEqual({
      width: 640,
      height: 480,
      contentType: 'image/png'
    });

    const gif = gifWithFrames(320, 240, 1);
    expect(inspectAvatarBytes(gif)).toEqual({
      width: 320,
      height: 240,
      contentType: 'image/gif'
    });
  });

  it('rejects GIFs that exceed avatar animation budgets before browser decoding', () => {
    expect(() => inspectAvatarBytes(gifWithFrames(1, 1, 121))).toThrow('frame budget');
    expect(() => inspectAvatarBytes(gifWithFrames(4096, 4096, 2))).toThrow('frame budget');
  });

  it('reads WebP canvas dimensions and rejects truncated frame chunks', () => {
    expect(inspectAvatarBytes(vp8xWebP(1024, 512))).toEqual({
      width: 1024,
      height: 512,
      contentType: 'image/webp'
    });
    expect(() => inspectAvatarBytes(vp8xWebP(1, 1, 1))).toThrow('truncated VP8X');
  });

  it('reports display-oriented JPEG dimensions used by the server cropper', () => {
    expect(inspectAvatarBytes(orientedJPEGHeader(600, 400, 6))).toEqual({
      width: 400,
      height: 600,
      contentType: 'image/jpeg'
    });
    expect(inspectAvatarBytes(orientedJPEGHeader(600, 400, 1))).toEqual({
      width: 600,
      height: 400,
      contentType: 'image/jpeg'
    });
  });

  it('rejects a declared image whose magic bytes are unsupported', () => {
    expect(() => inspectAvatarBytes(new TextEncoder().encode('<svg></svg>'))).toThrow(
      AvatarFileError
    );
  });
});
