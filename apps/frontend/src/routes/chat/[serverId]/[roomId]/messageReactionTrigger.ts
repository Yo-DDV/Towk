export function reactionTriggerTarget(
  pointerType: string | undefined,
  canUseHoverActions: boolean,
  isTouchPrimary: boolean
): 'action-sheet' | 'emoji-picker' {
  return pointerType === 'touch' || isTouchPrimary || !canUseHoverActions
    ? 'action-sheet'
    : 'emoji-picker';
}
