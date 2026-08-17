export type DesktopMotionPolicy = 'full' | 'reduced' | 'hidden';

export interface ComposerMotionPolicyInput {
  focused: boolean;
  documentVisible: boolean;
  reducedMotion: boolean;
  forcedColors: boolean;
  desktopPolicy?: DesktopMotionPolicy | null;
}

export interface ComposerMotionPoint {
  x: number;
  y: number;
}

export function normalizeDesktopMotionPolicy(value: unknown): DesktopMotionPolicy {
  return value === 'reduced' || value === 'hidden' ? value : 'full';
}

export function shouldAnimateComposer(input: ComposerMotionPolicyInput): boolean {
  const desktopPolicy = normalizeDesktopMotionPolicy(input.desktopPolicy);
  return (
    input.focused &&
    input.documentVisible &&
    !input.reducedMotion &&
    !input.forcedColors &&
    desktopPolicy === 'full'
  );
}

function normalizeProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return ((progress % 1) + 1) % 1;
}

/**
 * Returns a point at a uniform distance along a clockwise rounded-rectangle path.
 * The function is allocation-free and safe for degenerate dimensions.
 */
export function roundedRectPointAt(
  width: number,
  height: number,
  radius: number,
  progress: number
): ComposerMotionPoint {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;

  if (safeWidth === 0 || safeHeight === 0) {
    return { x: safeWidth / 2, y: safeHeight / 2 };
  }

  const safeRadius = Number.isFinite(radius)
    ? Math.max(0, Math.min(radius, safeWidth / 2, safeHeight / 2))
    : 0;
  const horizontal = Math.max(0, safeWidth - safeRadius * 2);
  const vertical = Math.max(0, safeHeight - safeRadius * 2);
  const quarterArc = (Math.PI * safeRadius) / 2;
  const perimeter = horizontal * 2 + vertical * 2 + quarterArc * 4;

  if (perimeter <= 0) {
    return { x: safeWidth / 2, y: safeHeight / 2 };
  }

  let distance = normalizeProgress(progress) * perimeter;

  if (distance <= horizontal) {
    return { x: safeRadius + distance, y: 0 };
  }
  distance -= horizontal;

  if (safeRadius > 0 && distance <= quarterArc) {
    const angle = -Math.PI / 2 + distance / safeRadius;
    return {
      x: safeWidth - safeRadius + Math.cos(angle) * safeRadius,
      y: safeRadius + Math.sin(angle) * safeRadius
    };
  }
  distance -= quarterArc;

  if (distance <= vertical) {
    return { x: safeWidth, y: safeRadius + distance };
  }
  distance -= vertical;

  if (safeRadius > 0 && distance <= quarterArc) {
    const angle = distance / safeRadius;
    return {
      x: safeWidth - safeRadius + Math.cos(angle) * safeRadius,
      y: safeHeight - safeRadius + Math.sin(angle) * safeRadius
    };
  }
  distance -= quarterArc;

  if (distance <= horizontal) {
    return { x: safeWidth - safeRadius - distance, y: safeHeight };
  }
  distance -= horizontal;

  if (safeRadius > 0 && distance <= quarterArc) {
    const angle = Math.PI / 2 + distance / safeRadius;
    return {
      x: safeRadius + Math.cos(angle) * safeRadius,
      y: safeHeight - safeRadius + Math.sin(angle) * safeRadius
    };
  }
  distance -= quarterArc;

  if (distance <= vertical) {
    return { x: 0, y: safeHeight - safeRadius - distance };
  }
  distance -= vertical;

  if (safeRadius > 0) {
    const angle = Math.PI + Math.min(distance, quarterArc) / safeRadius;
    return {
      x: safeRadius + Math.cos(angle) * safeRadius,
      y: safeRadius + Math.sin(angle) * safeRadius
    };
  }

  return { x: 0, y: 0 };
}

export function roundedRectPerimeterPoints(
  width: number,
  height: number,
  radius: number,
  sampleCount = 64
): ComposerMotionPoint[] {
  const samples = Number.isFinite(sampleCount) ? Math.max(8, Math.floor(sampleCount)) : 64;
  return Array.from({ length: samples + 1 }, (_, index) =>
    roundedRectPointAt(width, height, radius, index / samples)
  );
}

export function composerOrbitKeyframes(
  width: number,
  height: number,
  radius: number,
  sampleCount = 64,
  particleRadius = 2.5
): Keyframe[] {
  const points = roundedRectPerimeterPoints(width, height, radius, sampleCount);
  const denominator = Math.max(1, points.length - 1);
  return points.map((point, index) => ({
    offset: index / denominator,
    transform: `translate3d(${point.x - particleRadius}px, ${point.y - particleRadius}px, 0)`
  }));
}
