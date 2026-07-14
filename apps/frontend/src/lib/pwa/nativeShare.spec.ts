import { describe, expect, it, vi } from 'vitest';
import { canUseNativeShare, shareTowkMessage } from './nativeShare';

describe('native share', () => {
  const data = { title: 'Towk', text: 'Hello', url: 'https://towk.example/chat/-/R123' };

  it('reports unsupported browsers without calling anything', async () => {
    expect(canUseNativeShare({})).toBe(false);
    await expect(shareTowkMessage(data, {})).resolves.toBe('unsupported');
  });

  it('shares supported payloads', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);

    await expect(shareTowkMessage(data, { share, canShare })).resolves.toBe('shared');
    expect(canShare).toHaveBeenCalledWith(data);
    expect(share).toHaveBeenCalledWith(data);
  });

  it('does not open a native sheet for rejected payloads', async () => {
    const share = vi.fn();

    await expect(shareTowkMessage(data, { share, canShare: () => false })).resolves.toBe(
      'unsupported'
    );
    expect(share).not.toHaveBeenCalled();
  });

  it('distinguishes user cancellation from runtime failure', async () => {
    await expect(
      shareTowkMessage(data, {
        share: () => Promise.reject(new DOMException('cancelled', 'AbortError'))
      })
    ).resolves.toBe('cancelled');
    await expect(
      shareTowkMessage(data, { share: () => Promise.reject(new Error('broken')) })
    ).resolves.toBe('failed');
  });
});
