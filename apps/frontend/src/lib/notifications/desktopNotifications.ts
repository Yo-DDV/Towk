import { NotificationItemKind, type NotificationItem } from '$lib/api-client/notifications';

export type DesktopNotificationKind = 'generic' | 'message' | 'call';

export type DesktopNotificationPayload = {
  notificationId: string;
  title: string;
  body: string;
  url: string;
  kind: DesktopNotificationKind;
  silent: boolean;
};

export type DesktopNotificationActivation = {
  notificationId: string;
  url: string;
  action?: 'open' | 'answer' | 'decline';
};

export type DesktopLifecycleEvent = {
  type: 'ready' | 'suspend' | 'resume' | 'locked' | 'unlocked';
  at: number;
};

export type TowkDesktopBridge = {
  isDesktop: true;
  platform: string;
  runtime: 'electron';
  nativeNotifications: true;
  showNotification: (
    payload: DesktopNotificationPayload
  ) => Promise<{ displayed: boolean; reason: string }>;
  getResidentSettings: () => Promise<{
    autostartEnabled: boolean;
    residentNotificationsAvailable: boolean;
  }>;
  setAutostartEnabled: (
    enabled: boolean
  ) => Promise<{ ok: boolean; autostartEnabled?: boolean; code?: string }>;
  onNotificationActivate: (
    callback: (activation: DesktopNotificationActivation) => void
  ) => () => void;
  onLifecycle: (callback: (event: DesktopLifecycleEvent) => void) => () => void;
};

declare global {
  interface Window {
    towkDesktop?: TowkDesktopBridge;
  }
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9._~-]+$/;
const MAX_NATIVE_NOTIFICATION_ID_LENGTH = 160;

export function desktopBridge(): TowkDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.towkDesktop;
  return bridge?.isDesktop === true && bridge.nativeNotifications === true ? bridge : null;
}

export function isNativeDesktopShell(): boolean {
  return desktopBridge() !== null;
}

export function nativeDesktopNotificationId(
  serverId: string,
  notificationId: string
): string | null {
  if (!SAFE_IDENTIFIER.test(serverId) || !SAFE_IDENTIFIER.test(notificationId)) return null;
  const combined = `${serverId}:${notificationId}`;
  return combined.length <= MAX_NATIVE_NOTIFICATION_ID_LENGTH ? combined : null;
}

export function parseNativeDesktopNotificationId(
  value: string
): { serverId: string; notificationId: string } | null {
  if (value.length < 3 || value.length > MAX_NATIVE_NOTIFICATION_ID_LENGTH) return null;
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) return null;
  const serverId = value.slice(0, separator);
  const notificationId = value.slice(separator + 1);
  if (!SAFE_IDENTIFIER.test(serverId) || !SAFE_IDENTIFIER.test(notificationId)) return null;
  return { serverId, notificationId };
}

export function desktopNotificationPayload(
  serverId: string,
  applicationOrigin: string,
  navigationPath: string,
  notification: NotificationItem,
  silent: boolean
): DesktopNotificationPayload | null {
  const notificationId = nativeDesktopNotificationId(serverId, notification.id);
  if (!notificationId) return null;

  let url: URL;
  try {
    url = new URL(navigationPath, applicationOrigin);
  } catch {
    return null;
  }
  if (url.origin !== applicationOrigin || url.username || url.password) return null;

  const title =
    notification.actor?.displayName?.trim() || notification.actor?.login?.trim() || 'TOWK';
  const body = notification.summary.trim();
  if (!title || !body) return null;

  return {
    notificationId,
    title,
    body,
    url: url.href,
    kind:
      notification.kind === NotificationItemKind.CallStarted && !notification.isMissed
        ? 'call'
        : 'message',
    silent
  };
}
