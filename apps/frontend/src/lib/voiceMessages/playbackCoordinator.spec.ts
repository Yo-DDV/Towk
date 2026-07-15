import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimVoiceMessagePlayback, releaseVoiceMessagePlayback } from './playbackCoordinator';

describe('voice message playback coordinator', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pauses the previous player when another voice message starts', () => {
    const pause = vi.fn();
    const first = { pause } as unknown as HTMLAudioElement;
    const second = { pause: vi.fn() } as unknown as HTMLAudioElement;

    claimVoiceMessagePlayback(first);
    claimVoiceMessagePlayback(second);

    expect(pause).toHaveBeenCalledOnce();
    releaseVoiceMessagePlayback(second);
  });
});
