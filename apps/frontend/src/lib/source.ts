export const SOURCE_REPOSITORY_URL = 'https://github.com/Yo-DDV/towk';

const SEMVER_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DEVELOPMENT_COMMIT = /(?:^|-)dev-([0-9a-f]{7,40})$/i;

/** Return the corresponding-source URL for a version reported by the Towk server. */
export function sourcePathForVersion(version: string): string {
  const normalized = version.trim().replace(/^v/, '');
  const developmentCommit = normalized.match(DEVELOPMENT_COMMIT)?.[1];

  if (developmentCommit) {
    return `/commit/${developmentCommit}`;
  }
  if (SEMVER_VERSION.test(normalized)) {
    return `/tree/v${normalized}`;
  }
  return '';
}

export function sourceUrlForVersion(version: string): string {
  const path = sourcePathForVersion(version);
  if (path) return `${SOURCE_REPOSITORY_URL}${path}`;
  return SOURCE_REPOSITORY_URL;
}
