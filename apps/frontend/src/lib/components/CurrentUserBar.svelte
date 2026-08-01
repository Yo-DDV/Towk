<!--
@component

Displays the current (server-scoped) user at the bottom of the secondary
sidebar. Shows the avatar with presence and the live display name, and links
to the user settings page for the active server.
-->
<script lang="ts">
  import { resolve } from '$app/paths';
  import { serverIdToSegment } from '$lib/navigation';
  import * as m from '$lib/i18n/messages';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { getLiveDisplayName, type CustomUserStatus } from '$lib/state/userProfiles.svelte';
  import { setPresenceMode } from '$lib/presenceTracking';
  import { presencePreference, type PresenceMode } from '$lib/state/presencePreference.svelte';
  import { PresenceStatus } from '$lib/render/types';
  import { getPresenceCache } from '$lib/state/presenceCache.svelte';
  import { sidebarNav } from '$lib/state/globals.svelte';
  import { SIDEBAR_PANEL_WIDTH_PX, sidebarSwipe } from '$lib/hooks/useSidebarSwipe.svelte';
  import { prefersTouchActions, supportsHoverActions } from '$lib/utils/inputCapabilities';
  import BottomSheet from '$lib/ui/BottomSheet.svelte';
  import ContextMenu from '$lib/ui/ContextMenu.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import UserAvatar from './UserAvatar.svelte';
  import UserCustomStatusBadge from './UserCustomStatusBadge.svelte';
  import UserCustomStatusEditor from './UserCustomStatusEditor.svelte';
  import UserContextMenu from '$lib/components/menus/UserContextMenu.svelte';
  import GlobalCallDock from '$lib/components/voice/GlobalCallDock.svelte';

  const connection = useConnection();
  const presenceCache = getPresenceCache();
  const activeServerId = $derived(getActiveServer());
  const serverSegment = $derived(serverIdToSegment(activeServerId));
  const activeStore = $derived(serverRegistry.tryGetStore(activeServerId));
  const activeServerUser = $derived(activeStore?.currentUser.user);

  const displayName = $derived(
    activeServerUser
      ? getLiveDisplayName(
          activeServerUser.id,
          activeServerUser.displayName || activeServerUser.login
        )
      : ''
  );

  const login = $derived(activeServerUser?.login ?? '');
  const useSheetDialog = prefersTouchActions() && !supportsHoverActions();
  const presenceModes: PresenceMode[] = ['auto', 'away', 'doNotDisturb', 'invisible'];
  const currentPresence = $derived.by(() => {
    if (!activeServerUser) return PresenceStatus.Offline;
    return presenceCache.get(
      { serverId: activeServerId, userId: activeServerUser.id },
      activeServerUser.presenceStatus
    );
  });
  const presenceLabel = $derived.by(() => presenceStatusLabel(currentPresence));
  const dragging = $derived(sidebarNav.dragOffset !== null);
  const mobileClosed = $derived(sidebarNav.isMobile && sidebarNav.progress === 0 && !dragging);
  const mobileTransform = $derived(
    sidebarNav.isMobile
      ? `translate3d(${(sidebarNav.progress - 1) * SIDEBAR_PANEL_WIDTH_PX}px, 0, 0)`
      : undefined
  );
  let statusMenuAnchor = $state<{ top: number; bottom: number; left: number } | null>(null);
  let customStatusDialogVisible = $state(false);
  let ownProfileOpen = $state(false);

  function customStatusAPIConfig() {
    const conn = connection();
    return {
      serverId: activeServerId,
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    };
  }

  function openStatusMenu(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    statusMenuAnchor = { top: rect.top, bottom: rect.bottom, left: rect.left };
  }

  function presenceModeLabel(mode: PresenceMode): string {
    switch (mode) {
      case 'away':
        return m['settings.profile.presence.away']();
      case 'doNotDisturb':
        return m['settings.profile.presence.do_not_disturb']();
      case 'invisible':
        return m['settings.profile.presence.invisible']();
      default:
        return m['settings.profile.presence.auto']();
    }
  }

  function presenceStatusLabel(status: PresenceStatus): string {
    switch (status) {
      case PresenceStatus.Away:
        return m['settings.profile.presence.away']();
      case PresenceStatus.DoNotDisturb:
        return m['settings.profile.presence.do_not_disturb']();
      case PresenceStatus.Offline:
        return m['settings.profile.presence.offline']();
      default:
        return m['settings.profile.presence.auto']();
    }
  }

  function presenceModeDotClass(mode: PresenceMode): string {
    switch (mode) {
      case 'away':
        return 'bg-presence-away';
      case 'doNotDisturb':
        return 'bg-presence-do-not-disturb';
      case 'invisible':
        return 'bg-presence-invisible';
      default:
        return 'bg-presence-online';
    }
  }

  function choosePresenceMode(mode: PresenceMode) {
    setPresenceMode(mode);
    statusMenuAnchor = null;
  }

  function openCustomStatusDialog() {
    statusMenuAnchor = null;
    customStatusDialogVisible = true;
  }

  function updateCurrentCustomStatus(status: CustomUserStatus | null) {
    const store = activeStore;
    if (!store?.currentUser.user) return;
    store.currentUser.user = {
      ...store.currentUser.user,
      customStatus: status
    };
  }

  function reserveNavigationFooter(node: HTMLElement) {
    const region = node.closest<HTMLElement>('[data-testid="mobile-navigation-swipe-region"]');
    if (!region || typeof ResizeObserver === 'undefined') return;

    const update = () => {
      region.dataset.navigationFooter = 'true';
      region.style.setProperty(
        '--navigation-footer-height',
        `${Math.ceil(node.getBoundingClientRect().height)}px`
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();

    return {
      destroy() {
        observer.disconnect();
        delete region.dataset.navigationFooter;
        region.style.removeProperty('--navigation-footer-height');
      }
    };
  }
</script>

{#snippet customStatusEditor(sheet = false)}
  {#if activeServerUser}
    <UserCustomStatusEditor
      status={activeServerUser.customStatus}
      config={customStatusAPIConfig()}
      {sheet}
      onChange={updateCurrentCustomStatus}
      onClose={() => (customStatusDialogVisible = false)}
    />
  {/if}
{/snippet}

{#if activeServerUser}
  <div
    use:sidebarSwipe
    use:reserveNavigationFooter
    data-testid="current-user-bar"
    class={[
      'current-user-bar z-50 flex shrink-0 flex-col gap-1 border-t border-border bg-background p-2',
      'max-md:fixed max-md:bottom-0 max-md:left-0 max-md:touch-pan-y',
      sidebarNav.isMobile ? '' : sidebarNav.isOpen ? '' : 'hidden',
      mobileClosed && 'sidebar-mobile-closed',
      !dragging && 'sidebar-mobile-anim'
    ]}
    style:--navigation-panel-width={`${SIDEBAR_PANEL_WIDTH_PX}px`}
    style:transform={mobileTransform}
  >
    {#if sidebarNav.isOpen}
      <GlobalCallDock variant="sidebar" />
    {/if}

    <div
      class="flex h-15 max-h-15 min-h-15 items-center gap-2 overflow-hidden rounded-xl bg-surface px-2"
      data-testid="current-user-identity-card"
    >
      <button
        type="button"
        title={m['settings.profile.presence.button']({ status: presenceLabel })}
        aria-label={m['settings.profile.presence.button']({ status: presenceLabel })}
        class="flex h-10 shrink-0 cursor-pointer items-center rounded-full"
        data-testid="current-user-presence-menu"
        onclick={openStatusMenu}
      >
        <UserAvatar user={activeServerUser} size="sm" showPresence />
      </button>
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer flex-col overflow-hidden rounded px-1 text-left leading-tight transition-colors hover:bg-surface-100"
        data-testid="current-user-identity-text"
        aria-label={m['chat.user_menu.profile']()}
        onclick={() => (ownProfileOpen = true)}
      >
        <span class="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm font-semibold">
          <span class="min-w-0 truncate">{displayName}</span>
          <UserCustomStatusBadge status={activeServerUser.customStatus} class="text-xs" />
        </span>
        <span class="truncate text-xs text-muted">@{login}</span>
      </button>
      <a
        href={resolve('/chat/[serverId]/settings', { serverId: serverSegment })}
        title={m['voice.user_settings']()}
        aria-label={m['voice.user_settings']()}
        class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded text-muted transition-[background-color,color,scale] hover:bg-surface-100 hover:text-text active:scale-[0.96]"
      >
        <span class="iconify text-lg uil--setting" aria-hidden="true"></span>
      </a>
    </div>
  </div>
{/if}

{#if ownProfileOpen && activeServerUser}
  <UserContextMenu
    user={{ ...activeServerUser, presenceStatus: currentPresence }}
    onClose={() => (ownProfileOpen = false)}
  />
{/if}

{#if statusMenuAnchor && activeServerUser}
  <ContextMenu
    anchor={statusMenuAnchor}
    role="dialog"
    ariaLabel={m['settings.profile.status.edit_button']()}
    class="w-80 max-w-[calc(100vw-2rem)]"
    onclose={() => (statusMenuAnchor = null)}
  >
    <div class="flex w-full flex-col gap-1">
      <div class="menu-section p-1">
        <div class="px-2 py-1 text-xs font-semibold text-muted">
          {m['settings.profile.presence.title']()}
        </div>
        {#each presenceModes as mode (mode)}
          <button
            type="button"
            class={[
              'sidebar-item w-full gap-3 text-left',
              presencePreference.mode === mode ? 'bg-surface-100' : ''
            ]}
            role="menuitemradio"
            aria-checked={presencePreference.mode === mode}
            onclick={() => choosePresenceMode(mode)}
          >
            <span class="grid w-5 shrink-0 place-items-center" aria-hidden="true">
              <span class={['h-2.5 w-2.5 rounded-full', presenceModeDotClass(mode)]}></span>
            </span>
            <span class="min-w-0 truncate">{presenceModeLabel(mode)}</span>
            {#if presencePreference.mode === mode}
              <span class="ml-auto iconify shrink-0 uil--check" aria-hidden="true"></span>
            {/if}
          </button>
        {/each}
      </div>
      <div class="menu-section p-1">
        <button
          type="button"
          class="sidebar-item w-full gap-3 text-left"
          data-testid="current-user-custom-status-action"
          onclick={openCustomStatusDialog}
        >
          <span class="grid w-5 shrink-0 place-items-center" aria-hidden="true">
            {#if activeServerUser.customStatus}
              {activeServerUser.customStatus.emoji}
            {:else}
              <span class="iconify text-muted uil--comment-alt-edit"></span>
            {/if}
          </span>
          <span class="min-w-0 truncate">
            {m['settings.profile.status.set_custom_status']()}
          </span>
        </button>
      </div>
    </div>
  </ContextMenu>
{/if}

{#if activeServerUser}
  {#if useSheetDialog}
    <BottomSheet
      bind:visible={customStatusDialogVisible}
      onclose={() => (customStatusDialogVisible = false)}
    >
      <div class="flex max-h-[78vh] flex-col gap-2 overflow-y-auto pb-2 text-text">
        <header class="flex items-center justify-between gap-3 menu-section px-3 py-2">
          <h2 class="text-base font-semibold text-text">
            {m['settings.profile.status.dialog_title']()}
          </h2>
          <button
            type="button"
            onclick={() => (customStatusDialogVisible = false)}
            class="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-md text-text/50 transition-[background-color,color,scale] hover:bg-surface-100 hover:text-text active:scale-[0.96]"
            aria-label={m['ui.close']()}
          >
            <span class="iconify text-xl uil--times"></span>
          </button>
        </header>
        {@render customStatusEditor(true)}
      </div>
    </BottomSheet>
  {:else}
    <Dialog
      bind:visible={customStatusDialogVisible}
      title={m['settings.profile.status.dialog_title']()}
      size="md"
      onclose={() => (customStatusDialogVisible = false)}
    >
      {@render customStatusEditor()}
    </Dialog>
  {/if}
{/if}

<style>
  @media (max-width: 767px) {
    .current-user-bar {
      width: min(100vw, var(--navigation-panel-width));
      padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
