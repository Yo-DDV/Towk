<!--
@component

Synchronizes authoritative Towk notifications with the installed Electron shell.
The shell owns OS presentation and foreground suppression; this component owns
server scoping, navigation, dismissal and call admission.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { NotificationItemKind, type NotificationItem } from '$lib/api-client/notifications';
  import type { EventHandler } from '$lib/eventBus.svelte';
  import * as m from '$lib/i18n/messages';
  import {
    desktopBridge,
    desktopNotificationPayload,
    nativeDesktopNotificationId,
    parseNativeDesktopNotificationId,
    type DesktopNotificationActivation
  } from '$lib/notifications/desktopNotifications';
  import { RoomEventKind, roomEventKind } from '$lib/render/eventKinds';
  import { toast } from '$lib/ui/toast';
  import { eventBusManager } from '$lib/state/server/eventBus.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { getVoiceCallJoinErrorMessage } from '$lib/state/server/voiceCall.svelte';

  const requested = new SvelteSet<string>();
  const silentByNotification = new SvelteMap<string, boolean>();
  let activationQueue: Promise<void> = Promise.resolve();

  function boundedRemember(notificationId: string): void {
    requested.add(notificationId);
    while (requested.size > 2048) {
      const oldest = requested.values().next().value;
      if (typeof oldest !== 'string') break;
      requested.delete(oldest);
    }
  }

  function requestDesktopNotification(
    serverId: string,
    notification: NotificationItem,
    navigationPath: string
  ): void {
    const bridge = desktopBridge();
    if (!bridge) return;
    const nativeId = nativeDesktopNotificationId(serverId, notification.id);
    if (!nativeId || requested.has(nativeId)) return;

    const payload = desktopNotificationPayload(
      serverId,
      window.location.origin,
      navigationPath,
      notification,
      silentByNotification.get(nativeId) === true
    );
    if (!payload) return;

    boundedRemember(nativeId);
    void bridge.showNotification(payload).catch((error) => {
      requested.delete(nativeId);
      console.error('Failed to display resident desktop notification:', error);
    });
  }

  $effect(() => {
    if (!desktopBridge()) return;

    for (const server of serverRegistry.servers) {
      const stores = serverRegistry.tryGetStore(server.id);
      if (!stores?.isAuthenticated) continue;
      for (const notification of stores.notifications.allNotificationSignals) {
        requestDesktopNotification(
          server.id,
          notification,
          stores.notifications.getNavigationPath(server.id, notification)
        );
      }
    }
  });

  // Preserve the server-provided silent flag until NotificationSync hydrates
  // the authoritative item into the per-server store.
  $effect(() => {
    if (!desktopBridge()) return;
    const cleanups: (() => void)[] = [];

    for (const server of serverRegistry.servers) {
      const stores = serverRegistry.tryGetStore(server.id);
      if (!stores?.isAuthenticated) continue;
      const bus = eventBusManager.getBus(server.id);
      if (!bus) continue;

      const handler: EventHandler = (event) => {
        if (!event.event || roomEventKind(event.event) !== RoomEventKind.NotificationCreated)
          return;
        if (!('notificationId' in event.event) || typeof event.event.notificationId !== 'string') {
          return;
        }
        const nativeId = nativeDesktopNotificationId(server.id, event.event.notificationId);
        if (!nativeId) return;
        silentByNotification.set(nativeId, 'silent' in event.event && event.event.silent === true);
      };
      bus.handlers.add(handler);
      cleanups.push(() => bus.handlers.delete(handler));
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  });

  async function resolveNotification(
    serverId: string,
    notificationId: string
  ): Promise<NotificationItem | null> {
    const stores = serverRegistry.tryGetStore(serverId);
    if (!stores?.isAuthenticated) return null;
    let notification = stores.notifications.allNotificationSignals.find(
      (candidate) => candidate.id === notificationId
    );
    if (notification) return notification;

    await stores.notifications.fetch();
    notification = stores.notifications.allNotificationSignals.find(
      (candidate) => candidate.id === notificationId
    );
    return notification ?? null;
  }

  async function answerCall(serverId: string, notification: NotificationItem): Promise<void> {
    if (notification.kind !== NotificationItemKind.CallStarted || !notification.callRoom) return;
    const stores = serverRegistry.tryGetStore(serverId);
    if (!stores?.isAuthenticated) return;

    await stores.activeCallRooms.load();
    const currentCallId = stores.activeCallRooms.getCallId(notification.callRoom.id);
    if (currentCallId !== notification.callId) {
      toast.error(m['voice.call_no_longer_active']());
      return;
    }

    if (!stores.serverInfo.livekitUrl) {
      await stores.serverInfo.refreshAuthenticatedSettings();
    }
    const livekitUrl = stores.serverInfo.livekitUrl;
    if (!livekitUrl) {
      toast.error(m['voice.join_failed']());
      return;
    }

    try {
      // A desktop notification click is an explicit answer gesture. Transfer
      // keeps that gesture deterministic when another device of the same user
      // is still attached to the call.
      await stores.voiceCall.join(
        livekitUrl,
        notification.callRoom.id,
        'transfer',
        notification.callId
      );
    } catch (error) {
      toast.error(getVoiceCallJoinErrorMessage(error));
    }
  }

  async function handleActivation(activation: DesktopNotificationActivation): Promise<void> {
    const parsed = parseNativeDesktopNotificationId(activation.notificationId);
    if (!parsed) return;
    const stores = serverRegistry.tryGetStore(parsed.serverId);
    if (!stores?.isAuthenticated) return;

    const notification = await resolveNotification(parsed.serverId, parsed.notificationId);
    if (!notification) {
      try {
        const fallback = new URL(activation.url, window.location.origin);
        if (fallback.origin === window.location.origin) {
          await goto(`${fallback.pathname}${fallback.search}${fallback.hash}`);
        }
      } catch {
        // The main process already validates activation URLs. A malformed IPC
        // replay remains a no-op in the renderer.
      }
      return;
    }

    if (activation.action === 'decline') {
      await stores.notifications.dismissById(notification.id);
      void stores.rooms.refreshNotificationCounts();
      return;
    }

    const path = stores.notifications.getNavigationPath(parsed.serverId, notification);
    await stores.notifications.dismissById(notification.id);
    void stores.rooms.refreshNotificationCounts();
    await goto(path);
    if (
      notification.kind === NotificationItemKind.CallStarted &&
      (activation.action === undefined ||
        activation.action === 'open' ||
        activation.action === 'answer')
    ) {
      await answerCall(parsed.serverId, notification);
    }
  }

  function refreshResidentState(): void {
    for (const server of serverRegistry.servers) {
      const stores = serverRegistry.tryGetStore(server.id);
      if (!stores?.isAuthenticated) continue;
      void stores.notifications.fetch();
      if (stores.serverInfo.livekitUrl) void stores.activeCallRooms.load();
    }
  }

  onMount(() => {
    const bridge = desktopBridge();
    if (!bridge) return;

    const stopActivation = bridge.onNotificationActivate((activation) => {
      activationQueue = activationQueue
        .then(() => handleActivation(activation))
        .catch((error) => {
          console.error('Failed to activate resident desktop notification:', error);
        });
    });
    const stopLifecycle = bridge.onLifecycle((event) => {
      if (event.type === 'ready' || event.type === 'resume' || event.type === 'unlocked') {
        refreshResidentState();
      }
    });
    const handleOnline = () => refreshResidentState();
    window.addEventListener('online', handleOnline);
    refreshResidentState();

    return () => {
      stopActivation();
      stopLifecycle();
      window.removeEventListener('online', handleOnline);
    };
  });
</script>
