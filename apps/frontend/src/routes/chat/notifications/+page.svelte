<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { SvelteSet } from 'svelte/reactivity';
  import { PaneHeader, EmptyState } from '$lib/ui';
  import { Button } from '$lib/ui/form';
  import * as m from '$lib/i18n/messages';
  import type { NotificationItem } from '$lib/state/server/notifications.svelte';
  import { notificationTarget } from '$lib/state/server/notifications.svelte';
  import { prepareUiForNotificationTarget } from '$lib/notifications/notificationNavigationUi';
  import { getAppUiState } from '$lib/state/appUi.svelte';
  import { sidebarNav } from '$lib/state/globals.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import {
    dismissNativeNotification,
    reconcileNativeNotifications
  } from '$lib/notifications/pushNotifications';

  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { getUserSettings } from '$lib/state/userSettings.svelte';
  import { formatDate } from '$lib/utils/formatTime';
  import { getLocale } from '$lib/i18n/runtime';
  import { delayedLoadingVisible, MOTION_DURATION, motionDuration } from '$lib/ui/motion.svelte';
  import NotificationsServerSidebar from './NotificationsServerSidebar.svelte';

  const userSettings = getUserSettings();
  const activeLocale = $derived(getLocale());
  const appUi = getAppUiState();

  // Collect notification stores from all authenticated instances
  type ServerNotification = {
    serverId: string;
    serverName: string;
    serverHostname: string;
    notification: NotificationItem;
  };

  // Reactive: aggregate notifications from all authenticated instances
  let allNotifications = $derived.by(() => {
    const result: ServerNotification[] = [];

    for (const instance of serverRegistry.servers) {
      const stores = serverRegistry.getStore(instance.id);
      if (!stores.isAuthenticated) continue;

      let hostname: string;
      try {
        hostname = new URL(instance.url).hostname;
      } catch {
        hostname = instance.url;
      }

      const store = stores.notifications;
      for (const notification of store.notifications) {
        result.push({
          serverId: instance.id,
          serverName: stores.serverInfo.name,
          serverHostname: hostname,
          notification
        });
      }
    }

    // Sort by creation time, newest first
    result.sort(
      (a, b) =>
        new Date(b.notification.createdAt).getTime() - new Date(a.notification.createdAt).getTime()
    );
    return result;
  });

  let loading = $state(true);
  let clearing = $state(false);
  let showServerSidebar = $state(false);
  const pendingNotificationIds = new SvelteSet<string>();
  const showDelayedLoading = delayedLoadingVisible(() => loading && allNotifications.length === 0);

  function handleSidebarToggle(): boolean {
    if (!serverRegistry.originServer) return false;

    if (!showServerSidebar) {
      showServerSidebar = true;
      sidebarNav.open();
      return true;
    }

    if (sidebarNav.isOpen) {
      sidebarNav.close();
    } else {
      sidebarNav.open();
    }
    return true;
  }

  onMount(() => sidebarNav.registerToggleHandler(handleSidebarToggle));

  // Fetch notifications from all authenticated instances on mount
  $effect(() => {
    fetchAll();
  });

  async function fetchAll() {
    loading = true;
    const fetches: Promise<void>[] = [];

    for (const instance of serverRegistry.servers) {
      const stores = serverRegistry.getStore(instance.id);
      if (!stores.isAuthenticated) continue;
      fetches.push(stores.notifications.fetch());
    }

    await Promise.allSettled(fetches);
    loading = false;
  }

  function formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return m['chat.notifications.time_now']();
    if (diffMins < 60) return m['chat.notifications.time_minutes']({ count: diffMins });
    if (diffHours < 24) return m['chat.notifications.time_hours']({ count: diffHours });
    if (diffDays < 7) return m['chat.notifications.time_days']({ count: diffDays });

    return formatDate(date, userSettings, activeLocale);
  }

  async function handleClick(item: ServerNotification) {
    if (pendingNotificationIds.has(item.notification.id)) return;
    pendingNotificationIds.add(item.notification.id);
    const stores = serverRegistry.getStore(item.serverId);
    const store = stores.notifications;

    const target = notificationTarget(item.notification);
    prepareUiForNotificationTarget(appUi, item.serverId, target);
    if (target.eventId && target.roomId) {
      stores.pendingHighlights.set(target.roomId, target.threadRootId, target.eventId);
    }
    void store
      .dismiss(item.notification.id)
      .then((dismissed) => {
        if (dismissed) {
          dismissNativeNotification(item.notification.id);
        }
        if (dismissed && target.roomId) {
          stores.rooms.decrementUnreadNotification(target.roomId);
          void stores.rooms.refreshNotificationCounts();
        }
      })
      .catch((error) => {
        console.error('Failed to dismiss notification after click:', error);
      })
      .finally(() => {
        pendingNotificationIds.delete(item.notification.id);
      });

    const path = store.getCleanPath(item.serverId, item.notification);
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- path from getCleanPath() is already resolved
    await goto(path);
  }

  async function handleDismiss(e: Event, item: ServerNotification) {
    e.stopPropagation();
    if (pendingNotificationIds.has(item.notification.id)) return;
    pendingNotificationIds.add(item.notification.id);
    const stores = serverRegistry.getStore(item.serverId);
    const target = notificationTarget(item.notification);
    try {
      const dismissed = await stores.notifications.dismiss(item.notification.id);
      if (dismissed) {
        dismissNativeNotification(item.notification.id);
      }
      if (dismissed && target.roomId) {
        stores.rooms.decrementUnreadNotification(target.roomId);
        void stores.rooms.refreshNotificationCounts();
      }
    } finally {
      pendingNotificationIds.delete(item.notification.id);
    }
  }

  async function handleClearAll() {
    if (clearing) return;
    clearing = true;
    const clears: Promise<void>[] = [];
    for (const instance of serverRegistry.servers) {
      const stores = serverRegistry.getStore(instance.id);
      if (!stores.isAuthenticated) continue;
      const hadNotifications = stores.notifications.unreadNotificationCount > 0;
      clears.push(
        stores.notifications.dismissAll().then((dismissed) => {
          if (hadNotifications || dismissed > 0) {
            stores.rooms.clearAllUnreadNotifications();
            reconcileNativeNotifications([]);
            void stores.rooms.refreshNotificationCounts();
          }
        })
      );
    }
    try {
      await Promise.allSettled(clears);
    } finally {
      clearing = false;
    }
  }
