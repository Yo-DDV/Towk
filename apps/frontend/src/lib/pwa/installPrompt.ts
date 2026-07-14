export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export type InstallEnvironment = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone?: boolean;
  displayModeStandalone: boolean;
};

export function isAppleMobileDevice(environment: InstallEnvironment): boolean {
  return (
    /iPad|iPhone|iPod/u.test(environment.userAgent) ||
    (environment.platform === 'MacIntel' && environment.maxTouchPoints > 1)
  );
}

export function isInstalledPwa(environment: InstallEnvironment): boolean {
  return environment.displayModeStandalone || environment.standalone === true;
}

export function currentInstallEnvironment(): InstallEnvironment {
  const appleNavigator = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: appleNavigator.standalone,
    displayModeStandalone: window.matchMedia?.('(display-mode: standalone)').matches === true
  };
}
