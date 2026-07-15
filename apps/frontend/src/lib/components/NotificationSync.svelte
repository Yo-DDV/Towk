<!--
@component

Handles real-time notification synchronization across all authenticated instances
and PWA badge updates.

**Responsibilities:**
- Listens for new notifications on all instance event buses and plays the user's selected sound
- Syncs notification dismissals from other devices
- Updates PWA dock badge based on aggregated pending-notification count

Include this component once in the chat layout (unconditionally).
-->
<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { eventBusManager } from '$lib/state/server/eventBus.svelte';
  import { userPreferences } from '$lib/state/userPreferences.svelte';
  import { playNotificationSound } from '$lib/audio/notificationSounds';
  import {
    updateBadge,
    clearBadge,
    syncServiceWorkerNotificationBadgeState,
    type AppBadgeIntent
  } from '$lib/notifications/appBadge';
  import type { EventEnvelope, EventHandler } from '$lib/eventBus.svelte';
  import { RoomEventKind, roomEventKind } from '$lib/render/eventKinds';
  import {
    dismissNativeNotification,
    reconcileNativeNotifications
  } from '$lib/notifications/pushNotifications';

  function notificationCreatedEvent(
    event: EventEnvelope['event']
  ): { notificationId: string; silent?: boolean } | null {
    if (
      !event ||
      !('notificationId' in event) ||
      typeof event.notificationId !== 'string' ||
      !('silent' in event)
    ) {
      return null;
    }
    return { notificationId: event.notificationId, silent: event.silent === true };
  }

  function notificationDismissedEvent(
    event: EventEnvelope['event']
  ): { notificationId: string } | null {
    if (!event || !('notificationId' in event) || typeof event.notificationId !== 'string') {
      return null;
    }
    return { notificationId: event.notificationId };
  }

  // Subscribe to notification events on all authenticated instance buses.
  // Uses the event bus manager directly (not Svelte context) to handle all instances.
  $effect(() => {
    const cleanups: (() => void)[] = [];
    type CoalescedWork = { pending: Promise<void>; dirty: boolean };
    const pendingCountRefreshes = new SvelteMap<string, CoalescedWork>();
    const pendingUnknownDismissalReconciliations = new SvelteMap<string, CoalescedWork>();

    function refreshCountsOnce(instanceId: string, refresh: () => Promise<void>): Promise<void> {
      const existing = pendingCountRefreshes.get(instanceId);
      if (existing) {
        existing.dirty = true;
        return existing.pending;
      }

      const work: CoalescedWork = { pending: Promise.resolve(), dirty: false };
      pendingCountRefreshes.set(instanceId, work);
      work.pending = (async () => {
        let finalError: unknown;
        do {
          work.dirty = false;
          try {
            await refresh();
            finalError = undefined;
          } catch (error) {
            finalError = error;
          }
        } while (work.dirty);
        if (finalError !== undefined) throw finalError;
      })().finally(() => {
        if (pendingCountRefreshes.get(instanceId) === work) {
          pendingCountRefreshes.delete(instanceId);
        }
      });
      return work.pending;
    }

    function reconcileUnknownDismissalOnce(
      instanceId: string,
      reconcile: () => Promise<void>
    ): void {
      const existing = pendingUnknownDismissalReconciliations.get(instanceId);
      if (existing) {
        existing.dirty = true;
        return;
      }

      const work: CoalescedWork = { pending: Promise.resolve(), dirty: false };
      pendingUnknownDismissalReconciliations.set(instanceId, work);
      work.pending = (async () => {
        let finalError: unknown;
        do {
          work.dirty = false;
          try {
            await reconcile();
            finalError = undefined;
          } catch (error) {
            finalError = error;
          }
        } while (work.dirty);
        if (finalError !== undefined) throw finalError;
      })().finally(() => {
        if (pendingUnknownDismissalReconciliations.get(instanceId) === work) {
          pendingUnknownDismissalReconciliations.delete(instanceId);
        }
      });
    }

    for (const instance of serverRegistry.servers) {
      const stores = serverRegistry.getStore(instance.id);
      if (!stores.isAuthenticated) continue;

      const bus = eventBusManager.getBus(instance.id);
      if (!bus) continue;

      const notificationStore = stores.notifications;

      const handler: EventHandler = (event) => {
        if (!event.event) return;

        switch (roomEventKind(event.event)) {
          case RoomEventKind.NotificationCreated: {
            const notification = notificationCreatedEvent(event.event);
            if (!notification) break;
            void (async () => {
              const [hydrated] = await Promise.allSettled([
                notificationStore.addNotification(notification.notificationId),
                refreshCountsOnce(instance.id, () => stores.rooms.refreshNotificationCounts())
              ]);
              if (hydrated.status === 'fulfilled' && hydrated.value && !notification.silent) {
                playNotificationSound(
                  userPreferences.notificationSound,
                  userPreferences.notificationSoundFilters
                );
              }
            })();
            break;
          }
          case RoomEventKind.NotificationDismissed: {
            const notification = notificationDismissedEvent(event.event);
            if (!notification) break;
            if (instance.id === serverRegistry.originServer?.id) {
              dismissNativeNotification(notification.notificationId);
            }
            const roomId = notificationStore.removeNotification(notification.notificationId);
            if (roomId) {
              void refreshCountsOnce(instance.id, () =>
                stores.rooms.refreshNotificationCounts()
              ).catch((error) => {
                console.error('Failed to refresh notification counts after dismissal:', error);
              });
            } else if (!notificationStore.consumeLocalDismissal(notification.notificationId)) {
              reconcileUnknownDismissalOnce(instance.id, async () => {
                await Promise.allSettled([
                  notificationStore.fetch(),
                  refreshCountsOnce(instance.id, () => stores.rooms.refreshNotificationCounts())
                ]);
              });
            }
            break;
          }
        }
      };

      bus.handlers.add(handler);
      cleanups.push(() => bus.handlers.delete(handler));
    }

    return () => {
      for (const fn of cleanups) fn();
    };
  });

  let badgeState = $derived.by((): { intent: AppBadgeIntent; allStoresLoaded: boolean } => {
    let notificationCount = 0;
    let hasNotification = false;
    let allStoresLoaded = true;

    for (const instance of serverRegistry.servers) {
      const stores = serverRegistry.getStore(instance.id);
      if (!stores.isAuthenticated) continue;
      if (!stores.notifications.hasLoaded) allStoresLoaded = false;

      const notifications = stores.notifications.notifications;
      const notificationTotal = stores.notifications.unreadNotificationCount;
      notificationCount += notificationTotal;
      if (notifications.length > 0 || notificationTotal > 0) {
        hasNotification = true;
      }
    }

    if (notificationCount > 0 && allStoresLoaded) {
      return { intent: { kind: 'count', count: notificationCount }, allStoresLoaded };
    }
    if (hasNotification) return { intent: { kind: 'flag' }, allStoresLoaded };
    return { intent: { kind: 'clear' }, allStoresLoaded };
  });

  // Update PWA dock badge based on pending notifications only. Plain unread
  // rooms stay in-app so users can choose notification levels for important rooms.
  $effect(() => {
    if (badgeState.intent.kind === 'clear' && !badgeState.allStoresLoaded) return;

    syncServiceWorkerNotificationBadgeState(badgeState.intent);

    const originServer = serverRegistry.originServer;
    if (originServer) {
      const originStore = serverRegistry.getStore(originServer.id);
      if (
        originStore.isAuthenticated &&
        originStore.notifications.hasCompleteNotificationSnapshot
      ) {
        reconcileNativeNotifications(originStore.notifications.pendingNotificationIds);
      }
    }

    if (badgeState.intent.kind !== 'clear') {
      updateBadge(badgeState.intent);
    } else {
      clearBadge();
    }
  });
</script>
