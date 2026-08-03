export const MIN_IMAGE_SCALE = 1;
export const MAX_IMAGE_SCALE = 8;
export const IMAGE_ZOOM_STEP = 0.25;

export type ImageViewerPoint = {
  x: number;
  y: number;
};

export type ImageViewerSize = {
  width: number;
  height: number;
};

export type ImageViewerTransform = ImageViewerPoint & {
  scale: number;
};

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveOrZero(value: number): number {
  return Math.max(0, finiteOr(value, 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampImageScale(scale: number): number {
  return clamp(finiteOr(scale, MIN_IMAGE_SCALE), MIN_IMAGE_SCALE, MAX_IMAGE_SCALE);
}

export function fitImageWithinViewport(
  naturalSize: ImageViewerSize,
  viewportSize: ImageViewerSize
): ImageViewerSize {
  const naturalWidth = positiveOrZero(naturalSize.width);
  const naturalHeight = positiveOrZero(naturalSize.height);
  const viewportWidth = positiveOrZero(viewportSize.width);
  const viewportHeight = positiveOrZero(viewportSize.height);

  if (naturalWidth === 0 || naturalHeight === 0 || viewportWidth === 0 || viewportHeight === 0) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight, 1);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale))
  };
}

export function clampImageTransform(
  transform: ImageViewerTransform,
  fittedSize: ImageViewerSize,
  viewportSize: ImageViewerSize
): ImageViewerTransform {
  const scale = clampImageScale(transform.scale);
  const fittedWidth = positiveOrZero(fittedSize.width);
  const fittedHeight = positiveOrZero(fittedSize.height);
  const viewportWidth = positiveOrZero(viewportSize.width);
  const viewportHeight = positiveOrZero(viewportSize.height);
  const maximumX = Math.max(0, (fittedWidth * scale - viewportWidth) / 2);
  const maximumY = Math.max(0, (fittedHeight * scale - viewportHeight) / 2);

  return {
    scale,
    x: clamp(finiteOr(transform.x, 0), -maximumX, maximumX),
    y: clamp(finiteOr(transform.y, 0), -maximumY, maximumY)
  };
}

export function zoomImageTransformAtPoint(
  transform: ImageViewerTransform,
  requestedScale: number,
  focalPoint: ImageViewerPoint,
  fittedSize: ImageViewerSize,
  viewportSize: ImageViewerSize
): ImageViewerTransform {
  const current = clampImageTransform(transform, fittedSize, viewportSize);
  const nextScale = clampImageScale(requestedScale);
  if (nextScale === current.scale) return current;

  const ratio = nextScale / current.scale;
  const focalX = finiteOr(focalPoint.x, 0);
  const focalY = finiteOr(focalPoint.y, 0);

  return clampImageTransform(
    {
      scale: nextScale,
      x: focalX - (focalX - current.x) * ratio,
      y: focalY - (focalY - current.y) * ratio
    },
    fittedSize,
    viewportSize
  );
}

export function panImageTransform(
  transform: ImageViewerTransform,
  delta: ImageViewerPoint,
  fittedSize: ImageViewerSize,
  viewportSize: ImageViewerSize
): ImageViewerTransform {
  return clampImageTransform(
    {
      scale: transform.scale,
      x: transform.x + finiteOr(delta.x, 0),
      y: transform.y + finiteOr(delta.y, 0)
    },
    fittedSize,
    viewportSize
  );
}
