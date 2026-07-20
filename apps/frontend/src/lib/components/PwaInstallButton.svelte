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
    hasInstalledRelatedPwa,
    isInstalledPwa,
    selectInstallGuide,
    usesBeforeInstallPrompt,
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
  const componentId = $props.id();
  const reminderTitleId = `${componentId}-pwa-install-reminder-title`;

  let installEvent = $state<BeforeInstallPromptEvent | null>(null);
  let dialogVisible = $state(false);
  let detectionComplete = $state(false);
  let installedContext = $state(false);
  let installedRelatedPwa = $state(false);
  let installedThisSession = $state(false);
  let installFailed = $state(false);
  let installing = $state(false);
  let manualGuideVisible = $state(false);
  let nativePromptConsumed = $state(false);
  let reminderVisible = $state(false);
  let platform = $state<InstallPlatform>('other');
  let browser = $state<InstallBrowser>('other');
  let guide = $state<InstallGuide>('desktop_other');
  let reminderState = $state<InstallReminderState>(createInstallReminderState());
  let visitStartedAt = 0;
  let installDetectionGeneration = 0;

  const installed = $derived(installedContext || installedRelatedPwa || installedThisSession);
  const promptDrivenBrowser = $derived(usesBeforeInstallPrompt(platform, browser));
  const installPromotionAvailable = $derived(
    detectionComplete &&
      !installed &&
      (!promptDrivenBrowser || installEvent !== null || nativePromptConsumed || installFailed)
  );

  async function refreshInstallContext() {
    const generation = ++installDetectionGeneration;
    const environment = currentInstallEnvironment();
    installedContext = isInstalledPwa(environment);
    platform = detectInstallPlatform(environment);
    browser = detectInstallBrowser(environment);
    guide = selectInstallGuide(platform, browser);
    if (installedContext) {
      detectionComplete = true;
      installedRelatedPwa = false;
      installEvent = null;
      clearCapturedInstallPromptEvent();
      reminderVisible = false;
      return;
    }

    installedRelatedPwa = await hasInstalledRelatedPwa();
    if (generation !== installDetectionGeneration) return;
    detectionComplete = true;
    if (installedRelatedPwa) {
      installEvent = null;
      clearCapturedInstallPromptEvent();
      reminderVisible = false;
    }
  }

  function openDialog() {
    reminderVisible = false;
    manualGuideVisible = false;
    dialogVisible = true;
  }

  function dismissReminder() {
    reminderVisible = false;
    reminderState = snoozeInstallReminder(reminderState, Date.now());
    reminderSlot.set(reminderState);
  }

  async function acceptReminder() {
    reminderVisible = false;
    if (!installEvent) {
      openDialog();
      return;
    }

    await install();
    if (installFailed) dialogVisible = true;
  }

  function checkReminder() {
    if (
      dialogVisible ||
      reminderVisible ||
      !remindersEnabled ||
      !installPromotionAvailable ||
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
    clearCapturedInstallPromptEvent(promptEvent);
    installFailed = false;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        dialogVisible = false;
        installedThisSession = true;
        reminderVisible = false;
      } else {
        installEvent = null;
        nativePromptConsumed = true;
        manualGuideVisible = true;
      }
    } catch {
      installEvent = null;
      nativePromptConsumed = true;
      installFailed = true;
      manualGuideVisible = true;
    } finally {
      installing = false;
    }
  }

  onMount(() => {
    void refreshInstallContext();
    installEvent = installedContext ? null : getCapturedInstallPromptEvent();
    visitStartedAt = Date.now();
    reminderState = recordInstallVisit(reminderSlot.get());
    reminderSlot.set(reminderState);

    function handleInstallPrompt(event: Event) {
      event.preventDefault();
      installEvent = event as BeforeInstallPromptEvent;
      detectionComplete = true;
      installedRelatedPwa = false;
      installedThisSession = false;
      nativePromptConsumed = false;
      installFailed = false;
    }

    function handleCapturedInstallPrompt() {
      installEvent = getCapturedInstallPromptEvent();
      detectionComplete = true;
      installedRelatedPwa = false;
      installedThisSession = false;
      nativePromptConsumed = false;
      installFailed = false;
    }

    function handleClearedInstallPrompt() {
      installEvent = null;
      reminderVisible = false;
    }

    function handleInstalled() {
      dialogVisible = false;
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
    const handleRefreshInstallContext = () => void refreshInstallContext();
    window.addEventListener('focus', handleRefreshInstallContext);
    window.addEventListener('pageshow', handleRefreshInstallContext);
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
      window.removeEventListener('focus', handleRefreshInstallContext);
      window.removeEventListener('pageshow', handleRefreshInstallContext);
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', checkReminder);
      for (const query of displayQueries) {
        query.removeEventListener?.('change', refreshInstallContext);
      }
    };
  });
