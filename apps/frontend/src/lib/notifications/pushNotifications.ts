/**
 * Push notifications module.
 *
 * Manages Web Push subscriptions for receiving notifications outside an open
 * Towk page. Uses the Service Worker and Web Push API; platform delivery is
 * still treated as a notification trigger rather than authoritative app state.
 */

import { createPushNotificationAPI } from '$lib/api-client/pushNotifications';
import { clearBadge, syncServiceWorkerNotificationBadgeState } from '$lib/notifications/appBadge';
import {
  NOTIFICATION_CLICK_ACK_MESSAGE_TYPE,
  NOTIFICATION_CLICK_MESSAGE_TYPE
} from '$lib/pwa/notificationClick.worker';
import {
  NATIVE_NOTIFICATION_CLOSED_MESSAGE_TYPE,
  NATIVE_NOTIFICATION_CLOSE_ACK_MESSAGE_TYPE,
  NATIVE_NOTIFICATION_CLOSE_DRAIN_MESSAGE_TYPE,
  type NativeNotificationClosedMessage
} from '$lib/pwa/notificationClose.worker';
import { getLocale } from '$lib/i18n/runtime';
import { serverConnectionManager } from '$lib/state/server/serverConnection.svelte';
import { currentPushClientId } from './pushClientId';

type EnsureRegisteredOptions = {
  prompt: boolean;
};

let registrationQueue: Promise<void> = Promise.resolve();
let registrationGeneration = 0;
let registrationsSuspended = false;
const registeredVapidKeyStorageKey = 'towk:push:registered-vapid-public-key';
let registeredVapidKeyFallback: string | null = null;

export type PushCapability = 'supported' | 'ios_home_screen_required' | 'unsupported';

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

function isIosBrowserContext(): boolean {
  if (typeof navigator === 'undefined') return false;

  const platform = navigator.platform;
  const userAgent = navigator.userAgent;
  const touchCapableMac = platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(userAgent) || touchCapableMac;
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as StandaloneNavigator).standalone === true
  );
}

export function getPushCapability(): PushCapability {
  if (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  ) {
    return 'supported';
  }

  if (isIosBrowserContext() && !isStandaloneDisplayMode()) {
    return 'ios_home_screen_required';
  }

  return 'unsupported';
}

/**
 * Check if push notifications are supported in this browser.
 * Requires Service Worker and Push API support.
 */
export function isSupported(): boolean {
  return getPushCapability() === 'supported';
}

/**
 * Get the current service worker registration.
 */
async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function postServiceWorkerMessage(message: unknown): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const container = navigator.serviceWorker;
  if (container.controller) {
    container.controller.postMessage(message);
    return;
  }

  void container.ready
    .then((registration) => {
      (container.controller ?? registration.active)?.postMessage(message);
    })
    .catch(() => {});
}

/**
 * Get the current push subscription, if any.
 */
