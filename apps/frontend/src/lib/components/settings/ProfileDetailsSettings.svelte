<script lang="ts">
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { createAccountAPI } from '$lib/api-client/account';
  import { createMemberDirectoryAPI } from '$lib/api-client/memberDirectory';
  import MessageContent from '$lib/components/MessageContent.svelte';
  import { FormSection, Hint } from '$lib/ui';
  import { Button } from '$lib/ui/form';
  import {
    isProfileBiographyWithinLimit,
    MAX_PROFILE_BIOGRAPHY_BYTES,
    profileBiographyByteLength
  } from '$lib/profileBiography';
  import * as m from '$lib/i18n/messages';

  const currentUser = serverRegistry.getStore(getActiveServer()).currentUser;
  const connection = useConnection();

  let biography = $state('');
  let savedBiography = $state('');
  let showLastActivity = $state(currentUser.user?.settings?.showLastActivity ?? true);
  let savedShowLastActivity = $state(currentUser.user?.settings?.showLastActivity ?? true);
  let editor = $state<HTMLTextAreaElement>();
  let loading = $state(true);
  let bioSaving = $state(false);
  let privacySaving = $state(false);
  let bioError = $state('');
  let bioSuccess = $state('');
  let privacyError = $state('');
  let privacySuccess = $state('');
  let loadedUserId = $state<string | null>(null);

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
    if (!userId || loadedUserId === userId) return;
    loadedUserId = userId;
    let cancelled = false;
    loading = true;

    const conn = connection();
    void createMemberDirectoryAPI({
      serverId: getActiveServer(),
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    })
      .getUserProfile(userId)
      .then((profile) => {
        if (cancelled || !profile) return;
        biography = profile.biographyMarkdown;
        savedBiography = profile.biographyMarkdown;
        showLastActivity = currentUser.user?.settings?.showLastActivity ?? true;
        savedShowLastActivity = showLastActivity;
      })
      .catch(() => {
        if (!cancelled) bioError = m['settings.profile.details.load_failed']();
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

  async function saveBiography() {
    if (!biographyModified || !biographyValid) return;
    bioSaving = true;
    bioError = '';
    bioSuccess = '';
    try {
      await accountAPI().updateProfile({ biographyMarkdown: biography });
      savedBiography = biography;
      bioSuccess = m['settings.profile.details.biography_saved']();
    } catch (error) {
      bioError =
        error instanceof Error ? error.message : m['settings.profile.details.save_failed']();
    } finally {
      bioSaving = false;
    }
  }

  async function savePrivacy() {
    if (!privacyModified) return;
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
            showLastActivity: settings.showLastActivity
          }
        };
      }
      privacySuccess = m['settings.profile.details.privacy_saved']();
    } catch (error) {
      privacyError =
        error instanceof Error ? error.message : m['settings.profile.details.save_failed']();
    } finally {
      privacySaving = false;
    }
  }
</script>

<FormSection title={m['settings.profile.details.biography_title']()} maxWidth="max-w-2xl">
  <p class="mb-3 text-sm text-muted">{m['settings.profile.details.biography_description']()}</p>

  {#if loading}
    <p class="text-sm text-muted" role="status">{m['profile.loading']()}</p>
  {:else}
    <div class="grid gap-3 lg:grid-cols-2">
      <div class="grid gap-2">
        <div
          class="flex flex-wrap gap-1"
          aria-label={m['settings.profile.details.formatting_toolbar']()}
        >
          <button
            type="button"
            class="btn-ghost px-2 py-1 font-bold"
            onclick={() => applyMarkdown('**')}>B</button
          >
          <button
            type="button"
            class="btn-ghost px-2 py-1 italic"
            onclick={() => applyMarkdown('_')}>I</button
          >
          <button
            type="button"
            class="btn-ghost px-2 py-1"
            onclick={() =>
              applyMarkdown('[', '](https://)', m['settings.profile.details.link_text']())}
          >
            <span class="iconify uil--link" aria-hidden="true"></span>
            <span class="sr-only">{m['settings.profile.details.add_link']()}</span>
          </button>
          <button type="button" class="btn-ghost px-2 py-1" onclick={() => applyMarkdown('`')}>
            <span class="iconify uil--brackets-curly" aria-hidden="true"></span>
            <span class="sr-only">{m['settings.profile.details.inline_code']()}</span>
          </button>
        </div>
        <textarea
          bind:this={editor}
          bind:value={biography}
          rows="10"
          class="w-full resize-y rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary"
          aria-label={m['settings.profile.details.biography_label']()}
          placeholder={m['settings.profile.details.biography_placeholder']()}
          disabled={bioSaving}
          oninput={() => {
            bioError = '';
            bioSuccess = '';
          }}></textarea>
        <p class:text-danger={!biographyValid} class="text-right text-xs text-muted">
          {m['settings.profile.details.byte_count']({
            used: biographyBytes,
            limit: MAX_PROFILE_BIOGRAPHY_BYTES
          })}
        </p>
      </div>

      <div class="min-h-48 rounded-md border border-border bg-surface-100 p-4">
        <div class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
          {m['settings.profile.details.preview']()}
        </div>
        {#if biography.trim()}
          <MessageContent body={biography} />
        {:else}
          <p class="text-sm text-muted">{m['profile.biography_empty']()}</p>
        {/if}
      </div>
    </div>

    {#if !biographyValid}
      <Hint tone="danger">{m['settings.profile.details.biography_too_large']()}</Hint>
    {:else if bioError}
      <Hint tone="danger">{bioError}</Hint>
    {:else if bioSuccess}
      <Hint tone="success">{bioSuccess}</Hint>
    {/if}

    <div class="mt-3">
      <Button
        onclick={saveBiography}
        disabled={!biographyModified || !biographyValid || bioSaving}
        loading={bioSaving}
      >
        {m['settings.profile.details.save_biography']()}
      </Button>
    </div>
  {/if}
</FormSection>

<FormSection title={m['settings.profile.details.privacy_title']()} maxWidth="max-w-xl">
  <label class="flex cursor-pointer items-start gap-3 rounded-md border border-border p-4">
    <input
      type="checkbox"
      bind:checked={showLastActivity}
      class="mt-1 h-4 w-4"
      disabled={loading || privacySaving}
      onchange={() => {
        privacyError = '';
        privacySuccess = '';
      }}
    />
    <span>
      <span class="block font-medium">{m['settings.profile.details.show_last_activity']()}</span>
      <span class="mt-1 block text-sm text-muted">
        {m['settings.profile.details.show_last_activity_description']()}
      </span>
    </span>
  </label>

  {#if privacyError}
    <Hint tone="danger">{privacyError}</Hint>
  {:else if privacySuccess}
    <Hint tone="success">{privacySuccess}</Hint>
  {/if}

  <div class="mt-3">
    <Button
      onclick={savePrivacy}
      disabled={!privacyModified || privacySaving || loading}
      loading={privacySaving}
    >
      {m['settings.profile.details.save_privacy']()}
    </Button>
  </div>
</FormSection>
