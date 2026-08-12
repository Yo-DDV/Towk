import { describe, expect, it } from 'vitest';
import { gradeVisual } from './gradeVisuals';

describe('gradeVisual', () => {
  it('uses a resolvable owner shield/crown icon instead of the broken legacy crown', () => {
    const owner = gradeVisual('owner');
    expect(owner.icon).toBe('mdi--shield-crown-outline');
    expect(owner.icon).not.toBe('uil--crown');
  });

  it('uses a hand-and-heart metaphor for Helper', () => {
    const helper = gradeVisual('helper');
    expect(helper.icon).toBe('mdi--hand-heart-outline');
    expect(helper.icon).not.toBe('uil--life-ring');
  });

  it('keeps each system grade semantically distinct', () => {
    const icons = ['owner', 'admin', 'moderator', 'helper', 'everyone'].map(
      (roleName) => gradeVisual(roleName).icon
    );
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('uses a neutral tuning icon for custom grades', () => {
    expect(gradeVisual('custom-role')).toEqual({
      icon: 'mdi--tune-variant',
      fallbackAccent: '#64748B'
    });
  });
});
