<!--
@component

Pure presentation for Towk's canonical detailed user profile. Network loading,
history integration, navigation, and capability decisions remain owned by
UserContextMenu so every existing identity entry point keeps the same contract.
-->
<script lang="ts">
  import type { DetailedUserProfile } from '$lib/api-client/memberDirectory';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import UserCustomStatusBadge from '$lib/components/UserCustomStatusBadge.svelte';
  import MessageContent from '$lib/components/MessageContent.svelte';
  import { PresenceStatus } from '$lib/render/types';
  import * as m from '$lib/i18n/messages';

  let {
    user,
    profile,
    loading,
    loadError,
    anchored = false,
    canEditProfile = false,
    canSendMessage = false,
    canCall = false,
    canBanFromRoom = false,
    banningFromRoom = false,
    onEditProfile,
    onSendMessage,
    onCall,
    onBanFromRoom
  }: {
    user: DetailedUserProfile['user'];
    profile: DetailedUserProfile | null;
    loading: boolean;
    loadError: string;
    anchored?: boolean;
    canEditProfile?: boolean;
    canSendMessage?: boolean;
    canCall?: boolean;
    canBanFromRoom?: boolean;
    banningFromRoom?: boolean;
    onEditProfile: () => void | Promise<void>;
    onSendMessage: () => void | Promise<void>;
    onCall: () => void | Promise<void>;
    onBanFromRoom: () => void | Promise<void>;
  } = $props();

  const componentId = $props.id();
  const rolesHeadingId = `${componentId}-roles-heading`;
  const detailsHeadingId = `${componentId}-details-heading`;
  const biographyHeadingId = `${componentId}-biography-heading`;
  const biographyContentId = `${componentId}-biography-content`;

  let biographyExpanded = $state(false);

  const roles = $derived(profile?.roles ?? []);
  const displayName = $derived(user.displayName || user.login);
  const presenceLabel = $derived(presenceStatusLabel(user.presenceStatus));
  const presenceDotClass = $derived(presenceStatusDotClass(user.presenceStatus));
  const biography = $derived(profile?.biographyMarkdown ?? '');
  const biographyCharacterCount = $derived(Array.from(biography).length);
  const biographyLineCount = $derived(biography ? biography.split('\n').length : 0);
  const biographyCollapsible = $derived(
    Boolean(profile && (biographyCharacterCount > 720 || biographyLineCount > 14))
  );
  const showActions = $derived(
    canEditProfile || canSendMessage || canCall || canBanFromRoom
  );

  $effect(() => {
    void biography;
    biographyExpanded = false;
  });

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

  function handleBiographyFocusIn() {
    if (biographyCollapsible && !biographyExpanded) biographyExpanded = true;
  }
</script>

<article
  class="user-profile-dialog"
  data-anchor={anchored ? 'set' : undefined}
  data-testid="user-profile-dialog"
