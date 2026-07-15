<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import {
    chromeAndroidIntentUrl,
    currentInstallEnvironment,
    isLegacyAndroidStandaloneInstall
  } from '$lib/pwa/installPrompt';

  let visible = $state(false);
  let chromeLinkHref = $state<string | undefined>();
  let openLink = $state<HTMLAnchorElement | undefined>();

  const componentId = $props.id();
  const titleId = `${componentId}-title`;
  const descriptionId = `${componentId}-description`;

  function externalHref(node: HTMLAnchorElement, href: string | undefined) {
    if (href) node.setAttribute('href', href);
    return {
      update(nextHref: string | undefined) {
        if (nextHref) {
          node.setAttribute('href', nextHref);
        } else {
          node.removeAttribute('href');
        }
      }
    };
  }

  onMount(() => {
    if (!isLegacyAndroidStandaloneInstall(currentInstallEnvironment())) return;

    chromeLinkHref = chromeAndroidIntentUrl(window.location.href) ?? window.location.href;
    visible = true;
    queueMicrotask(() => openLink?.focus());
  });
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
          {#if chromeLinkHref}
            <!-- svelte-ignore a11y_missing_attribute -->
            <a
              bind:this={openLink}
              use:externalHref={chromeLinkHref}
              data-testid="pwa-android-standalone-open"
              aria-describedby={descriptionId}
              class="btn-primary w-full text-sm"
            >
              <span class="iconify text-lg uil--external-link-alt" aria-hidden="true"></span>
              {m['ui.pwa_install.android_standalone_notice.open_in_browser']()}
            </a>
          {/if}
          <p class="text-xs leading-relaxed text-muted">
            {m['ui.pwa_install.android_standalone_notice.close_old_app']()}
          </p>
        </div>
      </div>
    </div>
  </div>
{/if}
