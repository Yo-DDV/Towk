import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCodeVerifier, generateState } from './pkce';

describe('PKCE randomness', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('rejects bytes outside the unbiased charset range', () => {
		let call = 0;
		vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
			const bytes = array as Uint8Array;
			bytes.fill(call++ === 0 ? 255 : 0);
			return array;
		});

		const verifier = generateCodeVerifier();

		expect(verifier).toBe('A'.repeat(64));
		expect(globalThis.crypto.getRandomValues).toHaveBeenCalledTimes(2);
	});

	it('produces RFC 7636 verifier characters and length', () => {
		const verifier = generateCodeVerifier();

		expect(verifier).toHaveLength(64);
		expect(verifier).toMatch(/^[A-Za-z0-9._~-]+$/);
	});

	it('keeps state as 32 bytes encoded without padding', () => {
		const state = generateState();

		expect(state).toHaveLength(43);
		expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});