</script>

{#if installPromotionAvailable}
  <button
    type="button"
    class="relative app-header-icon text-warning"
    onclick={openDialog}
    aria-label={m['ui.pwa_install.action_install']()}
    title={m['ui.pwa_install.action_install']()}
    data-pwa-status="browser"
  >
    <span class="iconify text-lg uil--import" aria-hidden="true"></span>
    <span
      class="absolute right-1.5 bottom-1.5 size-2 rounded-full bg-warning ring-2 ring-surface-100"
      aria-hidden="true"
    ></span>
  </button>

  <Dialog bind:visible={dialogVisible} title={m['ui.pwa_install.title']()} size="lg" tall>
    <div
      class={[
        'pwa-install-content flex flex-col gap-4 text-sm',
        (!installEvent || manualGuideVisible) && 'pwa-install-content--with-guide'
      ]}
      data-testid="pwa-install-dialog-content"
    >
      <div class="pwa-install-intro flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" class="size-12 shrink-0 rounded-xl" />
        <p class="min-w-0 text-base leading-snug font-medium text-text">
          {m['ui.pwa_install.description']()}
        </p>
      </div>

      <ul
        class="pwa-install-benefits flex flex-wrap gap-2"
        aria-label={m['ui.pwa_install.benefits_label']()}
      >
        <li
          class="flex items-center gap-1.5 rounded-full bg-surface-100 px-2.5 py-1.5 text-xs text-muted"
        >
          <span class="iconify shrink-0 text-base text-accent uil--rocket" aria-hidden="true"
          ></span>
          <span>{m['ui.pwa_install.benefit_launch']()}</span>
        </li>
        <li
          class="flex items-center gap-1.5 rounded-full bg-surface-100 px-2.5 py-1.5 text-xs text-muted"
        >
          <span class="iconify shrink-0 text-base text-accent uil--window" aria-hidden="true"
          ></span>
          <span>{m['ui.pwa_install.benefit_focus']()}</span>
        </li>
        <li
          class="flex items-center gap-1.5 rounded-full bg-surface-100 px-2.5 py-1.5 text-xs text-muted"
        >
          <span class="iconify shrink-0 text-base text-accent uil--bell" aria-hidden="true"></span>
          <span>{m['ui.pwa_install.benefit_notifications']()}</span>
        </li>
      </ul>

      {#if installFailed}
        <p
          class="rounded-md border border-warning/25 bg-warning/5 p-3 text-xs text-muted"
          role="alert"
        >
          {m['ui.pwa_install.install_failed']()}
        </p>
      {/if}

      {#if installEvent}
        <Button
          fullWidth
          loading={installing}
          loadingText={m['ui.pwa_install.installing']()}
          onclick={install}
        >
          {m['ui.pwa_install.install_now']()}
        </Button>

        <button
          type="button"
          class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-1.5 text-left text-xs font-medium text-muted transition-colors hover:text-text"
          onclick={() => (manualGuideVisible = !manualGuideVisible)}
          aria-expanded={manualGuideVisible}
          data-testid="pwa-install-manual-toggle"
        >
          <span>{m['ui.pwa_install.manual_help']()}</span>
          <span
            class={[
              'iconify shrink-0 text-base transition-transform uil--angle-down',
              manualGuideVisible && 'rotate-180'
            ]}
            aria-hidden="true"
          ></span>
        </button>

        {#if manualGuideVisible}
          <div class="pwa-install-guide-slot">
            <PwaInstallGuide {guide} {browser} {platform} />
          </div>
        {/if}
      {:else}
        <div class="pwa-install-guide-slot">
          <PwaInstallGuide {guide} {browser} {platform} />
        </div>
      {/if}
    </div>
  </Dialog>
{/if}

{#if reminderVisible && !dialogVisible}
  <div
    class="pwa-install-reminder-shell pointer-events-none fixed right-3 bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] left-3 z-[55] flex justify-center sm:right-4 sm:left-auto sm:w-[25rem]"
  >
    <section
      class="pwa-install-reminder pointer-events-auto relative w-full overflow-hidden rounded-2xl border border-accent/20 bg-surface-100/95 p-4 shadow-2xl backdrop-blur-xl"
      aria-labelledby={reminderTitleId}
      data-testid="pwa-install-reminder"
    >
      <span
        class="pointer-events-none absolute -top-16 -right-12 size-36 rounded-full bg-accent/12 blur-3xl"
        aria-hidden="true"
      ></span>
      <div
        class="pwa-install-reminder-copy relative flex items-start gap-3.5"
        aria-live="polite"
        aria-atomic="true"
      >
        <span
          class="grid size-12 shrink-0 place-items-center rounded-xl bg-background shadow-sm ring-1 ring-text/10"
          aria-hidden="true"
        >
          <img src="/icons/icon-192.png" alt="" class="size-9 rounded-lg" />
        </span>
        <div class="min-w-0 flex-1 pt-0.5">
          <p id={reminderTitleId} class="text-[0.95rem] leading-tight font-semibold text-text">
            {m['ui.pwa_install.reminder_title']()}
          </p>
          <p class="mt-1.5 text-sm leading-relaxed text-muted">
            {m['ui.pwa_install.reminder_message']()}
          </p>
        </div>
      </div>
      <div class="pwa-install-reminder-actions relative mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          class="min-h-11 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-200 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onclick={dismissReminder}>{m['ui.pwa_install.later']()}</button
        >
        <button
          type="button"
          class="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-[filter,transform] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]"
          onclick={() => void acceptReminder()}
        >
          <span class="iconify text-base uil--import" aria-hidden="true"></span>
          {installEvent ? m['ui.pwa_install.install_now']() : m['ui.pwa_install.show_guide']()}
        </button>
      </div>
    </section>
  </div>
{/if}

<style>
  .pwa-install-reminder {
    animation: pwa-reminder-enter 180ms ease-out;
  }

  @keyframes pwa-reminder-enter {
    from {
      opacity: 0;
      transform: translateY(0.5rem) scale(0.98);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pwa-install-reminder {
      animation: none;
    }
  }

  @media (orientation: landscape) and (max-height: 32rem) and (min-width: 40rem) {
    .pwa-install-content--with-guide {
      display: grid;
      grid-template-columns: minmax(0, 0.9fr) minmax(18rem, 1.35fr);
      align-items: start;
      gap: 0.75rem 1rem;
    }

    .pwa-install-intro,
    .pwa-install-benefits {
      grid-column: 1;
    }

    .pwa-install-guide-slot {
      grid-column: 2;
      grid-row: 1 / span 4;
    }

    .pwa-install-reminder-shell {
      width: min(38rem, calc(100vw - 1.5rem));
    }

    .pwa-install-reminder {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
    }

    .pwa-install-reminder-actions {
      margin-top: 0;
    }
  }
</style>
