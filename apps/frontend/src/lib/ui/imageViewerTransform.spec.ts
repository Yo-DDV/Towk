import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_SCALE,
  MIN_IMAGE_SCALE,
  clampImageScale,
  clampImageTransform,
  fitImageWithinViewport,
  panImageTransform,
  zoomImageTransformAtPoint
} from './imageViewerTransform';

describe('imageViewerTransform', () => {
  it('fits media without upscaling its intrinsic dimensions', () => {
    expect(
      fitImageWithinViewport({ width: 400, height: 200 }, { width: 1_000, height: 1_000 })
    ).toEqual({ width: 400, height: 200 });
    expect(
      fitImageWithinViewport({ width: 2_000, height: 1_000 }, { width: 600, height: 400 })
    ).toEqual({ width: 600, height: 300 });
  });

  it('returns an empty fit for invalid geometry', () => {
    expect(
      fitImageWithinViewport({ width: Number.NaN, height: 200 }, { width: 600, height: 400 })
    ).toEqual({ width: 0, height: 0 });
  });

  it('bounds scale and pan so the image cannot be lost outside the viewport', () => {
    expect(clampImageScale(0.2)).toBe(MIN_IMAGE_SCALE);
    expect(clampImageScale(99)).toBe(MAX_IMAGE_SCALE);
    expect(
      clampImageTransform(
        { scale: 2, x: 9_000, y: -9_000 },
        { width: 600, height: 300 },
        { width: 600, height: 400 }
      )
    ).toEqual({ scale: 2, x: 300, y: -100 });
  });

  it('keeps the selected focal point stable while zooming', () => {
    const next = zoomImageTransformAtPoint(
      { scale: 1, x: 0, y: 0 },
      2,
      { x: 120, y: -40 },
      { width: 600, height: 400 },
      { width: 600, height: 400 }
    );

    expect(next).toEqual({ scale: 2, x: -120, y: 40 });
  });

  it('clamps panning after translation and ignores non-finite deltas', () => {
    expect(
      panImageTransform(
        { scale: 3, x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 500 },
        { width: 400, height: 300 },
        { width: 600, height: 500 }
      )
    ).toEqual({ scale: 3, x: 0, y: 200 });
  });
});
