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
    expect(
      fitImageWithinViewport({ width: -1, height: 200 }, { width: 600, height: 400 })
    ).toEqual({ width: 0, height: 0 });
  });

  it('bounds scale and pan so the image cannot be lost outside the viewport', () => {
    expect(clampImageScale(0.2)).toBe(MIN_IMAGE_SCALE);
    expect(clampImageScale(99)).toBe(MAX_IMAGE_SCALE);
    expect(clampImageScale(Number.NaN)).toBe(MIN_IMAGE_SCALE);
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

  it('reclamps an existing transform after a viewport resize', () => {
    expect(
      clampImageTransform(
        { scale: 4, x: 600, y: -400 },
        { width: 500, height: 300 },
        { width: 900, height: 700 }
      )
    ).toEqual({ scale: 4, x: 550, y: -250 });
  });

  it('preserves bounds through a deterministic zoom, pan and resize campaign', () => {
    let seed = 0x5eed1234;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let iteration = 0; iteration < 2_000; iteration++) {
      const viewport = {
        width: 1 + Math.floor(random() * 3_000),
        height: 1 + Math.floor(random() * 2_000)
      };
      const fitted = fitImageWithinViewport(
        {
          width: 1 + Math.floor(random() * 10_000),
          height: 1 + Math.floor(random() * 10_000)
        },
        viewport
      );
      let transform = zoomImageTransformAtPoint(
        { scale: 1, x: 0, y: 0 },
        -5 + random() * 20,
        {
          x: (random() - 0.5) * viewport.width,
          y: (random() - 0.5) * viewport.height
        },
        fitted,
        viewport
      );
      transform = panImageTransform(
        transform,
        { x: (random() - 0.5) * 10_000, y: (random() - 0.5) * 10_000 },
        fitted,
        viewport
      );
      const resizedViewport = {
        width: Math.max(1, viewport.width + (random() - 0.5) * 1_000),
        height: Math.max(1, viewport.height + (random() - 0.5) * 1_000)
      };
      transform = clampImageTransform(transform, fitted, resizedViewport);

      const maximumX = Math.max(
        0,
        (fitted.width * transform.scale - resizedViewport.width) / 2
      );
      const maximumY = Math.max(
        0,
        (fitted.height * transform.scale - resizedViewport.height) / 2
      );
      expect(transform.scale).toBeGreaterThanOrEqual(MIN_IMAGE_SCALE);
      expect(transform.scale).toBeLessThanOrEqual(MAX_IMAGE_SCALE);
      expect(Math.abs(transform.x)).toBeLessThanOrEqual(maximumX + Number.EPSILON);
      expect(Math.abs(transform.y)).toBeLessThanOrEqual(maximumY + Number.EPSILON);
    }
  });
});
