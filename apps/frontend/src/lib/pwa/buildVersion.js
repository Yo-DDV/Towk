/**
 * Resolve the deployment identity used by SvelteKit's version poller and the
 * service-worker cache. A package version alone is not unique across patches.
 *
 * @param {{
 *   explicitRevision?: string;
 *   gitRevision?: string;
 *   packageVersion?: string;
 * }} versions
 */
export function resolveFrontendBuildVersion({ explicitRevision, gitRevision, packageVersion }) {
  for (const candidate of [explicitRevision, gitRevision, packageVersion]) {
    const normalized = candidate?.trim();
    if (normalized) return normalized;
  }
  return 'dev';
}
