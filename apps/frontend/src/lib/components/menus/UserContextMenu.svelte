<!--
@component

Canonical detailed user profile controller. The component keeps the existing
trigger contract used by messages, member lists, call participants, and
autocomplete results while delegating the visual surface to UserProfileSurface.
-->
<script lang="ts">
  import Dialog from '$lib/ui/Dialog.svelte';
  import UserProfileSurface from '$lib/components/users/UserProfileSurface.svelte';
  import '$lib/components/users/UserProfileSurface.polish.css';
  import { PresenceStatus } from '$lib/render/types';
  import {
    createMemberDirectoryAPI,
    type DetailedUserProfile
  } from '$lib/api-client/memberDirectory';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { startCallWith, startDMWith } from '$lib/dm/startDM';
  import { getCallJoinController } from '$lib/state/callJoinController.svelte';
  import { getPresenceCache } from '$lib/state/presenceCache.svelte';
  import { goto, pushState, replaceState } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { serverIdToSegment } from '$lib/navigation';
  import {
    getLiveCustomStatus,
    getLiveDisplayName,
    getLiveLogin,
    getDetailedUserProfileRevision,
    loadDetailedUserProfile,
    type CustomUserStatus
  } from '$lib/state/userProfiles.svelte';
  import * as m from '$lib/i18n/messages';

  let {
    user,
    anchorRect,
    canSendMessage = false,
    canBanFromRoom = false,
    banningFromRoom = false,
    onSendMessage,
    onBanFromRoom,
    onClose
  }: {
    user: {
      id: string;
      login: string;
      displayName: string;
      avatarUrl?: string | null;
      presenceStatus: PresenceStatus;
      customStatus?: CustomUserStatus | null;
      deleted?: boolean;
    };
    anchorRect?: { top: number; bottom: number; left: number } | null;
    canSendMessage?: boolean;
    canBanFromRoom?: boolean;
    banningFromRoom?: boolean;
    onSendMessage?: () => void | Promise<void>;
    onBanFromRoom?: () => void | Promise<void>;
    onClose?: () => void;
  } = $props();

  const connection = useConnection();
  const callJoinController = getCallJoinController();
  const presenceCache = getPresenceCache();
  const componentId = $props.id();
  const historyMarker = `profile:${componentId}`;
  const serverId = $derived(getActiveServer());

  let visible = $state(true);
  let historyArmed = false;
  let previousPageState: App.PageState = {};
  let profile = $state<DetailedUserProfile | null>(null);
  let profileKey = $state<string | null>(null);
  let loading = $state(true);
  let loadError = $state('');

  const profileRevision = $derived(getDetailedUserProfileRevision(serverId, user.id));
  const targetProfileKey = $derived(JSON.stringify([serverId, user.id, profileRevision]));
  const currentProfile = $derived(!loading && profileKey === targetProfileKey ? profile : null);
  const snapshotUser = $derived(
    currentProfile?.user ?? {
      id: user.id,
      login: user.login,
      displayName: user.displayName || user.login,
      deleted: user.deleted ?? false,
      avatarUrl: user.avatarUrl ?? null,
      presenceStatus: user.presenceStatus,
      customStatus: user.customStatus ?? null
    }
  );
  const displayName = $derived(
    snapshotUser.deleted
      ? snapshotUser.displayName || snapshotUser.login
      : getLiveDisplayName(user.id, snapshotUser.displayName || snapshotUser.login)
  );
  const login = $derived(
    snapshotUser.deleted ? snapshotUser.login : getLiveLogin(user.id, snapshotUser.login)
  );
  const customStatus = $derived(
    snapshotUser.deleted ? null : getLiveCustomStatus(user.id, snapshotUser.customStatus)
  );
  const normalizedCustomStatus = $derived(
    customStatus
      ? {
          emoji: customStatus.emoji,
          text: customStatus.text,
          expiresAt: customStatus.expiresAt ?? null
        }
      : null
  );
  const presenceStatus = $derived(
    snapshotUser.deleted
      ? PresenceStatus.Offline
      : presenceCache.get({ serverId, userId: user.id }, snapshotUser.presenceStatus)
  );
  const profileUser = $derived({
    ...snapshotUser,
    login,
    displayName,
    customStatus: normalizedCustomStatus,
    presenceStatus
  });
  const viewerIsSelf = $derived(Boolean(currentProfile?.viewerIsSelf));
  const mayMessage = $derived(
    !profileUser.deleted &&
      !viewerIsSelf &&
      (currentProfile?.viewerCanMessage ?? canSendMessage)
  );
  const mayCall = $derived(
    !profileUser.deleted && !viewerIsSelf && (currentProfile?.viewerCanCall ?? false)
  );
  const mayEditProfile = $derived(viewerIsSelf);
  const mayBanFromRoom = $derived(
    !profileUser.deleted && !viewerIsSelf && canBanFromRoom && Boolean(onBanFromRoom)
  );

  $effect(() => {
    if (!browser || !visible) return;

    if (!historyArmed) {
      previousPageState = { ...page.state };
      pushState('', { ...page.state, profileDialog: historyMarker });
      historyArmed = true;
      return;
    }

    if (page.state.profileDialog !== historyMarker) visible = false;
  });

  $effect(() => {
    const targetUserId = user.id;
    const targetServerId = serverId;
    const targetKey = targetProfileKey;
    void profileRevision;

    let cancelled = false;
    loading = true;
    loadError = '';

    const conn = connection();
    const api = createMemberDirectoryAPI({
      serverId: targetServerId,
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    });

    void loadDetailedUserProfile(targetServerId, targetUserId, async () => {
      const result = await api.getUserProfile(targetUserId);
      if (result && result.user.id !== targetUserId) throw new Error();
      return result;
    })
      .then((result) => {
        if (cancelled) return;
        if (result && result.user.id !== targetUserId) {
          profile = null;
          profileKey = targetKey;
          loadError = m['profile.load_failed']();
          return;
        }
        profile = result;
        profileKey = targetKey;
        if (!result) loadError = m['profile.load_not_found']();
      })
      .catch(() => {
        if (cancelled) return;
        profile = null;
        profileKey = targetKey;
        loadError = m['profile.load_failed']();
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  function clearHistoryMarkerForAction() {
    if (browser && historyArmed && page.state.profileDialog === historyMarker) {
      replaceState('', previousPageState);
    }
    historyArmed = false;
    visible = false;
  }

  function handleDialogClose() {
    if (browser && historyArmed && page.state.profileDialog === historyMarker) {
      history.back();
    }
    historyArmed = false;
    onClose?.();
  }

  async function handleSendMessage() {
    clearHistoryMarkerForAction();
    if (onSendMessage) {
      await onSendMessage();
      return;
    }
    await startDMWith(getActiveServer(), user.id);
  }

  async function handleCall() {
    clearHistoryMarkerForAction();
    await startCallWith(getActiveServer(), user.id, callJoinController);
  }

  async function handleBanFromRoom() {
    if (banningFromRoom || !onBanFromRoom) return;
    clearHistoryMarkerForAction();
    await onBanFromRoom();
  }

  async function handleEditProfile() {
    clearHistoryMarkerForAction();
    await goto(resolve('/chat/[serverId]/settings', { serverId: serverIdToSegment(serverId) }));
  }
</script>

<Dialog
  bind:visible
  ariaLabel={m['chat.user_menu.profile']()}
  size="lg"
  tall
  mobileFullScreen
  swipeToClose
  onclose={handleDialogClose}
>
  <UserProfileSurface
    user={profileUser}
    profile={currentProfile}
    {loading}
    {loadError}
    anchored={Boolean(anchorRect)}
    canEditProfile={mayEditProfile}
    canSendMessage={mayMessage}
    canCall={mayCall}
    canBanFromRoom={mayBanFromRoom}
    {banningFromRoom}
    onEditProfile={handleEditProfile}
    onSendMessage={handleSendMessage}
    onCall={handleCall}
    onBanFromRoom={handleBanFromRoom}
  />
</Dialog>

<style>
  :global(dialog:has(.user-profile-dialog)) {
    overflow: hidden;
  }

  :global(dialog:has(.user-profile-dialog) > .dialog-tray) {
    overflow: hidden;
    border-color: color-mix(in srgb, var(--color-text) 12%, transparent);
    border-radius: 1.75rem;
    background: color-mix(in srgb, var(--color-surface-100) 94%, transparent);
    padding: 0.25rem;
  }

  :global(dialog:has(.user-profile-dialog) .dialog-content) {
    position: relative;
    border-radius: 1.5rem;
    background: transparent;
  }

  :global(dialog:has(.user-profile-dialog) .dialog-header) {
    position: absolute;
    z-index: 40;
    top: 0.75rem;
    right: 0.75rem;
    padding: 0;
    pointer-events: none;
  }

  :global(dialog:has(.user-profile-dialog) .dialog-header > span) {
    display: none;
  }

  :global(dialog:has(.user-profile-dialog) .dialog-header button) {
    width: 2.75rem;
    height: 2.75rem;
    min-width: 2.75rem;
    min-height: 2.75rem;
    margin: 0;
    border: 1px solid color-mix(in srgb, var(--color-text) 16%, transparent);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-background) 76%, transparent);
    color: var(--color-text-top);
    box-shadow:
      0 0.65rem 1.6rem color-mix(in srgb, black 18%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
    backdrop-filter: blur(1rem);
    pointer-events: auto;
  }

  :global(dialog:has(.user-profile-dialog) .dialog-header button:hover) {
    background: color-mix(in srgb, var(--color-surface-200) 88%, transparent);
  }

  :global(dialog:has(.user-profile-dialog) .dialog-header button:focus-visible) {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  :global(dialog:has(.user-profile-dialog) .dialog-body) {
    min-width: 0;
    padding: 0;
    scrollbar-gutter: stable;
  }

  :global(dialog:has(.user-profile-dialog) .profile-biography-content-collapsed) {
    max-height: clamp(16rem, 44vh, 28rem);
    max-height: clamp(16rem, 44dvh, 28rem);
  }

  :global(dialog:has(.user-profile-dialog) .dialog-swipe-handle) {
    position: absolute;
    z-index: 35;
    top: 0.25rem;
    left: 50%;
    display: none;
    margin: 0;
    transform: translateX(-50%);
  }

  @media (any-pointer: coarse), (max-width: 640px) {
    :global(dialog:has(.user-profile-dialog) .dialog-swipe-handle) {
      display: grid;
    }
  }

  @media (max-width: 640px), (max-height: 620px) {
    :global(dialog:has(.user-profile-dialog)) {
      width: 100vw !important;
      max-width: none !important;
      height: 100vh;
      height: 100dvh;
      max-height: none;
      margin: 0;
    }

    :global(dialog:has(.user-profile-dialog) > .dialog-tray) {
      min-height: 100vh;
      min-height: 100dvh;
      border: 0;
      border-radius: 0;
      padding: 0;
    }

    :global(dialog:has(.user-profile-dialog) .dialog-content) {
      min-height: 100vh;
      min-height: 100dvh;
      max-height: 100vh;
      max-height: 100dvh;
      border-radius: 0;
    }

    :global(dialog:has(.user-profile-dialog) .profile-shell) {
      min-height: 100vh;
      min-height: 100dvh;
      border-radius: 0;
    }

    :global(dialog:has(.user-profile-dialog) .dialog-header) {
      top: max(0.75rem, env(safe-area-inset-top));
      right: max(0.75rem, env(safe-area-inset-right));
    }

    :global(dialog:has(.user-profile-dialog) .dialog-swipe-handle) {
      top: max(0.15rem, env(safe-area-inset-top));
      display: grid;
    }

    :global(dialog:has(.user-profile-dialog) .dialog-body) {
      min-height: 100vh;
      min-height: 100dvh;
      max-height: 100vh;
      max-height: 100dvh;
    }

    :global(dialog:has(.user-profile-dialog) .profile-biography-content-collapsed) {
      max-height: min(24rem, 44vh);
      max-height: min(24rem, 44dvh);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(dialog:has(.user-profile-dialog) .dialog-header button),
    :global(dialog:has(.user-profile-dialog) .profile-action),
    :global(dialog:has(.user-profile-dialog) .profile-biography-toggle),
    :global(dialog:has(.user-profile-dialog) .profile-retry) {
      transition: none;
    }

    :global(dialog:has(.user-profile-dialog) .profile-action:active) {
      scale: 1;
    }

    :global(dialog:has(.user-profile-dialog) .profile-biography-toggle:active) {
      transform: none;
    }

    :global(dialog:has(.user-profile-dialog) .animate-spin) {
      animation: none;
    }
  }

  @media (forced-colors: active) {
    :global(dialog:has(.user-profile-dialog) > .dialog-tray),
    :global(dialog:has(.user-profile-dialog) .dialog-header button) {
      border: 1px solid CanvasText;
      box-shadow: none;
    }

    :global(dialog:has(.user-profile-dialog) .dialog-header button) {
      background: Canvas;
      color: CanvasText;
    }

    :global(dialog:has(.user-profile-dialog) .profile-biography-fade) {
      display: none;
    }
  }
</style>