export async function getSubscription(): Promise<PushSubscription | null> {
  const registration = await getServiceWorkerRegistration();
  if (!registration) {
    return null;
  }

  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Check if push notifications are currently subscribed.
 */
export async function isSubscribed(): Promise<boolean> {
  const subscription = await getSubscription();
  return subscription !== null;
}

export function getPermission(): NotificationPermission | null {
  if (!isSupported()) {
    return null;
  }
  return Notification.permission;
}

/**
 * Convert base64url string to Uint8Array (for VAPID key).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Ensure the current browser push subscription is stored on the server.
 * Browser/OS permission is the user-facing source of truth. When permission is
 * already granted, this refreshes the server-side delivery cache without
 * prompting the user.
 */
export async function ensureRegistered(
  vapidPublicKey: string,
  options: EnsureRegisteredOptions
): Promise<boolean> {
  if (registrationsSuspended) {
    return false;
  }
  if (!isSupported()) {
    console.warn('Push notifications not supported');
    return false;
  }

  let permission = Notification.permission;
  if (permission !== 'granted') {
    if (!options.prompt) return false;
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    console.warn('Notification permission denied');
    return false;
  }

  const generation = registrationGeneration;
  const run = registrationQueue.then(
    () => registerGrantedSubscription(vapidPublicKey, generation),
    () => registerGrantedSubscription(vapidPublicKey, generation)
  );
  registrationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function registerGrantedSubscription(
  vapidPublicKey: string,
  generation: number
): Promise<boolean> {
  if (!registrationIsCurrent(generation) || Notification.permission !== 'granted') {
    return false;
  }

  const registration = await getServiceWorkerRegistration();
  if (!registration) {
    console.error('No service worker registration');
    return false;
  }

  let subscription: PushSubscription | null = null;
  let createdSubscription = false;
  try {
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
    subscription = await registration.pushManager.getSubscription();

    if (
      subscription &&
      !subscriptionUsesApplicationServerKey(subscription, applicationServerKey, vapidPublicKey)
    ) {
      const staleEndpoint = subscription.endpoint;
      await subscription.unsubscribe();
      try {
        await originPushAPI().unsubscribe(staleEndpoint);
      } catch (error) {
        // The obsolete browser subscription is already revoked. Its server
        // record is best-effort cleanup and will also disappear on a 404/410.
        console.error('Failed to remove obsolete push subscription from server:', error);
      }
      subscription = null;
    }

    if (!registrationIsCurrent(generation) || Notification.permission !== 'granted') {
      return false;
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });
      createdSubscription = true;
    }

    if (!registrationIsCurrent(generation) || Notification.permission !== 'granted') {
      if (createdSubscription) await subscription.unsubscribe();
      return false;
    }

    // Extract subscription details
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      console.error('Invalid push subscription');
      await revokeSubscription(subscription);
      return false;
    }

    const saved = await originPushAPI().subscribe({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      userAgent: navigator.userAgent,
      locale: getLocale(),
      clientId: currentPushClientId(),
      applicationOrigin: currentApplicationOrigin()
    });

    if (!saved) {
      console.error('Failed to save push subscription');
      if (createdSubscription) {
        await subscription.unsubscribe();
      }
      return false;
    }

    rememberRegisteredVapidPublicKey(vapidPublicKey);

    if (!registrationIsCurrent(generation) || Notification.permission !== 'granted') {
      await revokeSubscription(subscription);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    if (createdSubscription && subscription) {
      try {
        await subscription.unsubscribe();
      } catch (cleanupError) {
        console.error('Failed to clean up incomplete push subscription:', cleanupError);
      }
    }
    return false;
  }
}

function subscriptionUsesApplicationServerKey(
  subscription: PushSubscription,
  expected: Uint8Array<ArrayBuffer>,
  expectedEncoded: string
): boolean {
  const current = subscription.options?.applicationServerKey;
  // Some implementations do not expose this option. Persisting the public
  // VAPID key after a successful server registration lets us still detect a
  // later rotation. A pre-migration subscription without either proof is
  // replaced once, then remains stable on subsequent launches.
  if (!current) return registeredVapidPublicKey() === expectedEncoded;

  const actual = new Uint8Array(current);
  if (actual.length !== expected.length) return false;
  return actual.every((value, index) => value === expected[index]);
}

function registeredVapidPublicKey(): string | null {
  try {
    return window.localStorage.getItem(registeredVapidKeyStorageKey) ?? registeredVapidKeyFallback;
  } catch {
    return registeredVapidKeyFallback;
  }
}

function rememberRegisteredVapidPublicKey(vapidPublicKey: string): void {
  registeredVapidKeyFallback = vapidPublicKey;
  try {
    window.localStorage.setItem(registeredVapidKeyStorageKey, vapidPublicKey);
  } catch {
    // The in-memory fallback still prevents churn during this page lifetime.
  }
}

function currentApplicationOrigin(): string | undefined {
  try {
    return window.location?.origin || undefined;
  } catch {
    return undefined;
  }
}

function registrationIsCurrent(generation: number): boolean {
  return !registrationsSuspended && generation === registrationGeneration;
}

async function revokeSubscription(subscription: PushSubscription): Promise<boolean> {
  const endpoint = subscription.endpoint;
  let browserRemoved = false;
  try {
    browserRemoved = await subscription.unsubscribe();
  } catch (error) {
    console.error('Failed to unsubscribe browser push subscription:', error);
  }

  // Browser revocation is the privacy boundary and must not depend on a live
  // authenticated API session. Server cleanup remains best-effort; a stale
  // record is also removed on the next 404/410 response from the push service.
  void originPushAPI()
    .unsubscribe(endpoint)
    .then((removed) => {
      if (!removed) console.error('Failed to remove push subscription from server');
    })
    .catch((error) => {
      console.error('Failed to remove push subscription from server:', error);
    });

  return browserRemoved;
}

/**
 * Subscribe to push notifications after an explicit user action.
 *
 * @param vapidPublicKey - The server's VAPID public key
 * @returns true if subscription was successful
 */
export async function subscribe(vapidPublicKey: string): Promise<boolean> {
  return ensureRegistered(vapidPublicKey, { prompt: true });
}

