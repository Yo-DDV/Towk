import { prefersReducedMotion } from 'svelte/motion';

export const MOTION_DURATION = {
  instant: 0,
  fast: 100,
  base: 150,
  expressive: 200,
  delayedLoading: 140
} as const;

export function motionDuration(duration: number): number {
  return prefersReducedMotion.current ? MOTION_DURATION.instant : duration;
}

export function motionEnabled(): boolean {
  return !prefersReducedMotion.current;
}

export function delayedLoadingVisible(
  loading: () => boolean,
  delay: number = MOTION_DURATION.delayedLoading
) {
  let visible = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (loading()) {
      if (prefersReducedMotion.current || delay <= 0) {
        visible = true;
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (loading()) visible = true;
      }, delay);
      return () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
    }

    visible = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });

  return {
    get current() {
      return visible;
    }
  };
}
