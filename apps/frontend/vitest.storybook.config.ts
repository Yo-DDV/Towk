import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { defineConfig, defineProject, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.join(dirname, '.storybook');

function storybookProject(name: string, theme: 'light' | 'dark') {
  return defineProject({
    extends: true,
    plugins: [
      storybookTest({
        configDir,
        initialGlobals: { theme },
        tags: {
          include: ['design-system-test'],
          exclude: [],
          skip: []
        }
      })
    ],
    test: {
      name,
      browser: {
        enabled: true,
        provider: playwright(),
        headless: true,
        instances: [{ browser: 'chromium' }]
      },
      setupFiles: ['./.storybook/vitest.setup.ts']
    }
  });
}

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        storybookProject('storybook-light', 'light'),
        storybookProject('storybook-dark', 'dark')
      ]
    }
  })
);
