export type PwaLaunchParams = {
  targetURL?: string;
};

export type PwaLaunchQueue = {
  setConsumer: (consumer: (params: PwaLaunchParams) => void | Promise<void>) => void;
};

type LaunchWindow = Window & { launchQueue?: PwaLaunchQueue };

export function safeLaunchPath(targetURL: string | undefined, origin: string): string | null {
  if (!targetURL) return null;
  try {
    const target = new URL(targetURL, origin);
    if (target.origin !== origin) return null;
    if (target.pathname !== '/' && !target.pathname.startsWith('/chat')) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

export function registerPwaLaunchHandler(
  navigate: (path: string) => void | Promise<void>,
  launchWindow: LaunchWindow = window
): boolean {
  if (!launchWindow.launchQueue) return false;
  launchWindow.launchQueue.setConsumer(async ({ targetURL }) => {
    const path = safeLaunchPath(targetURL, launchWindow.location.origin);
    if (path) await navigate(path);
  });
  return true;
}
