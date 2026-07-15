import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { execSync } from 'node:child_process';
import { resolveFrontendBuildVersion } from './src/lib/pwa/buildVersion.js';

const precompress = process.env.CHATTO_FRONTEND_PRECOMPRESS === '1';

function buildVersionName() {
  let gitRevision = '';
  try {
    gitRevision = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // Source archives may not include Git metadata.
  }

  return resolveFrontendBuildVersion({
    explicitRevision: process.env.TOWK_FRONTEND_REVISION,
    gitRevision,
    packageVersion: process.env.npm_package_version
  });
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // for more information about preprocessors
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: '200.html',
      precompress
    }),
    version: {
      // Every source revision must expose a distinct version so installed
      // PWAs can detect and activate an updated service worker.
      name: buildVersionName(),
      // Check for new version every 60 seconds
      pollInterval: 60000
    }
  },
  compilerOptions: {
    fragments: 'tree',
    experimental: {
      async: true
    }
  }
};

export default config;
