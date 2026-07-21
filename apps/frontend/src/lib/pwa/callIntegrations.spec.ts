import { describe, expect, it, vi } from 'vitest';
import {
  CallMediaSessionController,
  CallWakeLockController,
  selectCallIntegrationCandidate
} from './callIntegrations';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('call integration ownership', () => {
  const candidate = (
    id: string,
    state: { connected?: boolean; reconnecting?: boolean; isInAnyCall?: boolean }
  ) => ({
    id,
    call: {
      connected: state.connected ?? false,
      reconnecting: state.reconnecting ?? false,
      isInAnyCall: state.isInAnyCall ?? false
    }
  });

  it('prefers a connected call over an earlier reconnecting server', () => {
    const selected = selectCallIntegrationCandidate([
      candidate('recovering', { reconnecting: true, isInAnyCall: true }),
      candidate('connected', { connected: true, isInAnyCall: true })
    ]);

    expect(selected?.id).toBe('connected');
  });

  it('keeps a reconnecting call selected when no server is connected', () => {
    const selected = selectCallIntegrationCandidate([
      candidate('joining', { isInAnyCall: true }),
      candidate('recovering', { reconnecting: true, isInAnyCall: true })
    ]);

    expect(selected?.id).toBe('recovering');
  });

  it('keeps an active join intent selected and ignores inactive servers', () => {
    expect(
      selectCallIntegrationCandidate([
        candidate('inactive', {}),
        candidate('joining', { isInAnyCall: true })
      ])?.id
    ).toBe('joining');
    expect(selectCallIntegrationCandidate([candidate('inactive', {})])).toBeNull();
  });
});

describe('call screen wake lock', () => {
  it('holds a visible active call and releases it when the call ends', async () => {
    const listeners = new Map<string, () => void>();
    const documentLike = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type)
    };
    const sentinel = {
      released: false,
      release: vi.fn(async () => {
        sentinel.released = true;
      }),
      addEventListener: vi.fn()
    };
    const request = vi.fn(async () => sentinel);
    const controller = new CallWakeLockController(documentLike, { wakeLock: { request } });

    controller.sync(true);
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    controller.sync(false);
    await flush();
    expect(sentinel.release).toHaveBeenCalledOnce();
    await controller.dispose();
  });

  it('releases in the background and reacquires after visibility returns', async () => {
    const listeners = new Map<string, () => void>();
    const documentLike = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type)
    };
    const sentinels = [0, 1].map(() => ({
      released: false,
      release: vi.fn(async function (this: { released: boolean }) {
        this.released = true;
      }),
      addEventListener: vi.fn()
    }));
    const request = vi.fn(async () => sentinels[request.mock.calls.length - 1]!);
    const controller = new CallWakeLockController(documentLike, { wakeLock: { request } });

    controller.sync(true);
    await flush();
    documentLike.visibilityState = 'hidden';
    listeners.get('visibilitychange')?.();
    await flush();
    expect(sentinels[0]?.release).toHaveBeenCalledOnce();
    documentLike.visibilityState = 'visible';
    listeners.get('visibilitychange')?.();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    await controller.dispose();
  });
});

describe('call Media Session integration', () => {
  it('publishes call metadata, device state and OS call controls', async () => {
    const handlers = new Map<string, (() => void) | null>();
    const mediaSession = {
      metadata: null,
      playbackState: 'none' as MediaSessionPlaybackState,
      setActionHandler: vi.fn((action: string, handler: (() => void) | null) =>
        handlers.set(action, handler)
      ),
      setCameraActive: vi.fn(),
      setMicrophoneActive: vi.fn()
    };
    const hangup = vi.fn();
    const toggleCamera = vi.fn();
    const toggleMicrophone = vi.fn();
    const controller = new CallMediaSessionController(
      mediaSession,
      (init) => init as unknown as MediaMetadata
    );

    controller.sync({
      title: 'Call in General',
      artist: 'Towk server',
      cameraActive: true,
      microphoneActive: false,
      onHangup: hangup,
      onToggleCamera: toggleCamera,
      onToggleMicrophone: toggleMicrophone
    });
    handlers.get('hangup')?.();
    handlers.get('togglecamera')?.();
    handlers.get('togglemicrophone')?.();
    await flush();

    expect(mediaSession.metadata).toEqual({
      title: 'Call in General',
      artist: 'Towk server',
      album: 'Towk'
    });
    expect(mediaSession.playbackState).toBe('playing');
    expect(mediaSession.setCameraActive).toHaveBeenCalledWith(true);
    expect(mediaSession.setMicrophoneActive).toHaveBeenCalledWith(false);
    expect(hangup).toHaveBeenCalledOnce();
    expect(toggleCamera).toHaveBeenCalledOnce();
    expect(toggleMicrophone).toHaveBeenCalledOnce();
  });

  it('clears metadata and handlers after leaving', () => {
    const mediaSession = {
      metadata: {} as MediaMetadata | null,
      playbackState: 'playing' as MediaSessionPlaybackState,
      setActionHandler: vi.fn(),
      setCameraActive: vi.fn(),
      setMicrophoneActive: vi.fn()
    };
    const controller = new CallMediaSessionController(mediaSession);

    controller.sync(null);

    expect(mediaSession.metadata).toBeNull();
    expect(mediaSession.playbackState).toBe('none');
    expect(mediaSession.setActionHandler).toHaveBeenCalledTimes(3);
    expect(mediaSession.setCameraActive).toHaveBeenCalledWith(false);
    expect(mediaSession.setMicrophoneActive).toHaveBeenCalledWith(false);
  });

  it('keeps call actions usable when metadata support throws', () => {
    const mediaSession = {
      metadata: null,
      playbackState: 'none' as MediaSessionPlaybackState,
      setActionHandler: vi.fn()
    };
    const controller = new CallMediaSessionController(mediaSession, () => {
      throw new Error('metadata unavailable');
    });

    expect(() =>
      controller.sync({
        title: 'Call',
        artist: 'Server',
        cameraActive: false,
        microphoneActive: true,
        onHangup: vi.fn(),
        onToggleCamera: vi.fn(),
        onToggleMicrophone: vi.fn()
      })
    ).not.toThrow();
    expect(mediaSession.setActionHandler).toHaveBeenCalledTimes(3);
  });
});
