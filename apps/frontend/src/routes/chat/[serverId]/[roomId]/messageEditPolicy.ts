export type CanEditMessageOptions = {
  isAuthor: boolean;
  canManageOthersMessage: boolean;
  createdAt: string;
  messageEditWindowSeconds: number;
  nowMs: number;
};

export function canEditMessage({
  isAuthor,
  canManageOthersMessage,
  createdAt,
  messageEditWindowSeconds,
  nowMs
}: CanEditMessageOptions): boolean {
  if (!isAuthor) return canManageOthersMessage;

  const createdAtMs = Date.parse(createdAt);
  const editWindowMs = messageEditWindowSeconds * 1000;

  return Number.isFinite(createdAtMs) && nowMs - createdAtMs < editWindowMs;
}
