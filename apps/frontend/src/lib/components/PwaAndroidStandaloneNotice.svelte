<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import {
    chromeAndroidIntentUrl,
    currentInstallEnvironment,
    isLegacyAndroidStandaloneInstall
  } from '$lib/pwa/installPrompt';

  let visible = $state(false);
  let openButton = $state<HTMLButtonElement | undefined>();

  const componentId = $props.id();
  const titleId = `${componentId}-title`;
  const descriptionId = `${componentId}-description`;

  onMount(() => {
    if (!isLegacyAndroidStandaloneInstall(currentInstallEnvironment())) return;

    visible = true;
    queueMicrotask(() => openButton?.focus());
  });

  function openInBrowser() {
    window.open(
      chromeAndroidIntentUrl(window.location.href) ?? window.location.href,
      '_blank',
      'noopener,noreferrer'
    );
  }
</script>

{#if visible}
  <div
    class="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
    role="presentation"
    data-testid="pwa-android-standalone-notice"
  >
    <div
      class="w-full max-w-md rounded-xl border border-warning/40 bg-surface-100 p-5 text-text shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div class="flex items-start gap-3">
        <span
          class="mt-0.5 iconify shrink-0 text-2xl text-warning uil--exclamation-triangle"
          aria-hidden="true"
        ></span>
        <div class="min-w-0 space-y-3">
          <h2 id={titleId} class="text-lg font-semibold">
            {m['ui.pwa_install.android_standalone_notice.title']()}
          </h2>
          <p id={descriptionId} class="text-sm leading-relaxed text-muted">
            {m['ui.pwa_install.android_standalone_notice.body']()}
          </p>
          <button
            bind:this={openButton}
            type="button"
            class="btn-primary w-full text-sm"
            onclick={openInBrowser}
          >
            <span class="iconify text-lg uil--external-link-alt" aria-hidden="true"></span>
            {m['ui.pwa_install.android_standalone_notice.open_in_browser']()}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
