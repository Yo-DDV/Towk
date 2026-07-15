/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

/**
 * Service Worker for Towk's PWA shell and push notifications.
 *
 * Keeps the app shell available during offline launches while leaving live
 * Towk data on the network. It also handles Web Push notifications and
 * notification-click navigation.
 */

import { build, files, version } from '$service-worker';
import { OFFLINE_SHELL_PATH, classifyServiceWorkerRequest } from '$lib/pwa/serviceWorkerPolicy';
import {
  routeNotificationClick,
  type NotificationClickClients
} from '$lib/pwa/notificationClick.worker';
import {
  normalizeUnknownBadgeIntent,
  ServiceWorkerBadgeCoordinator,
  createCacheForegroundBadgeIntentStorage,
  type ServiceWorkerBadgeIntent
} from '$lib/pwa/notificationBadge.worker';
import {
  callNotificationClickUrl,
  normalizeCallPushNotification,
  type CallPushPayload
} from '$lib/pwa/callNotification.worker';
import { OUTBOX_SYNC_TAG } from '$lib/pwa/outboxPolicy';
import { storeIncomingShare } from '$lib/pwa/shareInbox';

declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'towk-shell';
const CACHE_NAME = `${CACHE_PREFIX}-${version}`;
const BADGE_STATE_CACHE_NAME = 'towk-badge-state-v1';
const LEGACY_CACHE_PREFIXES = ['chatto-shell'];
const LEGACY_CACHE_NAMES = ['chatto-badge-state-v2'];
const ESSENTIAL_STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/icons/favicon.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/symbol-256.png'
] as const;
const SHELL_ASSETS = new Set([...build, ...files, OFFLINE_SHELL_PATH]);
const PRECACHE_ASSETS = Array.from(
  new Set([...build, ...ESSENTIAL_STATIC_ASSETS, OFFLINE_SHELL_PATH, '/'])
);
const REQUIRED_PRECACHE_ASSETS = new Set([...build, OFFLINE_SHELL_PATH, '/']);

type ServiceWorkerAppBadgeNavigator = WorkerNavigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

const badgeCoordinator = new ServiceWorkerBadgeCoordinator(
  self.registration,
  navigator as ServiceWorkerAppBadgeNavigator,
  createCacheForegroundBadgeIntentStorage(caches, BADGE_STATE_CACHE_NAME)
);

/**
 * Prepare a complete versioned shell. Updated workers remain waiting until the
 * app confirms that reloading is safe (not while typing or in a call).
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_ASSETS.map((path) =>
            cacheShellAsset(cache, path, REQUIRED_PRECACHE_ASSETS.has(path))
          )
        )
      )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.navigationPreload?.enable();
      } catch {
        // Navigation preload is an optional acceleration. A browser runtime
        // rejection must not block worker activation or offline availability.
      }
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(
            (cacheName) =>
              (cacheName.startsWith(`${CACHE_PREFIX}-`) && cacheName !== CACHE_NAME) ||
              LEGACY_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(`${prefix}-`)) ||
              LEGACY_CACHE_NAMES.includes(cacheName)
          )
          .map((cacheName) => caches.delete(cacheName))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (handleLifecycleMessage(event)) return;
  if (handleBadgeStateMessage(event)) return;
  if (handleNotificationStateMessage(event)) return;
  handleNotificationDismissMessage(event);
});

// Background Sync cannot safely send authenticated messages itself: Towk
// credentials remain in the foreground connection stores, never IndexedDB.
// When supported, the worker wakes controlled app windows so the encrypted
// outbox can be replayed with the normal authenticated API client.
self.addEventListener('sync', (event: Event) => {
  const syncEvent = event as ExtendableEvent & { tag?: string };
  if (syncEvent.tag !== OUTBOX_SYNC_TAG) return;
  syncEvent.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) =>
        Promise.all(clients.map((client) => client.postMessage({ type: OUTBOX_SYNC_TAG })))
      )
  );
});

/**
 * Serve known app-shell assets from the versioned cache. For navigations, try
 * the network first and fall back to the cached SPA shell only when offline.
 *
 * Chat data, API responses, auth endpoints, uploaded assets, and cross-origin
 * requests stay network-only so stale data never masquerades as live state.
 */
