import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$service-worker', () => ({
  build: ['/app.js'],
  files: ['/manifest.webmanifest'],
  version: 'test-version'
}));

const shareInboxMock = vi.hoisted(() => ({
  storeIncomingShare: vi.fn()
}));

vi.mock('$lib/pwa/shareInbox', () => shareInboxMock);

type ServiceWorkerHandler = (event: {
  data?: unknown;
  notification?: {
    title?: string;
    body?: string;
    icon?: string;
    badge?: string;
    app_badge?: string | number;
    tag?: string;
    lang?: string;
    dir?: NotificationDirection;
    timestamp?: number;
    renotify?: boolean;
    requireInteraction?: boolean;
    data?: { notificationId?: string; url?: string };
    close?: () => void;
  };
  waitUntil: (promise: Promise<unknown>) => void;
  request?: Request;
  respondWith?: (response: Promise<Response> | Response) => void;
}) => void;

type TestNativeNotification = {
  close?: () => void;
  data?: { notificationId?: string };
};

type TestWindowClient = {
  postMessage: ReturnType<typeof vi.fn>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createWaitUntilEvent(extra: Record<string, unknown> = {}) {
  const pending: Promise<unknown>[] = [];
  return {
    event: {
      ...extra,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise)
    },
    pending
  };
}

function createMemoryCacheStorage() {
  const cachesByName = new Map<string, Map<string, Response>>();
  return {
    open: vi.fn(async (name: string) => {
      let cache = cachesByName.get(name);
      if (!cache) {
        cache = new Map();
        cachesByName.set(name, cache);
      }

      return {
        match: vi.fn(async (request: RequestInfo | URL) => cache.get(request.toString())?.clone()),
        put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
          cache.set(request.toString(), response.clone());
        }),
        delete: vi.fn(async (request: RequestInfo | URL) => cache.delete(request.toString()))
      };
    }),
    keys: vi.fn(async () => Array.from(cachesByName.keys())),
    delete: vi.fn(async (name: string) => cachesByName.delete(name))
  };
}

async function importServiceWorker(
  cacheStorage = createMemoryCacheStorage(),
  origin = 'https://towk.example'
) {
  const handlers = new Map<string, ServiceWorkerHandler[]>();
  const registration = {
    navigationPreload: {
      enable: vi.fn(async () => {})
    },
    getNotifications: vi.fn(
      async (_options?: { tag?: string }): Promise<TestNativeNotification[]> => []
    ),
    showNotification: vi.fn(async (_title: string, _options?: NotificationOptions) => {})
  };
  const clients = {
    claim: vi.fn(async () => {}),
    matchAll: vi.fn(async (): Promise<TestWindowClient[]> => []),
    openWindow: vi.fn(async () => null)
  };
  const setAppBadge = vi.fn(async () => {});
  const clearAppBadge = vi.fn(async () => {});
  const skipWaiting = vi.fn(async () => {});

  vi.stubGlobal('self', {
    location: { origin },
    registration,
    clients,
    skipWaiting,
    addEventListener: vi.fn((type: string, handler: ServiceWorkerHandler) => {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    })
  });
  vi.stubGlobal('navigator', { setAppBadge, clearAppBadge });
  vi.stubGlobal('caches', cacheStorage);

  await import('./service-worker');

  const dispatch = async (type: string, extra: Record<string, unknown> = {}) => {
    const { event, pending } = createWaitUntilEvent(extra);
    for (const handler of handlers.get(type) ?? []) {
      handler(event);
    }
    await Promise.all(pending);
  };

  return {
    clients,
    dispatch,
    getPendingDispatch(type: string, extra: Record<string, unknown> = {}) {
      return createWaitUntilEvent(extra);
    },
    handlers,
    registration,
    skipWaiting,
    setAppBadge,
    clearAppBadge,
    cacheStorage
  };
}

