<script lang="ts">
  import type { InstallBrowser, InstallGuide } from '$lib/pwa/installPrompt';
  import * as m from '$lib/i18n/messages';

  let { guide, browser }: { guide: InstallGuide; browser: InstallBrowser } = $props();

  const icon = $derived.by(() => {
    if (browser === 'safari') return 'logos--safari';
    if (browser === 'chrome') return 'logos--chrome';
    if (browser === 'edge') return 'logos--microsoft-edge';
    if (browser === 'firefox') return 'logos--firefox';
    if (browser === 'opera') return 'logos--opera';
    if (browser === 'samsung') return 'uil--android';
    return 'uil--browser';
  });

  const hasColorLogo = $derived(['safari', 'chrome', 'edge', 'firefox', 'opera'].includes(browser));

  const title = $derived.by(() => {
    if (guide === 'ios_safari') return m['ui.pwa_install.ios_safari_title']();
    if (guide === 'ios_chrome') return m['ui.pwa_install.ios_chrome_title']();
    if (guide === 'ios_other') return m['ui.pwa_install.ios_other_title']();
    if (guide === 'android_firefox') return m['ui.pwa_install.android_firefox_title']();
    if (guide === 'android_chromium') return m['ui.pwa_install.android_chromium_title']();
    if (guide === 'android_other') return m['ui.pwa_install.android_other_title']();
    if (guide === 'windows_firefox') return m['ui.pwa_install.windows_firefox_title']();
    if (guide === 'macos_safari') return m['ui.pwa_install.macos_safari_title']();
    if (guide === 'desktop_chromium') return m['ui.pwa_install.desktop_chromium_title']();
    return m['ui.pwa_install.desktop_other_title']();
  });
</script>

<section
  class="rounded-lg border border-text/10 bg-surface-100 p-3"
  data-testid="pwa-install-guide"
>
  <div class="flex items-center gap-2.5">
    <span
      class={[
        hasColorLogo ? 'iconify-color' : 'iconify',
        'flex size-9 shrink-0 items-center justify-center text-2xl',
        icon
      ]}
      data-testid="pwa-install-browser-icon"
      aria-hidden="true"
    ></span>
    <div class="min-w-0 flex-1">
      <p class="font-medium text-text">{title}</p>
      {#if guide === 'ios_safari'}
        <p class="mt-0.5 text-xs font-medium text-success">
          {m['ui.pwa_install.recommended']()}
        </p>
      {/if}
    </div>
  </div>

  <ol class="mt-3 space-y-2.5 text-sm text-muted">
    {#if guide === 'ios_safari'}
      <li class="flex gap-2.5">
        <span class="guide-step">1</span><span>{m['ui.pwa_install.ios_safari_share']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">2</span><span>{m['ui.pwa_install.ios_safari_home']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">3</span><span>{m['ui.pwa_install.ios_safari_open']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">4</span><span>{m['ui.pwa_install.confirm_add']()}</span>
      </li>
    {:else if guide === 'ios_chrome'}
      <li class="flex gap-2.5">
        <span class="guide-step">1</span><span>{m['ui.pwa_install.ios_chrome_share']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">2</span><span>{m['ui.pwa_install.ios_chrome_home']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">3</span><span>{m['ui.pwa_install.confirm_add']()}</span>
      </li>
    {:else if guide === 'ios_other'}
      <li class="flex gap-2.5">
        <span class="guide-step">1</span><span>{m['ui.pwa_install.ios_other_open']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">2</span><span>{m['ui.pwa_install.ios_other_return']()}</span>
      </li>
    {:else if guide === 'android_firefox'}
      <li class="flex gap-2.5">
        <span class="guide-step">1</span><span>{m['ui.pwa_install.android_firefox_menu']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">2</span><span>{m['ui.pwa_install.android_firefox_install']()}</span
        >
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">3</span><span>{m['ui.pwa_install.confirm_install']()}</span>
      </li>
    {:else if guide === 'android_chromium'}
      <li class="flex gap-2.5">
        <span class="guide-step">1</span><span>{m['ui.pwa_install.android_chromium_menu']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">2</span><span
          >{m['ui.pwa_install.android_chromium_install']()}</span
        >
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">3</span><span>{m['ui.pwa_install.confirm_install']()}</span>
      </li>
    {:else if guide === 'android_other'}
      <li class="flex gap-2.5">
        <span class="guide-step">1</span><span>{m['ui.pwa_install.android_other_open']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">2</span><span>{m['ui.pwa_install.android_other_return']()}</span>
      </li>
    {:else if guide === 'windows_firefox'}
      <li class="flex gap-2.5">
        <span class="guide-step">1</span><span>{m['ui.pwa_install.windows_firefox_button']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">2</span><span>{m['ui.pwa_install.windows_firefox_pin']()}</span>
      </li>
    {:else if guide === 'macos_safari'}
      <li class="flex gap-2.5">
        <span class="guide-step">1</span><span>{m['ui.pwa_install.macos_safari_share']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">2</span><span>{m['ui.pwa_install.macos_safari_dock']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">3</span><span>{m['ui.pwa_install.confirm_add']()}</span>
      </li>
    {:else if guide === 'desktop_chromium'}
      <li class="flex gap-2.5">
        <span class="guide-step">1</span><span>{m['ui.pwa_install.desktop_chromium_icon']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">2</span><span>{m['ui.pwa_install.desktop_chromium_menu']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">3</span><span>{m['ui.pwa_install.confirm_install']()}</span>
      </li>
    {:else}
      <li class="flex gap-2.5">
        <span class="guide-step">1</span><span>{m['ui.pwa_install.desktop_other_open']()}</span>
      </li>
      <li class="flex gap-2.5">
        <span class="guide-step">2</span><span>{m['ui.pwa_install.desktop_other_return']()}</span>
      </li>
    {/if}
  </ol>

  {#if guide === 'android_chromium'}
    <p class="mt-3 rounded-md bg-background px-2.5 py-2 text-xs text-muted">
      {m['ui.pwa_install.android_troubleshoot']()}
    </p>
  {/if}
</section>
