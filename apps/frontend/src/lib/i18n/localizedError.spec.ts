import { Code, ConnectError } from '@connectrpc/connect';
import { beforeEach, describe, expect, it } from 'vitest';

import { setLocale } from './runtime';
import { localizedErrorMessage } from './localizedError';

describe('localizedErrorMessage', () => {
  beforeEach(async () => setLocale('en'));

  it('never exposes a raw ConnectRPC message', () => {
    const error = new ConnectError('sensitive backend detail', Code.PermissionDenied);
    expect(localizedErrorMessage(error, 'Fallback')).toBe(
      'You do not have permission to perform this action.'
    );
  });

  it('maps network and timeout failures', () => {
    expect(localizedErrorMessage(new TypeError('Failed to fetch'), 'Fallback')).toBe(
      'Network error. Please try again.'
    );
    expect(
      localizedErrorMessage(new ConnectError('deadline', Code.DeadlineExceeded), 'Fallback')
    ).toBe('The request timed out. Please try again.');
  });

  it('keeps the caller fallback for unknown failures', () => {
    expect(localizedErrorMessage(new Error('raw detail'), 'Context failed')).toBe('Context failed');
  });

  it('uses the active locale', async () => {
    await setLocale('fr');
    expect(
      localizedErrorMessage(new ConnectError('not found', Code.NotFound), 'Échec contextuel')
    ).toBe('L’élément demandé est introuvable.');
  });
});