self.addEventListener('fetch', (event) => {
  if (isIncomingShareRequest(event.request)) {
    event.respondWith(handleIncomingShare(event.request));
    return;
  }

  const policy = classifyServiceWorkerRequest(
    event.request,
    event.request.url,
    SHELL_ASSETS,
    self.location.origin
  );

  if (policy.networkOnly) return;

  if (policy.networkFirstAsset) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const url = new URL(event.request.url);
        try {
          const response = await fetch(event.request);
          if (response.ok) {
            await cache.put(url.pathname, response.clone());
          }
          return response;
        } catch (error) {
          const cached = await cache.match(url.pathname);
          if (cached) return cached;
          throw error;
        }
      })()
    );
    return;
  }

  if (policy.cacheableShellAsset) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const url = new URL(event.request.url);
        const cached = await cache.match(url.pathname);
        if (cached) return cached;

        const response = await fetch(event.request);
        if (response.ok) {
          await cache.put(url.pathname, response.clone());
        }
        return response;
      })()
    );
    return;
  }

  if (policy.navigationRequest) {
    event.respondWith(
      (async () => {
        try {
          return (await event.preloadResponse) ?? (await fetch(event.request));
        } catch (err) {
          const cache = await caches.open(CACHE_NAME);
          const shell = await getCachedOfflineShell(cache);
          if (shell) return shell;
          throw err;
        }
      })()
    );
  }
});

function isIncomingShareRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    request.method === 'POST' &&
    url.origin === self.location.origin &&
    url.pathname === '/chat/share-target'
  );
}

async function handleIncomingShare(request: Request): Promise<Response> {
  const redirect = (suffix: string) =>
    Response.redirect(new URL(`/chat/share-target${suffix}`, self.location.origin), 303);
  try {
    const form = await request.formData();
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const files = form.getAll('files').filter((value): value is File => value instanceof File);
    const shareId = await storeIncomingShare({
      title: field('title'),
      text: field('text'),
      url: field('url'),
      files
    });
    return redirect(`?shareId=${encodeURIComponent(shareId)}`);
  } catch {
    return redirect('?error=invalid');
  }
}
async function cacheShellAsset(cache: Cache, path: string, required: boolean): Promise<void> {
  try {
    const response = await fetch(path, { cache: 'reload' });
    if (!response.ok) {
      throw new Error(`Failed to precache ${path}: HTTP ${response.status}`);
    }
    await cache.put(path, response);
  } catch (error) {
    if (required) throw error;
    // Optional install metadata may be temporarily unavailable. The worker can
    // still activate with a complete executable shell and refresh it later.
  }
}

async function getCachedOfflineShell(cache: Cache): Promise<Response | undefined> {
  return (await cache.match(OFFLINE_SHELL_PATH)) ?? cache.match('/');
}

function handleLifecycleMessage(event: ExtendableMessageEvent): boolean {
  const message = event.data as Record<string, unknown> | undefined;
  if (!message || message.type !== 'towk-skip-waiting') return false;

  event.waitUntil(self.skipWaiting());
  return true;
}

// Type for push notification payload from server
interface PushPayload {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  notificationId?: string;
  url?: string;
  expiresAt?: number;
  call?: CallPushPayload;
  // "dismiss" action is used to close notifications on other devices
  action?: 'dismiss';
}

interface DeclarativePushPayload extends PushPayload {
  web_push?: number;
  mutable?: boolean;
  app_badge?: string | number;
  notification?: DeclarativeNotificationPayload;
}

interface DeclarativeNotificationPayload {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  app_badge?: string | number;
  tag?: string;
  navigate?: string;
  data?: {
    notificationId?: string;
    url?: string;
  };
}

type NormalizedPushNotification = {
  title: string;
  options: NotificationOptions;
  appBadgeIntent: ServiceWorkerBadgeIntent;
};

type DeclarativePushEventNotification = Pick<
  Notification,
  'title' | 'body' | 'icon' | 'tag' | 'data'
> & {
  badge?: string;
  app_badge?: string | number;
};

type PushEventWithDeclarativeNotification = PushEvent & {
  notification?: DeclarativePushEventNotification | null;
};

const NOTIFICATION_BODY_FALLBACKS: Record<string, string> = {
  en: 'Open Towk to view the notification',
  de: 'Öffne Towk, um die Benachrichtigung anzuzeigen',
  fr: 'Ouvrez Towk pour afficher la notification',
  es: 'Abre Towk para ver la notificación',
  pt: 'Abra o Towk para ver a notificação'
};

