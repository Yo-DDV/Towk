<!--
@component

Canonical detailed user profile. The component keeps the existing trigger contract used by
messages, member lists, call participants, and autocomplete results, while presenting one
responsive dialog backed by the detailed profile API.
-->
<script lang="ts">
  import type { PresenceStatus } from '$lib/render/types';
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
  import {
    getLiveCustomStatus,
    getLiveDisplayName,
    getLiveLogin,
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
  let visible = $state(true);
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
  const mayMessage = $derived(!user.deleted && (profile?.viewerCanMessage ?? canSendMessage));
  const mayCall = $derived(!user.deleted && (profile?.viewerCanCall ?? false));

  $effect(() => {
    const targetUserId = user.id;
    let cancelled = false;
    loading = true;
    loadError = '';

    const conn = connection();
    void createMemberDirectoryAPI({
      serverId: getActiveServer(),
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    })
      .getUserProfile(targetUserId)
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

  function closeBeforeAction() {
    visible = false;
  }

  async function handleSendMessage() {
    closeBeforeAction();
    if (onSendMessage) {
      await onSendMessage();
      return;
    }
    await startDMWith(getActiveServer(), user.id);
  }

  async function handleCall() {
    closeBeforeAction();
    await startCallWith(getActiveServer(), user.id);
  }

  async function handleBanFromRoom() {
    await onBanFromRoom?.();
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
  onclose={() => onClose?.()}
>
  <article
    class="user-profile-dialog grid gap-6"
    data-anchor={anchorRect ? 'set' : undefined}
    data-testid="user-profile-dialog"
  >
    <section class="flex min-w-0 items-center gap-4">
      <UserAvatar user={profileUser} size="xl" showPresence />
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-2xl font-bold">{displayName}</h3>
        <p class="truncate text-sm text-muted">@{login}</p>
        <UserCustomStatusBadge status={customStatus} showText class="mt-2 max-w-full" />
      </div>
    </section>

    {#if loading}
      <div
        class="flex items-center gap-2 rounded-md bg-surface-100 p-4 text-sm text-muted"
        role="status"
      >
        <span class="iconify animate-spin uil--spinner-alt" aria-hidden="true"></span>
        {m['profile.loading']()}
      </div>
    {:else if loadError}
      <p class="rounded-md bg-danger/10 p-3 text-sm text-danger" role="alert">{loadError}</p>
    {/if}

    {#if profile}
      <section class="grid gap-2" aria-labelledby="profile-roles-heading">
        <h4
          id="profile-roles-heading"
          class="text-xs font-semibold tracking-wide text-muted uppercase"
        >
          {m['profile.roles']()}
        </h4>
        <div class="flex flex-wrap gap-2">
          {#if roles.length === 0}
            <span class="rounded-full bg-surface-200 px-3 py-1 text-sm"
              >{m['profile.member_role']()}</span
            >
          {:else}
            {#each roles as role (role.name)}
              <span
                class={[
                  'rounded-full px-3 py-1 text-sm',
                  role.moderation
                    ? 'bg-primary/20 font-semibold text-primary'
                    : 'bg-surface-200 text-text'
                ]}
                title={role.name}
              >
                {role.displayName || role.name}
              </span>
            {/each}
          {/if}
        </div>
      </section>

      <section class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="rounded-md bg-surface-100 p-3">
          <div class="text-xs font-semibold tracking-wide text-muted uppercase">
            {m['profile.joined']()}
          </div>
          <div class="mt-1 text-sm">{formatDate(profile.joinedAt)}</div>
        </div>
        <div class="rounded-md bg-surface-100 p-3">
          <div class="text-xs font-semibold tracking-wide text-muted uppercase">
            {m['profile.last_activity']()}
          </div>
          <div class="mt-1 text-sm">
            {#if !profile.lastActivityVisible}
              {m['profile.last_activity_hidden']()}
            {:else if profile.lastActivity}
              {formatDateTime(profile.lastActivity)}
            {:else}
              {m['profile.last_activity_unavailable']()}
            {/if}
          </div>
        </div>
      </section>

      <section class="grid gap-2" aria-labelledby="profile-bio-heading">
        <h4
          id="profile-bio-heading"
          class="text-xs font-semibold tracking-wide text-muted uppercase"
        >
          {m['profile.biography']()}
        </h4>
        <div class="profile-biography min-h-16 rounded-md bg-surface-100 p-4 text-sm">
          {#if profile.biographyMarkdown.trim()}
            <MessageContent body={profile.biographyMarkdown} />
          {:else}
            <p class="text-muted">{m['profile.biography_empty']()}</p>
          {/if}
        </div>
      </section>
    {/if}

    {#if mayMessage || mayCall || canBanFromRoom}
      <section
        class="flex flex-wrap gap-2 border-t border-border pt-4"
        aria-label={m['profile.actions']()}
      >
        {#if mayMessage}
          <button type="button" class="btn-primary" onclick={handleSendMessage}>
            <span class="iconify uil--comment-alt-message" aria-hidden="true"></span>
            {m['chat.user_menu.send_message']()}
          </button>
        {/if}
        {#if mayCall}
          <button type="button" class="btn-secondary" onclick={handleCall}>
            <span class="iconify uil--phone" aria-hidden="true"></span>
            {m['profile.call']()}
          </button>
        {/if}
        {#if canBanFromRoom}
          <button
            type="button"
            class="btn-danger disabled:cursor-not-allowed disabled:opacity-50"
            onclick={handleBanFromRoom}
            disabled={banningFromRoom}
          >
            {banningFromRoom ? m['admin.moderation.banning']() : m['admin.moderation.ban_action']()}
          </button>
        {/if}
      </section>
    {/if}
  </article>
</Dialog>

<style>
  :global(.profile-biography img) {
    max-width: 100%;
  }

  @media (max-width: 640px), (max-height: 620px) {
    :global(dialog:has(.user-profile-dialog)) {
      width: 100vw !important;
      max-width: none !important;
      height: 100dvh;
      max-height: none;
      margin: 0;
    }

    :global(dialog:has(.user-profile-dialog) > div) {
      min-height: 100dvh;
      border: 0;
      border-radius: 0;
      padding: 0;
    }

    :global(dialog:has(.user-profile-dialog) > div > div) {
      min-height: 100dvh;
      max-height: 100dvh;
      border-radius: 0;
      padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom));
    }
  }
</style>
