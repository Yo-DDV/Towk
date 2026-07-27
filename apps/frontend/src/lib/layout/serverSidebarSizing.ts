import {
  SERVER_SIDEBAR_DEFAULT_WIDTH,
  SERVER_SIDEBAR_MAX_WIDTH
} from '$lib/storage/serverSidebarWidth';

export const FOLD_LIKE_MIN_VIEWPORT_WIDTH = 768;
export const FOLD_LIKE_MAX_VIEWPORT_WIDTH = 1280;
export const FOLD_LIKE_MIN_ASPECT_RATIO = 4 / 5;
export const FOLD_LIKE_MAX_ASPECT_RATIO = 5 / 4;
export const FOLD_LIKE_SIDEBAR_MAX_WIDTH = 360;
export const FOLD_LIKE_SIDEBAR_VIEWPORT_RATIO = 0.38;

const RESIZE_STEP_PX = 8;

export type ServerSidebarViewport = {
  width: number;
  height: number;
  hasCoarsePointer: boolean;
};

/**
 * Keep the desktop-resizable channel sidebar proportional when a Fold-like
 * touch viewport is wide enough to cross the desktop breakpoint but still
 * leaves a comparatively narrow central chat column.
 *
 * Device names and user agents are deliberately avoided. Conventional phone
 * overlays, 4:3 tablets, laptops, and desktops retain the normal 480 px cap.
 */
export function getServerSidebarMaxWidth({
  width,
  height,
  hasCoarsePointer
}: ServerSidebarViewport): number {
  if (
    !hasCoarsePointer ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return SERVER_SIDEBAR_MAX_WIDTH;
  }

  const aspectRatio = width / height;
  const isFoldLikeViewport =
    width >= FOLD_LIKE_MIN_VIEWPORT_WIDTH &&
    width <= FOLD_LIKE_MAX_VIEWPORT_WIDTH &&
    aspectRatio >= FOLD_LIKE_MIN_ASPECT_RATIO &&
    aspectRatio <= FOLD_LIKE_MAX_ASPECT_RATIO;

  if (!isFoldLikeViewport) return SERVER_SIDEBAR_MAX_WIDTH;

  const proportionalWidth =
    Math.round((width * FOLD_LIKE_SIDEBAR_VIEWPORT_RATIO) / RESIZE_STEP_PX) * RESIZE_STEP_PX;

  return Math.min(
    FOLD_LIKE_SIDEBAR_MAX_WIDTH,
    Math.max(SERVER_SIDEBAR_DEFAULT_WIDTH, proportionalWidth)
  );
}
