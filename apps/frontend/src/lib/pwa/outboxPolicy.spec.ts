import { describe, expect, it } from 'vitest';
import {
  MESSAGE_CREATE_IDEMPOTENCY_CAPABILITY,
  supportsMessageCreateIdempotency
} from './outboxPolicy';

describe('outbox capability policy', () => {
  it('requires the exact advertised idempotency capability', () => {
    expect(
      supportsMessageCreateIdempotency({
        capabilities: [MESSAGE_CREATE_IDEMPOTENCY_CAPABILITY]
      })
    ).toBe(true);
    expect(supportsMessageCreateIdempotency({ capabilities: [] })).toBe(false);
    expect(supportsMessageCreateIdempotency({ capabilities: ['future-capability'] })).toBe(false);
    expect(supportsMessageCreateIdempotency(undefined)).toBe(false);
  });
});