function handleBadgeStateMessage(event: ExtendableMessageEvent): boolean {
  const message = event.data as Record<string, unknown> | undefined;
  if (!message || message.type !== 'towk-badge-state') return false;

  const badgeIntent =
    normalizeUnknownBadgeIntent(message.badgeIntent) ??
    (typeof message.notificationCount === 'number'
      ? legacyBadgeIntentFromCount(message.notificationCount)
      : null);
  if (!badgeIntent) return false;

  event.waitUntil(
    badgeCoordinator.applyForegroundBadgeIntent(badgeIntent, {
      serviceWorkerAppBadgeEnabled: message.serviceWorkerAppBadgeEnabled === true
    })
  );
  return true;
}

function handleNotificationDismissMessage(event: ExtendableMessageEvent): boolean {
  const message = event.data as Record<string, unknown> | undefined;
  if (
    !message ||
    message.type !== 'towk-notification-dismiss' ||
    typeof message.notificationId !== 'string'
  ) {
    return false;
  }

  event.waitUntil(
    (async () => {
      const notifications = await self.registration.getNotifications();
      for (const notification of notifications) {
        if (notification.data?.notificationId === message.notificationId) {
          notification.close();
        }
      }
    })()
  );
  return true;
}

function handleNotificationStateMessage(event: ExtendableMessageEvent): boolean {
  const message = event.data as Record<string, unknown> | undefined;
  if (!message || message.type !== 'towk-notification-state') return false;

  const rawNotificationIds = message.notificationIds;
  if (!Array.isArray(rawNotificationIds)) return false;

  const pendingNotificationIds = new Set(
    rawNotificationIds.filter((id): id is string => typeof id === 'string' && id !== '')
  );

  event.waitUntil(
    (async () => {
      const notifications = await self.registration.getNotifications();
      for (const notification of notifications) {
        const notificationId = notification.data?.notificationId;
        if (typeof notificationId === 'string' && !pendingNotificationIds.has(notificationId)) {
          notification.close();
        }
      }
    })()
  );
  return true;
}

function normalizePushNotification(payload: DeclarativePushPayload): NormalizedPushNotification {
  const notification = payload.notification;
  const notificationId = payload.notificationId ?? notification?.data?.notificationId;
  const url = payload.url ?? notification?.data?.url ?? notification?.navigate;
  const body = payload.body ?? notification?.body;

  return {
    title: payload.title ?? notification?.title ?? 'Towk',
    options: {
      body: normalizeNotificationBody(body),
      icon: payload.icon ?? notification?.icon ?? '/icons/icon-192.png',
      badge: payload.badge ?? notification?.badge ?? '/icons/badge-monochrome-96.png',
      tag: payload.tag ?? notification?.tag,
      data: {
        notificationId,
        url
      }
    },
    appBadgeIntent: declarativeAppBadgeIntent(notification?.app_badge ?? payload.app_badge)
  };
}

function normalizeNotificationBody(body: unknown): string {
  const value = typeof body === 'string' ? body.trim() : '';
  if (value === '' || isServingOriginBody(value)) {
    return notificationBodyFallback(navigator.language);
  }
  return value;
}

function notificationBodyFallback(locale: string | undefined): string {
  const language = locale?.toLowerCase().split('-')[0] ?? 'en';
  return NOTIFICATION_BODY_FALLBACKS[language] ?? NOTIFICATION_BODY_FALLBACKS.en;
}

function isServingOriginBody(body: string): boolean {
  const candidate = body.replace(/\/+$/, '');
  try {
    const current = new URL(self.location.origin);
    const origin = current.origin.replace(/\/+$/, '');
    const aliases = new Set([origin, current.host, current.hostname]);
    if (current.port !== '') aliases.add(`${current.hostname}:${current.port}`);
    if (aliases.has(candidate)) return true;

    const candidateUrl = new URL(candidate);
    return candidateUrl.origin.replace(/\/+$/, '') === origin;
  } catch {
    return false;
  }
}

function declarativePayloadFromEventNotification(
  notification: DeclarativePushEventNotification
): DeclarativePushPayload {
  return {
    notification: {
      title: notification.title,
      body: notification.body,
      icon: notification.icon,
      badge: notification.badge,
      app_badge: notification.app_badge,
      tag: notification.tag,
      data: notificationData(notification.data)
    }
  };
}

function legacyBadgeIntentFromCount(notificationCount: number): ServiceWorkerBadgeIntent {
  if (!Number.isFinite(notificationCount)) return { kind: 'clear' };
  const count = Math.max(0, Math.floor(notificationCount));
  return count > 0 ? { kind: 'count', count } : { kind: 'clear' };
}

