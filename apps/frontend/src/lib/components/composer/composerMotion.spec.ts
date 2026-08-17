import { describe, expect, it } from 'vitest';
import {
  composerOrbitKeyframes,
  normalizeDesktopMotionPolicy,
  roundedRectPerimeterPoints,
  roundedRectPointAt,
  shouldAnimateComposer
} from './composerMotion';

describe('composer motion geometry', () => {
  it('samples a closed rounded-rectangle path', () => {
    const points = roundedRectPerimeterPoints(320, 64, 16, 64);

    expect(points).toHaveLength(65);
    expect(points.at(-1)?.x).toBeCloseTo(points[0].x, 6);
    expect(points.at(-1)?.y).toBeCloseTo(points[0].y, 6);
  });

  it('keeps every point inside the requested bounds', () => {
    const points = roundedRectPerimeterPoints(173, 57, 14, 128);

    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(173);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(57);
    }
  });

  it('samples the path at approximately uniform distances', () => {
    const points = roundedRectPerimeterPoints(360, 72, 18, 128);
    const distances = points.slice(1).map((point, index) =>
      Math.hypot(point.x - points[index].x, point.y - points[index].y)
    );
    const average = distances.reduce((total, distance) => total + distance, 0) / distances.length;
    const largestDeviation = Math.max(...distances.map((distance) => Math.abs(distance - average)));

    expect(largestDeviation / average).toBeLessThan(0.08);
  });

  it('returns finite coordinates for degenerate and invalid inputs', () => {
    for (const point of [
      roundedRectPointAt(0, 0, 20, 0.5),
      roundedRectPointAt(Number.NaN, 40, Number.POSITIVE_INFINITY, Number.NaN),
      roundedRectPointAt(10, 3, 99, -2.25)
    ]) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it('produces compositor-ready transforms with explicit offsets', () => {
    const frames = composerOrbitKeyframes(200, 60, 12, 16, 2);

    expect(frames).toHaveLength(17);
    expect(frames[0].offset).toBe(0);
    expect(frames.at(-1)?.offset).toBe(1);
    expect(String(frames[0].transform)).toContain('translate3d(');
  });
});

describe('composer motion policy', () => {
  const baseline = {
    focused: true,
    documentVisible: true,
    reducedMotion: false,
    forcedColors: false,
    desktopPolicy: 'full' as const
  };

  it('animates only for a focused, visible, full-motion composer', () => {
    expect(shouldAnimateComposer(baseline)).toBe(true);
    expect(shouldAnimateComposer({ ...baseline, focused: false })).toBe(false);
    expect(shouldAnimateComposer({ ...baseline, documentVisible: false })).toBe(false);
    expect(shouldAnimateComposer({ ...baseline, reducedMotion: true })).toBe(false);
    expect(shouldAnimateComposer({ ...baseline, forcedColors: true })).toBe(false);
    expect(shouldAnimateComposer({ ...baseline, desktopPolicy: 'reduced' })).toBe(false);
    expect(shouldAnimateComposer({ ...baseline, desktopPolicy: 'hidden' })).toBe(false);
  });

  it('normalizes unknown desktop policy values to full motion', () => {
    expect(normalizeDesktopMotionPolicy('hidden')).toBe('hidden');
    expect(normalizeDesktopMotionPolicy('reduced')).toBe('reduced');
    expect(normalizeDesktopMotionPolicy('unexpected')).toBe('full');
    expect(normalizeDesktopMotionPolicy(undefined)).toBe('full');
  });
});