</script>

{#if showServerSidebar}
  <NotificationsServerSidebar />
{/if}

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <PaneHeader
    title={m['chat.notifications.title']()}
    subtitle={m['chat.notifications.subtitle']()}
    showMobileNav
  >
    {#snippet actions()}
      {#if allNotifications.length > 0}
        <Button variant="ghost" size="sm" onclick={handleClearAll} loading={clearing}>
          {m['chat.notifications.clear_all']()}
        </Button>
      {/if}
    {/snippet}
  </PaneHeader>

  <div class="flex flex-1 flex-col overflow-y-auto">
    {#if showDelayedLoading.current}
      <div
        class="space-y-3 p-4"
        aria-busy="true"
        aria-label={m['common.loading']()}
        transition:fade={{ duration: motionDuration(MOTION_DURATION.base) }}
      >
        {#each Array.from({ length: 4 }) as _, index (index)}
          <div class="flex items-center gap-3 rounded-lg px-1 py-2">
            <div class="skeleton h-10 w-10 shrink-0 rounded-full"></div>
            <div class="min-w-0 flex-1 space-y-2">
              <div class="skeleton h-4 w-2/3 rounded"></div>
              <div class="skeleton h-3 w-5/6 rounded"></div>
            </div>
          </div>
        {/each}
      </div>
    {:else if allNotifications.length === 0}
      <div transition:fade={{ duration: motionDuration(MOTION_DURATION.base) }}>
        <EmptyState icon="uil--bell-slash" title={m['chat.notifications.empty_title']()}>
          {m['chat.notifications.empty_body']()}
        </EmptyState>
      </div>
    {:else}
      <div class="flex flex-col surface-pop">
        {#each allNotifications as item (item.notification.id)}
          {@const actor = item.notification.actor ?? null}
          {@const pending = pendingNotificationIds.has(item.notification.id)}
          {@const location = serverRegistry
            .getStore(item.serverId)
            .notifications.getLocationString(item.notification, item.serverName)}
          <div
            class={[
              'flex w-full cursor-pointer items-center gap-3 border-b border-border px-4 py-3 soft-list-item hover:bg-surface-100',
              pending ? 'opacity-60' : ''
            ]}
            role="button"
            tabindex="0"
            data-testid="notification-item"
            aria-busy={pending || undefined}
            onclick={() => handleClick(item)}
            onkeydown={(e) => e.key === 'Enter' && handleClick(item)}
          >
            {#if actor}
              <UserAvatar user={actor} size="md" />
            {/if}

            <div class="min-w-0 flex-1">
              <p class="truncate">{item.notification.summary}</p>
              <p class="text-sm text-muted">
                <span class="truncate">{item.serverHostname}</span>
                {#if location}
                  <span class="mx-1">•</span>
                  <span class="truncate">{location}</span>
                {/if}
                <span class="mx-1">•</span>
                {formatTime(item.notification.createdAt)}
              </p>
            </div>

            <button
              type="button"
              class={[
                'icon-action iconify soft-press',
                pending ? 'uil--spinner-alt animate-spin' : 'uil--times'
              ]}
              title={m['common.dismiss']()}
              disabled={pending}
              aria-busy={pending || undefined}
              onclick={(e) => handleDismiss(e, item)}
            ></button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
