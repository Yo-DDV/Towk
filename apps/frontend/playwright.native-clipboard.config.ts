/// <reference types="node" />
import { defineConfig, type BrowserName, type Project } from '@playwright/test';

type NativeClipboardTarget = 'chromium' | 'chrome' | 'msedge' | 'firefox' | 'webkit';

function projectFor(target: NativeClipboardTarget): Project {
  let browserName: BrowserName;
  let channel: 'chrome' | 'msedge' | undefined;
  switch (target) {
    case 'chrome':
      browserName = 'chromium';
      channel = 'chrome';
      break;
    case 'msedge':
      browserName = 'chromium';
      channel = 'msedge';
      break;
    case 'firefox':
    case 'webkit':
      browserName = target;
      break;
    default:
      browserName = 'chromium';
  }
  return { name: target, use: { browserName, channel } };
}

const supportedTargets = new Set<NativeClipboardTarget>([
  'chromium',
  'chrome',
  'msedge',
  'firefox',
  'webkit'
]);
const targets = (process.env.NATIVE_CLIPBOARD_TARGETS ?? 'chromium')
  .split(',')
  .map((target) => target.trim())
  .filter(Boolean)
  .map((target) => {
    if (!supportedTargets.has(target as NativeClipboardTarget)) {
      throw new Error(`Unsupported NATIVE_CLIPBOARD_TARGETS entry: ${target}`);
    }
    return target as NativeClipboardTarget;
  });

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  testDir: 'e2e',
  testMatch: 'native-file-clipboard.test.ts',
  fullyParallel: false,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-native' }]],
  timeout: 60_000,
  workers: 1,
  expect: { timeout: 15_000 },
  projects: targets.map(projectFor),
  use: {
    headless: false,
    trace: 'retain-on-failure'
  }
});
