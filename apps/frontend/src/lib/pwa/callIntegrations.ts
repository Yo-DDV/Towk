export type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (
    type: 'release',
    listener: () => void,
    options?: AddEventListenerOptions
  ) => void;
};

export type WakeLockNavigatorLike = {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

export type VisibilityDocumentLike = {
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
};

export class CallWakeLockController {
  #sentinel: WakeLockSentinelLike | null = null;
  #request: Promise<void> | null = null;
  #desired = false;
  #disposed = false;
  #onVisibility = () => void this.#reconcile();

  constructor(
    private readonly documentLike: VisibilityDocumentLike,
    private readonly navigatorLike: WakeLockNavigatorLike
  ) {
    documentLike.addEventListener('visibilitychange', this.#onVisibility);
  }

  sync(active: boolean): void {
    this.#desired = active;
    void this.#reconcile();
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#desired = false;
    this.documentLike.removeEventListener('visibilitychange', this.#onVisibility);
    await this.#release();
  }

  async #reconcile(): Promise<void> {
    if (this.#disposed || !this.#desired || this.documentLike.visibilityState !== 'visible') {
      await this.#release();
      return;
    }
    if (
      !this.navigatorLike.wakeLock ||
      (this.#sentinel && !this.#sentinel.released) ||
      this.#request
    ) {
      return;
    }

    this.#request = this.navigatorLike.wakeLock
      .request('screen')
      .then(async (sentinel) => {
        if (this.#disposed || !this.#desired || this.documentLike.visibilityState !== 'visible') {
          await sentinel.release();
          return;
        }
        this.#sentinel = sentinel;
        sentinel.addEventListener(
          'release',
          () => {
            if (this.#sentinel === sentinel) this.#sentinel = null;
          },
          { once: true }
        );
      })
      .catch(() => undefined)
      .finally(() => {
        this.#request = null;
      });
    await this.#request;
  }

  async #release(): Promise<void> {
    const sentinel = this.#sentinel;
    this.#sentinel = null;
    if (sentinel && !sentinel.released) await sentinel.release().catch(() => undefined);
  }
}

type CallMediaAction = 'hangup' | 'togglecamera' | 'togglemicrophone';

export type CallMediaSessionLike = {
  metadata: MediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler: (action: CallMediaAction, handler: (() => void) | null) => void;
  setCameraActive?: (active: boolean) => void;
  setMicrophoneActive?: (active: boolean) => void;
};

export type CallMediaSessionState = {
  title: string;
  artist: string;
  cameraActive: boolean;
  microphoneActive: boolean;
  onHangup: () => void | Promise<void>;
  onToggleCamera: () => void | Promise<void>;
  onToggleMicrophone: () => void | Promise<void>;
};

export class CallMediaSessionController {
  constructor(
    private readonly mediaSession: CallMediaSessionLike | undefined,
    private readonly createMetadata: (init: MediaMetadataInit) => MediaMetadata = (init) =>
      new MediaMetadata(init)
  ) {}

  sync(call: CallMediaSessionState | null): void {
    if (!this.mediaSession) return;
    if (!call) {
      this.#setMetadata(null);
      this.#setPlaybackState('none');
      this.#setHandler('hangup', null);
      this.#setHandler('togglecamera', null);
      this.#setHandler('togglemicrophone', null);
      return;
    }

    this.#setMetadata({
      title: call.title,
      artist: call.artist,
      album: 'Towk'
    });
    this.#setPlaybackState('playing');
    this.#setHandler('hangup', () => call.onHangup());
    this.#setHandler('togglecamera', () => call.onToggleCamera());
    this.#setHandler('togglemicrophone', () => call.onToggleMicrophone());
    this.#setCameraActive(call.cameraActive);
    this.#setMicrophoneActive(call.microphoneActive);
  }

  #setMetadata(init: MediaMetadataInit | null): void {
    try {
      this.mediaSession!.metadata = init ? this.createMetadata(init) : null;
    } catch {
      // Metadata support varies independently from Media Session actions.
    }
  }

  #setPlaybackState(state: MediaSessionPlaybackState): void {
    try {
      this.mediaSession!.playbackState = state;
    } catch {
      // Optional browser integration.
    }
  }

  #setHandler(action: CallMediaAction, handler: (() => void | Promise<void>) | null): void {
    try {
      this.mediaSession?.setActionHandler(
        action,
        handler
          ? () => {
              void Promise.resolve(handler()).catch(() => undefined);
            }
          : null
      );
    } catch {
      // Unsupported call-specific actions are optional progressive enhancements.
    }
  }

  #setCameraActive(active: boolean): void {
    try {
      this.mediaSession?.setCameraActive?.(active);
    } catch {
      // Optional browser integration.
    }
  }

  #setMicrophoneActive(active: boolean): void {
    try {
      this.mediaSession?.setMicrophoneActive?.(active);
    } catch {
      // Optional browser integration.
    }
  }
}
