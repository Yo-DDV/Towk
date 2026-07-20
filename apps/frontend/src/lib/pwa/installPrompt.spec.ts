import { describe, expect, it } from 'vitest';
import {
  detectInstallBrowser,
  detectInstallPlatform,
  isAppleMobileDevice,
  isInstalledPwa,
  selectInstallGuide,
  type InstallEnvironment
} from './installPrompt';

function environment(overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return {
    userAgent: 'Mozilla/5.0',
    platform: 'Linux x86_64',
    maxTouchPoints: 0,
    displayModeStandalone: false,
    ...overrides
  };
}

describe('PWA install environment', () => {
  it('detects iPhone, iPad and touch-mode iPadOS', () => {
    expect(isAppleMobileDevice(environment({ userAgent: 'Mozilla/5.0 (iPhone)' }))).toBe(true);
    expect(isAppleMobileDevice(environment({ userAgent: 'Mozilla/5.0 (iPad)' }))).toBe(true);
    expect(isAppleMobileDevice(environment({ platform: 'MacIntel', maxTouchPoints: 5 }))).toBe(
      true
    );
  });

  it('does not mistake a regular Mac or Linux browser for iOS', () => {
    expect(isAppleMobileDevice(environment({ platform: 'MacIntel' }))).toBe(false);
    expect(isAppleMobileDevice(environment())).toBe(false);
  });

  it('recognizes installed app display modes and Apple standalone mode', () => {
    expect(isInstalledPwa(environment({ displayModeStandalone: true }))).toBe(true);
    expect(isInstalledPwa(environment({ displayModeFullscreen: true }))).toBe(true);
    expect(isInstalledPwa(environment({ displayModeMinimalUi: true }))).toBe(true);
    expect(isInstalledPwa(environment({ displayModeWindowControlsOverlay: true }))).toBe(true);
    expect(isInstalledPwa(environment({ standalone: true }))).toBe(true);
    expect(isInstalledPwa(environment())).toBe(false);
  });

  it.each([
    [
      'iOS',
      environment({
        userAgent:
          'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
      }),
      'ios'
    ],
    [
      'iPadOS desktop UA',
      environment({
        userAgent: 'Mozilla/5.0 (Macintosh)',
        platform: 'MacIntel',
        maxTouchPoints: 5
      }),
      'ios'
    ],
    [
      'Android',
      environment({
        userAgent:
          'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36'
      }),
      'android'
    ],
    [
      'ChromeOS',
      environment({
        userAgent:
          'Mozilla/5.0 (X11; CrOS x86_64 16093.68.0) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36'
      }),
      'chromeos'
    ],
    ['Windows', environment({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'windows'],
    [
      'macOS',
      environment({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel'
      }),
      'macos'
    ],
    ['Linux', environment(), 'linux']
  ] as const)('detects the %s platform', (_label, input, expected) => {
    expect(detectInstallPlatform(input)).toBe(expected);
  });

  it.each([
    [
      'iOS Chrome',
      'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/141.0 Mobile/15E148 Safari/604.1',
      'chrome'
    ],
    [
      'iOS Safari',
      'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      'safari'
    ],
    [
      'Android Edge',
      'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0',
      'edge'
    ],
    [
      'Samsung Internet',
      'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36',
      'samsung'
    ],
    [
      'Firefox',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
      'firefox'
    ],
    [
      'Opera',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 OPR/122.0',
      'opera'
    ],
    [
      'Chrome',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36',
      'chrome'
    ]
  ] as const)('detects %s before overlapping Chromium tokens', (_label, userAgent, expected) => {
    expect(detectInstallBrowser(environment({ userAgent }))).toBe(expected);
  });

  it('selects platform-specific manual installation guides', () => {
    expect(selectInstallGuide('ios', 'safari')).toBe('ios_safari');
    expect(selectInstallGuide('ios', 'chrome')).toBe('ios_chrome');
    expect(selectInstallGuide('ios', 'firefox')).toBe('ios_other');
    expect(selectInstallGuide('android', 'firefox')).toBe('android_firefox');
    expect(selectInstallGuide('android', 'samsung')).toBe('android_chromium');
    expect(selectInstallGuide('windows', 'firefox')).toBe('windows_firefox');
    expect(selectInstallGuide('macos', 'safari')).toBe('macos_safari');
    expect(selectInstallGuide('linux', 'chrome')).toBe('desktop_chromium');
    expect(selectInstallGuide('linux', 'firefox')).toBe('desktop_firefox_unsupported');
    expect(selectInstallGuide('macos', 'firefox')).toBe('desktop_firefox_unsupported');
  });
});
