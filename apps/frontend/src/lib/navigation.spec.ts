import { afterEach, describe, expect, it } from 'vitest';
import { serverRegistry, type RegisteredServer } from '$lib/state/server/registry.svelte';
import { segmentToServerId, serverIdToSegment } from './navigation';

const originalServers = [...serverRegistry.servers];

function server(id: string, url: string): RegisteredServer {
	return {
		id,
		url,
		name: id,
		iconUrl: null,
		token: 'token',
		userId: 'user',
		userLogin: 'user',
		userDisplayName: 'User',
		userAvatarUrl: null,
		reauthRequiredAt: null,
		capabilities: [],
		addedAt: 1
	};
}

afterEach(() => {
	serverRegistry.servers = [...originalServers];
});

describe('multi-server route segments', () => {
	it('keeps non-default ports so same-host servers remain independently routable', () => {
		serverRegistry.servers = [
			server('primary-port', 'https://chat.example.test:8443'),
			server('secondary-port', 'https://chat.example.test:9443')
		];

		expect(serverIdToSegment('primary-port')).toBe('chat.example.test:8443');
		expect(serverIdToSegment('secondary-port')).toBe('chat.example.test:9443');
		expect(segmentToServerId('chat.example.test:8443')).toBe('primary-port');
		expect(segmentToServerId('chat.example.test:9443')).toBe('secondary-port');
	});

	it('accepts an old hostname-only link when it remains unambiguous', () => {
		serverRegistry.servers = [server('legacy', 'https://legacy.example.test:8443')];

		expect(segmentToServerId('legacy.example.test')).toBe('legacy');
	});

	it('rejects an ambiguous old hostname-only link instead of choosing the wrong server', () => {
		serverRegistry.servers = [
			server('first', 'https://chat.example.test:8443'),
			server('second', 'https://chat.example.test:9443')
		];

		expect(segmentToServerId('chat.example.test')).toBeNull();
	});

	it('preserves bracketed IPv6 hosts with non-default ports', () => {
		serverRegistry.servers = [server('ipv6', 'https://[2001:db8::1]:8443')];

		expect(serverIdToSegment('ipv6')).toBe('[2001:db8::1]:8443');
		expect(segmentToServerId('[2001:db8::1]:8443')).toBe('ipv6');
	});
});
