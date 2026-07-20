export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export const INSTALL_PROMPT_CAPTURED_EVENT = 'towk:pwa-install-prompt-captured';
export const INSTALL_PROMPT_CLEARED_EVENT = 'towk:pwa-install-prompt-cleared';

type InstallPromptWindow = Window & {
  __towkInstallPrompt?: BeforeInstallPromptEvent | null;
};

export function getCapturedInstallPromptEvent(): BeforeInstallPromptEvent | null {
  if (typeof window === 'undefined') return null;
  return (window as InstallPromptWindow).__towkInstallPrompt ?? null;
}

export function clearCapturedInstallPromptEvent(expected?: BeforeInstallPromptEvent): void {
  if (typeof window === 'undefined') return;
  const target = window as InstallPromptWindow;
  if (expected && target.__towkInstallPrompt !== expected) return;
  target.__towkInstallPrompt = null;
}

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

export type InstallPlatform =
  | 'ios'
  | 'android'
  | 'chromeos'
  | 'windows'
  | 'macos'
  | 'linux'
  | 'other';

export type InstallBrowser =
  | 'safari'
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'samsung'
  | 'opera'
  | 'other';

export type InstallGuide =
  | 'ios_safari'
  | 'ios_chrome'
  | 'ios_other'
  | 'android_firefox'
  | 'android_chromium'
  | 'android_other'
  | 'windows_firefox'
  | 'macos_safari'
  | 'desktop_chromium'
  | 'desktop_firefox_unsupported'
  | 'desktop_other';

export function isAppleMobileDevice(environment: InstallEnvironment): boolean {
  return (
    /iPad|iPhone|iPod/u.test(environment.userAgent) ||
    (environment.platform === 'MacIntel' && environment.maxTouchPoints > 1)
  );
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

export function detectInstallPlatform(environment: InstallEnvironment): InstallPlatform {
  const ua = environment.userAgent;
  if (isAppleMobileDevice(environment)) return 'ios';
  if (/Android/u.test(ua)) return 'android';
  if (/CrOS/u.test(ua)) return 'chromeos';
  if (/Windows/u.test(ua) || environment.platform.startsWith('Win')) return 'windows';
  if (/Macintosh|Mac OS X/u.test(ua) || environment.platform.startsWith('Mac')) return 'macos';
  if (/Linux|X11/u.test(ua) || environment.platform.startsWith('Linux')) return 'linux';
  return 'other';
}

export function detectInstallBrowser(environment: InstallEnvironment): InstallBrowser {
  const ua = environment.userAgent;
  if (/SamsungBrowser\//u.test(ua)) return 'samsung';
  if (/EdgA?\/|EdgiOS\//u.test(ua)) return 'edge';
  if (/OPR\/|OPiOS\//u.test(ua)) return 'opera';
  if (/Firefox\/|FxiOS\/|Fennec\//u.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS\/|Chromium\//u.test(ua)) return 'chrome';
  if (/Safari\//u.test(ua)) return 'safari';
  return 'other';
}

export function selectInstallGuide(
  platform: InstallPlatform,
  browser: InstallBrowser
): InstallGuide {
  if (platform === 'ios') {
    if (browser === 'safari') return 'ios_safari';
    if (browser === 'chrome') return 'ios_chrome';
    return 'ios_other';
  }
  if (platform === 'android') {
    if (browser === 'firefox') return 'android_firefox';
    if (['chrome', 'edge', 'samsung', 'opera'].includes(browser)) return 'android_chromium';
    return 'android_other';
  }
  if (platform === 'windows' && browser === 'firefox') return 'windows_firefox';
  if (platform === 'macos' && browser === 'safari') return 'macos_safari';
  if (['chrome', 'edge', 'opera'].includes(browser)) return 'desktop_chromium';
  if (browser === 'firefox' && ['linux', 'macos'].includes(platform)) {
    return 'desktop_firefox_unsupported';
  }
  return 'desktop_other';
}

export function currentInstallEnvironment(): InstallEnvironment {
  const appleNavigator = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: navigator.userAgent ?? '',
    platform: navigator.platform ?? '',
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: appleNavigator.standalone,
    displayModeStandalone: window.matchMedia?.('(display-mode: standalone)').matches === true,
    displayModeFullscreen: window.matchMedia?.('(display-mode: fullscreen)').matches === true,
    displayModeMinimalUi: window.matchMedia?.('(display-mode: minimal-ui)').matches === true,
    displayModeWindowControlsOverlay:
      window.matchMedia?.('(display-mode: window-controls-overlay)').matches === true
  };
}
