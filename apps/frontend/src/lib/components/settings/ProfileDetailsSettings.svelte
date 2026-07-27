<script lang="ts">
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { createAccountAPI } from '$lib/api-client/account';
  import { createMemberDirectoryAPI } from '$lib/api-client/memberDirectory';
  import { invalidateDetailedUserProfile } from '$lib/state/userProfiles.svelte';
  import MessageContent from '$lib/components/MessageContent.svelte';
  import { FormSection, Hint } from '$lib/ui';
  import { Button } from '$lib/ui/form';
  import {
    isProfileBiographyWithinLimit,
    MAX_PROFILE_BIOGRAPHY_BYTES,
    MAX_PROFILE_BIOGRAPHY_CHARACTERS,
    profileBiographyByteLength,
    profileBiographyCharacterLength
  } from '$lib/profileBiography';
  import * as m from '$lib/i18n/messages';

  const activeServerId = getActiveServer();
  const currentUser = serverRegistry.getStore(activeServerId).currentUser;
  const connection = useConnection();

  let biography = $state('');
  let savedBiography = $state('');
  let showLastActivity = $state(currentUser.user?.settings?.showLastActivity ?? true);
  let savedShowLastActivity = $state(currentUser.user?.settings?.showLastActivity ?? true);
  let editor = $state<HTMLTextAreaElement>();
  let loading = $state(true);
  let detailsLoaded = $state(false);
  let bioSaving = $state(false);
  let privacySaving = $state(false);
  let loadError = $state('');
  let bioError = $state('');
  let bioSuccess = $state('');
  let privacyError = $state('');
  let privacySuccess = $state('');
  let loadedUserId: string | null = null;

  const biographyCharacters = $derived(profileBiographyCharacterLength(biography));
  const biographyBytes = $derived(profileBiographyByteLength(biography));
  const biographyValid = $derived(isProfileBiographyWithinLimit(biography));
  const biographyModified = $derived(biography !== savedBiography);
  const privacyModified = $derived(showLastActivity !== savedShowLastActivity);

  function accountAPI() {
    const conn = connection();
    return createAccountAPI({
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    });
  }

  $effect(() => {
    const userId = currentUser.user?.id;
    const currentShowLastActivity = currentUser.user?.settings?.showLastActivity ?? true;

    if (!userId) {
      loadedUserId = null;
      biography = '';
      savedBiography = '';
      showLastActivity = currentShowLastActivity;
      savedShowLastActivity = currentShowLastActivity;
      detailsLoaded = false;
      loading = false;
      loadError = m['settings.profile.details.load_failed']();
      return;
    }

    if (loadedUserId === userId) return;
    loadedUserId = userId;
    let cancelled = false;
    loading = true;
    detailsLoaded = false;
    loadError = '';
    bioError = '';
    bioSuccess = '';

    const conn = connection();
    void createMemberDirectoryAPI({
      serverId: activeServerId,
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    })
      .getUserProfile(userId)
      .then((profile) => {
        if (cancelled) return;
        biography = profile?.biographyMarkdown ?? '';
        savedBiography = biography;
        showLastActivity = currentUser.user?.settings?.showLastActivity ?? true;
        savedShowLastActivity = showLastActivity;
        detailsLoaded = true;
      })
      .catch(() => {
        if (!cancelled) {
          biography = '';
          savedBiography = '';
          detailsLoaded = false;
          loadError = m['settings.profile.details.load_failed']();
        }
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  function applyMarkdown(prefix: string, suffix = prefix, placeholder = '') {
    const textarea = editor;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = biography.slice(start, end) || placeholder;
    biography = `${biography.slice(0, start)}${prefix}${selected}${suffix}${biography.slice(end)}`;
    const selectionStart = start + prefix.length;
    const selectionEnd = selectionStart + selected.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function applyLinePrefix(prefix: string, placeholder = '') {
    const textarea = editor;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = biography.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
    const lineEndIndex = biography.indexOf('\n', selectionEnd);
    const lineEnd = lineEndIndex === -1 ? biography.length : lineEndIndex;
    const selected = biography.slice(lineStart, lineEnd) || placeholder;
    const prefixed = selected
      .split('\n')
      .map((line) => `${prefix}${line}`)
      .join('\n');
    biography = `${biography.slice(0, lineStart)}${prefixed}${biography.slice(lineEnd)}`;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart + prefix.length, lineStart + prefixed.length);
    });
  }

  async function saveBiography() {
    if (!detailsLoaded || !biographyModified || !biographyValid) return;
    bioSaving = true;
    bioError = '';
    bioSuccess = '';
    try {
      await accountAPI().updateProfile({ biographyMarkdown: biography });
      savedBiography = biography;
      if (currentUser.user) invalidateDetailedUserProfile(activeServerId, currentUser.user.id);
      bioSuccess = m['settings.profile.details.biography_saved']();
    } catch (error) {
      bioError =
        error instanceof Error ? error.message : m['settings.profile.details.save_failed']();
    } finally {
      bioSaving = false;
    }
  }

  async function savePrivacy() {
    if (!privacyModified || !currentUser.user) return;
    privacySaving = true;
    privacyError = '';
    privacySuccess = '';
    try {
      const settings = await accountAPI().updateSettings({ showLastActivity });
      showLastActivity = settings.showLastActivity;
      savedShowLastActivity = settings.showLastActivity;
      if (currentUser.user) {
        currentUser.user = {
          ...currentUser.user,
          settings: {
            timezone: currentUser.user.settings?.timezone ?? null,
            timeFormat: currentUser.user.settings?.timeFormat ?? settings.timeFormat,
            readReceiptsEnabled: settings.readReceiptsEnabled,
            showLastActivity: settings.showLastActivity
          }
        };
      }
      if (currentUser.user) invalidateDetailedUserProfile(activeServerId, currentUser.user.id);
      privacySuccess = m['settings.profile.details.privacy_saved']();
    } catch (error) {
      privacyError =
        error instanceof Error ? error.message : m['settings.profile.details.save_failed']();
    } finally {
      privacySaving = false;
    }
  }
</script>

<FormSection title={m['settings.profile.details.biography_title']()} maxWidth="max-w-4xl">
  <p class="mb-4 max-w-2xl text-sm text-muted">
    {m['settings.profile.details.biography_description']()}
  </p>

  {#if loading}
    <div
      class="profile-details-loading grid gap-4 rounded-2xl border border-border/80 bg-background/70 p-4 shadow-sm backdrop-blur"
      role="status"
      aria-live="polite"
      data-testid="profile-details-loading"
    >
      <div class="flex items-center gap-3 text-sm font-medium text-muted">
        <span class="iconify animate-spin text-xl text-primary uil--spinner-alt" aria-hidden="true"
        ></span>
        {m['profile.loading']()}
      </div>
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="profile-details-skeleton h-72 rounded-xl"></div>
        <div class="profile-details-skeleton h-72 rounded-xl"></div>
      </div>
    </div>
  {:else if loadError && !detailsLoaded}
    <div
      class="flex items-start gap-3 rounded-2xl border border-danger/20 bg-danger/10 p-4 text-danger shadow-sm"
      role="alert"
      data-testid="profile-details-error"
    >
      <span class="mt-0.5 iconify text-xl uil--exclamation-octagon" aria-hidden="true"></span>
      <p class="text-sm leading-relaxed font-medium">{loadError}</p>
    </div>
  {:else}
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
      <div
        class="profile-details-card grid min-w-0 gap-3 rounded-2xl border border-text/10 bg-background/70 p-3 shadow-sm backdrop-blur-xl sm:p-4"
      >
        <div
          class="flex flex-wrap gap-1 rounded-xl border border-text/10 bg-surface-100/80 p-1.5 shadow-inner"
          role="toolbar"
          aria-label={m['settings.profile.details.formatting_toolbar']()}
        >
          <button
            type="button"
            class="btn-ghost grid min-h-11 min-w-11 place-items-center px-2 font-bold"
            aria-label={m['settings.profile.details.bold']()}
            title={m['settings.profile.details.bold']()}
            onclick={() => applyMarkdown('**')}>B</button
          >
          <button
            type="button"
            class="btn-ghost grid min-h-11 min-w-11 place-items-center px-2 italic"
            aria-label={m['settings.profile.details.italic']()}
            title={m['settings.profile.details.italic']()}
            onclick={() => applyMarkdown('_')}>I</button
          >
          <button
            type="button"
            class="btn-ghost grid min-h-11 min-w-11 place-items-center px-2"
            aria-label={m['settings.profile.details.heading']()}
            title={m['settings.profile.details.heading']()}
            onclick={() =>
              applyLinePrefix('## ', m['settings.profile.details.biography_placeholder']())}
          >
            <span class="iconify uil--text-size" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            class="btn-ghost grid min-h-11 min-w-11 place-items-center px-2"
            aria-label={m['settings.profile.details.bullet_list']()}
            title={m['settings.profile.details.bullet_list']()}
            onclick={() =>
              applyLinePrefix('- ', m['settings.profile.details.biography_placeholder']())}
          >
            <span class="iconify uil--list-ul" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            class="btn-ghost grid min-h-11 min-w-11 place-items-center px-2"
            aria-label={m['settings.profile.details.numbered_list']()}
            title={m['settings.profile.details.numbered_list']()}
            onclick={() =>
              applyLinePrefix('1. ', m['settings.profile.details.biography_placeholder']())}
          >
            <span class="iconify uil--list-ol" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            class="btn-ghost grid min-h-11 min-w-11 place-items-center px-2"
            aria-label={m['settings.profile.details.quote']()}
            title={m['settings.profile.details.quote']()}
            onclick={() =>
              applyLinePrefix('> ', m['settings.profile.details.biography_placeholder']())}
          >
            <span class="uil--quote-right iconify" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            class="btn-ghost grid min-h-11 min-w-11 place-items-center px-2"
            aria-label={m['settings.profile.details.add_link']()}
            title={m['settings.profile.details.add_link']()}
            onclick={() =>
              applyMarkdown('[', '](https://)', m['settings.profile.details.link_text']())}
          >
            <span class="iconify uil--link" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            class="btn-ghost grid min-h-11 min-w-11 place-items-center px-2"
            aria-label={m['settings.profile.details.inline_code']()}
            title={m['settings.profile.details.inline_code']()}
            onclick={() => applyMarkdown('`')}
          >
            <span class="iconify uil--brackets-curly" aria-hidden="true"></span>
          </button>
        </div>
        <textarea
          bind:this={editor}
          bind:value={biography}
          rows="13"
          class="w-full resize-y rounded-xl border border-input-border bg-input p-4 text-sm leading-relaxed shadow-inner transition-colors outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          aria-label={m['settings.profile.details.biography_label']()}
          aria-invalid={!biographyValid}
          aria-describedby="profile-biography-counter"
          placeholder={m['settings.profile.details.biography_placeholder']()}
          disabled={bioSaving}
          oninput={() => {
            bioError = '';
            bioSuccess = '';
          }}></textarea>
        <div
          id="profile-biography-counter"
          class="flex flex-wrap justify-end gap-x-2 gap-y-1 text-right text-xs text-muted"
          aria-live="polite"
          data-testid="profile-biography-counter"
        >
          <span class:text-danger={biographyCharacters > MAX_PROFILE_BIOGRAPHY_CHARACTERS}>
            {m['settings.profile.details.character_count']({
              used: biographyCharacters,
              limit: MAX_PROFILE_BIOGRAPHY_CHARACTERS
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span class:text-danger={biographyBytes > MAX_PROFILE_BIOGRAPHY_BYTES}>
            {m['settings.profile.details.byte_count']({
              used: biographyBytes,
              limit: MAX_PROFILE_BIOGRAPHY_BYTES
            })}
          </span>
        </div>
      </div>

      <section
        class="profile-details-card min-h-72 min-w-0 rounded-2xl border border-text/10 bg-background/70 p-4 shadow-sm backdrop-blur-xl"
        aria-label={m['settings.profile.details.preview']()}
      >
        <div
          class="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase"
        >
          <span class="iconify text-base text-primary uil--eye" aria-hidden="true"></span>
          {m['settings.profile.details.preview']()}
        </div>
        <div
          class="profile-biography-preview min-h-56 rounded-xl border border-text/10 bg-surface-100/70 p-4 shadow-inner"
        >
          {#if biography.trim()}
            <MessageContent body={biography} />
          {:else}
            <p class="text-sm text-muted">{m['profile.biography_empty']()}</p>
          {/if}
        </div>
      </section>
    </div>

    {#if !biographyValid}
      <Hint tone="danger">{m['settings.profile.details.biography_too_large']()}</Hint>
    {:else if bioError}
      <Hint tone="danger">{bioError}</Hint>
    {:else if bioSuccess}
      <Hint tone="success">{bioSuccess}</Hint>
    {/if}

    <div class="mt-4">
      <Button
        onclick={saveBiography}
        disabled={!detailsLoaded || !biographyModified || !biographyValid || bioSaving}
        loading={bioSaving}
      >
        {m['settings.profile.details.save_biography']()}
      </Button>
    </div>
  {/if}
</FormSection>

<FormSection title={m['settings.profile.details.privacy_title']()} maxWidth="max-w-2xl">
  <label
    class="group flex cursor-pointer items-start gap-4 rounded-2xl border border-text/10 bg-background/70 p-4 shadow-sm backdrop-blur-xl transition-colors hover:border-primary/35"
  >
    <input
      type="checkbox"
      bind:checked={showLastActivity}
      class="peer sr-only"
      disabled={loading || privacySaving || !currentUser.user}
      onchange={() => {
        privacyError = '';
        privacySuccess = '';
      }}
    />
    <span
      class="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-surface-300 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-50 after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
      aria-hidden="true"
    ></span>
    <span class="min-w-0">
      <span class="flex items-center gap-2 font-medium">
        <span class="iconify text-lg text-primary uil--clock" aria-hidden="true"></span>
        {m['settings.profile.details.show_last_activity']()}
      </span>
      <span class="mt-1 block text-sm leading-relaxed text-muted">
        {m['settings.profile.details.show_last_activity_description']()}
      </span>
    </span>
  </label>

  {#if privacyError}
    <Hint tone="danger">{privacyError}</Hint>
  {:else if privacySuccess}
    <Hint tone="success">{privacySuccess}</Hint>
  {/if}

  <div class="mt-4">
    <Button
      onclick={savePrivacy}
      disabled={!privacyModified || privacySaving || loading || !currentUser.user}
      loading={privacySaving}
    >
      {m['settings.profile.details.save_privacy']()}
    </Button>
  </div>
</FormSection>

<style>
  .profile-details-card,
  .profile-details-loading {
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 16%, transparent),
      0 16px 40px color-mix(in srgb, black 7%, transparent);
  }

  .profile-details-skeleton {
    position: relative;
    overflow: hidden;
    background: color-mix(in srgb, var(--color-surface-200) 70%, transparent);
  }

  .profile-details-skeleton::after {
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
    animation: profile-details-skeleton-shimmer 1.4s ease-in-out infinite;
  }

  :global(.profile-biography-preview) {
    overflow-wrap: anywhere;
  }

  :global(.profile-biography-preview pre) {
    max-width: 100%;
    overflow-x: auto;
  }

  :global(.profile-biography-preview a) {
    word-break: break-word;
  }

  @media (prefers-reduced-motion: reduce) {
    .profile-details-skeleton::after {
      animation: none;
    }
  }

  @keyframes profile-details-skeleton-shimmer {
    to {
      transform: translateX(100%);
    }
  }
</style>
