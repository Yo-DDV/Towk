<!--
@component

Monitors for app updates and reloads automatically only while the app is hidden
and the user is idle (not typing, not in a call). A visible reader
keeps control through the reload toast. As a final fallback, the next safe
navigation triggers a reload to avoid stale chunk errors.

Include this component once at the root layout level.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { updated } from '$app/state';
  import { idleState } from '$lib/state/idle.svelte';
  import { appState } from '$lib/state/globals.svelte';
  import { activatePendingServiceWorker } from '$lib/pwa/serviceWorkerUpdate';
  import { startVersionUpdateMonitor } from '$lib/pwa/versionUpdateMonitor';
  import { serverConnectionManager } from '$lib/state/server/serverConnection.svelte';
  import { selectUpdatePolicy } from '$lib/pwa/updatePolicy';
  import { toast } from '$lib/ui/toast';
  import * as m from '$lib/i18n/messages';

  let updateToastId: string | null = null;
  let updateToastMode: 'reload' | 'update-after-call' | 'scheduled' | null = null;
  let reloadStarted = false;
  let observedDuringCall = false;
  let updateAfterCallRequested = false;
  let websocketReconnectRequested = false;

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
    if (idleState.isInAnyCall) observedDuringCall = true;
    const policy = selectUpdatePolicy({
      isInCall: idleState.isInAnyCall,
      canSafelyReload: idleState.canSafelyReload,
      isAppVisible: appState.isVisible,
      observedDuringCall,
      updateAfterCallRequested
    });

    const requestedMode = updateAfterCallRequested ? 'scheduled' : policy.action;
    if (updateToastMode !== requestedMode) {
      if (updateToastId) toast.remove(updateToastId);
      updateToastMode = requestedMode;
      if (requestedMode === 'scheduled') {
        updateToastId = toast.info(m['ui.update_waiting_for_call'](), 0);
      } else {
        updateToastId = toast.info(m['ui.update_available'](), 0, {
          label:
            requestedMode === 'update-after-call' ? m['ui.update_after_call']() : m['ui.reload'](),
          onClick: () => {
            if (idleState.isInAnyCall) {
              updateAfterCallRequested = true;
              handleAvailableUpdate();
              return;
            }
            void reloadLatestVersion();
          }
        });
      }
    }

    // Avoid perturbing signaling during a live/recovering call. The pending
    // version will reconnect or reload once the call-safe policy allows it.
    if (!idleState.isInAnyCall && !websocketReconnectRequested) {
      websocketReconnectRequested = true;
      serverConnectionManager.originClient.forceReconnect('app update detected');
    }

    if (policy.shouldAutoReload) {
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
