import { describe, expect, it } from 'vitest';
import { isAppleMobileDevice, isInstalledPwa, type InstallEnvironment } from './installPrompt';

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

  it('recognizes standards and Apple standalone modes', () => {
    expect(isInstalledPwa(environment({ displayModeStandalone: true }))).toBe(true);
    expect(isInstalledPwa(environment({ standalone: true }))).toBe(true);
    expect(isInstalledPwa(environment())).toBe(false);
  });
});
