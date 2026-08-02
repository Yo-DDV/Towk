export type UploadProgressRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type UploadProgressViewport = {
  width: number;
  height: number;
  offsetTop?: number;
  offsetLeft?: number;
};

export type UploadProgressPosition = {
  top: number;
  left: number;
  width: number;
};

const VIEWPORT_PADDING_PX = 8;
const MAX_ISLAND_WIDTH_PX = 576;

export function computeUploadProgressPosition(
  anchor: UploadProgressRect,
  island: Pick<UploadProgressRect, 'height'>,
  viewport: UploadProgressViewport
): UploadProgressPosition {
  const offsetTop = viewport.offsetTop ?? 0;
  const offsetLeft = viewport.offsetLeft ?? 0;
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_PADDING_PX * 2);
  const width = Math.min(Math.max(0, anchor.width), MAX_ISLAND_WIDTH_PX, availableWidth);
  const centeredLeft = anchor.left + (anchor.width - width) / 2;
  const left = clamp(
    centeredLeft,
    offsetLeft + VIEWPORT_PADDING_PX,
    offsetLeft + viewport.width - width - VIEWPORT_PADDING_PX
  );
  const preferredTop = anchor.top - Math.max(0, island.height) - VIEWPORT_PADDING_PX;
  const top = clamp(
    preferredTop,
    offsetTop + VIEWPORT_PADDING_PX,
    offsetTop + viewport.height - Math.max(0, island.height) - VIEWPORT_PADDING_PX
  );
  return { top: Math.round(top), left: Math.round(left), width: Math.round(width) };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
