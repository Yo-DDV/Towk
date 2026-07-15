import { beforeEach, describe, expect, it } from 'vitest';
import type { Track } from 'livekit-client';
import { PresenceStatus } from '$lib/render/types';
import { callFullscreenMedia } from './callFullscreenMedia.svelte';

const media = {
  roomId: 'room-1',
  participantKey: 'user-1',
  kind: 'screen' as const,
  track: {} as Track,
  name: "Alice's screen",
  user: {
    id: 'user-1',
    login: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
    presenceStatus: PresenceStatus.Online
  }
};

describe('callFullscreenMedia', () => {
  beforeEach(() => callFullscreenMedia.close());

  it('keeps another room open when a panel is destroyed', () => {
    callFullscreenMedia.open(media);
    callFullscreenMedia.closeForRoom('room-2');
    expect(callFullscreenMedia.current).toBe(media);

    callFullscreenMedia.closeForRoom('room-1');
    expect(callFullscreenMedia.current).toBeNull();
  });
});
