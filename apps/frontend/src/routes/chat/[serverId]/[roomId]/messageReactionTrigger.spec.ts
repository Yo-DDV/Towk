import { describe, expect, it } from 'vitest';
import { reactionTriggerTarget } from './messageReactionTrigger';

describe('reactionTriggerTarget', () => {
  it('opens the message action sheet for Android touch clicks even when hover is reported', () => {
    expect(reactionTriggerTarget('touch', true)).toBe('action-sheet');
  });

  it('opens the message action sheet on other no-hover devices', () => {
    expect(reactionTriggerTarget(undefined, false)).toBe('action-sheet');
  });

  it('keeps the floating emoji picker for desktop mouse clicks', () => {
    expect(reactionTriggerTarget('mouse', true)).toBe('emoji-picker');
  });
});
