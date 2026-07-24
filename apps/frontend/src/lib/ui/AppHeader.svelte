<script lang="ts">
  import { goto, pushState } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { navigating } from '$app/state';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { serverConnectionManager } from '$lib/state/server/serverConnection.svelte';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { version as frontendVersion } from '$app/environment';
  import { sidebarNav, quickSwitcher } from '$lib/state/globals.svelte';
  import * as m from '$lib/i18n/messages';
  import UnreadDot from '$lib/ui/UnreadDot.svelte';
  import MotdContent from '$lib/ui/MotdContent.svelte';
  import FloatingPopover from '$lib/ui/FloatingPopover.svelte';
  import PwaInstallButton from '$lib/components/PwaInstallButton.svelte';
  import { sourcePathForVersion } from '$lib/source';

  // MOTD follows the active server; the connection-lost icon below stays
  // bound to the origin store since it reflects the SPA host's own connection.
  const motd = $derived(serverRegistry.tryGetStore(getActiveServer())?.serverInfo.motd);
  const originStore = $derived(serverRegistry.tryGetStore(serverRegistry.originServer?.id ?? ''));
  const deployedVersion = $derived(originStore?.serverInfo.version || frontendVersion);
  const correspondingSourcePath = $derived(
    originStore?.serverInfo.version ? sourcePathForVersion(originStore.serverInfo.version) : ''
  );

  // Aggregate notification count across all servers.
  const totalNotificationCount = $derived(
    serverRegistry.servers.reduce(
      (sum, instance) => sum + serverRegistry.getStore(instance.id).notifications.count,
      0
    )
  );

  // Show sign-out button when any server is registered
  const hasInstances = $derived(serverRegistry.servers.length > 0);
  const versionInfoId = 'app-version-info';
  let versionInfoOpen = $state(false);
  let versionInfoTrigger = $state<HTMLButtonElement>();
  let versionInfoAnchor = $state<{ top: number; bottom: number; left: number } | null>(null);

  function updateVersionInfoAnchor() {
    if (!versionInfoTrigger) return;
    const rect = versionInfoTrigger.getBoundingClientRect();
    versionInfoAnchor = { top: rect.top, bottom: rect.bottom, left: rect.left };
  }

  function closeVersionInfo(restoreFocus = false) {
    versionInfoOpen = false;
    versionInfoAnchor = null;
    if (restoreFocus) versionInfoTrigger?.focus();
  }

  function toggleVersionInfo(event: MouseEvent) {
    event.stopPropagation();
    if (versionInfoOpen) {
      closeVersionInfo();
      return;
    }
    updateVersionInfoAnchor();
    versionInfoOpen = true;
  }

  function handleVersionInfoViewportChange() {
    if (versionInfoOpen) updateVersionInfoAnchor();
  }

  function handleVersionInfoKeydown(event: KeyboardEvent) {
    if (!versionInfoOpen || event.key !== 'Escape') return;
    event.preventDefault();
    closeVersionInfo(true);
  }

  async function waitForPendingNavigation() {
    const pendingNavigation = navigating.complete;
    if (pendingNavigation) await pendingNavigation.catch(() => undefined);
  }

  async function handleQuickSwitcher() {
    await waitForPendingNavigation();
    quickSwitcher.open();
  }

  function shouldUseNativeLinkNavigation(event: MouseEvent): boolean {
    return (
      event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    );
  }

  async function handleNotifications(event: MouseEvent) {
    if (shouldUseNativeLinkNavigation(event)) return;

    event.preventDefault();
    await waitForPendingNavigation();
    const notificationServerId = getActiveServer();
    await goto(resolve('/chat/notifications'), {
      state: notificationServerId ? { notificationServerId } : {}
    });
  }

  async function handleSignOut() {
    await waitForPendingNavigation();
    pushState('', { modal: { type: 'logout' } });
  }
</script>

<svelte:window
  onresize={handleVersionInfoViewportChange}
  onscrollcapture={handleVersionInfoViewportChange}
/>
<svelte:document onkeydown={handleVersionInfoKeydown} />

