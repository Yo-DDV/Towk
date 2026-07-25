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
  const detailsHeadingId = `${componentId}-details-heading`;
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
  const showActions = $derived(
    Boolean(profile?.viewerIsSelf || mayMessage || mayCall || canBanFromRoom)
  );
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
        if (!cancelled) {
          profile = null;
          loadError = m['profile.load_failed']();
        }
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
  mobileFullScreen
  swipeToClose
  onclose={handleDialogClose}
>
  <article
    class="user-profile-dialog -mx-1 grid min-w-0 gap-5 pb-1"
    data-anchor={anchorRect ? 'set' : undefined}
    data-testid="user-profile-dialog"
  >
    <section
      class="profile-hero relative isolate overflow-hidden rounded-3xl border border-text/10 bg-linear-to-br from-background/95 via-surface-100/90 to-surface-200/80 p-5 shadow-lg ring-1 ring-white/10 backdrop-blur-xl sm:p-6"
    >
      <div
        class="pointer-events-none absolute -top-24 -right-24 -z-10 h-64 w-64 rounded-full bg-primary/20 blur-3xl"
        aria-hidden="true"
      ></div>
      <div
        class="pointer-events-none absolute -bottom-24 -left-16 -z-10 h-56 w-56 rounded-full bg-accent/10 blur-3xl"
        aria-hidden="true"
      ></div>

      <div class="profile-hero-layout">
        <div class="profile-avatar-shell" data-testid="profile-avatar-shell">
          <UserAvatar user={profileUser} size="xl" showPresence class="profile-avatar" />
        </div>

        <div class="profile-identity min-w-0">
          <div class="profile-kicker">
            <span class="profile-section-icon" aria-hidden="true">
              <span class="iconify uil--user-square"></span>
            </span>
            <span>{m['profile.details']()}</span>
          </div>
          <h3 class="mt-3 truncate text-3xl font-black tracking-tight text-text-top sm:text-4xl">
            {displayName}
          </h3>
          <p class="mt-1 truncate text-sm font-semibold text-muted">@{login}</p>
          <div class="profile-presence-row mt-4 flex flex-wrap items-center gap-2">
            <span class="profile-presence-chip">
              <span
                class={['h-2.5 w-2.5 rounded-full shadow-sm', presenceDotClass]}
                aria-hidden="true"
              ></span>
              {presenceLabel}
            </span>
            <UserCustomStatusBadge status={customStatus} showText class="max-w-full" />
          </div>
        </div>

        <section
          class="profile-hero-roles"
          aria-labelledby={rolesHeadingId}
          data-testid="profile-hero-roles"
        >
          <h4 id={rolesHeadingId} class="flex items-center gap-2 text-sm font-bold text-text-top">
            <span class="profile-section-icon" aria-hidden="true">
              <span class="iconify uil--award"></span>
            </span>
            {m['profile.roles']()}
          </h4>
          <div class="mt-3 flex flex-wrap gap-2">
            {#if loading}
              <span class="profile-role-skeleton w-24"></span>
              <span class="profile-role-skeleton w-16"></span>
            {:else if profile}
              {#if roles.length === 0}
                <span class="profile-role-chip">{m['profile.member_role']()}</span>
              {:else}
                {#each roles as role (role.name)}
                  <span
                    class={['profile-role-chip', role.moderation && 'profile-role-chip-moderation']}
                    title={role.name}
                  >
                    {#if role.moderation}
                      <span class="iconify text-base uil--shield-check" aria-hidden="true"></span>
                    {/if}
                    {role.displayName || role.name}
                  </span>
                {/each}
              {/if}
            {:else}
              <span class="text-sm font-medium text-muted">{m['profile.not_available']()}</span>
            {/if}
          </div>
        </section>
      </div>
    </section>

    {#if loading}
      <section
        class="profile-loading-grid grid gap-4 rounded-2xl border border-border/80 bg-background/65 p-4 shadow-sm backdrop-blur"
        role="status"
        aria-live="polite"
        data-testid="user-profile-loading"
      >
        <div class="flex items-center gap-3 text-sm font-medium text-muted">
          <span class="profile-section-icon" aria-hidden="true">
            <span class="iconify animate-spin uil--spinner-alt"></span>
          </span>
          {m['profile.loading']()}
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="profile-skeleton h-24 rounded-xl"></div>
          <div class="profile-skeleton h-24 rounded-xl"></div>
        </div>
        <div class="profile-skeleton h-28 rounded-xl"></div>
      </section>
    {:else if loadError}
      <section
        class="profile-state-card flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-danger shadow-sm backdrop-blur"
        role="alert"
        data-testid="user-profile-error"
      >
        <span class="profile-state-icon" aria-hidden="true">
          <span class="iconify uil--exclamation-octagon"></span>
        </span>
        <p class="text-sm leading-relaxed font-medium">{loadError}</p>
      </section>
    {/if}

    {#if profile}
      <div class="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <section
          class="profile-card profile-biography-card grid min-w-0 gap-3 rounded-2xl border border-text/10 bg-background/70 p-4 shadow-sm backdrop-blur-xl"
          aria-labelledby={biographyHeadingId}
        >
          <div class="flex items-center justify-between gap-3">
            <h4
              id={biographyHeadingId}
              class="flex items-center gap-2 text-sm font-semibold text-text"
            >
              <span class="profile-section-icon" aria-hidden="true">
                <span class="iconify uil--file-alt"></span>
              </span>
              {m['profile.biography']()}
            </h4>
          </div>
          <div
            class="profile-biography min-h-40 rounded-xl border border-text/10 bg-surface-100/70 p-4 text-sm leading-relaxed shadow-inner"
          >
            {#if profile.biographyMarkdown.trim()}
              <MessageContent body={profile.biographyMarkdown} />
            {:else}
              <p class="text-muted">{m['profile.biography_empty']()}</p>
            {/if}
          </div>
        </section>

        <section
          class="profile-card grid gap-3 rounded-2xl border border-text/10 bg-background/70 p-4 shadow-sm backdrop-blur-xl"
          aria-labelledby={detailsHeadingId}
        >
          <h4 id={detailsHeadingId} class="sr-only">{m['profile.details']()}</h4>
          <div class="grid gap-3">
            <div class="profile-detail-tile">
              <span class="profile-detail-icon iconify uil--calendar-alt" aria-hidden="true"></span>
              <span class="min-w-0">
                <span class="block text-xs font-semibold tracking-wide text-muted uppercase">
                  {m['profile.joined']()}
                </span>
                <span class="mt-1 block text-sm font-semibold text-text">
                  {formatDate(profile.joinedAt)}
                </span>
              </span>
            </div>
            <div class="profile-detail-tile">
              <span class="profile-detail-icon iconify uil--clock" aria-hidden="true"></span>
              <span class="min-w-0">
                <span class="block text-xs font-semibold tracking-wide text-muted uppercase">
                  {m['profile.last_activity']()}
                </span>
                <span class="mt-1 block text-sm font-semibold text-text">
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
                </span>
              </span>
            </div>
          </div>
        </section>
      </div>
    {/if}

    {#if showActions}
      <section
        class="profile-actions sticky bottom-0 z-10 -mx-1 grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2 rounded-t-2xl border border-border/80 bg-background/92 px-3 pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-12px_32px_rgba(0,0,0,0.08)] backdrop-blur-xl"
        aria-label={m['profile.actions']()}
      >
        {#if profile?.viewerIsSelf}
          <button
            type="button"
            class="profile-action-button btn-primary min-h-12"
            onclick={handleEditProfile}
          >
            <span class="profile-action-icon" aria-hidden="true">
              <span class="iconify uil--edit"></span>
            </span>
            {m['profile.edit']()}
          </button>
        {/if}
        {#if mayMessage}
          <button
            type="button"
            class="profile-action-button btn-primary min-h-12"
            onclick={handleSendMessage}
          >
            <span class="profile-action-icon" aria-hidden="true">
              <span class="iconify uil--comment-alt-message"></span>
            </span>
            {m['chat.user_menu.send_message']()}
          </button>
        {/if}
        {#if mayCall}
          <button
            type="button"
            class="profile-action-button btn-accent min-h-12"
            onclick={handleCall}
          >
            <span class="profile-action-icon" aria-hidden="true">
              <span class="iconify uil--phone"></span>
            </span>
            {m['profile.call']()}
          </button>
        {/if}
        {#if canBanFromRoom}
          <button
            type="button"
            class="profile-action-button btn-danger min-h-12 disabled:cursor-not-allowed disabled:opacity-50"
            onclick={handleBanFromRoom}
            disabled={banningFromRoom}
          >
            <span class="profile-action-icon" aria-hidden="true">
              <span class="iconify uil--ban"></span>
            </span>
            {banningFromRoom ? m['admin.moderation.banning']() : m['admin.moderation.ban_action']()}
          </button>
        {/if}
      </section>
    {/if}
  </article>
</Dialog>

<style>
  .profile-hero {
    container-type: inline-size;
  }

  .profile-hero-layout {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 1.25rem;
  }

  .profile-avatar-shell {
    position: relative;
    display: grid;
    width: 6.5rem;
    height: 6.5rem;
    aspect-ratio: 1;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, white 24%, var(--color-text) 10%);
    border-radius: 9999px;
    padding: 0.55rem;
    background: linear-gradient(
      145deg,
      color-mix(in srgb, var(--color-surface-100) 90%, white 10%),
      color-mix(in srgb, var(--color-background) 86%, black 14%)
    );
    box-shadow:
      -0.65rem -0.65rem 1.35rem color-mix(in srgb, white 14%, transparent),
      0.75rem 0.75rem 1.6rem color-mix(in srgb, black 28%, transparent),
      inset 0.16rem 0.16rem 0.35rem color-mix(in srgb, white 22%, transparent),
      inset -0.18rem -0.18rem 0.4rem color-mix(in srgb, black 16%, transparent);
  }

  .profile-avatar-shell::before {
    position: absolute;
    inset: 0.3rem;
    border: 1px solid color-mix(in srgb, var(--color-primary) 32%, transparent);
    border-radius: inherit;
    content: '';
    pointer-events: none;
  }

  .profile-avatar-shell :global(.profile-avatar) {
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: 1;
    border-radius: 9999px;
  }

  .profile-avatar-shell :global(.profile-avatar img),
  .profile-avatar-shell :global(.profile-avatar > div:first-child) {
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: 1;
    border-radius: 9999px;
    object-fit: cover;
  }

  .profile-kicker {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    color: var(--color-muted);
    font-size: 0.6875rem;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .profile-section-icon,
  .profile-state-icon {
    display: inline-grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-primary) 48%, transparent);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--color-primary) 22%, var(--color-surface-100));
    color: color-mix(in srgb, var(--color-primary) 82%, white 18%);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 26%, transparent),
      0 0.4rem 1rem color-mix(in srgb, var(--color-primary) 16%, transparent);
    font-size: 1.1rem;
  }

  .profile-state-icon {
    border-color: color-mix(in srgb, var(--color-danger) 55%, transparent);
    background: color-mix(in srgb, var(--color-danger) 18%, var(--color-surface-100));
    color: var(--color-danger);
  }

  .profile-presence-chip {
    display: inline-flex;
    min-height: 2rem;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 18%, transparent);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-background) 84%, transparent);
    padding: 0.25rem 0.75rem;
    color: var(--color-text);
    font-size: 0.75rem;
    font-weight: 750;
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 18%, transparent);
    backdrop-filter: blur(0.75rem);
  }

  .profile-hero-roles {
    grid-column: 1 / -1;
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--color-text) 14%, transparent);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--color-background) 70%, transparent);
    padding: 0.9rem;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 18%, transparent),
      0 0.9rem 2rem color-mix(in srgb, black 10%, transparent);
    backdrop-filter: blur(1rem) saturate(1.15);
  }

  .profile-card,
  .profile-state-card,
  .profile-loading-grid {
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 16%, transparent),
      0 18px 45px color-mix(in srgb, black 8%, transparent);
  }

  .profile-role-chip {
    display: inline-flex;
    min-height: 2rem;
    align-items: center;
    gap: 0.375rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 22%, transparent);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-background) 88%, transparent);
    padding: 0.25rem 0.75rem;
    color: var(--color-text-top);
    font-size: 0.875rem;
    font-weight: 650;
    line-height: 1.25rem;
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 20%, transparent);
  }

  .profile-role-chip-moderation {
    border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
    background: color-mix(in srgb, var(--color-primary) 20%, var(--color-background));
    color: color-mix(in srgb, var(--color-primary) 84%, white 16%);
    font-weight: 750;
  }

  .profile-role-skeleton {
    display: inline-block;
    height: 2rem;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-surface-200) 76%, transparent);
    animation: profile-role-pulse 1.4s ease-in-out infinite;
  }

  .profile-detail-tile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    align-items: center;
    border: 1px solid color-mix(in srgb, var(--color-text) 11%, transparent);
    border-radius: 0.875rem;
    background: color-mix(in srgb, var(--color-surface-100) 80%, transparent);
    padding: 0.875rem;
  }

  .profile-detail-icon {
    display: grid;
    min-height: 2.75rem;
    min-width: 2.75rem;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
    border-radius: 0.9rem;
    background: color-mix(in srgb, var(--color-primary) 20%, var(--color-surface-100));
    color: color-mix(in srgb, var(--color-primary) 82%, white 18%);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 24%, transparent),
      0 0.5rem 1.15rem color-mix(in srgb, var(--color-primary) 13%, transparent);
    font-size: 1.25rem;
  }

  .profile-action-button {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    padding-inline: 1rem;
    font-weight: 750;
  }

  .profile-action-icon {
    display: inline-grid;
    width: 2rem;
    height: 2rem;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
    border-radius: 0.7rem;
    background: color-mix(in srgb, currentColor 16%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 22%, transparent);
    font-size: 1.05rem;
  }

  .profile-skeleton {
    position: relative;
    overflow: hidden;
    background: color-mix(in srgb, var(--color-surface-200) 70%, transparent);
  }

  .profile-skeleton::after {
    position: absolute;
    inset: 0;
    content: '';
    transform: translateX(-100%);
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, white 18%, transparent),
      transparent
    );
    animation: profile-skeleton-shimmer 1.4s ease-in-out infinite;
  }

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

  @container (min-width: 42rem) {
    .profile-hero-layout {
      grid-template-columns: auto minmax(14rem, 1fr) minmax(15rem, 0.72fr);
      gap: 1.5rem;
    }

    .profile-avatar-shell {
      width: 7rem;
      height: 7rem;
    }

    .profile-hero-roles {
      grid-column: auto;
    }
  }

  @container (max-width: 27rem) {
    .profile-hero-layout {
      grid-template-columns: minmax(0, 1fr);
      justify-items: center;
      text-align: center;
    }

    .profile-identity {
      width: 100%;
    }

    .profile-kicker,
    .profile-presence-row {
      justify-content: center;
    }

    .profile-hero-roles {
      width: 100%;
      text-align: left;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .profile-skeleton::after,
    .profile-role-skeleton {
      animation: none;
    }
  }

  @media (forced-colors: active) {
    .profile-avatar-shell,
    .profile-hero-roles,
    .profile-section-icon,
    .profile-state-icon,
    .profile-detail-icon,
    .profile-action-icon,
    .profile-role-chip {
      border: 1px solid CanvasText;
      box-shadow: none;
    }
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
      border-radius: 1.25rem;
    }

    .profile-actions {
      margin-inline: -0.25rem;
    }
  }

  @keyframes profile-role-pulse {
    0%,
    100% {
      opacity: 0.58;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes profile-skeleton-shimmer {
    to {
      transform: translateX(100%);
    }
  }
</style>