>
  <div class="profile-shell">
    <aside class="profile-identity-panel" data-testid="profile-identity-panel">
      <div class="profile-cover" aria-hidden="true">
        <span class="profile-cover-orbit profile-cover-orbit-large"></span>
        <span class="profile-cover-orbit profile-cover-orbit-small"></span>
      </div>

      <div class="profile-identity-body">
        <div class="profile-avatar-shell" data-testid="profile-avatar-shell">
          <UserAvatar user={user} size="xl" showPresence class="profile-avatar" />
        </div>

        <div class="profile-name-block">
          <h2 class="profile-display-name" data-testid="profile-display-name">
            {displayName}
          </h2>
          <p class="profile-login">@{user.login}</p>
        </div>

        <div class="profile-status-row">
          <span class="profile-presence-pill">
            <span
              class={['profile-presence-dot', presenceDotClass]}
              aria-hidden="true"
            ></span>
            <span>{presenceLabel}</span>
          </span>
          <UserCustomStatusBadge
            status={user.customStatus}
            showText
            class="profile-custom-status"
          />
        </div>

        {#if showActions}
          <div class="profile-actions" role="group" aria-label={m['profile.actions']()}>
            {#if canEditProfile}
              <button
                type="button"
                class="profile-action btn-secondary"
                onclick={onEditProfile}
              >
                <span class="profile-action-icon" aria-hidden="true">
                  <span class="iconify uil--edit"></span>
                </span>
                <span class="profile-action-label">{m['profile.edit']()}</span>
              </button>
            {/if}
            {#if canSendMessage}
              <button
                type="button"
                class="profile-action btn-primary"
                onclick={onSendMessage}
              >
                <span class="profile-action-icon" aria-hidden="true">
                  <span class="iconify uil--comment-alt-message"></span>
                </span>
                <span class="profile-action-label">
                  {m['chat.user_menu.send_message']()}
                </span>
              </button>
            {/if}
            {#if canCall}
              <button
                type="button"
                class="profile-action btn-secondary"
                onclick={onCall}
              >
                <span class="profile-action-icon" aria-hidden="true">
                  <span class="iconify uil--phone"></span>
                </span>
                <span class="profile-action-label">{m['profile.call']()}</span>
              </button>
            {/if}
            {#if canBanFromRoom}
              <button
                type="button"
                class="profile-action btn-danger"
                onclick={onBanFromRoom}
                aria-busy={banningFromRoom}
                disabled={banningFromRoom}
              >
                <span class="profile-action-icon" aria-hidden="true">
                  <span class="iconify uil--ban"></span>
                </span>
                <span class="profile-action-label">
                  {banningFromRoom
                    ? m['admin.moderation.banning']()
                    : m['admin.moderation.ban_action']()}
                </span>
              </button>
            {/if}
          </div>
        {/if}

        <section
          class="profile-roles"
          aria-labelledby={rolesHeadingId}
          data-testid="profile-hero-roles"
        >
          <div class="profile-section-label">
            <span class="profile-section-label-icon" aria-hidden="true">
              <span class="iconify uil--award"></span>
            </span>
            <h3 id={rolesHeadingId}>{m['profile.roles']()}</h3>
          </div>

          <div class="profile-role-list">
            {#if loading}
              <span class="profile-role-skeleton profile-role-skeleton-wide"></span>
              <span class="profile-role-skeleton"></span>
            {:else if profile}
              {#if roles.length === 0}
                <span class="profile-role-chip">
                  <span class="profile-role-label">{m['profile.member_role']()}</span>
                </span>
              {:else}
                {#each roles as role (role.name)}
                  <span
                    class={[
                      'profile-role-chip',
                      role.moderation && 'profile-role-chip-moderation'
                    ]}
                    title={role.displayName || role.name}
                  >
                    {#if role.moderation}
                      <span class="iconify uil--shield-check" aria-hidden="true"></span>
                    {/if}
                    <span class="profile-role-label">
                      {role.displayName || role.name}
                    </span>
                  </span>
                {/each}
              {/if}
            {:else}
              <span class="profile-role-unavailable">{m['profile.not_available']()}</span>
            {/if}
          </div>
        </section>
      </div>
    </aside>

    <div
      class="profile-content-panel"
      data-testid="profile-content-panel"
      aria-busy={loading}
    >
      {#if loading}
        <section
          class="profile-loading-state"
          role="status"
          aria-live="polite"
          data-testid="user-profile-loading"
        >
          <div class="profile-section-heading">
            <span class="profile-section-icon" aria-hidden="true">
              <span class="iconify animate-spin uil--spinner-alt"></span>
            </span>
            <h3>{m['profile.loading']()}</h3>
          </div>

          <div class="profile-facts-grid" aria-hidden="true">
            <div class="profile-skeleton profile-skeleton-fact"></div>
            <div class="profile-skeleton profile-skeleton-fact"></div>
          </div>
          <div
            class="profile-skeleton profile-skeleton-biography"
            aria-hidden="true"
          ></div>
        </section>
      {:else if loadError}
        <section class="profile-error-section">
          <div
            class="profile-error-state"
            role="alert"
            data-testid="user-profile-error"
          >
            <span class="profile-error-icon" aria-hidden="true">
              <span class="iconify uil--exclamation-octagon"></span>
            </span>
            <p>{loadError}</p>
          </div>
        </section>
      {:else if profile}
        <section class="profile-content-section" aria-labelledby={detailsHeadingId}>
          <div class="profile-section-heading">
            <span class="profile-section-icon" aria-hidden="true">
              <span class="iconify uil--user-square"></span>
            </span>
            <h3 id={detailsHeadingId}>{m['profile.details']()}</h3>
          </div>

          <div class="profile-facts-grid">
            <div class="profile-fact">
              <span
                class="profile-fact-icon iconify uil--calendar-alt"
                aria-hidden="true"
              ></span>
              <span class="profile-fact-copy">
                <span class="profile-fact-label">{m['profile.joined']()}</span>
                <span class="profile-fact-value">{formatDate(profile.joinedAt)}</span>
              </span>
            </div>

            <div class="profile-fact">
              <span
                class="profile-fact-icon iconify uil--clock"
                aria-hidden="true"
              ></span>
              <span class="profile-fact-copy">
                <span class="profile-fact-label">
                  {m['profile.last_activity']()}
                </span>
                <span class="profile-fact-value">
                  {#if !profile.lastActivityVisible}
                    <span class="profile-private-value">
                      <span class="iconify uil--eye-slash" aria-hidden="true"></span>
                      {m['profile.last_activity_hidden']()}
                    </span>
                  {:else if profile.lastActivity}
                    {formatDateTime(profile.lastActivity)}
                  {:else}
                    <span class="profile-muted-value">
                      {m['profile.last_activity_unavailable']()}
                    </span>
                  {/if}
                </span>
              </span>
            </div>
          </div>
        </section>

        <section
          class="profile-content-section profile-biography-section"
          aria-labelledby={biographyHeadingId}
        >
          <div class="profile-section-heading">
            <span class="profile-section-icon" aria-hidden="true">
              <span class="iconify uil--file-alt"></span>
            </span>
            <h3 id={biographyHeadingId}>{m['profile.biography']()}</h3>
          </div>

          <div
            class="profile-biography-shell"
            class:profile-biography-shell-collapsed={biographyCollapsible &&
              !biographyExpanded}
          >
            <div
              id={biographyContentId}
              class="profile-biography"
              class:profile-biography-content-collapsed={biographyCollapsible &&
                !biographyExpanded}
              data-testid="profile-biography-content"
              onfocusin={handleBiographyFocusIn}
            >
              {#if biography.trim()}
                <MessageContent body={biography} />
              {:else}
                <p class="profile-biography-empty">
                  {m['profile.biography_empty']()}
                </p>
              {/if}
            </div>

            {#if biographyCollapsible && !biographyExpanded}
              <div class="profile-biography-fade" aria-hidden="true"></div>
            {/if}
          </div>

          {#if biographyCollapsible}
            <button
              type="button"
              class="profile-biography-toggle"
              aria-expanded={biographyExpanded}
              aria-controls={biographyContentId}
              onclick={() => (biographyExpanded = !biographyExpanded)}
            >
              <span
                class={[
                  'iconify',
                  biographyExpanded ? 'uil--angle-up' : 'uil--angle-down'
                ]}
                aria-hidden="true"
              ></span>
              <span>
                {biographyExpanded
                  ? m['profile.biography_collapse']()
                  : m['profile.biography_expand']()}
              </span>
            </button>
          {/if}
        </section>
      {:else}
        <section class="profile-error-section">
          <div class="profile-empty-state" role="status">
            {m['profile.not_available']()}
          </div>
        </section>
      {/if}
    </div>
  </div>
</article>

<style>
  .user-profile-dialog {
    container-name: user-profile;
    container-type: inline-size;
    min-width: 0;
    color: var(--color-text);
  }

  .profile-shell {
    display: grid;
    min-width: 0;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-text) 12%, transparent);
    border-radius: 1.5rem;
    background: var(--color-background);
    box-shadow:
      0 1.5rem 4.5rem color-mix(in srgb, black 22%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 7%, transparent);
    isolation: isolate;
  }

  .profile-identity-panel {
    position: relative;
    min-width: 0;
    border-bottom: 1px solid var(--color-border);
    background: linear-gradient(
      180deg,
      var(--color-surface-100),
      color-mix(in srgb, var(--color-background) 92%, var(--color-surface-100))
    );
  }

  .profile-cover {
    position: relative;
    height: 8.75rem;
    overflow: hidden;
    border-bottom: 1px solid color-mix(in srgb, var(--color-text) 9%, transparent);
    background:
      radial-gradient(
        circle at 12% 8%,
        color-mix(in srgb, white 10%, transparent),
        transparent 34%
      ),
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-surface-300) 88%, var(--color-background)),
        var(--color-surface-100) 62%,
        color-mix(in srgb, var(--color-surface-200) 84%, var(--color-background))
      );
  }

  .profile-cover::before {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(
        color-mix(in srgb, var(--color-text) 5%, transparent) 1px,
        transparent 1px
      ),
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--color-text) 5%, transparent) 1px,
        transparent 1px
      );
    background-size: 1.75rem 1.75rem;
    content: '';
    opacity: 0.8;
  }

  .profile-cover::after {
    position: absolute;
    right: -3rem;
    bottom: -5.75rem;
    width: 13rem;
    height: 13rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 11%, transparent);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-background) 12%, transparent);
    box-shadow:
      0 0 0 1.5rem color-mix(in srgb, var(--color-text) 3%, transparent),
      0 0 0 3.25rem color-mix(in srgb, var(--color-text) 2%, transparent);
    content: '';
  }

  .profile-cover-orbit {
    position: absolute;
    z-index: 1;
    display: block;
    border: 1px solid color-mix(in srgb, var(--color-text) 9%, transparent);
    border-radius: 9999px;
    pointer-events: none;
  }

  .profile-cover-orbit-large {
    top: -2.25rem;
    left: 42%;
    width: 7rem;
    height: 7rem;
  }

  .profile-cover-orbit-small {
    top: 2.25rem;
    left: 64%;
    width: 2.25rem;
    height: 2.25rem;
    background: color-mix(in srgb, var(--color-background) 10%, transparent);
  }

  .profile-identity-body {
    min-width: 0;
    padding: 0 1.25rem 1.35rem;
  }

  .profile-avatar-shell {
    position: relative;
    z-index: 3;
    display: grid;
    width: 7.5rem;
    height: 7.5rem;
    margin-top: -4.25rem;
    place-items: center;
    border: 0.375rem solid var(--color-surface-100);
    border-radius: 9999px;
    background: var(--color-background);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-text) 16%, transparent),
      0 0.9rem 2rem color-mix(in srgb, black 24%, transparent);
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

  .profile-name-block {
    min-width: 0;
    margin-top: 0.85rem;
  }

  .profile-display-name {
    margin: 0;
    color: var(--color-text-top);
    font-size: clamp(1.7rem, 7cqi, 2.35rem);
    font-weight: 780;
    letter-spacing: -0.035em;
    line-height: 1.05;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }

  .profile-login {
    min-width: 0;
    margin-top: 0.4rem;
    color: var(--color-muted);
    font-size: 0.875rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .profile-status-row {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.9rem;
  }

  .profile-presence-pill,
  :global(.profile-custom-status) {
    display: inline-flex;
    min-width: 0;
    min-height: 2rem;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 13%, transparent);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-background) 72%, transparent);
    padding: 0.32rem 0.7rem;
    color: var(--color-text);
    font-size: 0.75rem;
    font-weight: 650;
    line-height: 1.2;
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 7%, transparent);
  }

  :global(.profile-custom-status) {
    max-width: 100%;
  }

  :global(.profile-custom-status > span:last-child) {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .profile-presence-dot {
    width: 0.55rem;
    height: 0.55rem;
    flex: none;
    border-radius: 9999px;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-background) 80%, transparent);
  }

  .profile-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7.25rem, 1fr));
    gap: 0.625rem;
    margin-top: 1.2rem;
  }

  .profile-action {
    min-width: 0;
    min-height: 2.875rem;
    justify-content: flex-start;
    border-radius: 0.875rem;
    padding: 0.5rem 0.7rem;
    font-size: 0.8125rem;
    font-weight: 700;
  }

  .profile-action-icon {
    display: inline-grid;
    width: 1.8rem;
    height: 1.8rem;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
    border-radius: 0.625rem;
    background: color-mix(in srgb, currentColor 10%, transparent);
    font-size: 1rem;
  }

  .profile-action-label {
    min-width: 0;
    line-height: 1.25;
    overflow-wrap: anywhere;
    text-align: left;
  }

  .profile-roles {
    min-width: 0;
    margin-top: 1.25rem;
    border-top: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
    padding-top: 1.1rem;
  }

  .profile-section-label {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    color: var(--color-muted);
  }

  .profile-section-label h3 {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 780;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .profile-section-label-icon {
    display: inline-grid;
    width: 1.7rem;
    height: 1.7rem;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-text) 11%, transparent);
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--color-background) 58%, transparent);
    color: var(--color-text);
    font-size: 0.95rem;
  }

  .profile-role-list {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.75rem;
  }

  .profile-role-chip {
    display: inline-flex;
    max-width: 100%;
    min-height: 1.85rem;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 13%, transparent);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-background) 70%, transparent);
    padding: 0.25rem 0.65rem;
    color: var(--color-text);
    font-size: 0.77rem;
    font-weight: 650;
    line-height: 1.15;
  }

  .profile-role-chip-moderation {
    border-color: color-mix(in srgb, var(--color-text-top) 20%, transparent);
    background: color-mix(in srgb, var(--color-surface-200) 64%, transparent);
    color: var(--color-text-top);
    font-weight: 720;
  }

  .profile-role-label {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .profile-role-unavailable {
    color: var(--color-muted);
    font-size: 0.8rem;
    font-weight: 600;
  }

  .profile-role-skeleton,
  .profile-skeleton {
    display: block;
    background: color-mix(in srgb, var(--color-surface-200) 82%, transparent);
    animation: profile-pulse 1.45s ease-in-out infinite;
  }

  .profile-role-skeleton {
    width: 4.5rem;
    height: 1.85rem;
    border-radius: 9999px;
  }

  .profile-role-skeleton-wide {
    width: 6.25rem;
  }

  .profile-content-panel {
    min-width: 0;
    padding: 1.25rem;
    background: var(--color-background);
  }

  .profile-content-section + .profile-content-section {
    margin-top: 1.5rem;
    border-top: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
    padding-top: 1.5rem;
  }

  .profile-section-heading {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.75rem;
  }

  .profile-section-heading h3 {
    min-width: 0;
    margin: 0;
    color: var(--color-text-top);
    font-size: 0.95rem;
    font-weight: 750;
    letter-spacing: -0.01em;
  }

  .profile-section-icon,
  .profile-error-icon {
    display: inline-grid;
    width: 2.35rem;
    height: 2.35rem;
    flex: none;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-text) 12%, transparent);
    border-radius: 0.75rem;
    background: var(--color-surface-100);
    color: var(--color-text-top);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 6%, transparent);
    font-size: 1.1rem;
  }

  .profile-facts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .profile-fact {
    display: grid;
    min-width: 0;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
    border-radius: 1rem;
    background: var(--color-surface-100);
    padding: 0.9rem;
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 5%, transparent);
  }

  .profile-fact-icon {
    display: grid;
    width: 2.55rem;
    height: 2.55rem;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-text) 11%, transparent);
    border-radius: 0.8rem;
    background: color-mix(in srgb, var(--color-background) 64%, transparent);
    color: var(--color-text);
    font-size: 1.15rem;
  }

  .profile-fact-copy {
    display: grid;
    min-width: 0;
    gap: 0.22rem;
  }

  .profile-fact-label {
    color: var(--color-muted);
    font-size: 0.68rem;
    font-weight: 760;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .profile-fact-value {
    min-width: 0;
    color: var(--color-text-top);
    font-size: 0.84rem;
    font-weight: 650;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .profile-private-value {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--color-muted);
  }

  .profile-muted-value {
    color: var(--color-muted);
  }

  .profile-biography-shell {
    position: relative;
    min-width: 0;
    margin-top: 1rem;
  }

  .profile-biography-shell-collapsed {
    overflow: hidden;
    border-radius: 1rem;
  }

  .profile-biography {
    min-height: 7rem;
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
    border-radius: 1rem;
    background: var(--color-surface-100);
    padding: 1rem;
    color: var(--color-text);
    font-size: 0.875rem;
    line-height: 1.65;
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 5%, transparent);
    overflow-wrap: anywhere;
  }

  .profile-biography-content-collapsed {
    max-height: clamp(16rem, 44dvh, 28rem);
    overflow: hidden;
  }

  .profile-biography-fade {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 6rem;
    border-radius: 0 0 1rem 1rem;
    background: linear-gradient(
      to bottom,
      transparent,
      color-mix(in srgb, var(--color-surface-100) 96%, transparent) 78%
    );
    pointer-events: none;
  }

  .profile-biography-empty {
    margin: 0;
    color: var(--color-muted);
    font-style: italic;
  }

  .profile-biography-toggle {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    margin-top: 0.75rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 13%, transparent);
    border-radius: 9999px;
    background: var(--color-surface-100);
    padding: 0.45rem 0.9rem;
    color: var(--color-text);
    font-size: 0.78rem;
    font-weight: 700;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      transform 140ms ease;
  }

  .profile-biography-toggle:hover {
    border-color: color-mix(in srgb, var(--color-text) 22%, transparent);
    background: var(--color-surface-200);
  }

  .profile-biography-toggle:active {
    transform: translateY(1px);
  }

  .profile-biography-toggle:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .profile-loading-state {
    display: grid;
    gap: 1rem;
  }

  .profile-skeleton {
    border-radius: 1rem;
  }

  .profile-skeleton-fact {
    height: 5rem;
  }

  .profile-skeleton-biography {
    height: 12rem;
  }

  .profile-error-section {
    display: grid;
    min-height: 15rem;
    place-items: center;
  }

  .profile-error-state {
    display: grid;
    width: min(100%, 28rem);
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 0.8rem;
    border: 1px solid color-mix(in srgb, var(--color-danger) 36%, transparent);
    border-radius: 1rem;
    background: color-mix(in srgb, var(--color-danger) 9%, var(--color-background));
    padding: 1rem;
    color: var(--color-danger);
  }

  .profile-error-state p {
    margin: 0.15rem 0 0;
    font-size: 0.875rem;
    font-weight: 650;
    line-height: 1.5;
  }

  .profile-error-icon {
    border-color: color-mix(in srgb, var(--color-danger) 36%, transparent);
    background: color-mix(in srgb, var(--color-danger) 10%, var(--color-background));
    color: var(--color-danger);
  }

  .profile-empty-state {
    border: 1px dashed color-mix(in srgb, var(--color-text) 16%, transparent);
    border-radius: 1rem;
    padding: 1rem 1.25rem;
    color: var(--color-muted);
    font-size: 0.875rem;
    font-weight: 600;
    text-align: center;
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

  @container user-profile (min-width: 38rem) and (max-width: 53.999rem) {
    .profile-identity-body {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      column-gap: 1.25rem;
      align-items: start;
    }

    .profile-avatar-shell {
      grid-row: 1 / span 2;
    }

    .profile-name-block {
      grid-column: 2;
      margin-top: 0.75rem;
    }

    .profile-status-row {
      grid-column: 2;
    }

    .profile-actions,
    .profile-roles {
      grid-column: 1 / -1;
    }
  }

  @container user-profile (min-width: 54rem) {
    .profile-shell {
      min-height: min(40rem, calc(100dvh - 3rem));
      grid-template-columns: minmax(17.75rem, 19rem) minmax(0, 1fr);
    }

    .profile-identity-panel {
      border-right: 1px solid var(--color-border);
      border-bottom: 0;
    }

    .profile-cover {
      height: 10rem;
    }

    .profile-identity-body {
      padding-right: 1.35rem;
      padding-bottom: 1.5rem;
      padding-left: 1.35rem;
    }

    .profile-content-panel {
      padding: clamp(1.5rem, 3cqi, 2rem);
    }

    .profile-display-name {
      font-size: clamp(1.8rem, 3.2cqi, 2.35rem);
    }

    .profile-action {
      gap: 0.4rem;
      padding-inline: 0.5rem;
    }

    .profile-action-icon {
      width: 1.55rem;
      height: 1.55rem;
      border-radius: 0.5rem;
      font-size: 0.9rem;
    }
  }

  @container user-profile (max-width: 23rem) {
    .profile-cover {
      height: 7.75rem;
    }

    .profile-avatar-shell {
      width: 6.6rem;
      height: 6.6rem;
      margin-top: -3.7rem;
      border-width: 0.3rem;
    }

    .profile-identity-body,
    .profile-content-panel {
      padding-right: 1rem;
      padding-left: 1rem;
    }

    .profile-actions {
      grid-template-columns: minmax(0, 1fr);
    }

    .profile-action {
      justify-content: center;
    }

    .profile-facts-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 640px), (max-height: 620px) {
    .profile-shell {
      min-height: 100dvh;
      border: 0;
      border-radius: 0;
      box-shadow: none;
    }

    .profile-cover {
      padding-top: env(safe-area-inset-top);
    }

    .profile-identity-body {
      padding-right: max(1rem, env(safe-area-inset-right));
      padding-left: max(1rem, env(safe-area-inset-left));
    }

    .profile-content-panel {
      padding-right: max(1rem, env(safe-area-inset-right));
      padding-bottom: max(1.25rem, env(safe-area-inset-bottom));
      padding-left: max(1rem, env(safe-area-inset-left));
    }

    .profile-biography-content-collapsed {
      max-height: min(24rem, 44dvh);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .profile-role-skeleton,
    .profile-skeleton {
      animation: none;
    }

    .profile-biography-toggle {
      transition: none;
    }
  }

  @media (forced-colors: active) {
    .profile-shell,
    .profile-avatar-shell,
    .profile-presence-pill,
    :global(.profile-custom-status),
    .profile-action,
    .profile-section-label-icon,
    .profile-role-chip,
    .profile-section-icon,
    .profile-error-icon,
    .profile-fact,
    .profile-fact-icon,
    .profile-biography,
    .profile-biography-toggle,
    .profile-error-state {
      border: 1px solid CanvasText;
      box-shadow: none;
    }

    .profile-cover {
      background: Canvas;
    }

    .profile-cover::before,
    .profile-cover::after,
    .profile-cover-orbit {
      display: none;
    }
  }

  @keyframes profile-pulse {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 0.92;
    }
  }
</style>
