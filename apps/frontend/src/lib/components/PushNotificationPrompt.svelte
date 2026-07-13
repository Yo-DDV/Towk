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

  let snoozedUntil = $state(snoozedUntilSlot.get());
  let now = $state(Date.now());
  let permission = $state<NotificationPermission | null>(getPermission());
  let loading = $state(false);
  let confirmOptOutVisible = $state(false);

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
    canShowPushPrompt && supported && permission === 'default'
  );
  const shouldShowBlockedPrompt = $derived(
    canShowPushPrompt && supported && permission === 'denied'
  );
  const shouldShowIosHomeScreenNotice = $derived(canShowPushPrompt && needsIosHomeScreen);

  function clearReminderSnooze() {
    snoozedUntil = 0;
    snoozedUntilSlot.remove();
  }

  function refreshPermissionState() {
    const nextPermission = getPermission();
    if (permission === 'granted' && nextPermission !== 'granted') {
      clearReminderSnooze();
    }
    if (nextPermission === 'granted') {
      clearReminderSnooze();
    }
    permission = nextPermission;
    now = Date.now();
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
      permission = getPermission();

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
    refreshPermissionState();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshPermissionState();
    };
    window.addEventListener('focus', refreshPermissionState);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshPermissionState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
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
