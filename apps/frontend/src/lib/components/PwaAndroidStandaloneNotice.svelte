<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import {
    currentInstallEnvironment,
    isLegacyAndroidStandaloneInstall
  } from '$lib/pwa/installPrompt';
  import { toast } from '$lib/ui/toast';

  const DISMISSED_SESSION_KEY = 'towk:pwa:android-standalone-notice-dismissed';

  function isDismissedForSession(): boolean {
    try {
      return sessionStorage.getItem(DISMISSED_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }

  function markDismissedForSession(): void {
    try {
      sessionStorage.setItem(DISMISSED_SESSION_KEY, '1');
    } catch {
      // The notice is advisory only; blocked storage must not break app startup.
    }
  }

  onMount(() => {
    if (isDismissedForSession()) return;
    if (!isLegacyAndroidStandaloneInstall(currentInstallEnvironment())) return;

    let toastId = '';
    toastId = toast.warning(
      `${m['ui.pwa_install.android_standalone_notice.title']()} ${m[
        'ui.pwa_install.android_standalone_notice.body'
      ]()}`,
      0,
      {
        label: m['ui.pwa_install.android_standalone_notice.open_in_browser'](),
        onClick: () => {
          markDismissedForSession();
          window.open(window.location.href, '_blank', 'noopener,noreferrer');
          toast.remove(toastId);
        }
      }
    );

    return () => toast.remove(toastId);
  });
</script>
