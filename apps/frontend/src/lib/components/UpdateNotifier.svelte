<!--
@component

Monitors for app updates and reloads the page automatically as soon as the
user is idle (not typing, not in a call — see `idleState.canSafelyReload`).
While the user is busy, a toast offers a manual reload. As a final fallback,
the next navigation triggers a reload to avoid stale chunk errors.

Include this component once at the root layout level.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { updated } from '$app/state';
  import { idleState } from '$lib/state/idle.svelte';
  import { activatePendingServiceWorker } from '$lib/pwa/serviceWorkerUpdate';
  import { startVersionUpdateMonitor } from '$lib/pwa/versionUpdateMonitor';
  import { serverConnectionManager } from '$lib/state/server/serverConnection.svelte';
  import { toast } from '$lib/ui/toast';
  import * as m from '$lib/i18n/messages';

  let updateToastShown = false;
  let reloadStarted = false;

  async function reloadLatestVersion() {
    if (reloadStarted) return;
    reloadStarted = true;

    try {
      if ('serviceWorker' in navigator) {
        await activatePendingServiceWorker(navigator.serviceWorker);
      }
    } finally {
      location.reload();
    }
  }

  function handleAvailableUpdate() {
    if (!updateToastShown) {
      updateToastShown = true;
      toast.info(m['ui.update_available'](), 0, {
        label: m['ui.reload'](),
        onClick: () => void reloadLatestVersion()
      });

      // Force-reconnect the WebSocket — a deploy means the old connection
      // is stale even if the client thinks it's still connected
      serverConnectionManager.originClient.forceReconnect('app update detected');
    }

    if (idleState.canSafelyReload) {
      void reloadLatestVersion();
    }
  }

  onMount(() => {
    const monitor = startVersionUpdateMonitor(updated, handleAvailableUpdate);

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') void monitor.checkNow();
    };
    const checkWhenOnline = () => void monitor.checkNow();

    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('online', checkWhenOnline);

    return () => {
      monitor.stop();
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('online', checkWhenOnline);
    };
  });

  $effect(() => {
    if (!updated.current) return;
    handleAvailableUpdate();
  });

  // Fallback: if the toast was dismissed, use the next safe navigation to
  // prevent stale chunk errors without interrupting typing or a call.
  onNavigate(() => {
    if (updated.current && idleState.canSafelyReload) {
      void reloadLatestVersion();
    }
  });
</script>