describe('service worker badge orchestration', () => {
  beforeEach(() => {
    vi.resetModules();
    shareInboxMock.storeIncomingShare.mockReset();
    shareInboxMock.storeIncomingShare.mockResolvedValue('share-123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps an update waiting until the app explicitly accepts it', async () => {
    const worker = await importServiceWorker();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200 }))
    );

    await worker.dispatch('install');

    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it('rejects an incomplete required shell so the previous worker stays active', async () => {
    const worker = await importServiceWorker();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path === '/app.js'
          ? new Response('unavailable', { status: 503 })
          : new Response('ok', { status: 200 })
      )
    );

    await expect(worker.dispatch('install')).rejects.toThrow();
  });

  it('does not precache the browser-specific web manifest during install', async () => {
    const worker = await importServiceWorker();
    const fetchMock = vi.fn(async (_path: string) => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(worker.dispatch('install')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalledWith('/manifest.webmanifest', expect.anything());
  });

  it('captures a POST share target securely before redirecting to the chooser', async () => {
    const worker = await importServiceWorker();
    const form = new FormData();
    form.set('title', 'Shared title');
    form.set('text', 'Shared text');
    form.set('url', 'https://example.com');
    form.append('files', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    const request = new Request('https://towk.example/chat/share-target', {
      method: 'POST',
      body: form
    });
    let responsePromise: Promise<Response> | undefined;
    const { event } = createWaitUntilEvent({
      request,
      respondWith: (response: Promise<Response> | Response) => {
        responsePromise = Promise.resolve(response);
      }
    });

    for (const handler of worker.handlers.get('fetch') ?? []) handler(event);
    const response = await responsePromise;

    expect(shareInboxMock.storeIncomingShare).toHaveBeenCalledOnce();
    expect(shareInboxMock.storeIncomingShare).toHaveBeenCalledWith({
      title: 'Shared title',
      text: 'Shared text',
      url: 'https://example.com',
      files: [expect.objectContaining({ name: 'note.txt', type: 'text/plain' })]
    });
    expect(response?.status).toBe(303);
    expect(response?.headers.get('location')).toBe(
      'https://towk.example/chat/share-target?shareId=share-123'
    );
  });

  it('redirects invalid or unsafe shares without exposing their payload', async () => {
    shareInboxMock.storeIncomingShare.mockRejectedValueOnce(new TypeError('unsafe'));
    const worker = await importServiceWorker();
    const request = new Request('https://towk.example/chat/share-target', {
      method: 'POST',
      body: new FormData()
    });
    let responsePromise: Promise<Response> | undefined;
    const { event } = createWaitUntilEvent({
      request,
      respondWith: (response: Promise<Response> | Response) => {
        responsePromise = Promise.resolve(response);
      }
    });

    for (const handler of worker.handlers.get('fetch') ?? []) handler(event);
    const response = await responsePromise;

    expect(response?.status).toBe(303);
    expect(response?.headers.get('location')).toBe(
      'https://towk.example/chat/share-target?error=invalid'
    );
  });
  it('enables navigation preload when the worker activates', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('activate');

    expect(worker.registration.navigationPreload.enable).toHaveBeenCalledOnce();
    expect(worker.clients.claim).toHaveBeenCalledOnce();
  });

  it('still activates when optional navigation preload cannot be enabled', async () => {
    const worker = await importServiceWorker();
    worker.registration.navigationPreload.enable.mockRejectedValueOnce(
      new Error('unsupported at runtime')
    );

    await expect(worker.dispatch('activate')).resolves.toBeUndefined();
    expect(worker.clients.claim).toHaveBeenCalledOnce();
  });

  it('activates a waiting update only after the app requests it', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('message', { data: { type: 'towk-skip-waiting' } });

    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });

  it('does not let a stale foreground zero clear a regular pushed notification', async () => {
    const worker = await importServiceWorker();
    const nativeNotification = { close: vi.fn() };
    const listing = deferred<Array<typeof nativeNotification>>();
    worker.registration.getNotifications.mockReturnValueOnce(listing.promise);

    const messageDispatch = worker.getPendingDispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 0,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    for (const handler of worker.handlers.get('message') ?? []) {
      handler(messageDispatch.event);
    }

    await worker.dispatch('push', {
      data: {
        json: () => ({
          title: 'New notification',
          body: 'Hello',
          tag: 'notification-1',
          url: 'https://towk.example/chat/-/room-1'
        })
      }
    });

    listing.resolve([nativeNotification]);
    await Promise.all(messageDispatch.pending);

    expect(worker.registration.showNotification).toHaveBeenCalledOnce();
    expect(worker.registration.showNotification).toHaveBeenCalledWith('New notification', {
      body: 'Hello',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-monochrome-96.png',
      tag: 'notification-1',
      data: {
        notificationId: undefined,
        url: 'https://towk.example/chat/-/room-1'
      }
    });
    expect(nativeNotification.close).not.toHaveBeenCalled();
    expect(worker.clearAppBadge).not.toHaveBeenCalled();
  });

  it('shows an app-owned fallback for malformed pushes and treats a tagless dismiss as a bulk close', async () => {
    const worker = await importServiceWorker();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = { close: vi.fn() };
    const second = { close: vi.fn() };
    worker.registration.getNotifications
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([]);

    try {
      await worker.dispatch('push', { data: { json: () => null } });
      await worker.dispatch('push', {
        data: { json: () => ({ action: 'dismiss' }) }
      });

      expect(consoleError).toHaveBeenCalledWith('Invalid push payload');
      expect(worker.registration.showNotification).toHaveBeenCalledOnce();
      expect(worker.registration.showNotification).toHaveBeenCalledWith('Towk', {
        body: 'Open Towk to view the notification',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-monochrome-96.png',
        tag: undefined,
        data: { notificationId: undefined, url: undefined }
      });
      expect(worker.registration.getNotifications).toHaveBeenCalledTimes(2);
      expect(worker.registration.getNotifications).toHaveBeenNthCalledWith(1, undefined);
      expect(first.close).toHaveBeenCalledOnce();
      expect(second.close).toHaveBeenCalledOnce();
      expect(worker.setAppBadge).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps regular push bodies app-owned when the payload body is absent', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('push', {
      data: {
        json: () => ({
          title: 'New notification',
          tag: 'notification-without-body',
          url: 'https://towk.example/chat/-/room-1'
        })
      }
    });

    expect(worker.registration.showNotification).toHaveBeenCalledWith('New notification', {
      body: 'Open Towk to view the notification',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-monochrome-96.png',
      tag: 'notification-without-body',
      data: {
        notificationId: undefined,
        url: 'https://towk.example/chat/-/room-1'
      }
    });
  });

  it('uses the payload locale for regular push fallback bodies', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('push', {
      data: {
        json: () => ({
          title: 'Nouvelle notification',
          lang: 'fr-FR',
          tag: 'notification-with-french-fallback',
          url: 'https://towk.example/chat/-/room-1'
        })
      }
    });

    expect(worker.registration.showNotification).toHaveBeenCalledWith('Nouvelle notification', {
      body: 'Ouvrez Towk pour afficher la notification',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-monochrome-96.png',
      tag: 'notification-with-french-fallback',
      lang: 'fr-FR',
      data: {
        notificationId: undefined,
        url: 'https://towk.example/chat/-/room-1'
      }
    });
  });

  it('replaces browser origin bodies so Android never displays the served host or port', async () => {
    const worker = await importServiceWorker(createMemoryCacheStorage(), 'https://towk.example:8443');

    await worker.dispatch('push', {
      data: {
        json: () => ({
          title: 'New notification',
          body: 'towk.example:8443',
          tag: 'origin-body',
          url: 'https://towk.example:8443/chat/-/room-1'
        })
      }
    });

    expect(worker.registration.showNotification).toHaveBeenCalledWith('New notification', {
      body: 'Open Towk to view the notification',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-monochrome-96.png',
      tag: 'origin-body',
      data: {
        notificationId: undefined,
        url: 'https://towk.example:8443/chat/-/room-1'
      }
    });
  });

  it('uses the declarative payload locale when sanitizing origin fallback bodies', async () => {
    const worker = await importServiceWorker(createMemoryCacheStorage(), 'https://towk.example:8443');

    await worker.dispatch('push', {
      notification: {
        title: 'Notification déclarative',
        body: 'https://towk.example:8443/',
        lang: 'fr',
        tag: 'notification-origin-fr',
        icon: 'https://towk.example:8443/icons/icon-192.png',
        badge: 'https://towk.example:8443/icons/badge-monochrome-96.png',
        data: {
          notificationId: 'notif-origin-fr',
          url: 'https://towk.example:8443/chat/-/room-3?highlight=event-3'
        }
      }
    });

    expect(worker.registration.showNotification).toHaveBeenCalledWith('Notification déclarative', {
      body: 'Ouvrez Towk pour afficher la notification',
      icon: 'https://towk.example:8443/icons/icon-192.png',
      badge: 'https://towk.example:8443/icons/badge-monochrome-96.png',
      tag: 'notification-origin-fr',
      lang: 'fr',
      data: {
        notificationId: 'notif-origin-fr',
        url: 'https://towk.example:8443/chat/-/room-3?highlight=event-3'
      }
    });
  });

  it('closes a native notification from an online realtime dismissal without a Web Push', async () => {
    const worker = await importServiceWorker();
    const matching = { data: { notificationId: 'notification-2' }, close: vi.fn() };
    const other = { data: { notificationId: 'notification-1' }, close: vi.fn() };
    worker.registration.getNotifications.mockResolvedValueOnce([other, matching]);

    await worker.dispatch('message', {
      data: {
        type: 'towk-notification-dismiss',
        notificationId: 'notification-2'
      }
    });

    expect(worker.registration.getNotifications).toHaveBeenCalledOnce();
    expect(matching.close).toHaveBeenCalledOnce();
    expect(other.close).not.toHaveBeenCalled();
    expect(worker.registration.showNotification).not.toHaveBeenCalled();
  });

  it('closes stale native notifications after a foreground state reconciliation', async () => {
    const worker = await importServiceWorker();
    const stillPending = { data: { notificationId: 'notification-1' }, close: vi.fn() };
    const stale = { data: { notificationId: 'notification-2' }, close: vi.fn() };
    const unmanaged = { close: vi.fn() };
    worker.registration.getNotifications.mockResolvedValueOnce([stillPending, stale, unmanaged]);

    await worker.dispatch('message', {
      data: {
        type: 'towk-notification-state',
        notificationIds: ['notification-1']
      }
    });

    expect(worker.registration.getNotifications).toHaveBeenCalledOnce();
    expect(stale.close).toHaveBeenCalledOnce();
    expect(stillPending.close).not.toHaveBeenCalled();
    expect(unmanaged.close).not.toHaveBeenCalled();
    expect(worker.registration.showNotification).not.toHaveBeenCalled();
  });

  it('queues native notification-center closes and forwards them to controlled clients', async () => {
    const worker = await importServiceWorker();
    const client = { postMessage: vi.fn() };
    worker.clients.matchAll.mockResolvedValueOnce([client]);

    await worker.dispatch('notificationclose', {
      notification: {
        data: {
          notificationId: 'notification-closed-from-tray'
        }
      }
    });

    expect(client.postMessage).toHaveBeenCalledWith({
      type: 'towk-native-notification-closed',
      notificationId: 'notification-closed-from-tray',
      source: 'native-close'
    });
  });

  it('replays queued native notification closes until the foreground app acknowledges them', async () => {
    const cacheStorage = createMemoryCacheStorage();
    const worker = await importServiceWorker(cacheStorage);
    const firstClient = { postMessage: vi.fn() };
    const secondClient = { postMessage: vi.fn() };

    worker.clients.matchAll.mockResolvedValueOnce([firstClient]);
    await worker.dispatch('notificationclose', {
      notification: {
        data: {
          notificationId: 'notification-replay'
        }
      }
    });

    worker.clients.matchAll.mockResolvedValueOnce([secondClient]);
    await worker.dispatch('message', {
      data: {
        type: 'towk-native-notification-close-drain'
      }
    });

    expect(secondClient.postMessage).toHaveBeenCalledWith({
      type: 'towk-native-notification-closed',
      notificationId: 'notification-replay',
      source: 'replay'
    });

    await worker.dispatch('message', {
      data: {
        type: 'towk-native-notification-close-ack',
        notificationId: 'notification-replay'
      }
    });

    const thirdClient = { postMessage: vi.fn() };
    worker.clients.matchAll.mockResolvedValueOnce([thirdClient]);
    await worker.dispatch('message', {
      data: {
        type: 'towk-native-notification-close-drain'
      }
    });

    expect(thirdClient.postMessage).not.toHaveBeenCalled();
  });

  it('uses declarative push notification fields when legacy root fields are absent', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 0,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    worker.setAppBadge.mockClear();

    await worker.dispatch('push', {
      data: {
        json: () => ({
          web_push: 8030,
          notification: {
            title: 'Declarative notification',
            body: 'Opened by the browser or worker fallback',
            tag: 'notification-2',
            lang: 'fr',
            dir: 'ltr',
            timestamp: 1783936800000,
            renotify: true,
            requireInteraction: true,
            icon: 'https://towk.example/icons/icon-192.png',
            badge: 'https://towk.example/icons/badge-monochrome-96.png',
            app_badge: '5',
            navigate: 'https://towk.example/chat/-/room-2?highlight=event-2',
            data: {
              notificationId: 'notif-2',
              url: 'https://towk.example/chat/-/room-2?highlight=event-2'
            }
          }
        })
      }
    });

    expect(worker.setAppBadge).toHaveBeenCalledWith(5);
    expect(worker.registration.showNotification).toHaveBeenCalledWith('Declarative notification', {
      body: 'Opened by the browser or worker fallback',
      icon: 'https://towk.example/icons/icon-192.png',
      badge: 'https://towk.example/icons/badge-monochrome-96.png',
      tag: 'notification-2',
      lang: 'fr',
      dir: 'ltr',
      timestamp: 1783936800000,
      renotify: true,
      requireInteraction: true,
      data: {
        notificationId: 'notif-2',
        url: 'https://towk.example/chat/-/room-2?highlight=event-2'
      }
    });
  });

  it('accepts a root app badge count for imperative regular push fallbacks', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 0,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    worker.setAppBadge.mockClear();

    await worker.dispatch('push', {
      data: {
        json: () => ({
          title: 'New message',
          body: 'Fallback body',
          tag: 'notification-root-badge',
          url: 'https://towk.example/chat/-/room-2?highlight=event-2',
          app_badge: '6'
        })
      }
    });

    expect(worker.registration.showNotification).toHaveBeenCalledWith('New message', {
      body: 'Fallback body',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-monochrome-96.png',
      tag: 'notification-root-badge',
      data: {
        notificationId: undefined,
        url: 'https://towk.example/chat/-/room-2?highlight=event-2'
      }
    });
    expect(worker.setAppBadge).toHaveBeenCalledWith(6);
  });

  it('sanitizes declarative origin bodies before showing the notification', async () => {
    const worker = await importServiceWorker(createMemoryCacheStorage(), 'https://towk.example:8443');

    await worker.dispatch('push', {
      notification: {
        title: 'Declarative notification',
        body: 'https://towk.example:8443/',
        tag: 'notification-origin',
        icon: 'https://towk.example:8443/icons/icon-192.png',
        badge: 'https://towk.example:8443/icons/badge-monochrome-96.png',
        data: {
          notificationId: 'notif-origin',
          url: 'https://towk.example:8443/chat/-/room-3?highlight=event-3'
        }
      }
    });

    expect(worker.registration.showNotification).toHaveBeenCalledWith('Declarative notification', {
      body: 'Open Towk to view the notification',
      icon: 'https://towk.example:8443/icons/icon-192.png',
      badge: 'https://towk.example:8443/icons/badge-monochrome-96.png',
      tag: 'notification-origin',
      data: {
        notificationId: 'notif-origin',
        url: 'https://towk.example:8443/chat/-/room-3?highlight=event-3'
      }
    });
  });

  it('clears a declarative DM push app badge after clicking the only native notification', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 0,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    worker.clearAppBadge.mockClear();
    worker.setAppBadge.mockClear();

    await worker.dispatch('push', {
      data: {
        json: () => ({
          web_push: 8030,
          notification: {
            title: 'New DM',
            body: 'Hello from a DM',
            tag: 'dm-event-1',
            app_badge: '1',
            navigate: 'https://towk.example/chat/-/dm-room-1',
            data: {
              notificationId: 'notif-dm-1',
              url: 'https://towk.example/chat/-/dm-room-1'
            }
          }
        })
      }
    });

    const options = worker.registration.showNotification.mock.calls[0][1] as NotificationOptions;
    worker.registration.getNotifications.mockResolvedValueOnce([]);

    await worker.dispatch('notificationclick', {
      notification: {
        close: vi.fn(),
        data: options.data as { url?: string }
      }
    });

    expect(worker.setAppBadge).toHaveBeenCalledOnce();
    expect(worker.setAppBadge).toHaveBeenCalledWith(1);
    expect(worker.clearAppBadge).toHaveBeenCalledOnce();
  });

  it('clears a push-only app badge after the user closes the last native notification', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 0,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    worker.clearAppBadge.mockClear();
    worker.setAppBadge.mockClear();

    await worker.dispatch('push', {
      data: {
        json: () => ({
          title: 'New message',
          tag: 'room-message-event-1',
          url: 'https://towk.example/chat/-/room-1'
        })
      }
    });
    worker.registration.getNotifications.mockResolvedValueOnce([]);

    await worker.dispatch('notificationclose', {
      notification: { tag: 'room-message-event-1' }
    });

    expect(worker.setAppBadge).toHaveBeenCalledOnce();
    expect(worker.clearAppBadge).toHaveBeenCalledOnce();
  });

  it('handles mutable declarative push events with event.notification and no payload data', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 0,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    worker.setAppBadge.mockClear();

    await worker.dispatch('push', {
      notification: {
        title: 'Mutable declarative notification',
        body: 'Handled through PushEvent.notification',
        tag: 'notification-3',
        icon: 'https://towk.example/icons/icon-192.png',
        badge: 'https://towk.example/icons/badge-monochrome-96.png',
        app_badge: 3,
        data: {
          notificationId: 'notif-3',
          url: 'https://towk.example/chat/-/room-3?highlight=event-3'
        }
      }
    });

    expect(worker.registration.showNotification).toHaveBeenCalledWith(
      'Mutable declarative notification',
      {
        body: 'Handled through PushEvent.notification',
        icon: 'https://towk.example/icons/icon-192.png',
        badge: 'https://towk.example/icons/badge-monochrome-96.png',
        tag: 'notification-3',
        data: {
          notificationId: 'notif-3',
          url: 'https://towk.example/chat/-/room-3?highlight=event-3'
        }
      }
    );
    expect(worker.setAppBadge).toHaveBeenCalledWith(3);
  });

  it('applies the authoritative app badge count for imperative call pushes', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 0,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    worker.setAppBadge.mockClear();

    await worker.dispatch('push', {
      data: {
        json: () => ({
          title: 'Ignored backend title',
          tag: 'call-C1',
          lang: 'fr',
          dir: 'ltr',
          timestamp: 1783936800000,
          notificationId: 'N-call',
          url: 'https://towk.example/chat/-/room-1',
          expiresAt: Date.now() + 30_000,
          app_badge: '4',
          call: {
            actorName: 'Alice',
            actorKnown: true,
            roomName: 'General',
            callId: 'C1',
            joinUrl: 'https://towk.example/chat/-/room-1?joinCall=C1'
          }
        })
      }
    });

    expect(worker.registration.showNotification).toHaveBeenCalledWith('Alice a démarré un appel', {
      body: 'Dans #General',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-monochrome-96.png',
      tag: 'call-C1',
      lang: 'fr',
      dir: 'ltr',
      timestamp: 1783936800000,
      renotify: true,
      requireInteraction: true,
      data: {
        notificationId: 'N-call',
        url: 'https://towk.example/chat/-/room-1',
        joinUrl: 'https://towk.example/chat/-/room-1?joinCall=C1',
        callId: 'C1'
      },
      actions: [
        { action: 'view-room', title: 'Voir le salon' },
        { action: 'join-call', title: 'Rejoindre' }
      ]
    });
    expect(worker.setAppBadge).toHaveBeenCalledWith(4);
  });

  it('uses a provisional app badge flag when an imperative call push has no count', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 0,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    worker.setAppBadge.mockClear();

    await worker.dispatch('push', {
      data: {
        json: () => ({
          tag: 'call-C2',
          notificationId: 'N-call-2',
          url: 'https://towk.example/chat/-/room-2',
          expiresAt: Date.now() + 30_000,
          call: {
            actorName: 'Bob',
            actorKnown: true,
            roomName: 'General',
            callId: 'C2',
            joinUrl: 'https://towk.example/chat/-/room-2?joinCall=C2'
          }
        })
      }
    });

    expect(worker.registration.showNotification).toHaveBeenCalledOnce();
    expect(worker.setAppBadge).toHaveBeenCalledWith();
  });

  it('uses declarative navigate as the fallback notification click URL', async () => {
    const worker = await importServiceWorker();
    const targetUrl = 'https://towk.example/chat/-/room-2?highlight=event-2';

    await worker.dispatch('push', {
      data: {
        json: () => ({
          web_push: 8030,
          notification: {
            title: 'Declarative notification',
            navigate: targetUrl,
            data: {
              notificationId: 'notif-2'
            }
          }
        })
      }
    });

    const options = worker.registration.showNotification.mock.calls[0][1] as NotificationOptions;
    await worker.dispatch('notificationclick', {
      notification: {
        close: vi.fn(),
        data: options.data as { url?: string }
      }
    });

    expect(worker.clients.openWindow).toHaveBeenCalledWith(targetUrl);
  });

  it('preserves a foreground authoritative count after clicking the only native notification', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 3,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    worker.registration.getNotifications.mockResolvedValueOnce([]);

    await worker.dispatch('notificationclick', {
      notification: {
        close: vi.fn(),
        data: { url: 'https://towk.example/chat/-/room-1' }
      }
    });

    expect(worker.clearAppBadge).not.toHaveBeenCalled();
    expect(worker.setAppBadge).toHaveBeenLastCalledWith(3);
    expect(worker.clients.openWindow.mock.invocationCallOrder[0]).toBeLessThan(
      worker.registration.getNotifications.mock.invocationCallOrder[0]
    );
  });

  it('reconciles badge state even when notification click routing fails', async () => {
    const worker = await importServiceWorker();
    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 0,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    worker.clearAppBadge.mockClear();
    worker.registration.getNotifications.mockClear();
    worker.clients.openWindow.mockRejectedValueOnce(new Error('window activation failed'));
    worker.registration.getNotifications.mockResolvedValueOnce([]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await worker.dispatch('notificationclick', {
        notification: {
          close: vi.fn(),
          data: { url: 'https://towk.example/chat/-/room-1' }
        }
      });

      expect(worker.registration.getNotifications).toHaveBeenCalledOnce();
      expect(worker.clearAppBadge).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('preserves a foreground authoritative count after a service worker restart', async () => {
    const cacheStorage = createMemoryCacheStorage();
    const firstWorker = await importServiceWorker(cacheStorage);

    await firstWorker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 3,
        serviceWorkerAppBadgeEnabled: true
      }
    });

    vi.resetModules();
    const restartedWorker = await importServiceWorker(cacheStorage);
    restartedWorker.registration.getNotifications.mockResolvedValueOnce([]);

    await restartedWorker.dispatch('notificationclick', {
      notification: {
        close: vi.fn(),
        data: { url: 'https://towk.example/chat/-/room-1' }
      }
    });

    expect(restartedWorker.clearAppBadge).not.toHaveBeenCalled();
    expect(restartedWorker.setAppBadge).toHaveBeenLastCalledWith(3);
  });

  it('does not call the worker Badging API for a foreground browser tab', async () => {
    const worker = await importServiceWorker();

    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 3,
        serviceWorkerAppBadgeEnabled: false
      }
    });
    worker.registration.getNotifications.mockResolvedValueOnce([]);

    await worker.dispatch('notificationclick', {
      notification: {
        close: vi.fn(),
        data: { url: 'https://towk.example/chat/-/room-1' }
      }
    });

    expect(worker.clearAppBadge).not.toHaveBeenCalled();
    expect(worker.setAppBadge).not.toHaveBeenCalled();
  });

  it('does not preserve a foreground count after a dismiss push without a fresh count', async () => {
    const worker = await importServiceWorker();
    const staleNotification = { close: vi.fn() };

    await worker.dispatch('message', {
      data: {
        type: 'towk-badge-state',
        notificationCount: 1,
        serviceWorkerAppBadgeEnabled: true
      }
    });
    worker.registration.getNotifications
      .mockResolvedValueOnce([staleNotification])
      .mockResolvedValueOnce([]);

    await worker.dispatch('push', {
      data: {
        json: () => ({
          action: 'dismiss',
          tag: 'notification-1'
        })
      }
    });

    expect(staleNotification.close).toHaveBeenCalledOnce();
    expect(worker.clearAppBadge).toHaveBeenCalledOnce();
    expect(worker.setAppBadge).toHaveBeenCalledTimes(1);
  });
});
