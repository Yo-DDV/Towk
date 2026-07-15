import { describe, expect, it } from 'vitest';
import { resolveFrontendBuildVersion } from './buildVersion.js';

describe('resolveFrontendBuildVersion', () => {
  it('uses the source revision instead of the static package version', () => {
    expect(
      resolveFrontendBuildVersion({
        gitRevision: '596acffb9e267947a95fa9f96680eb1f84bbf86d',
        packageVersion: '0.5.0'
      })
    ).toBe('596acffb9e267947a95fa9f96680eb1f84bbf86d');
  });

  it('prefers an explicit reproducible-build revision', () => {
    expect(
      resolveFrontendBuildVersion({
        explicitRevision: 'release-source-123',
        gitRevision: '596acffb',
        packageVersion: '0.5.0'
      })
    ).toBe('release-source-123');
  });

  it('falls back to the package version outside a Git checkout', () => {
    expect(resolveFrontendBuildVersion({ packageVersion: '0.5.0' })).toBe('0.5.0');
  });
});
