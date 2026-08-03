<script lang="ts">
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { createAccountAPI } from '$lib/api-client/account';
  import { PaneHeader, FormSection, Dialog, Hint } from '$lib/ui';
  import { TextInput, Button, Form } from '$lib/ui/form';
  import { toast } from '$lib/ui/toast';
  import { dropZone } from '$lib/attachments/dropZone.svelte';
  import DropZoneOverlay from '$lib/attachments/DropZoneOverlay.svelte';
  import AvatarFramingDialog from '$lib/components/settings/AvatarFramingDialog.svelte';
  import ProfileDetailsSettings from '$lib/components/settings/ProfileDetailsSettings.svelte';
  import {
    AVATAR_FRAMING_CAPABILITY,
    MAX_AVATAR_UPLOAD_BYTES,
    inspectAvatarFile,
    AvatarFileError,
    type AvatarFramingSelection
  } from '$lib/avatarFraming';
  import { avatarFramingMessages } from '$lib/i18n/avatarFraming';
  import {
    validateAndNormalizeDisplayName,
    validateAndNormalizeLogin,
    getLoginChangeCooldownRemaining,
    formatCooldownRemaining,
    validationErrorMessage
  } from '$lib/validation';
  import { getAvatarInitials } from '$lib/utils/initials';
  import * as m from '$lib/i18n/messages';
  import { localizedErrorMessage } from '$lib/i18n/localizedError';

  // Capture the active server's CurrentUserState at init. The settings
  // page is scoped to one server (it lives under `[serverId]/settings`),
  // so we don't need the registry lookup to re-resolve reactively — and
  // the captured CurrentUserState is itself a reactive class (`user` /
  // `loading` are `$state`), so subsequent profile updates flow through.
  // The connection getter resolves to the active server's API client,
  // so profile/avatar mutations land on the right backend.
  const activeServerId = getActiveServer();
  const activeStore = serverRegistry.getStore(activeServerId);
  const currentUser = activeStore.currentUser;
  const connection = useConnection();
  const avatarCapabilityLoading = $derived(activeStore.serverInfo.loading);
  const supportsAvatarFraming = $derived(
    !activeStore.serverInfo.error &&
      activeStore.serverInfo.supportsCapability(AVATAR_FRAMING_CAPABILITY)
  );

  function accountAPI() {
    const conn = connection();
    return createAccountAPI({
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    });
  }

  // Form state seeded once from the user's current profile. After init
  // these are local edit buffers; profile updates from elsewhere
  // (`currentUser.user = ...` after a mutation, cross-tab sync, etc.)
  // intentionally don't re-sync into them.
  let displayName = $state(currentUser.user?.displayName ?? '');
  let login = $state(currentUser.user?.login ?? '');
  let avatarUrl = $state<string | null>(currentUser.user?.avatarUrl ?? null);

  let isSaving = $state(false);
  let error = $state('');
  let successMessage = $state('');

  // Avatar state. A selected file remains local until framing is confirmed;
  // the current server avatar is not replaced by selection or cancellation.
  let uploadingAvatar = $state(false);
  let deletingAvatar = $state(false);
  let avatarFileInput = $state<HTMLInputElement>();
  let isDraggingAvatar = $state(false);
  let pendingAvatarFile = $state<File | null>(null);
  let showAvatarFraming = $state(false);

  // Cooldown state
  let localLastLoginChange = $state<Date | null>(null);
  const viewerLastLoginChange = $derived(
    currentUser.user?.lastLoginChange ? new Date(currentUser.user.lastLoginChange) : null
  );
  const lastLoginChange = $derived(localLastLoginChange ?? viewerLastLoginChange);

  // Confirmation dialog state
  let showLoginConfirm = $state(false);
  let pendingDisplayName = $state<string | undefined>(undefined);
  let pendingLogin = $state<string | undefined>(undefined);

  // Compute initials for avatar fallback
  const initials = $derived(
    getAvatarInitials(currentUser.user?.displayName, currentUser.user?.login)
  );

  // Track if the form has been modified
  const displayNameModified = $derived(displayName !== currentUser.user?.displayName);
  const loginModified = $derived(login !== currentUser.user?.login);
  const isModified = $derived(displayNameModified || loginModified);
  // Cooldown
  const cooldownRemaining = $derived(getLoginChangeCooldownRemaining(lastLoginChange));
  const canChangeLogin = $derived(cooldownRemaining === 0);

  function clearProfileMessages() {
    error = '';
    successMessage = '';
  }

  function avatarFileErrorMessage(error: unknown): string | null {
    if (!(error instanceof AvatarFileError)) return null;
    const copy = avatarFramingMessages();
    switch (error.code) {
      case 'type':
        return m['settings.profile.avatar.invalid_type']();
      case 'size':
        return m['settings.profile.avatar.too_large']();
      case 'dimensions':
        return copy.dimensions_too_large;
      case 'animation':
        return copy.animation_too_large;
      case 'decode':
      default:
        return copy.decode_failed;
    }
  }

  function applyUploadedAvatar(nextAvatarUrl: string | null | undefined) {
    avatarUrl = nextAvatarUrl ?? null;
    if (currentUser.user) {
      currentUser.user = {
        ...currentUser.user,
        avatarUrl: nextAvatarUrl ?? null
      };
    }
  }

  async function queueAvatarFile(file: File | undefined) {
    if (!file || uploadingAvatar || deletingAvatar || pendingAvatarFile) return;
    if (avatarCapabilityLoading) {
      toast.error(avatarFramingMessages().capability_loading);
      clearPendingAvatar();
      return;
    }
    if (file.size <= 0) {
      toast.error(m['settings.profile.avatar.invalid_type']());
      clearPendingAvatar();
      return;
    }
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      toast.error(m['settings.profile.avatar.too_large']());
      clearPendingAvatar();
      return;
    }

    if (supportsAvatarFraming) {
      pendingAvatarFile = file;
      showAvatarFraming = true;
      return;
    }

    // Mixed-version fallback: older servers do not understand framing metadata.
    // Validate authoritative bytes locally, then preserve their existing full-image upload path.
    uploadingAvatar = true;
    try {
      await inspectAvatarFile(file);
      const updated = await accountAPI().uploadAvatar(file);
      applyUploadedAvatar(updated.avatarUrl);
      toast.success(avatarFramingMessages().legacy_server_uploaded);
    } catch (uploadError) {
      toast.error(
        avatarFileErrorMessage(uploadError) ??
          localizedErrorMessage(uploadError, m['settings.profile.avatar.upload_failed']())
      );
    } finally {
      uploadingAvatar = false;
      clearPendingAvatar();
    }
  }

  async function submitAvatarFraming(selection: AvatarFramingSelection): Promise<boolean> {
    const file = pendingAvatarFile;
    if (!file || uploadingAvatar) return false;

    uploadingAvatar = true;
    try {
      const updated = await accountAPI().uploadAvatar(file, selection);
      applyUploadedAvatar(updated.avatarUrl);

      toast.success(m['settings.profile.avatar.uploaded']());
      return true;
    } catch (e) {
      toast.error(localizedErrorMessage(e, m['settings.profile.avatar.upload_failed']()));
      return false;
    } finally {
      uploadingAvatar = false;
    }
  }

  function clearPendingAvatar() {
    showAvatarFraming = false;
    pendingAvatarFile = null;
    if (avatarFileInput) avatarFileInput.value = '';
  }

  function handleAvatarUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    void queueAvatarFile(input.files?.[0]);
  }

  const avatarDropZone = dropZone({
    onDrop: (files) => void queueAvatarFile(files[0]),
    onDragStateChange: (dragging) => (isDraggingAvatar = dragging),
    acceptedTypes: ['*/*']
  });

  async function handleAvatarDelete() {
    if (!avatarUrl || uploadingAvatar || pendingAvatarFile) return;

    deletingAvatar = true;

    try {
      const updated = await accountAPI().deleteAvatar();
      applyUploadedAvatar(updated.avatarUrl);

      toast.success(m['settings.profile.avatar.removed']());
    } catch (e) {
      toast.error(localizedErrorMessage(e, m['settings.profile.avatar.delete_failed']()));
    } finally {
      deletingAvatar = false;
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();

    // Validate display name if changed
    let normalizedDisplayName: string | undefined;
    if (displayNameModified) {
      const validation = validateAndNormalizeDisplayName(displayName);
      if (!validation.valid) {
        error =
          validationErrorMessage(validation.errorCode) ??
          m['settings.profile.display_name.invalid']();
        return;
      }
      normalizedDisplayName = validation.normalized!;
    }

    // Validate login if changed
    let normalizedLogin: string | undefined;
    if (loginModified) {
      if (!canChangeLogin) {
        error = m['settings.profile.username.cooldown_error']({
          remaining: formatCooldownRemaining(cooldownRemaining)
        });
        return;
      }
      const validation = validateAndNormalizeLogin(login);
      if (!validation.valid) {
        error =
          validationErrorMessage(validation.errorCode) ?? m['settings.profile.username.invalid']();
        return;
      }
      normalizedLogin = validation.normalized!;
    }

    if (!normalizedDisplayName && !normalizedLogin) {
      return;
    }

    // If login is being changed, show confirmation dialog
    if (normalizedLogin) {
      pendingDisplayName = normalizedDisplayName;
      pendingLogin = normalizedLogin;
      showLoginConfirm = true;
      return;
    }

    // No login change — save directly
    await saveProfile(normalizedDisplayName, undefined);
  }

  async function confirmLoginChange() {
    showLoginConfirm = false;
    await saveProfile(pendingDisplayName, pendingLogin);
    pendingDisplayName = undefined;
    pendingLogin = undefined;
  }

  async function saveProfile(
    normalizedDisplayName: string | undefined,
    normalizedLogin: string | undefined
  ) {
    isSaving = true;
    error = '';
    successMessage = '';

    try {
      const updated = await accountAPI().updateProfile({
        displayName: normalizedDisplayName,
        login: normalizedLogin
      });

      // Update the current user state
      if (currentUser.user) {
        const lastLoginChange = normalizedLogin
          ? new Date().toISOString()
          : currentUser.user.lastLoginChange;
        currentUser.user = {
          ...currentUser.user,
          displayName: updated.displayName,
          login: updated.login,
          lastLoginChange
        };
      }

      // Update local state to match
      displayName = updated.displayName;
      login = updated.login;

      // Update cooldown if login was changed
      if (normalizedLogin) {
        localLastLoginChange = new Date();
      }

      successMessage = m['settings.profile.saved']();
    } catch (err) {
      error = localizedErrorMessage(err, m['settings.profile.save_failed']());
    } finally {
      isSaving = false;
    }
  }
</script>

<PaneHeader
  title={m['settings.profile.title']()}
  subtitle={m['settings.profile.subtitle']()}
  showMobileNav
/>

<div class="flex flex-col gap-6 overflow-y-auto p-6">
  <!-- Avatar Section -->
  <FormSection title={m['settings.profile.avatar.title']()} maxWidth="max-w-md">
    <div
      class="relative flex flex-col items-start gap-4 sm:flex-row sm:gap-6"
      data-testid="avatar-drop-zone"
      {@attach avatarDropZone}
    >
      <DropZoneOverlay
        visible={
          isDraggingAvatar &&
          !avatarCapabilityLoading &&
          !uploadingAvatar &&
          !deletingAvatar &&
          !pendingAvatarFile
        }
        title={m['settings.profile.avatar.drop_title']()}
        subtitle={m['settings.profile.avatar.drop_subtitle']()}
      />
      <!-- Avatar Preview -->
      <div
        class="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-200 text-4xl font-black text-muted shadow-md"
      >
        {#if avatarUrl}
          <img
            src={avatarUrl}
            alt={m['settings.profile.avatar.alt']()}
            class="h-full w-full object-cover motion-reduce:[image-animation:paused]"
          />
        {:else}
          {initials}
        {/if}
      </div>

      <!-- Upload Controls -->
      <div class="flex min-w-0 flex-col gap-3">
        <p class="text-sm text-muted">
          {m['settings.profile.avatar.description']()}
        </p>
        <div class="flex flex-wrap gap-2">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            class="hidden"
            bind:this={avatarFileInput}
            onchange={handleAvatarUpload}
          />
          <Button
            variant="secondary"
            onclick={() => avatarFileInput?.click()}
            disabled={avatarCapabilityLoading || deletingAvatar || !!pendingAvatarFile}
            loading={uploadingAvatar}
            loadingText={m['settings.profile.avatar.uploading']()}
          >
            <span class="inline-flex items-center gap-2">
              <span class="iconify uil--image-upload" aria-hidden="true"></span>
              {avatarUrl
                ? m['settings.profile.avatar.change']()
                : m['settings.profile.avatar.upload']()}
            </span>
          </Button>
          {#if avatarUrl}
            <Button
              variant="ghost"
              onclick={handleAvatarDelete}
              disabled={uploadingAvatar || !!pendingAvatarFile}
              loading={deletingAvatar}
              loadingText={m['settings.profile.avatar.removing']()}
            >
              <span class="inline-flex items-center gap-2 text-error">
                <span class="iconify uil--trash-alt" aria-hidden="true"></span>
                {m['settings.profile.avatar.remove']()}
              </span>
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </FormSection>

  <!-- Profile Form -->
  <Form onsubmit={handleSubmit} maxWidth="max-w-md" bordered {error}>
    <TextInput
      label={m['settings.profile.display_name.label']()}
      bind:value={displayName}
      placeholder={m['settings.profile.display_name.placeholder']()}
      disabled={isSaving}
      oninput={clearProfileMessages}
    />

    <TextInput
      label={m['settings.profile.username.label']()}
      bind:value={login}
      placeholder={m['settings.profile.username.placeholder']()}
      disabled={isSaving || !canChangeLogin}
      testid="settings-username"
      oninput={clearProfileMessages}
    />

    {#if !canChangeLogin}
      <p class="text-sm text-muted">
        {m['settings.profile.username.cooldown_notice']({
          remaining: formatCooldownRemaining(cooldownRemaining)
        })}
      </p>
    {/if}

    {#if successMessage}
      <Hint tone="success">{successMessage}</Hint>
    {/if}

    {#snippet footer()}
      <Button type="submit" disabled={!isModified || isSaving} loading={isSaving}>
        <span class="iconify uil--check" aria-hidden="true"></span>
        {m['settings.profile.save_button']()}
      </Button>
    {/snippet}
  </Form>

  <ProfileDetailsSettings />
</div>

{#if pendingAvatarFile}
  <AvatarFramingDialog
    file={pendingAvatarFile}
    bind:visible={showAvatarFraming}
    busy={uploadingAvatar}
    onsubmit={submitAvatarFraming}
    oncancel={clearPendingAvatar}
    oncomplete={clearPendingAvatar}
  />
{/if}

<Dialog
  bind:visible={showLoginConfirm}
  title={m['settings.profile.username.confirm_title']()}
  size="sm"
>
  <p class="mb-2">
    {m['settings.profile.username.confirm_prompt']({ login: pendingLogin ?? '' })}
  </p>
  <p class="text-muted">{m['settings.profile.username.confirm_cooldown']()}</p>

  {#snippet footer()}
    <Button variant="secondary" onclick={() => (showLoginConfirm = false)}>
      <span class="iconify uil--times" aria-hidden="true"></span>
      {m['common.cancel']()}
    </Button>
    <Button onclick={confirmLoginChange}>
      <span class="iconify uil--check" aria-hidden="true"></span>
      {m['settings.profile.username.confirm_button']()}
    </Button>
  {/snippet}
</Dialog>
