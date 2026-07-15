export type NativeShareResult = 'shared' | 'cancelled' | 'unsupported' | 'failed';

type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
};

export function canUseNativeShare(
  shareNavigator: ShareNavigator | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator
): boolean {
  return typeof shareNavigator?.share === 'function';
}

export async function shareTowkMessage(
  data: ShareData,
  shareNavigator: ShareNavigator | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator
): Promise<NativeShareResult> {
  if (!canUseNativeShare(shareNavigator)) return 'unsupported';

  try {
    if (shareNavigator?.canShare && !shareNavigator.canShare(data)) return 'unsupported';
    await shareNavigator!.share!(data);
    return 'shared';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}
