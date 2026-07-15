export const OUTBOX_SYNC_TAG = 'towk-outbox-v1';
export const MESSAGE_CREATE_IDEMPOTENCY_CAPABILITY = 'message.create-idempotency-v1';

export function supportsMessageCreateIdempotency(
  source: { capabilities?: readonly string[] } | null | undefined
): boolean {
  return source?.capabilities?.includes(MESSAGE_CREATE_IDEMPOTENCY_CAPABILITY) ?? false;
}
