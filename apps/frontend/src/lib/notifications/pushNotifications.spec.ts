import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureRegistered,
  getPushCapability,
  onNotificationClick,
  unsubscribe,
  unsubscribeForSignOut
} from './pushNotifications';
import {
  notificationRoomTargetFromPathname,
  prepareUiForNotificationPath,
  prepareUiForNotificationTarget
} from './notificationNavigationUi';

const mocks = vi.hoisted(() => ({
  createPushNotificationAPI: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
  getLocale: vi.fn(() => 'fr'),
  appUi: {
    disableRoomCallWideFor: vi.fn()
  },
  segmentToServerId: vi.fn((segment: string) => {
    if (segment === '-') return 'origin';
    if (segment === 'remote.example.com') return 'remote';
    return null;
  })
}));

vi.mock('$lib/api-client/pushNotifications', () => ({
  createPushNotificationAPI: mocks.createPushNotificationAPI
}));

vi.mock('$lib/i18n/runtime', () => ({
  getLocale: mocks.getLocale
}));

vi.mock('$lib/state/server/serverConnection.svelte', () => ({
  serverConnectionManager: {
    originClient: {
      connectBaseUrl: 'https://origin.test/api/connect',
      bearerToken: 'origin-token'
    }
  }
}));

vi.mock('$lib/navigation', () => ({
  segmentToServerId: mocks.segmentToServerId
}));

type TestPushSubscription = PushSubscription & {
  unsubscribe: ReturnType<typeof vi.fn>;
};

let permission: NotificationPermission;
let requestPermission: ReturnType<typeof vi.fn>;
let getSubscription: ReturnType<typeof vi.fn>;
let subscribe: ReturnType<typeof vi.fn>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function makeSubscription(
  endpoint: string,
  applicationServerKey?: Uint8Array
): TestPushSubscription {
  return {
    endpoint,
    options: { applicationServerKey: applicationServerKey?.buffer ?? null },
    toJSON: () => ({
      endpoint,
      keys: {
        p256dh: 'p256dh-key',
        auth: 'auth-secret'
      }
    }),
    unsubscribe: vi.fn().mockResolvedValue(true)
  } as unknown as TestPushSubscription;
}

function installPushGlobals() {
  const storage = new Map<string, string>();
  requestPermission = vi.fn(async () => {
    permission = 'granted';
    return permission;
  });
  getSubscription = vi.fn();
  subscribe = vi.fn();
  const getNotifications = vi.fn(async (): Promise<Notification[]> => []);
  const postMessage = vi.fn();
  const setAppBadge = vi.fn(async () => {});
  const clearAppBadge = vi.fn(async () => {});
  const registration = {
    pushManager: {
      getSubscription,
      subscribe
    },
    getNotifications
  };

  vi.stubGlobal('Notification', {
    get permission() {
      return permission;
    },
    requestPermission
  });
  vi.stubGlobal('window', {
    Notification,
    PushManager: class PushManager {},
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    }
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      ready: Promise.resolve(registration),
      controller: { postMessage },
      addEventListener: vi.fn()
    },
    userAgent: 'test-agent',
    setAppBadge,
    clearAppBadge
  });

  return { clearAppBadge, getNotifications, postMessage };
}