function declarativeAppBadgeIntent(appBadge: unknown): ServiceWorkerBadgeIntent {
  if (typeof appBadge === 'number' && Number.isFinite(appBadge)) {
    const count = Math.max(0, Math.floor(appBadge));
    return count > 0 ? { kind: 'count', count } : { kind: 'clear' };
  }
  if (typeof appBadge !== 'string' || appBadge.trim() === '') return { kind: 'flag' };

  const count = Number(appBadge);
  if (!Number.isFinite(count)) return { kind: 'flag' };
  const normalized = Math.max(0, Math.floor(count));
  return normalized > 0 ? { kind: 'count', count: normalized } : { kind: 'clear' };
}

async function applyPushAppBadgeIntent(intent: ServiceWorkerBadgeIntent): Promise<void> {
  if (intent.kind === 'count') {
    await badgeCoordinator.setPushAppBadgeCount(intent.count);
  } else if (intent.kind === 'flag') {
    await badgeCoordinator.setProvisionalPushFlagBadge();
  } else {
    await badgeCoordinator.setPushAppBadgeCount(0);
  }
}

function notificationData(data: unknown): DeclarativeNotificationPayload['data'] {
  if (typeof data !== 'object' || data === null) return undefined;
  return {
    notificationId: stringProperty(data, 'notificationId'),
    url: stringProperty(data, 'url')
  };
}

function stringProperty(record: object, key: string): string | undefined {
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Handle incoming push events.
 * Parse the payload and display a native notification, or dismiss existing ones.
 */
self.addEventListener('push', (event) => {
  const declarativeNotification = (event as PushEventWithDeclarativeNotification).notification;
  let payload: DeclarativePushPayload;
  if (event.data) {
    try {
      const decoded = event.data.json() as unknown;
      if (typeof decoded !== 'object' || decoded === null) {
        console.error('Invalid push payload');
        payload = { title: 'Towk' };
      } else {
        payload = decoded as DeclarativePushPayload;
      }
    } catch {
      console.error('Failed to parse push payload');
      payload = { title: 'Towk' };
    }
  } else if (declarativeNotification) {
    payload = declarativePayloadFromEventNotification(declarativeNotification);
  } else {
    console.warn('Push event received with no data or declarative notification');
    payload = { title: 'Towk' };
  }

  // Handle dismiss action - close matching notifications on this device
  if (payload.action === 'dismiss') {
    event.waitUntil(
      (async () => {
        const notifications = await self.registration.getNotifications(
          payload.tag ? { tag: payload.tag } : undefined
        );
        notifications.forEach((n) => n.close());
        await badgeCoordinator.reconcileAfterDismissPush();
      })()
    );
    return;
  }

  if (payload.call) {
    const notification = normalizeCallPushNotification(payload, Date.now(), navigator.language);
    if (!notification) return;
    badgeCoordinator.recordRegularPush();
    event.waitUntil(
      Promise.all([
        self.registration.showNotification(notification.title, notification.options),
        applyPushAppBadgeIntent(declarativeAppBadgeIntent(payload.app_badge))
      ])
    );
    return;
  }

  badgeCoordinator.recordRegularPush();
  const notification = normalizePushNotification(payload);

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(notification.title, notification.options),
      applyPushAppBadgeIntent(notification.appBadgeIntent)
    ])
  );
});

/**
 * Handle notification clicks.
 * Prefer postMessage to an already-open client so the SPA can route via
 * `goto()` (no full reload). Fall back to `WindowClient.navigate()` or
 * `openWindow()` when no client is open or messaging fails.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawUrl = callNotificationClickUrl(event.notification.data, event.action);
  event.waitUntil(
    (async () => {
      try {
        await routeNotificationClick(
          rawUrl,
          self.location.origin,
          self.clients as unknown as NotificationClickClients,
          { logger: console }
        );
      } finally {
        await badgeCoordinator.reconcileAfterNotificationClick().catch(() => {});
      }
    })().catch((err) => {
      console.error('[SW] Error handling notification click:', err);
    })
  );
});

/**
 * Reconcile the dock badge when the user dismisses a native notification from
 * the operating-system notification center without opening Towk.
 */
self.addEventListener('notificationclose', (event) => {
  event.waitUntil(badgeCoordinator.reconcileAfterNotificationClick().catch(() => {}));
});

// Export empty object for SvelteKit to recognize this as a module
export {};
