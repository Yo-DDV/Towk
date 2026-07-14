<script lang="ts">
  import { onMount } from 'svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Button from '$lib/ui/form/Button.svelte';
  import { encryptedPrivateData } from '$lib/pwa/privateData';
  import {
    currentInstallEnvironment,
    isAppleMobileDevice,
    isInstalledPwa,
    type BeforeInstallPromptEvent
  } from '$lib/pwa/installPrompt';
  import * as m from '$lib/i18n/messages';

  let installEvent = $state<BeforeInstallPromptEvent | null>(null);
  let dialogVisible = $state(false);
  let appleInstructionsAvailable = $state(false);
  let installed = $state(true);
  let installing = $state(false);

  const available = $derived(!installed && (installEvent !== null || appleInstructionsAvailable));

  onMount(() => {
    const environment = currentInstallEnvironment();
    installed = isInstalledPwa(environment);
    appleInstructionsAvailable = !installed && isAppleMobileDevice(environment);

    function handleInstallPrompt(event: Event) {
      event.preventDefault();
      installEvent = event as BeforeInstallPromptEvent;
      installed = false;
    }

    function handleInstalled() {
      installed = true;
      installEvent = null;
      dialogVisible = false;
    }

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  });

  async function install() {
    if (!installEvent || installing) return;
    installing = true;
    try {
      const promptEvent = installEvent;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        await encryptedPrivateData.requestPersistentStorage().catch(() => false);
        installed = true;
        dialogVisible = false;
      }
      installEvent = null;
    } finally {
      installing = false;
    }
  }
</script>

{#if available}
  <button
    type="button"
    class="app-header-icon"
    onclick={() => (dialogVisible = true)}
    aria-label={m['ui.pwa_install.action']()}
    title={m['ui.pwa_install.action']()}
  >
    <span class="iconify text-lg uil--import" aria-hidden="true"></span>
  </button>
{/if}

<Dialog bind:visible={dialogVisible} title={m['ui.pwa_install.title']()} size="sm">
  <div class="flex flex-col gap-4 text-sm">
    <p>{m['ui.pwa_install.description']()}</p>
    <ul class="list-disc space-y-2 pl-5 text-muted">
      <li>{m['ui.pwa_install.benefit_launch']()}</li>
      <li>{m['ui.pwa_install.benefit_offline']()}</li>
      <li>{m['ui.pwa_install.benefit_notifications']()}</li>
    </ul>

    {#if appleInstructionsAvailable && !installEvent}
      <div class="rounded-md border border-text/10 bg-surface-100 p-3">
        <p class="font-medium">{m['ui.pwa_install.ios_title']()}</p>
        <ol class="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>{m['ui.pwa_install.ios_share']()}</li>
          <li>{m['ui.pwa_install.ios_home_screen']()}</li>
          <li>{m['ui.pwa_install.ios_confirm']()}</li>
        </ol>
      </div>
    {/if}

    {#if installEvent}
      <Button fullWidth loading={installing} onclick={install}>
        {m['ui.pwa_install.install_now']()}
      </Button>
    {/if}
  </div>
</Dialog>