function installCapabilityGlobals(options: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  hasPushManager?: boolean;
  standalone?: boolean;
  displayModeStandalone?: boolean;
}) {
  vi.stubGlobal('Notification', {
    permission: 'default',
    requestPermission: vi.fn()
  });
  vi.stubGlobal('window', {
    Notification,
    ...(options.hasPushManager === false ? {} : { PushManager: class PushManager {} }),
    matchMedia: vi.fn((query: string) => ({
      matches: query === '(display-mode: standalone)' && options.displayModeStandalone === true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {},
    userAgent: options.userAgent,
    platform: options.platform ?? '',
    maxTouchPoints: options.maxTouchPoints ?? 0,
    standalone: options.standalone
  });
}

function stubServiceWorker() {
  const listeners = new Set<(event: MessageEvent) => void>();

  vi.stubGlobal('navigator', {
    serviceWorker: {
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') listeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') listeners.delete(listener);
      })
    }
  });

  return {
    dispatchMessage(event: Pick<MessageEvent, 'data' | 'ports'>) {
      for (const listener of listeners) {
        listener(event as MessageEvent);
      }
    },
    listenerCount() {
      return listeners.size;
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pushNotifications.getPushCapability', () => {
  it('returns supported when service worker, notifications, and Push API are available', () => {
    installCapabilityGlobals({
      userAgent: 'Mozilla/5.0 Chrome/125.0',
      platform: 'Linux x86_64'
    });

    expect(getPushCapability()).toBe('supported');
  });

  it('returns ios_home_screen_required for iOS browser context before Home Screen launch', () => {
    installCapabilityGlobals({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      hasPushManager: false
    });

    expect(getPushCapability()).toBe('ios_home_screen_required');
  });

  it('returns supported for iOS standalone contexts when the Push API is available', () => {
    installCapabilityGlobals({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      standalone: true
    });

    expect(getPushCapability()).toBe('supported');
  });

  it('returns unsupported when a non-iOS browser lacks the Push API', () => {
    installCapabilityGlobals({
      userAgent: 'Mozilla/5.0 Firefox/120.0',
      platform: 'Linux x86_64',
      hasPushManager: false
    });

    expect(getPushCapability()).toBe('unsupported');
  });
});

describe('pushNotifications.ensureRegistered', () => {
  beforeEach(() => {
    permission = 'default';
    installPushGlobals();
    window.localStorage.setItem('towk:push:registered-vapid-public-key', 'dmFwaWQ');
    mocks.createPushNotificationAPI.mockReset();
    mocks.createPushNotificationAPI.mockReturnValue({
      subscribe: mocks.subscribePush,
      unsubscribe: mocks.unsubscribePush
    });
    mocks.subscribePush.mockReset();
    mocks.subscribePush.mockResolvedValue(true);
    mocks.unsubscribePush.mockReset();
    mocks.unsubscribePush.mockResolvedValue(true);
  });

  it('does not prompt or mutate when permission is default and prompt is false', async () => {
    getSubscription.mockResolvedValue(null);

    await expect(ensureRegistered('dmFwaWQ', { prompt: false })).resolves.toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(mocks.subscribePush).not.toHaveBeenCalled();
  });

  it('saves an existing subscription when permission is granted', async () => {
    permission = 'granted';
    const subscription = makeSubscription('https://push.example/existing');
    getSubscription.mockResolvedValue(subscription);

    await expect(ensureRegistered('dmFwaWQ', { prompt: false })).resolves.toBe(true);
    expect(subscribe).not.toHaveBeenCalled();
    expect(mocks.createPushNotificationAPI).toHaveBeenCalledWith({
      baseUrl: 'https://origin.test/api/connect',
      bearerToken: 'origin-token'
    });
    expect(mocks.subscribePush).toHaveBeenCalledWith({
      endpoint: 'https://push.example/existing',
      p256dh: 'p256dh-key',
      auth: 'auth-secret',
      userAgent: 'test-agent',
      locale: 'fr'
    });
  });

  it('creates and saves a subscription when permission is granted and none exists', async () => {
    permission = 'granted';
    const subscription = makeSubscription('https://push.example/created');
    getSubscription.mockResolvedValue(null);
    subscribe.mockResolvedValue(subscription);

    await expect(ensureRegistered('dmFwaWQ', { prompt: false })).resolves.toBe(true);
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array)
    });
    expect(mocks.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://push.example/created'
      })
    );
  });

  it('replaces a subscription created with a stale VAPID key', async () => {
    permission = 'granted';
    const stale = makeSubscription('https://push.example/stale-key', new Uint8Array([1, 2, 3]));
    const replacement = makeSubscription('https://push.example/replacement');
    getSubscription.mockResolvedValue(stale);
    subscribe.mockResolvedValue(replacement);

    await expect(ensureRegistered('dmFwaWQ', { prompt: false })).resolves.toBe(true);

    expect(stale.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.unsubscribePush).toHaveBeenCalledWith('https://push.example/stale-key');
    expect(subscribe).toHaveBeenCalledOnce();
    expect(mocks.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example/replacement' })
    );
  });

  it('replaces a pre-migration subscription once when the browser hides its VAPID key', async () => {
    permission = 'granted';
    window.localStorage.removeItem('towk:push:registered-vapid-public-key');
    const stale = makeSubscription('https://push.example/unknown-key');
    const replacement = makeSubscription('https://push.example/migrated-key');
    let currentSubscription: TestPushSubscription | null = stale;
    getSubscription.mockImplementation(async () => currentSubscription);
    subscribe.mockImplementation(async () => {
      currentSubscription = replacement;
      return replacement;
    });

    await expect(ensureRegistered('bmV3', { prompt: false })).resolves.toBe(true);
    await expect(ensureRegistered('bmV3', { prompt: false })).resolves.toBe(true);

    expect(stale.unsubscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(replacement.unsubscribe).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('towk:push:registered-vapid-public-key')).toBe('bmV3');
  });

  it('serializes concurrent reconciliation so a newly created subscription cannot be raced', async () => {
    permission = 'granted';
    const subscription = makeSubscription('https://push.example/serialized');
    const firstSave = deferred<boolean>();
    let currentSubscription: TestPushSubscription | null = null;

    getSubscription.mockImplementation(async () => currentSubscription);
    subscribe.mockImplementation(async () => {
      currentSubscription = subscription;
      return subscription;
    });
    mocks.subscribePush.mockReturnValueOnce(firstSave.promise).mockResolvedValue(true);

    const first = ensureRegistered('dmFwaWQ', { prompt: false });
    await vi.waitFor(() => expect(mocks.subscribePush).toHaveBeenCalledOnce());

    const second = ensureRegistered('dmFwaWQ', { prompt: false });
    await Promise.resolve();
    expect(getSubscription).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();

    firstSave.resolve(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(getSubscription).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it('prompts during explicit enable when permission is default', async () => {
    const subscription = makeSubscription('https://push.example/prompted');
    getSubscription.mockResolvedValue(null);
    subscribe.mockResolvedValue(subscription);

    await expect(ensureRegistered('dmFwaWQ', { prompt: true })).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(mocks.subscribePush).toHaveBeenCalledOnce();
  });

  it('cleans up only a newly created subscription when server save fails', async () => {
    permission = 'granted';
    const existingSubscription = makeSubscription('https://push.example/existing');
    getSubscription.mockResolvedValueOnce(existingSubscription);
    mocks.subscribePush.mockResolvedValueOnce(false);

    await expect(ensureRegistered('dmFwaWQ', { prompt: false })).resolves.toBe(false);
    expect(existingSubscription.unsubscribe).not.toHaveBeenCalled();

    const createdSubscription = makeSubscription('https://push.example/created');
    getSubscription.mockResolvedValueOnce(null);
    subscribe.mockResolvedValueOnce(createdSubscription);
    mocks.subscribePush.mockResolvedValueOnce(false);

    await expect(ensureRegistered('dmFwaWQ', { prompt: false })).resolves.toBe(false);
    expect(createdSubscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('revokes a malformed browser subscription so the next attempt can recover', async () => {
    permission = 'granted';
    const malformed = makeSubscription('https://push.example/malformed');
    malformed.toJSON = vi.fn(() => ({ endpoint: malformed.endpoint }));
    getSubscription.mockResolvedValue(malformed);

    await expect(ensureRegistered('dmFwaWQ', { prompt: false })).resolves.toBe(false);

    expect(malformed.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.unsubscribePush).toHaveBeenCalledWith(malformed.endpoint);
    expect(mocks.subscribePush).not.toHaveBeenCalled();
  });

  it('cleans up a newly created subscription when registration throws after creation', async () => {
    permission = 'granted';
    const created = makeSubscription('https://push.example/created-before-error');
    getSubscription.mockResolvedValue(null);
    subscribe.mockResolvedValue(created);
    mocks.subscribePush.mockRejectedValueOnce(new Error('server unavailable'));

    await expect(ensureRegistered('dmFwaWQ', { prompt: false })).resolves.toBe(false);

    expect(created.unsubscribe).toHaveBeenCalledOnce();
  });

  it('revokes the browser subscription and then cleans up the server record', async () => {
    permission = 'granted';
    const subscription = makeSubscription('https://push.example/existing');
    getSubscription.mockResolvedValue(subscription);

    await expect(unsubscribe()).resolves.toBe(true);

    expect(mocks.unsubscribePush).toHaveBeenCalledWith('https://push.example/existing');
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('still revokes the browser subscription when server cleanup is unavailable', async () => {
    permission = 'granted';
    const subscription = makeSubscription('https://push.example/offline-signout');
    getSubscription.mockResolvedValue(subscription);
    mocks.unsubscribePush.mockRejectedValueOnce(new Error('session already closed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(unsubscribe()).resolves.toBe(true);
      expect(subscription.unsubscribe).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    } finally {
      consoleError.mockRestore();
    }
  });

  it('invalidates an in-flight registration before origin sign-out', async () => {
    permission = 'granted';
    const pushGlobals = installPushGlobals();
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    pushGlobals.getNotifications.mockResolvedValue([
      { close: closeFirst },
      { close: closeSecond }
    ] as unknown as Notification[]);
    const subscription = makeSubscription('https://push.example/signout-race');
    const save = deferred<boolean>();
    getSubscription.mockResolvedValue(subscription);
    mocks.subscribePush.mockReturnValueOnce(save.promise);

    const registration = ensureRegistered('dmFwaWQ', { prompt: false });
    await vi.waitFor(() => expect(mocks.subscribePush).toHaveBeenCalledOnce());

    await expect(unsubscribeForSignOut()).resolves.toBe(true);
    expect(closeFirst).toHaveBeenCalledOnce();
    expect(closeSecond).toHaveBeenCalledOnce();
    expect(pushGlobals.clearAppBadge).toHaveBeenCalledOnce();
    expect(pushGlobals.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'towk-badge-state',
        badgeIntent: { kind: 'clear' },
        notificationCount: 0
      })
    );
    save.resolve(true);

    await expect(registration).resolves.toBe(false);
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(2);
    await expect(ensureRegistered('dmFwaWQ', { prompt: false })).resolves.toBe(false);
    expect(mocks.subscribePush).toHaveBeenCalledOnce();
  });
});

describe('notification navigation UI routing', () => {
  beforeEach(() => {
    mocks.appUi.disableRoomCallWideFor.mockClear();
    mocks.segmentToServerId.mockClear();
  });

  it('extracts the server and room target from chat room paths', () => {
    expect(notificationRoomTargetFromPathname('/chat/-/room-1/thread-1')).toEqual({
      serverId: 'origin',
      roomId: 'room-1'
    });
    expect(notificationRoomTargetFromPathname('/chat/remote.example.com/room%202')).toEqual({
      serverId: 'remote',
      roomId: 'room 2'
    });
  });

  it('prepares shared UI state for notification room paths', () => {
    prepareUiForNotificationPath(mocks.appUi, '/chat/-/room-1');

    expect(mocks.appUi.disableRoomCallWideFor).toHaveBeenCalledWith('origin', 'room-1');
  });

  it('prepares shared UI state for notification targets', () => {
    prepareUiForNotificationTarget(mocks.appUi, 'origin', { roomId: 'room-1' });

    expect(mocks.appUi.disableRoomCallWideFor).toHaveBeenCalledWith('origin', 'room-1');
  });

  it('ignores non-room notification paths', () => {
    prepareUiForNotificationPath(mocks.appUi, '/chat/notifications');
    prepareUiForNotificationPath(mocks.appUi, '/settings');

    expect(mocks.appUi.disableRoomCallWideFor).not.toHaveBeenCalled();
  });
});

describe('onNotificationClick', () => {
  it('acknowledges after the notification callback completes', async () => {
    const serviceWorker = stubServiceWorker();
    const navigation = deferred();
    const callback = vi.fn(() => navigation.promise);
    const responsePort = { postMessage: vi.fn() };
    const stop = onNotificationClick(callback);

    serviceWorker.dispatchMessage({
      data: {
        type: 'notification-click',
        url: 'https://towk.example/chat/-/room-1'
      },
      ports: [responsePort as unknown as MessagePort]
    });

    await Promise.resolve();
    expect(callback).toHaveBeenCalledWith('https://towk.example/chat/-/room-1');
    expect(responsePort.postMessage).not.toHaveBeenCalled();

    navigation.resolve();
    await navigation.promise;
    await Promise.resolve();

    expect(responsePort.postMessage).toHaveBeenCalledWith({ type: 'notification-click-ack' });

    stop();
    expect(serviceWorker.listenerCount()).toBe(0);
  });

  it('does not acknowledge when the callback rejects', async () => {
    const serviceWorker = stubServiceWorker();
    const callback = vi.fn(async () => {
      throw new Error('navigation failed');
    });
    const responsePort = { postMessage: vi.fn() };
    onNotificationClick(callback);

    serviceWorker.dispatchMessage({
      data: {
        type: 'notification-click',
        url: 'https://towk.example/chat/-/room-1'
      },
      ports: [responsePort as unknown as MessagePort]
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(callback).toHaveBeenCalledOnce();
    expect(responsePort.postMessage).not.toHaveBeenCalled();
  });
});
