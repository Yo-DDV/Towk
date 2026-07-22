import type { Track } from 'livekit-client';
import type { PresenceStatus } from '$lib/render/types';

export type CallFullscreenMediaKind = 'camera' | 'screen';

export type CallFullscreenMedia = {
  roomId: string;
  participantKey: string;
  kind: CallFullscreenMediaKind;
  track: Track;
  name: string;
  user: {
    id: string;
    login: string;
    displayName: string;
    avatarUrl: string | null;
    presenceStatus: PresenceStatus;
  };
  onClose?: () => void;
};

let current = $state.raw<CallFullscreenMedia | null>(null);

export const callFullscreenMedia = {
  get current(): CallFullscreenMedia | null {
    return current;
  },

  get isOpen(): boolean {
    return current !== null;
  },

  open(media: CallFullscreenMedia): void {
    current?.onClose?.();
    current = media;
  },

  close(): void {
    current?.onClose?.();
    current = null;
  },

  closeForRoom(roomId: string): void {
    if (current?.roomId === roomId) this.close();
  }
};
