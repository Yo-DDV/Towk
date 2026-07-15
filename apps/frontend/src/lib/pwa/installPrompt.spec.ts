import { describe, expect, it } from 'vitest';
import {
  isAndroidDevice,
  isAppleMobileDevice,
  isInstalledPwa,
  isLegacyAndroidStandaloneInstall,
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

  it('detects Android browsers without matching Apple mobile devices', () => {
    expect(isAndroidDevice(environment({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' }))).toBe(
      true
    );
    expect(isAndroidDevice(environment({ userAgent: 'Mozilla/5.0 (iPhone)' }))).toBe(false);
    expect(isAndroidDevice(environment())).toBe(false);
  });

  it('flags stale Android standalone installs that can show Chrome URL-copy notifications', () => {
    expect(
      isLegacyAndroidStandaloneInstall(
        environment({
          userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141',
          platform: 'Linux armv8l',
          maxTouchPoints: 5,
          displayModeStandalone: true
        })
      )
    ).toBe(true);
  });

  it('does not flag current Android minimal-ui installs or non-Android standalone apps', () => {
    expect(
      isLegacyAndroidStandaloneInstall(
        environment({
          userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141',
          platform: 'Linux armv8l',
          maxTouchPoints: 5,
          displayModeStandalone: false,
          displayModeMinimalUi: true
        })
      )
    ).toBe(false);
    expect(
      isLegacyAndroidStandaloneInstall(
        environment({
          userAgent: 'Mozilla/5.0 (iPhone)',
          displayModeStandalone: true,
          standalone: true
        })
      )
    ).toBe(false);
    expect(isLegacyAndroidStandaloneInstall(environment({ displayModeStandalone: true }))).toBe(
      false
    );
  });
});
