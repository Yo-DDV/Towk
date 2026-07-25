<!--
@component

Canonical detailed user profile. The component keeps the existing trigger contract used by
messages, member lists, call participants, and autocomplete results, while presenting one
responsive dialog backed by the detailed profile API.
-->
<script lang="ts">
  import { PresenceStatus } from '$lib/render/types';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import UserCustomStatusBadge from '$lib/components/UserCustomStatusBadge.svelte';
  import MessageContent from '$lib/components/MessageContent.svelte';
  import Dialog from '$lib/ui/Dialog.svelte';
  import {
    createMemberDirectoryAPI,
    type DetailedUserProfile
  } from '$lib/api-client/memberDirectory';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { startCallWith, startDMWith } from '$lib/dm/startDM';
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
  const componentId = $props.id();
  const historyMarker = `profile:${componentId}`;
  const rolesHeadingId = `${componentId}-roles-heading`;
  const biographyHeadingId = `${componentId}-biography-heading`;
  const serverId = $derived(getActiveServer());
  let visible = $state(true);
  let historyArmed = false;
  let previousPageState: App.PageState = {};
  let profile = $state<DetailedUserProfile | null>(null);
  let loading = $state(true);
  let loadError = $state('');

  const displayName = $derived(getLiveDisplayName(user.id, user.displayName || user.login));
  const login = $derived(getLiveLogin(user.id, user.login));
  const customStatus = $derived(getLiveCustomStatus(user.id, user.customStatus));
  const profileUser = $derived(
    profile?.user ?? {
      id: user.id,
      login,
      displayName,
      deleted: user.deleted ?? false,
      avatarUrl: user.avatarUrl ?? null,
      presenceStatus: user.presenceStatus,
      customStatus
    }
  );
  const roles = $derived(profile?.roles ?? []);
  const presenceLabel = $derived(presenceStatusLabel(profileUser.presenceStatus));
  const presenceDotClass = $derived(presenceStatusDotClass(profileUser.presenceStatus));
  const mayMessage = $derived(
    !profileUser.deleted && (profile?.viewerCanMessage ?? canSendMessage)
  );
  const mayCall = $derived(!profileUser.deleted && (profile?.viewerCanCall ?? false));
  const profileRevision = $derived(getDetailedUserProfileRevision(serverId, user.id));

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
    void loadDetailedUserProfile(targetServerId, targetUserId, () =>
      api.getUserProfile(targetUserId)
    )
      .then((result) => {
        if (cancelled) return;
        profile = result;
        if (!result) loadError = m['profile.load_not_found']();
      })
      .catch(() => {
        if (!cancelled) loadError = m['profile.load_failed']();
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
    await startCallWith(getActiveServer(), user.id);
  }

  async function handleBanFromRoom() {
    clearHistoryMarkerForAction();
    await onBanFromRoom?.();
  }

  async function handleEditProfile() {
    clearHistoryMarkerForAction();
    await goto(resolve('/chat/[serverId]/settings', { serverId: serverIdToSegment(serverId) }));
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

  function presenceStatusDotClass(status: PresenceStatus): string {
    switch (status) {
      case PresenceStatus.Away:
        return 'bg-presence-away';
      case PresenceStatus.DoNotDisturb:
        return 'bg-presence-do-not-disturb';
      case PresenceStatus.Offline:
        return 'bg-presence-offline';
      default:
        return 'bg-presence-online';
    }
  }

  function formatDate(value: string | null): string {
    if (!value) return m['profile.not_available']();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return m['profile.not_available']();
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
  }

  function formatDateTime(value: string | null): string {
    if (!value) return m['profile.not_available']();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return m['profile.not_available']();
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }
</script>

<Dialog
  bind:visible
  title={m['chat.user_menu.profile']()}
  size="lg"
  tall
  swipeToClose
  onclose={handleDialogClose}
>
  <article
    class="user-profile-dialog -mx-1 grid min-w-0 gap-5 pb-1"
    data-anchor={anchorRect ? 'set' : undefined}
    data-testid="user-profile-dialog"
  >
    <section
      class="profile-hero relative isolate overflow-hidden rounded-2xl border border-primary/20 bg-linear-to-br from-primary/20 via-surface-100 to-surface-200 p-5 shadow-sm"
    >
      <div
        class="pointer-events-none absolute -top-20 -right-20 -z-10 h-56 w-56 rounded-full bg-primary/15 blur-3xl"
        aria-hidden="true"
      ></div>
      <div class="flex min-w-0 items-center gap-4 sm:gap-5">
        <div class="shrink-0 rounded-full bg-background/70 p-1 shadow-md ring-1 ring-text/10">
          <UserAvatar user={profileUser} size="xl" showPresence />
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-2xl font-bold tracking-tight sm:text-3xl">{displayName}</h3>
          <p class="truncate text-sm text-muted">@{login}</p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <span
              class="inline-flex min-h-7 items-center gap-2 rounded-full border border-text/10 bg-background/65 px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur"
            >
              <span class={['h-2.5 w-2.5 rounded-full', presenceDotClass]} aria-hidden="true"
              ></span>
              {presenceLabel}
            </span>
            <UserCustomStatusBadge status={customStatus} showText class="max-w-full" />
          </div>
        </div>
      </div>
    </section>

    {#if loading}
      <div
        class="flex min-h-18 items-center gap-3 rounded-xl border border-border bg-surface-100 p-4 text-sm text-muted"
        role="status"
        aria-live="polite"
      >
        <span class="iconify animate-spin text-xl uil--spinner-alt" aria-hidden="true"></span>
        {m['profile.loading']()}
      </div>
    {:else if loadError}
      <p
        class="rounded-xl border border-danger/20 bg-danger/10 p-4 text-sm text-danger"
        role="alert"
      >
        {loadError}
      </p>
    {/if}

    {#if profile}
      <section
        class="grid gap-3 rounded-xl border border-border bg-surface-100/80 p-4 shadow-sm"
        aria-labelledby={rolesHeadingId}
      >
        <h4 id={rolesHeadingId} class="flex items-center gap-2 text-sm font-semibold text-text">
          <span class="iconify text-lg text-primary uil--award" aria-hidden="true"></span>
          {m['profile.roles']()}
        </h4>
        <div class="flex flex-wrap gap-2">
          {#if roles.length === 0}
            <span
              class="inline-flex min-h-8 items-center rounded-full border border-text/10 bg-surface-200 px-3 py-1 text-sm"
            >
              {m['profile.member_role']()}
            </span>
          {:else}
            {#each roles as role (role.name)}
              <span
                class={[
                  'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-sm shadow-xs',
                  role.moderation
                    ? 'border-primary/30 bg-primary/10 font-semibold text-primary'
                    : 'border-text/10 bg-surface-200 text-text'
                ]}
                title={role.name}
              >
                {#if role.moderation}
                  <span class="iconify text-base uil--shield-check" aria-hidden="true"></span>
                {/if}
                {role.displayName || role.name}
              </span>
            {/each}
          {/if}
        </div>
      </section>

      <section class="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={m['profile.details']()}>
        <div class="rounded-xl border border-border bg-surface-100 p-4 shadow-sm">
          <div
            class="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase"
          >
            <span class="iconify text-base uil--calendar-alt" aria-hidden="true"></span>
            {m['profile.joined']()}
          </div>
          <div class="mt-2 text-sm font-medium">{formatDate(profile.joinedAt)}</div>
        </div>
        <div class="rounded-xl border border-border bg-surface-100 p-4 shadow-sm">
          <div
            class="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase"
          >
            <span class="iconify text-base uil--clock" aria-hidden="true"></span>
            {m['profile.last_activity']()}
          </div>
          <div class="mt-2 text-sm font-medium">
            {#if !profile.lastActivityVisible}
              <span class="inline-flex items-center gap-1.5 text-muted">
                <span class="iconify uil--eye-slash" aria-hidden="true"></span>
                {m['profile.last_activity_hidden']()}
              </span>
            {:else if profile.lastActivity}
              {formatDateTime(profile.lastActivity)}
            {:else}
              <span class="text-muted">{m['profile.last_activity_unavailable']()}</span>
            {/if}
          </div>
        </div>
      </section>

      <section
        class="grid gap-3 rounded-xl border border-border bg-surface-100 p-4 shadow-sm"
        aria-labelledby={biographyHeadingId}
      >
        <h4 id={biographyHeadingId} class="flex items-center gap-2 text-sm font-semibold text-text">
          <span class="iconify text-lg text-primary uil--file-alt" aria-hidden="true"></span>
          {m['profile.biography']()}
        </h4>
        <div
          class="profile-biography min-h-20 rounded-lg bg-background/65 p-4 text-sm ring-1 ring-text/5"
        >
          {#if profile.biographyMarkdown.trim()}
            <MessageContent body={profile.biographyMarkdown} />
          {:else}
            <p class="text-muted">{m['profile.biography_empty']()}</p>
          {/if}
        </div>
      </section>
    {/if}

    {#if profile?.viewerIsSelf || mayMessage || mayCall || canBanFromRoom}
      <section
        class="profile-actions sticky bottom-0 z-10 -mx-1 flex flex-wrap gap-2 border-t border-border bg-background/95 px-1 pt-4 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl"
        aria-label={m['profile.actions']()}
      >
        {#if profile?.viewerIsSelf}
          <button type="button" class="btn-primary min-h-11" onclick={handleEditProfile}>
            <span class="iconify uil--edit" aria-hidden="true"></span>
            {m['profile.edit']()}
          </button>
        {/if}
        {#if mayMessage}
          <button type="button" class="btn-primary min-h-11" onclick={handleSendMessage}>
            <span class="iconify uil--comment-alt-message" aria-hidden="true"></span>
            {m['chat.user_menu.send_message']()}
          </button>
        {/if}
        {#if mayCall}
          <button type="button" class="btn-secondary min-h-11" onclick={handleCall}>
            <span class="iconify uil--phone" aria-hidden="true"></span>
            {m['profile.call']()}
          </button>
        {/if}
        {#if canBanFromRoom}
          <button
            type="button"
            class="btn-danger min-h-11 disabled:cursor-not-allowed disabled:opacity-50"
            onclick={handleBanFromRoom}
            disabled={banningFromRoom}
          >
            <span class="iconify uil--ban" aria-hidden="true"></span>
            {banningFromRoom ? m['admin.moderation.banning']() : m['admin.moderation.ban_action']()}
          </button>
        {/if}
      </section>
    {/if}
  </article>
</Dialog>

<style>
  :global(.profile-biography) {
    overflow-wrap: anywhere;
  }

  :global(.profile-biography img) {
    max-width: 100%;
  }

  :global(.profile-biography pre) {
    max-width: 100%;
    overflow-x: auto;
  }

  :global(.profile-biography a) {
    word-break: break-word;
  }

  @media (max-width: 640px), (max-height: 620px) {
    :global(dialog:has(.user-profile-dialog)) {
      width: 100vw !important;
      max-width: none !important;
      height: 100dvh;
      max-height: none;
      margin: 0;
    }

    :global(dialog:has(.user-profile-dialog) > .dialog-tray) {
      min-height: 100dvh;
      border: 0;
      border-radius: 0;
      padding: 0;
    }

    :global(dialog:has(.user-profile-dialog) .dialog-content) {
      min-height: 100dvh;
      max-height: 100dvh;
      border-radius: 0;
      padding: max(0.75rem, env(safe-area-inset-top)) 1rem max(0.75rem, env(safe-area-inset-bottom));
    }

    .user-profile-dialog {
      min-height: calc(100dvh - max(5rem, env(safe-area-inset-top)));
      align-content: start;
    }

    .profile-hero {
      border-radius: 1rem;
    }

    .profile-actions > button {
      flex: 1 1 9rem;
      justify-content: center;
    }
  }
</style>
