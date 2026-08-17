export type DesktopMotionPolicy = 'full' | 'reduced' | 'hidden';

export interface ComposerMotionPolicyInput {
  focused: boolean;
  documentVisible: boolean;
  reducedMotion: boolean;
  forcedColors: boolean;
  desktopPolicy?: DesktopMotionPolicy | null;
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

export function composerHaloKeyframes(): Keyframe[] {
  return [{ strokeDashoffset: '0' }, { strokeDashoffset: '-1' }];
}
