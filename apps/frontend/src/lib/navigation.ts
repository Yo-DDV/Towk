import { serverRegistry } from '$lib/state/server/registry.svelte';

/** URL segment used for the home (origin) server. */
const HOME_SEGMENT = '-';

/**
 * Convert an internal server registry ID to a URL segment.
 * Origin server → "-", remote → URL host (hostname plus non-default port).
 */
export function serverIdToSegment(serverId: string): string {
	if (serverRegistry.isOriginServer(serverId)) return HOME_SEGMENT;

	const server = serverRegistry.getServer(serverId);
	if (!server) return HOME_SEGMENT;

	try {
		return new URL(server.url).host;
	} catch {
		return HOME_SEGMENT;
	}
}

/**
 * Convert a URL segment back to an internal server registry ID.
 * "-" → origin server, host → exact server URL host. A legacy hostname-only
 * segment remains accepted only when it identifies exactly one registration.
 */
export function segmentToServerId(segment: string): string | null {
	if (segment === HOME_SEGMENT) {
		return serverRegistry.originServer?.id ?? null;
	}

	const exactMatches = serverRegistry.servers.filter((server) => {
		try {
			return new URL(server.url).host === segment;
		} catch {
			return false;
		}
	});
	if (exactMatches.length === 1) return exactMatches[0].id;
	if (exactMatches.length > 1) return null;

	// Backward compatibility for links generated before route segments carried
	// non-default ports. Never guess when multiple registrations share a host.
	const legacyMatches = serverRegistry.servers.filter((server) => {
		try {
			return new URL(server.url).hostname === segment;
		} catch {
			return false;
		}
	});
	if (legacyMatches.length === 1) return legacyMatches[0].id;

	return null;
}
