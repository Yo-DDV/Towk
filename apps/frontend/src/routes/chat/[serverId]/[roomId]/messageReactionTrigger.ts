export function reactionTriggerTarget(
  pointerType: string | undefined,
  canUseHoverActions: boolean
): 'action-sheet' | 'emoji-picker' {
  return pointerType === 'touch' || !canUseHoverActions ? 'action-sheet' : 'emoji-picker';
}