/**
 * Unsubscribe from push notifications.
 * This will:
 * 1. Remove the subscription from the server
 * 2. Unsubscribe from the browser's push service
 *
 * @returns true if unsubscription was successful
 */
export async function unsubscribe(): Promise<boolean> {
  registrationGeneration += 1;
  const subscription = await getSubscription();
  if (!subscription) {
    // Already unsubscribed
    return true;
  }

  return revokeSubscription(subscription);
}

/** Close the matching native notification while this PWA is already online. */
export function dismissNativeNotification(notificationId: string): void {
  postServiceWorkerMessage({
    type: 'towk-notification-dismiss',
    notificationId
  });
}

/** Close delivered native notifications that are no longer pending on the server. */
export function reconcileNativeNotifications(notificationIds: Iterable<string>): void {
  const pendingIds = Array.from(
    new Set(
      Array.from(notificationIds).filter(
        (notificationId) => typeof notificationId === 'string' && notificationId !== ''
      )
    )
  );

  postServiceWorkerMessage({
    type: 'towk-notification-state',
    notificationIds: pendingIds
  });
}

export function drainNativeNotificationCloseOutbox(): void {
  postServiceWorkerMessage({
    type: NATIVE_NOTIFICATION_CLOSE_DRAIN_MESSAGE_TYPE
  });
}

export function acknowledgeNativeNotificationClose(notificationId: string): void {
  if (notificationId === '') return;
  postServiceWorkerMessage({
    type: NATIVE_NOTIFICATION_CLOSE_ACK_MESSAGE_TYPE,
    notificationId
  });
}

async function clearLocalNotificationSurfaces(): Promise<void> {
  // This is an authoritative account boundary. Reset the worker's persisted
  // push count as well as the currently rendered badge so a later push cannot
  // resurrect attention belonging to the signed-out account.
  syncServiceWorkerNotificationBadgeState({ kind: 'clear' });

  const registration = await getServiceWorkerRegistration();
  if (registration) {
    try {
      const notifications = await registration.getNotifications();
      for (const notification of notifications) {
        try {
          notification.close();
        } catch {
          // Continue closing the remaining notifications.
        }
      }
    } catch {
      // Browser-native notification cleanup is best-effort at sign-out.
    }
  }

  await clearBadge();
}

/**
 * Stop automatic reconciliation before an origin-account sign-out and revoke
 * the browser endpoint even if the authenticated server call is already lost.
 * A hard navigation resets this module for the next authenticated session.
 */
export async function unsubscribeForSignOut(): Promise<boolean> {
  registrationsSuspended = true;
  registrationGeneration += 1;
  const [subscription] = await Promise.all([getSubscription(), clearLocalNotificationSurfaces()]);
  return subscription ? revokeSubscription(subscription) : true;
}

function originPushAPI() {
  const origin = serverConnectionManager.originClient;
  return createPushNotificationAPI({
    baseUrl: origin.connectBaseUrl,
    bearerToken: origin.bearerToken
  });
}

/**
 * Listen for notification-click messages from the service worker.
 * The SW posts these instead of calling `WindowClient.navigate()` so the
 * SPA can route via `goto()` (client-side navigation, no full reload).
 */
export function onNotificationClick(callback: (url: string) => void | Promise<void>): () => void {
  if (!('serviceWorker' in navigator)) {
    return () => {};
  }

  const handler = (event: MessageEvent) => {
    if (
      event.data?.type === NOTIFICATION_CLICK_MESSAGE_TYPE &&
      typeof event.data.url === 'string'
    ) {
      const responsePort = event.ports[0];
      void (async () => {
        try {
          await callback(event.data.url);
          responsePort?.postMessage({ type: NOTIFICATION_CLICK_ACK_MESSAGE_TYPE });
        } catch {
          // Leave the service worker unacknowledged so it can fall back to
          // WindowClient.navigate() after its timeout.
        }
      })();
    }
  };

  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}

export function onNativeNotificationClose(
  callback: (notificationId: string, source: NativeNotificationClosedMessage['source']) => void
): () => void {
  if (!('serviceWorker' in navigator)) {
    return () => {};
  }

  const handler = (event: MessageEvent) => {
    if (
      event.data?.type === NATIVE_NOTIFICATION_CLOSED_MESSAGE_TYPE &&
      typeof event.data.notificationId === 'string'
    ) {
      callback(
        event.data.notificationId,
        event.data.source === 'replay' ? 'replay' : 'native-close'
      );
    }
  };

  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
