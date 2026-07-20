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
  import { onMount } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
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
    acknowledgeNativeNotificationClose,
    dismissNativeNotification,
    drainNativeNotificationCloseOutbox,
    onNativeNotificationClose,
    reconcileNativeNotifications
  } from '$lib/notifications/pushNotifications';

  type ServerStores = ReturnType<typeof serverRegistry.getStore>;
  type RefreshWork = { pending: Promise<void>; dirty: boolean };
  type AuthoritativeRefreshWork = RefreshWork & { refresh: () => Promise<void> };

  const attemptedInitialNotificationStateRefreshes = new SvelteSet<string>();
  const pendingNotificationStateRefreshes = new SvelteMap<string, AuthoritativeRefreshWork>();

  function refreshAuthoritativeNotificationState(
    instanceId: string,
    stores: ServerStores
  ): Promise<void> {
    const existing = pendingNotificationStateRefreshes.get(instanceId);
    if (existing) {
      existing.dirty = true;
      existing.refresh = () => refreshNotificationState(stores);
      return existing.pending;
    }

    const work: AuthoritativeRefreshWork = {
      pending: Promise.resolve(),
      dirty: false,
      refresh: () => refreshNotificationState(stores)
    };
    pendingNotificationStateRefreshes.set(instanceId, work);
    work.pending = (async () => {
      do {
        work.dirty = false;
        await work.refresh();
      } while (work.dirty);
    })().finally(() => {
      if (pendingNotificationStateRefreshes.get(instanceId) === work) {
        pendingNotificationStateRefreshes.delete(instanceId);
      }
    });
    return work.pending;
  }

  async function refreshNotificationState(stores: ServerStores): Promise<void> {
    const [notifications, roomCounts] = await Promise.allSettled([
      stores.notifications.fetch(),
      stores.rooms.refreshNotificationCounts()
    ]);

    if (notifications.status === 'rejected') {
      console.error(
        'Failed to refresh notifications during app-level reconciliation:',
        notifications.reason
      );
    }
    if (roomCounts.status === 'rejected') {
      console.error(
        'Failed to refresh room notification counts during app-level reconciliation:',
        roomCounts.reason
      );
    }
  }

  function needsAuthoritativeNotificationRefresh(stores: ServerStores): boolean {
    return !stores.notifications.hasLoaded && !stores.notifications.loading;
  }

  function scheduleMissingNotificationStateRefresh(instanceId: string, stores: ServerStores): void {
    if (
      !needsAuthoritativeNotificationRefresh(stores) ||
      attemptedInitialNotificationStateRefreshes.has(instanceId)
    ) {
      return;
    }
    attemptedInitialNotificationStateRefreshes.add(instanceId);
    void refreshAuthoritativeNotificationState(instanceId, stores);
  }

  function refreshAllAuthenticatedNotificationState(options: { onlyMissing?: boolean } = {}): void {
    for (const instance of serverRegistry.servers) {
      const stores = serverRegistry.getStore(instance.id);
      if (!stores.isAuthenticated) continue;
      if (options.onlyMissing) {
        scheduleMissingNotificationStateRefresh(instance.id, stores);
        continue;
      }
      void refreshAuthoritativeNotificationState(instance.id, stores);
    }
  }

  function refreshVisibleAuthenticatedNotificationState(
    options: { onlyMissing?: boolean } = {}
  ): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    refreshAllAuthenticatedNotificationState(options);
  }

  function notificationCreatedEvent(event: EventEnvelope['event']): {
    notificationId: string;
    silent?: boolean;
    notificationCenterSuppressed?: boolean;
  } | null {
    if (
      !event ||
      !('notificationId' in event) ||
      typeof event.notificationId !== 'string' ||
      !('silent' in event)
    ) {
      return null;
    }
    return {
      notificationId: event.notificationId,
      silent: event.silent === true,
      notificationCenterSuppressed:
        'notificationCenterSuppressed' in event && event.notificationCenterSuppressed === true
    };
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
    const pendingCountRefreshes = new SvelteMap<string, RefreshWork>();
    const pendingUnknownDismissalReconciliations = new SvelteMap<string, RefreshWork>();

    function refreshCountsOnce(instanceId: string, refresh: () => Promise<void>): Promise<void> {
      const existing = pendingCountRefreshes.get(instanceId);
      if (existing) {
        existing.dirty = true;
        return existing.pending;
      }

      const work: RefreshWork = { pending: Promise.resolve(), dirty: false };
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

      const work: RefreshWork = { pending: Promise.resolve(), dirty: false };
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
      if (!stores.isAuthenticated) {
        attemptedInitialNotificationStateRefreshes.delete(instance.id);
        continue;
      }

      scheduleMissingNotificationStateRefresh(instance.id, stores);

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
              if (notification.notificationCenterSuppressed) {
                notificationStore.removeCenterNotification(notification.notificationId);
                await Promise.allSettled([
                  notificationStore.addNotificationSignal(notification.notificationId),
                  refreshCountsOnce(instance.id, () => stores.rooms.refreshNotificationCounts())
                ]);
                if (!notification.silent) {
                  playNotificationSound(
                    userPreferences.notificationSound,
                    userPreferences.notificationSoundFilters
                  );
                }
                return;
              }
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

  onMount(() => {
    refreshVisibleAuthenticatedNotificationState({ onlyMissing: true });
    drainNativeNotificationCloseOutbox();

    const handleVisibleResume = () => refreshVisibleAuthenticatedNotificationState();
    const handleOnline = () => refreshAllAuthenticatedNotificationState();
    const stopNativeNotificationClose = onNativeNotificationClose((notificationId) => {
      const originServer = serverRegistry.originServer;
      if (!originServer) return;
      const stores = serverRegistry.getStore(originServer.id);
      if (!stores.isAuthenticated) return;

      void (async () => {
        const dismissed = await stores.notifications.dismissById(notificationId);
        if (!dismissed) return;
        acknowledgeNativeNotificationClose(notificationId);
        await refreshAuthoritativeNotificationState(originServer.id, stores);
      })();
    });

    document.addEventListener('visibilitychange', handleVisibleResume);
    window.addEventListener('focus', handleVisibleResume);
    window.addEventListener('pageshow', handleVisibleResume);
    window.addEventListener('online', handleOnline);
    navigator.serviceWorker?.addEventListener('controllerchange', handleVisibleResume);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibleResume);
      window.removeEventListener('focus', handleVisibleResume);
      window.removeEventListener('pageshow', handleVisibleResume);
      window.removeEventListener('online', handleOnline);
      navigator.serviceWorker?.removeEventListener('controllerchange', handleVisibleResume);
      stopNativeNotificationClose();
    };
  });
</script>
