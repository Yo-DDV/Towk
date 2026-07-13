<!--
@component

Shows a persistent, non-blocking Web Push reminder. A confirmed refusal snoozes
the reminder for seven days; losing a previously granted permission restores it.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import {
    ensureRegistered,
    getPushCapability,
    getPermission
  } from '$lib/notifications/pushNotifications';
  import {
    isPushPromptReminderDue,
    nextPushPromptReminderAt
  } from '$lib/notifications/pushPromptPolicy';
  import { serverIdToSegment } from '$lib/navigation';
  import { Codecs, serverSlot } from '$lib/storage/slot';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { ConfirmDialog, TopOverlayNotice } from '$lib/ui';
  import { toast } from '$lib/ui/toast';
  import * as m from '$lib/i18n/messages';

  let { userId }: { userId: string } = $props();

  const originId = serverRegistry.originServer?.id ?? '';
  const originServerInfo = originId ? serverRegistry.getStore(originId).serverInfo : undefined;
  // svelte-ignore state_referenced_locally
  const snoozedUntilSlot = serverSlot(
    originId,
    `user:${userId}:pushPromptSnoozedUntil`,
    0,
    Codecs.number({ min: 0 })
  );
  // svelte-ignore state_referenced_locally
  const legacyDismissedSlot = serverSlot(
    originId,
    `user:${userId}:pushPromptDismissed`,
    false,
    Codecs.boolean
  );
  // Remember the last permission seen on this device so revocation while the
  // PWA is closed can invalidate an earlier reminder snooze on next launch.
  // svelte-ignore state_referenced_locally
  const lastObservedPermissionSlot = serverSlot(
    originId,
    `user:${userId}:pushPromptLastPermission`,
    '',
    Codecs.string
  );

  let snoozedUntil = $state(snoozedUntilSlot.get());
  let now = $state(Date.now());
  let permission = $state<NotificationPermission | null>(getPermission());
  let registrationHealthy = $state<boolean | null>(null);
  let loading = $state(false);
  let confirmOptOutVisible = $state(false);
  let permissionRefreshGeneration = 0;

  const pushCapability = getPushCapability();
  const supported = pushCapability === 'supported';
  const needsIosHomeScreen = pushCapability === 'ios_home_screen_required';
  const vapidKey = $derived(originServerInfo?.vapidPublicKey ?? null);
  const canShowPushPrompt = $derived(
    Boolean(
      originServerInfo?.pushNotificationsEnabled &&
      vapidKey &&
      isPushPromptReminderDue(snoozedUntil, now)
    )
  );
  const shouldShowEnablePrompt = $derived(
    canShowPushPrompt &&
      supported &&
      (permission === 'default' || (permission === 'granted' && registrationHealthy === false))
  );
  const shouldShowBlockedPrompt = $derived(
    canShowPushPrompt && supported && permission === 'denied'
  );
  const shouldShowIosHomeScreenNotice = $derived(canShowPushPrompt && needsIosHomeScreen);

  function clearReminderSnooze() {
    snoozedUntil = 0;
    snoozedUntilSlot.remove();
  }

  function applyObservedPermission(nextPermission: NotificationPermission | null) {
    const previouslyObserved = lastObservedPermissionSlot.get();
    if (
      nextPermission !== 'granted' &&
      (permission === 'granted' || previouslyObserved === 'granted')
    ) {
      clearReminderSnooze();
    }
    if (nextPermission) lastObservedPermissionSlot.set(nextPermission);
    permission = nextPermission;
    now = Date.now();
  }

  async function refreshPermissionState(configuredVapidKey = vapidKey) {
    const generation = ++permissionRefreshGeneration;
    const nextPermission = getPermission();
    applyObservedPermission(nextPermission);
    registrationHealthy = null;

    if (nextPermission === 'granted' && configuredVapidKey) {
      const healthy = await ensureRegistered(configuredVapidKey, { prompt: false });
      if (generation !== permissionRefreshGeneration) return;

      const currentPermission = getPermission();
      if (currentPermission !== nextPermission) {
        applyObservedPermission(currentPermission);
        registrationHealthy = null;
        void refreshPermissionState();
        return;
      }
      registrationHealthy = healthy;
    }
  }

  function requestOptOut() {
    confirmOptOutVisible = true;
  }

  function confirmOptOut() {
    snoozedUntil = nextPushPromptReminderAt();
    snoozedUntilSlot.set(snoozedUntil);
    confirmOptOutVisible = false;
  }

  function openNotificationSettings() {
    void goto(
      resolve('/chat/[serverId]/settings/notifications', {
        serverId: serverIdToSegment(originId)
      })
    );
  }

  async function enablePush() {
    if (!vapidKey) return;

    loading = true;
    try {
      const enabled = await ensureRegistered(vapidKey, { prompt: true });
      applyObservedPermission(getPermission());
      registrationHealthy = permission === 'granted' ? enabled : null;

      if (enabled) {
        clearReminderSnooze();
        toast.success(m['settings.notifications.push_prompt.enabled']());
        return;
      }

      if (permission === 'denied') {
        toast.warning(m['settings.notifications.push_prompt.blocked']());
      } else {
        toast.error(m['settings.notifications.push_prompt.enable_failed']());
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    // Migrate the old permanent opt-out into the new reminder policy.
    legacyDismissedSlot.remove();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshPermissionState();
    };
    const handleControllerChange = () => void refreshPermissionState();
    const handleFocus = () => void refreshPermissionState();
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== snoozedUntilSlot.key) return;
      snoozedUntil = snoozedUntilSlot.get();
      now = Date.now();
      void refreshPermissionState();
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    navigator.serviceWorker?.addEventListener('controllerchange', handleControllerChange);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener('controllerchange', handleControllerChange);
    };
  });

  // Configuration arrives asynchronously with server state and can rotate at
  // runtime. This single owner replaces the old parallel setup component,
  // avoiding duplicate server writes while retaining automatic reconciliation.
  $effect(() => {
    const configured = originServerInfo?.pushNotificationsEnabled;
    const configuredVapidKey = vapidKey;
    if (!configured || !configuredVapidKey) return;
    void refreshPermissionState(configuredVapidKey);
  });

  $effect(() => {
    const delay = snoozedUntil - now;
    if (delay <= 0) return;
    const timeout = window.setTimeout(() => {
      now = Date.now();
    }, delay + 1);
    return () => window.clearTimeout(timeout);
  });
