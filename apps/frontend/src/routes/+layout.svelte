<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onNotificationClick } from '$lib/notifications/pushNotifications';
  import { prepareUiForNotificationPath } from '$lib/notifications/notificationNavigationUi';
  import { reconcileNotificationClick } from '$lib/notifications/reconcileNotificationClick';
  import { setAuthServerInfo } from '$lib/components/authServerInfo';
  import ConnectionIndicator from '$lib/components/ConnectionIndicator.svelte';
  import ConnectionProvider from '$lib/components/ConnectionProvider.svelte';
  import GlobalKeyboardShortcuts from '$lib/components/GlobalKeyboardShortcuts.svelte';
  import IdleTracker from '$lib/components/IdleTracker.svelte';
  import MobileSidebarChrome from '$lib/components/MobileSidebarChrome.svelte';
  import NativeMessageContextMenuGuard from '$lib/components/NativeMessageContextMenuGuard.svelte';
  import NetworkStatusNotifier from '$lib/components/NetworkStatusNotifier.svelte';
  import PwaLaunchHandler from '$lib/components/PwaLaunchHandler.svelte';
  import ServiceWorkerRegistrar from '$lib/components/ServiceWorkerRegistrar.svelte';
  import UpdateNotifier from '$lib/components/UpdateNotifier.svelte';
  import UploadProgressOverlay from '$lib/components/UploadProgressOverlay.svelte';
  import {
    useAutoHideScrollbars,
    usePageTitle,
    usePinchZoomPrevention,
    useVisualViewport
  } from '$lib/hooks';
  import { chatRoomIdFromRoute } from '$lib/navigation/chatRoomRoute';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { sidebarNav } from '$lib/state/globals.svelte';
  import { provideAppUiState } from '$lib/state/appUi.svelte';
  import { useServerRegistry } from '$lib/state/server/useServerRegistry.svelte';
  import { ToastContainer } from '$lib/ui/toast';
  import { AppHeader, Frame } from '$lib/ui';
  import '../app.css';
  import '$lib/styles/app-shell-depth.css';
  import '$lib/styles/liquid-glass-surfaces.css';
  import '$lib/styles/auto-hide-scrollbars.css';

  let { data, children } = $props();
  let modalContainerModule: Promise<typeof import('./chat/ModalContainer.svelte')> | null = null;

  function loadModalContainer() {
    modalContainerModule ??= import('./chat/ModalContainer.svelte');
    return modalContainerModule;
  }

  setAuthServerInfo(() => data.serverInfo);
  const appUi = provideAppUiState();
  useServerRegistry(() => data.user);
  useVisualViewport();
  usePinchZoomPrevention();
  useAutoHideScrollbars();

  const activeServerId = $derived(getActiveServer());
  const activeRoomId = $derived(chatRoomIdFromRoute(page.route.id, page.params.roomId));

  $effect(() => {
    if (typeof activeRoomId === 'string' && activeRoomId) {
      appUi.setActiveRoomScope(activeServerId, activeRoomId);
      return;
    }
    appUi.setActiveServer(activeServerId);
  });

  // Route push-notification clicks via SvelteKit and consume the exact
  // application notification independently of whether the URL changes.
  $effect(() =>
    onNotificationClick((url, notificationId) => {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        // Ignore malformed URLs from the SW.
        return;
      }
      if (target.origin !== window.location.origin) return;

      prepareUiForNotificationPath(appUi, target.pathname);
      return Promise.all([
        goto(resolve((target.pathname + target.search + target.hash) as '/')),
        reconcileNotificationClick(notificationId)
      ]).then(([, notificationConsumed]) => notificationConsumed);
    })
  );

  $effect(() => sidebarNav.initViewportTracking());
  afterNavigate(() => {
    if (sidebarNav.isMobile) sidebarNav.close();
  });

  const getFullTitle = usePageTitle();
  const fullTitle = $derived(getFullTitle());
</script>

<GlobalKeyboardShortcuts />
<IdleTracker />
<NativeMessageContextMenuGuard />
<NetworkStatusNotifier />
<ServiceWorkerRegistrar />
<UpdateNotifier />
<PwaLaunchHandler />
<UploadProgressOverlay />

<svelte:head>
  <title>{fullTitle}</title>
</svelte:head>

<ConnectionProvider>
  {@render frame()}
</ConnectionProvider>

{#snippet frame()}
  <div
    data-testid="app-envelope"
    class="app-envelope flex h-full w-full flex-col overscroll-y-contain bg-surface-100 pt-[env(safe-area-inset-top,0px)] md:p-3 md:pt-0"
  >
    <ConnectionIndicator />

    <AppHeader />

    <Frame class="relative flex-col">
      <MobileSidebarChrome>
        {@render children?.()}
      </MobileSidebarChrome>
    </Frame>
  </div>
{/snippet}

{#if page.state.modal}
  {#await loadModalContainer() then { default: ModalContainer }}
    <ModalContainer />
  {/await}
{/if}

<ToastContainer />
