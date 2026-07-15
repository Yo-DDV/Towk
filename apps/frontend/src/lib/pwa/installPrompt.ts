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
  displayModeFullscreen?: boolean;
  displayModeMinimalUi?: boolean;
  displayModeWindowControlsOverlay?: boolean;
};

export function isAppleMobileDevice(environment: InstallEnvironment): boolean {
  return (
    /iPad|iPhone|iPod/u.test(environment.userAgent) ||
    (environment.platform === 'MacIntel' && environment.maxTouchPoints > 1)
  );
}

export function isAndroidDevice(environment: InstallEnvironment): boolean {
  return /Android/u.test(environment.userAgent);
}

export function isInstalledPwa(environment: InstallEnvironment): boolean {
  return (
    environment.displayModeStandalone ||
    environment.displayModeFullscreen === true ||
    environment.displayModeMinimalUi === true ||
    environment.displayModeWindowControlsOverlay === true ||
    environment.standalone === true
  );
}

export function isLegacyAndroidStandaloneInstall(environment: InstallEnvironment): boolean {
  return (
    isAndroidDevice(environment) &&
    environment.displayModeStandalone &&
    environment.displayModeMinimalUi !== true
  );
}

export function currentInstallEnvironment(): InstallEnvironment {
  const appleNavigator = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: appleNavigator.standalone,
    displayModeStandalone: window.matchMedia?.('(display-mode: standalone)').matches === true,
    displayModeFullscreen: window.matchMedia?.('(display-mode: fullscreen)').matches === true,
    displayModeMinimalUi: window.matchMedia?.('(display-mode: minimal-ui)').matches === true,
    displayModeWindowControlsOverlay:
      window.matchMedia?.('(display-mode: window-controls-overlay)').matches === true
  };
}