</script>

{#if shouldShowEnablePrompt}
  <TopOverlayNotice
    title={m['settings.notifications.push_prompt.title']()}
    message={m['settings.notifications.push_prompt.message']()}
    icon="uil--bell"
    tone="info"
    {loading}
    primaryAction={{
      label: loading
        ? m['settings.notifications.push_prompt.enabling']()
        : m['settings.notifications.push_prompt.enable'](),
      icon: 'uil--bell',
      onclick: enablePush
    }}
    secondaryAction={{
      label: m['settings.notifications.push_prompt.dismiss'](),
      onclick: requestOptOut
    }}
  />
{:else if shouldShowBlockedPrompt}
  <TopOverlayNotice
    title={m['settings.notifications.push_prompt.blocked_title']()}
    message={m['settings.notifications.push_prompt.blocked_message']()}
    icon="uil--bell-slash"
    tone="warning"
    primaryAction={{
      label: m['settings.notifications.push_prompt.blocked_action'](),
      icon: 'uil--setting',
      onclick: openNotificationSettings
    }}
    secondaryAction={{
      label: m['settings.notifications.push_prompt.dismiss'](),
      onclick: requestOptOut
    }}
  />
{:else if shouldShowIosHomeScreenNotice}
  <TopOverlayNotice
    title={m['settings.notifications.push_prompt.ios_home_screen_title']()}
    message={m['settings.notifications.push_prompt.ios_home_screen_message']()}
    icon="uil--mobile-android"
    tone="info"
    secondaryAction={{
      label: m['settings.notifications.push_prompt.dismiss'](),
      onclick: requestOptOut
    }}
  />
{/if}

{#if confirmOptOutVisible}
  <ConfirmDialog
    title={m['settings.notifications.push_prompt.confirm_title']()}
    tone="warning"
    actionLabel={m['settings.notifications.push_prompt.confirm_action']()}
    onconfirm={confirmOptOut}
    onclose={() => (confirmOptOutVisible = false)}
  >
    {m['settings.notifications.push_prompt.confirm_message']()}
  </ConfirmDialog>
{/if}
