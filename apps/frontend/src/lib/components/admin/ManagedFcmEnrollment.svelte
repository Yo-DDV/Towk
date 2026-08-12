<script lang="ts">
  import { onMount } from 'svelte';
  import {
    enrollManagedFCM,
    getNativeNotificationConfig,
    type NativeNotificationConfig
  } from '$lib/api-client/nativeNotifications';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { localizedErrorMessage } from '$lib/i18n/localizedError';
  import { Button } from '$lib/ui/form';
  import { Hint, Pill } from '$lib/ui';
  import { Panel } from '$lib/components/admin';
  import { toast } from '$lib/ui/toast';
  import * as m from '$lib/i18n/messages';

  const connection = useConnection();
  let config = $state.raw<NativeNotificationConfig | null>(null);
  let loading = $state(true);
  let enrolling = $state(false);
  let error = $state<string | null>(null);

  function apiConfig() {
    const conn = connection();
    return { baseUrl: conn.connectBaseUrl, bearerToken: conn.bearerToken };
  }

  async function load() {
    loading = true;
    error = null;
    try {
      config = await getNativeNotificationConfig(apiConfig());
    } catch (err) {
      error = localizedErrorMessage(err, m['admin.notifications.load_failed']());
    } finally {
      loading = false;
    }
  }

  async function enroll() {
    enrolling = true;
    error = null;
    try {
      config = await enrollManagedFCM(apiConfig());
      toast.success(m['admin.notifications.enrolled']());
    } catch (err) {
      error = localizedErrorMessage(err, m['admin.notifications.enroll_failed']());
    } finally {
      enrolling = false;
    }
  }

  const enrolled = $derived(config?.managedFcmEnrollmentState === 'enrolled');

  onMount(() => void load());
</script>

<Panel title={m['admin.notifications.title']()} icon="iconify uil--bell">
  {#if loading}
    <div class="text-muted">{m['admin.common.loading']()}</div>
  {:else if error && !config}
    <Hint tone="danger">{error}</Hint>
    <Button onclick={load}>{m['admin.notifications.retry']()}</Button>
  {:else if config}
    <div class="flex flex-col gap-4">
      <p class="text-sm text-muted">{m['admin.notifications.description']()}</p>

      {#if !config.androidManagedFcmEnabled}
        <Hint tone="warning">{m['admin.notifications.operator_disabled']()}</Hint>
      {:else if enrolled}
        <Hint tone="success">{m['admin.notifications.privacy']()}</Hint>
      {:else}
        <Hint tone="warning">{m['admin.notifications.required']()}</Hint>
      {/if}

      {#if error}<Hint tone="danger">{error}</Hint>{/if}

      <dl class="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-muted">{m['admin.notifications.status']()}</dt>
          <dd>
            <Pill tone={enrolled ? 'success' : 'muted'}>{config.managedFcmEnrollmentState}</Pill>
          </dd>
        </div>
        <div>
          <dt class="text-muted">{m['admin.notifications.relay']()}</dt>
          <dd class="font-mono break-all">{config.managedFcmRelayUrl || '—'}</dd>
        </div>
      </dl>

      {#if !enrolled && config.androidManagedFcmEnabled}
        <Button onclick={enroll} loading={enrolling} disabled={enrolling}>
          <span class="iconify uil--link"></span>
          {m['admin.notifications.enroll']()}
        </Button>
      {/if}
    </div>
  {/if}
</Panel>
