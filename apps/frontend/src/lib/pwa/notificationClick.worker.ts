import { normalizeSameOriginUrl } from './serviceWorkerPolicy';

export const NOTIFICATION_CLICK_ACK_TIMEOUT_MS = 750;
export const NOTIFICATION_CLICK_MESSAGE_TYPE = 'notification-click';
export const NOTIFICATION_CLICK_ACK_MESSAGE_TYPE = 'notification-click-ack';
const NOTIFICATION_CLICK_FALLBACK_PATH = '/chat';

interface NotificationClickPort {
  onmessage: ((event: MessageEvent) => void) | null;
  close?: () => void;
}

interface NotificationClickMessageChannel {
  port1: NotificationClickPort;
  port2: unknown;
}

export interface NotificationClickClient {
  focus?: () => Promise<NotificationClickClient | null>;
  navigate?: (url: string) => Promise<NotificationClickClient | null>;
  postMessage?: (message: unknown, transfer?: unknown[]) => void;
}

export interface NotificationClickClients {
  matchAll(options: {
    type: 'window';
    includeUncontrolled: true;
  }): Promise<readonly NotificationClickClient[]>;
  openWindow(url: string): Promise<NotificationClickClient | null>;
}

interface NotificationClickLogger {
  warn: (...args: unknown[]) => void;
}

export type NotificationClickRouteResult = 'client' | 'navigate' | 'open';
export type NotificationClickDeliveryResult =
  | NotificationClickRouteResult
  | 'client-unconsumed';

export interface NotificationClickRouteOptions {
  ackTimeoutMs?: number;
  createMessageChannel?: () => NotificationClickMessageChannel;
  logger?: NotificationClickLogger;
  notificationId?: string;
}

function sameOriginURLForPath(origin: string, pathname: string, search = '', hash = ''): string {
  return new URL(`${pathname}${search}${hash}`, origin).href;
}

export function normalizeNotificationClickUrl(rawUrl: string | undefined, origin: string): string {
  const sameOriginUrl = normalizeSameOriginUrl(rawUrl, origin);
  if (sameOriginUrl) return sameOriginUrl;

  if (typeof rawUrl === 'string') {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.pathname === '/chat' || parsed.pathname.startsWith('/chat/')) {
        return sameOriginURLForPath(origin, parsed.pathname, parsed.search, parsed.hash);
      }
    } catch {
      // Fall back to the safe same-origin chat entry point below.
    }
  }

  return sameOriginURLForPath(origin, NOTIFICATION_CLICK_FALLBACK_PATH);
}

function createDefaultMessageChannel(): NotificationClickMessageChannel {
  return new MessageChannel();
}

function notificationClickAckConsumed(message: unknown): boolean | null {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('type' in message) ||
    message.type !== NOTIFICATION_CLICK_ACK_MESSAGE_TYPE
  ) {
    return null;
  }
  return 'notificationConsumed' in message && message.notificationConsumed === true;
}

function notifyClientAndWaitForAck(
  client: NotificationClickClient,
  url: string,
  notificationId: string | undefined,
  options: Required<Pick<NotificationClickRouteOptions, 'ackTimeoutMs' | 'createMessageChannel'>>
): Promise<boolean | null> {
  if (typeof client.postMessage !== 'function') return Promise.resolve(null);
  const postMessage = client.postMessage;

  return new Promise((resolve) => {
    const channel = options.createMessageChannel();
    let settled = false;
    const timeout = setTimeout(() => finish(null), options.ackTimeoutMs);

    function finish(notificationConsumed: boolean | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      channel.port1.onmessage = null;
      channel.port1.close?.();
      resolve(notificationConsumed);
    }

    channel.port1.onmessage = (event) => {
      const notificationConsumed = notificationClickAckConsumed(event.data);
      if (notificationConsumed !== null) finish(notificationConsumed);
    };

    try {
      postMessage.call(
        client,
        {
          type: NOTIFICATION_CLICK_MESSAGE_TYPE,
          url,
          ...(notificationId ? { notificationId } : {})
        },
        [channel.port2]
      );
    } catch {
      finish(null);
    }
  });
}

async function focusClient(
  client: NotificationClickClient,
  logger?: NotificationClickLogger
): Promise<NotificationClickClient | null> {
  if (typeof client.focus !== 'function') return null;
  try {
    return await client.focus();
  } catch (err) {
    logger?.warn('[SW] Failed to focus existing window:', err);
    return null;
  }
}

export async function routeNotificationClick(
  rawUrl: string | undefined,
  origin: string,
  clients: NotificationClickClients,
  options: NotificationClickRouteOptions = {}
): Promise<NotificationClickDeliveryResult> {
  const url = normalizeNotificationClickUrl(rawUrl, origin);
  const notificationId =
    typeof options.notificationId === 'string' && options.notificationId.trim() !== ''
      ? options.notificationId
      : undefined;

  const ackOptions = {
    ackTimeoutMs: options.ackTimeoutMs ?? NOTIFICATION_CLICK_ACK_TIMEOUT_MS,
    createMessageChannel: options.createMessageChannel ?? createDefaultMessageChannel
  };
  const clientList = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });

  for (const client of clientList) {
    const initiallyFocusedClient = await focusClient(client, options.logger);
    const focusedClient = initiallyFocusedClient ?? client;
    const notificationConsumed = await notifyClientAndWaitForAck(
      focusedClient,
      url,
      notificationId,
      ackOptions
    );
    if (notificationConsumed !== null) {
      return !notificationId || notificationConsumed ? 'client' : 'client-unconsumed';
    }

    try {
      const navigatedClient = await focusedClient.navigate?.(url);
      if (navigatedClient) {
        if (!initiallyFocusedClient) await focusClient(navigatedClient, options.logger);
        return 'navigate';
      }
    } catch (err) {
      options.logger?.warn('[SW] Failed to navigate existing window:', err);
    }
  }

  await clients.openWindow(url);
  return 'open';
}
