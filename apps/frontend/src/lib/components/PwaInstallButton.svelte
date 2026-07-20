<script lang="ts">
  import { onMount } from 'svelte';
  import PwaInstallGuide from '$lib/components/PwaInstallGuide.svelte';
  import * as m from '$lib/i18n/messages';
  import {
    PWA_INSTALL_REMINDER_DELAY_MS,
    createInstallReminderState,
    isInstallReminderDue,
    isInstallReminderState,
    markInstallReminderShown,
    recordInstallVisit,
    snoozeInstallReminder,
    type InstallReminderState
  } from '$lib/pwa/installReminderPolicy';
  import {
    INSTALL_PROMPT_CAPTURED_EVENT,
    INSTALL_PROMPT_CLEARED_EVENT,
    clearCapturedInstallPromptEvent,
    currentInstallEnvironment,
    detectInstallBrowser,
    detectInstallPlatform,
    getCapturedInstallPromptEvent,
    isInstalledPwa,
    selectInstallGuide,
    type BeforeInstallPromptEvent,
    type InstallBrowser,
    type InstallGuide,
    type InstallPlatform
  } from '$lib/pwa/installPrompt';
  import { idleState } from '$lib/state/idle.svelte';
  import { Codecs, globalSlot } from '$lib/storage/slot';
  import Dialog from '$lib/ui/Dialog.svelte';
  import Button from '$lib/ui/form/Button.svelte';

  let { remindersEnabled = true }: { remindersEnabled?: boolean } = $props();

  const reminderSlot = globalSlot(
    'pwaInstallReminder',
    createInstallReminderState(),
    Codecs.json<InstallReminderState>(isInstallReminderState)
  );

  let installEvent = $state<BeforeInstallPromptEvent | null>(null);
  let dialogVisible = $state(false);
  let installedContext = $state(false);
  let installedThisSession = $state(false);
  let installFailed = $state(false);
  let installing = $state(false);
  let reminderVisible = $state(false);
  let platform = $state<InstallPlatform>('other');
  let browser = $state<InstallBrowser>('other');
  let guide = $state<InstallGuide>('desktop_other');
  let reminderState = $state<InstallReminderState>(createInstallReminderState());
  let visitStartedAt = 0;

  const installed = $derived(installedContext || installedThisSession);
  const actionLabel = $derived(
    installed ? m['ui.pwa_install.action_installed']() : m['ui.pwa_install.action_install']()
  );

  function refreshInstallContext() {
    const environment = currentInstallEnvironment();
    installedContext = isInstalledPwa(environment);
    platform = detectInstallPlatform(environment);
    browser = detectInstallBrowser(environment);
    guide = selectInstallGuide(platform, browser);
    if (installedContext) {
      installEvent = null;
      clearCapturedInstallPromptEvent();
      reminderVisible = false;
    }
  }

  function openDialog() {
    reminderVisible = false;
    dialogVisible = true;
  }

  function dismissReminder() {
    reminderVisible = false;
    reminderState = snoozeInstallReminder(reminderState, Date.now());
    reminderSlot.set(reminderState);
  }

  function checkReminder() {
    if (
      dialogVisible ||
      reminderVisible ||
      !remindersEnabled ||
      document.visibilityState !== 'visible' ||
      !idleState.canSafelyReload
    ) {
      return;
    }

    const now = Date.now();
    if (
      !isInstallReminderDue(reminderState, {
        installed,
        now,
        engagedForMs: now - visitStartedAt
      })
    ) {
      return;
    }

    reminderVisible = true;
    reminderState = markInstallReminderShown(reminderState, now);
    reminderSlot.set(reminderState);
  }

  async function install() {
    if (!installEvent || installing) return;
    installing = true;
    const promptEvent = installEvent;
    installEvent = null;
    clearCapturedInstallPromptEvent(promptEvent);
    installFailed = false;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        installedThisSession = true;
        reminderVisible = false;
      }
    } catch {
      installFailed = true;
    } finally {
      installing = false;
    }
  }

  onMount(() => {
    refreshInstallContext();
    installEvent = installedContext ? null : getCapturedInstallPromptEvent();
    visitStartedAt = Date.now();
    reminderState = recordInstallVisit(reminderSlot.get());
    reminderSlot.set(reminderState);

    function handleInstallPrompt(event: Event) {
      event.preventDefault();
      installEvent = event as BeforeInstallPromptEvent;
      installedThisSession = false;
      installFailed = false;
    }

    function handleCapturedInstallPrompt() {
      installEvent = getCapturedInstallPromptEvent();
      installedThisSession = false;
      installFailed = false;
    }

    function handleClearedInstallPrompt() {
      installEvent = null;
    }

    function handleInstalled() {
      installedThisSession = true;
      installEvent = null;
      clearCapturedInstallPromptEvent();
      reminderVisible = false;
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== reminderSlot.key) return;
      reminderState = reminderSlot.get();
      checkReminder();
    }

    const displayQueries =
      typeof window.matchMedia === 'function'
        ? [
            '(display-mode: standalone)',
            '(display-mode: fullscreen)',
            '(display-mode: minimal-ui)',
            '(display-mode: window-controls-overlay)'
          ].map((query) => window.matchMedia(query))
        : [];
    const initialReminderTimer = window.setTimeout(checkReminder, PWA_INSTALL_REMINDER_DELAY_MS);
    const reminderPoll = window.setInterval(checkReminder, 30_000);

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener(INSTALL_PROMPT_CAPTURED_EVENT, handleCapturedInstallPrompt);
    window.addEventListener(INSTALL_PROMPT_CLEARED_EVENT, handleClearedInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('focus', refreshInstallContext);
    window.addEventListener('pageshow', refreshInstallContext);
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', checkReminder);
    for (const query of displayQueries) query.addEventListener?.('change', refreshInstallContext);

    return () => {
      window.clearTimeout(initialReminderTimer);
      window.clearInterval(reminderPoll);
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener(INSTALL_PROMPT_CAPTURED_EVENT, handleCapturedInstallPrompt);
      window.removeEventListener(INSTALL_PROMPT_CLEARED_EVENT, handleClearedInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('focus', refreshInstallContext);
      window.removeEventListener('pageshow', refreshInstallContext);
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', checkReminder);
      for (const query of displayQueries) {
        query.removeEventListener?.('change', refreshInstallContext);
      }
    };
  });
</script>

<button
  type="button"
  class={['relative app-header-icon', installed ? 'text-success' : 'text-warning']}
  onclick={openDialog}
  aria-label={actionLabel}
  title={actionLabel}
  data-pwa-status={installed ? 'installed' : 'browser'}
>
  <span
    class={['iconify text-lg', installed ? 'uil--check-circle' : 'uil--import']}
    aria-hidden="true"
  ></span>
  <span
    class={[
      'absolute right-1.5 bottom-1.5 size-2 rounded-full ring-2 ring-surface-100',
      installed ? 'bg-success' : 'bg-warning'
    ]}
    aria-hidden="true"
  ></span>
</button>

<Dialog
  bind:visible={dialogVisible}
  title={installed ? m['ui.pwa_install.installed_title']() : m['ui.pwa_install.title']()}
  size="lg"
>
  <div class="flex flex-col gap-4 text-sm">
    <div class="flex items-start gap-3 rounded-lg bg-surface-100 p-3">
      <img src="/icons/icon-192.png" alt="" class="size-12 shrink-0 rounded-xl" />
      <div class="min-w-0">
        <p class="font-semibold text-text">Towk</p>
        <p class={['mt-0.5 text-xs font-medium', installed ? 'text-success' : 'text-warning']}>
          {installed
            ? m['ui.pwa_install.status_installed']()
            : m['ui.pwa_install.status_browser']()}
        </p>
      </div>
    </div>

    {#if installed}
      <p>{m['ui.pwa_install.installed_description']()}</p>
    {:else}
      <p>{m['ui.pwa_install.description']()}</p>
      <p class="rounded-md border border-accent/20 bg-accent/5 p-3 text-muted">
        {m['ui.pwa_install.explanation']()}
      </p>
    {/if}

    <ul class="grid gap-2 sm:grid-cols-3">
      <li class="rounded-md border border-text/10 p-2.5">
        <span class="iconify text-lg text-accent uil--window" aria-hidden="true"></span>
        <p class="mt-1 text-xs text-muted">{m['ui.pwa_install.benefit_launch']()}</p>
      </li>
      <li class="rounded-md border border-text/10 p-2.5">
        <span class="iconify text-lg text-accent uil--bolt-alt" aria-hidden="true"></span>
        <p class="mt-1 text-xs text-muted">{m['ui.pwa_install.benefit_focus']()}</p>
      </li>
      <li class="rounded-md border border-text/10 p-2.5">
        <span class="iconify text-lg text-accent uil--bell" aria-hidden="true"></span>
        <p class="mt-1 text-xs text-muted">{m['ui.pwa_install.benefit_notifications']()}</p>
      </li>
    </ul>

    {#if !installed}
      {#if installEvent}
        <div class="rounded-lg border border-success/25 bg-success/5 p-3">
          <p class="font-medium text-text">{m['ui.pwa_install.native_title']()}</p>
          <p class="mt-1 text-xs text-muted">{m['ui.pwa_install.native_description']()}</p>
        </div>
        <Button
          fullWidth
          loading={installing}
          loadingText={m['ui.pwa_install.installing']()}
          onclick={install}
        >
          {m['ui.pwa_install.install_now']()}
        </Button>
      {/if}

      {#if installFailed}
        <p
          class="rounded-md border border-warning/25 bg-warning/5 p-3 text-xs text-muted"
          role="alert"
        >
          {m['ui.pwa_install.install_failed']()}
        </p>
      {/if}

      <div>
        <p class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
          {m['ui.pwa_install.guide_title']()}
        </p>
        <PwaInstallGuide {guide} {browser} />
      </div>
    {/if}
  </div>
</Dialog>

{#if reminderVisible && !dialogVisible}
  <div
    class="pointer-events-none fixed right-3 bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] left-3 z-[55] flex justify-center sm:right-4 sm:left-auto sm:w-[24rem]"
  >
    <section
      class="pointer-events-auto w-full rounded-lg border border-text/10 bg-surface-100 p-2 shadow-xl"
      role="status"
      aria-live="polite"
      data-testid="pwa-install-reminder"
    >
      <div class="rounded-md bg-background p-3">
        <div class="flex gap-3">
          <span class="mt-0.5 iconify shrink-0 text-xl text-accent uil--import" aria-hidden="true"
          ></span>
          <div class="min-w-0 flex-1">
            <p class="font-medium text-text">{m['ui.pwa_install.reminder_title']()}</p>
            <p class="mt-1 text-sm text-muted">{m['ui.pwa_install.reminder_message']()}</p>
          </div>
        </div>
        <div class="mt-3 flex justify-end gap-2">
          <button type="button" class="btn-secondary btn-sm" onclick={dismissReminder}
            >{m['ui.pwa_install.later']()}</button
          >
          <button type="button" class="btn-accent btn-sm" onclick={openDialog}
            >{m['ui.pwa_install.show_guide']()}</button
          >
        </div>
      </div>
    </section>
  </div>
{/if}
