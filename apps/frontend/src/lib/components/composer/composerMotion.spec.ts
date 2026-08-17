import { describe, expect, it } from 'vitest';
import {
  composerHaloKeyframes,
  normalizeDesktopMotionPolicy,
  shouldAnimateComposer
} from './composerMotion';

describe('composer motion geometry', () => {
  it('moves a continuous dash by one normalized perimeter', () => {
    const frames = composerHaloKeyframes();

    expect(frames).toEqual([{ strokeDashoffset: '0' }, { strokeDashoffset: '-1' }]);
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
