export type PwaLaunchParams = {
  targetURL?: string;
  files?: Array<{ getFile: () => Promise<File> }>;
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
  options: {
    launchWindow?: LaunchWindow;
    importFiles?: (files: File[]) => Promise<string | null>;
  } = {}
): boolean {
  const launchWindow = (options.launchWindow ?? window) as LaunchWindow;
  if (!launchWindow.launchQueue) return false;
  launchWindow.launchQueue.setConsumer(async ({ targetURL, files }) => {
    if (files?.length && options.importFiles) {
      const path = await options.importFiles(
        await Promise.all(files.map((handle) => handle.getFile()))
      );
      if (path) {
        await navigate(path);
        return;
      }
    }
    const path = safeLaunchPath(targetURL, launchWindow.location.origin);
    if (path) await navigate(path);
  });
  return true;
}
