import { describe, expect, it } from 'vitest';
import { SOURCE_REPOSITORY_URL, sourceUrlForVersion } from './source';

describe('sourceUrlForVersion', () => {
  it('links development builds to their exact commit', () => {
    expect(sourceUrlForVersion('0.5.0-dev-cbe8f0ee')).toBe(
      `${SOURCE_REPOSITORY_URL}/commit/cbe8f0ee`
    );
  });

  it('links stable and prerelease builds to their exact tag', () => {
    expect(sourceUrlForVersion('0.5.0')).toBe(`${SOURCE_REPOSITORY_URL}/tree/v0.5.0`);
    expect(sourceUrlForVersion('v0.6.0-beta.1')).toBe(
      `${SOURCE_REPOSITORY_URL}/tree/v0.6.0-beta.1`
    );
  });

  it('falls back to the repository for unknown build identifiers', () => {
    expect(sourceUrlForVersion('dev')).toBe(SOURCE_REPOSITORY_URL);
    expect(sourceUrlForVersion('')).toBe(SOURCE_REPOSITORY_URL);
  });
});