<header class="app-header flex items-center justify-between gap-2 p-2 text-muted md:text-sm">
  <!-- Leading: Sidebar toggle + Notifications -->
  <div class="flex items-center gap-3">
    <!-- Hamburger - 44px tap target for mobile accessibility -->
    <button
      type="button"
      class="app-header-icon"
      onclick={() => sidebarNav.toggle()}
      aria-label={m['ui.toggle_sidebar']()}
      aria-expanded={sidebarNav.isOpen}
      title={m['ui.toggle_sidebar']()}
    >
      <span class="iconify text-xl uil--bars"></span>
    </button>

    <!-- Notification bell - 44px tap target for mobile accessibility -->
    <a
      href={resolve('/chat/notifications')}
      onclick={handleNotifications}
      aria-label={m['ui.notifications']()}
      title={m['ui.notifications']()}
      class="relative app-header-icon"
    >
      <span class="iconify text-lg uil--bell"></span>
      {#if totalNotificationCount > 0}
        <UnreadDot class="absolute top-2 right-2" />
      {/if}
    </a>

    <!-- Quick switcher trigger -->
    {#if hasInstances}
      <button
        type="button"
        class="app-header-icon"
        onclick={handleQuickSwitcher}
        aria-label={m['ui.open_quick_switcher']()}
        title={m['ui.quick_switcher_shortcut']()}
      >
        <span class="iconify text-lg uil--apps"></span>
      </button>
    {/if}

    <PwaInstallButton remindersEnabled={Boolean(originStore?.currentUser.user)} />

    <!-- Connection lost indicator: only show when an authenticated server has lost connection.
         Skip the origin server if the user isn't authenticated (no WebSocket expected). -->
    {#if originStore?.currentUser.user && serverConnectionManager.originClient.showConnectionLostIcon}
      <span
        class={[
          'iconify text-lg uil--wifi-slash',
          serverConnectionManager.originClient.showConnectionLostBanner
            ? 'text-warning'
            : 'animate-pulse'
        ]}
        title={m['ui.realtime_paused']()}
      ></span>
    {/if}
  </div>

  <!-- MOTD -->
  {#if motd}
    <MotdContent {motd} />
  {:else}
    <span class="flex-1"></span>
  {/if}

  <!-- Actions: Version + Logout -->
  <div class="flex items-center gap-3">
    {#if deployedVersion}
      <button
        bind:this={versionInfoTrigger}
        type="button"
        data-testid="version-info-trigger"
        class="app-header-icon"
        onclick={toggleVersionInfo}
        aria-label={m['ui.version_info.open']()}
        aria-haspopup="dialog"
        aria-expanded={versionInfoOpen}
        aria-controls={versionInfoId}
        title={m['ui.version_info.open']()}
      >
        <span class="iconify text-lg uil--info-circle" aria-hidden="true"></span>
      </button>
    {/if}

    {#if hasInstances}
      <button
        type="button"
        data-testid="sign-out-trigger"
        class="app-header-icon"
        onclick={handleSignOut}
        aria-label={m['ui.sign_out']()}
        title={m['ui.sign_out']()}
      >
        <span class="iconify text-lg uil--signout" aria-hidden="true"></span>
      </button>
    {/if}
  </div>
</header>

{#if versionInfoOpen && versionInfoAnchor && deployedVersion}
  <FloatingPopover
    anchor={versionInfoAnchor}
    anchorPlacement="bottom"
    role="dialog"
    id={versionInfoId}
    ariaLabel={m['ui.version_info.open']()}
    class="max-w-[min(22rem,calc(100vw-1rem))] menu"
    onclose={() => closeVersionInfo()}
  >
    <section data-testid="version-info-popover" class="min-w-56 menu-section px-3 py-3">
      <div class="flex min-w-0 items-start gap-2.5">
        <span
          class="mt-0.5 iconify shrink-0 text-lg text-accent uil--info-circle"
          aria-hidden="true"
        ></span>
        <div class="min-w-0 space-y-1.5">
          <h2 class="text-sm font-semibold text-text">{m['ui.version_info.title']()}</h2>
          <code
            data-testid="deployed-version"
            class="block text-xs leading-relaxed break-all text-muted">v{deployedVersion}</code
          >
          <a
            href={`https://github.com/Yo-DDV/towk${correspondingSourcePath}`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="corresponding-source-link"
            class="inline-flex min-h-8 items-center gap-1.5 rounded-sm text-xs font-medium text-accent underline decoration-dotted underline-offset-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label={m['ui.corresponding_source']({ version: deployedVersion })}
          >
            <span>{m['ui.version_info.source']()}</span>
            <span class="iconify text-sm uil--external-link-alt" aria-hidden="true"></span>
          </a>
        </div>
      </div>
    </section>
  </FloatingPopover>
{/if}

<style>
  /* Tauri window dragging - header is draggable, interactive elements are not */
  .app-header {
    -webkit-app-region: drag;
  }
  .app-header :global(a),
  .app-header :global(button) {
    -webkit-app-region: no-drag;
  }
</style>
