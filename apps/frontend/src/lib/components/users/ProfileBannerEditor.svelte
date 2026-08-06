<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/ui/form';
  import { dropZone } from '$lib/attachments/dropZone.svelte';
  import DropZoneOverlay from '$lib/attachments/DropZoneOverlay.svelte';
  import { toast } from '$lib/ui/toast';
  import { localizedErrorMessage } from '$lib/i18n/localizedError';
  import { profileBannerMessage } from '$lib/i18n/profileBanner';
  import {
    PROFILE_BANNER_ACCEPT,
    type ProfileBannerAPIConfig,
    deleteProfileBanner,
    inspectProfileBannerDimensions,
    isProfileBannerBelowRecommendation,
    uploadProfileBanner,
    validateProfileBannerDimensions,
    validateProfileBannerFile
  } from '$lib/profileBanner';

  let {
    config,
    currentBannerUrl = null,
    onClose,
    onChanged
  }: {
    config: ProfileBannerAPIConfig;
    currentBannerUrl?: string | null;
    onClose: () => void;
    onChanged: (bannerUrl: string | null) => void;
  } = $props();

  let fileInput = $state<HTMLInputElement>();
  let selectedFile = $state<File | null>(null);
  let previewUrl = $state<string | null>(null);
  let dimensions = $state<{ width: number; height: number } | null>(null);
  let validationMessage = $state('');
  let isDragging = $state(false);
  let saving = $state(false);
  let removing = $state(false);
  let selectionGeneration = 0;
  let destroyed = false;

  const displayedBannerUrl = $derived(previewUrl ?? currentBannerUrl);
  const belowRecommendation = $derived(
    dimensions ? isProfileBannerBelowRecommendation(dimensions) : false
  );

  function resetPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    selectedFile = null;
    dimensions = null;
    validationMessage = '';
    if (fileInput) fileInput.value = '';
  }

  function invalidateSelection() {
    selectionGeneration += 1;
    resetPreview();
  }

  onDestroy(() => {
    destroyed = true;
    invalidateSelection();
  });

  async function selectFile(file: File | undefined) {
    if (!file || saving || removing) return;

    const generation = ++selectionGeneration;
    resetPreview();

    const validation = validateProfileBannerFile(file);
    if (validation) {
      validationMessage = profileBannerMessage(validation);
      return;
    }

    let decoded: { width: number; height: number };
    try {
      decoded = await inspectProfileBannerDimensions(file);
    } catch {
      if (!destroyed && generation === selectionGeneration) {
        validationMessage = profileBannerMessage('decode_failed');
      }
      return;
    }

    if (destroyed || generation !== selectionGeneration) return;
    const dimensionValidation = validateProfileBannerDimensions(decoded);
    if (dimensionValidation) {
      validationMessage = profileBannerMessage(dimensionValidation);
      return;
    }

    selectedFile = file;
    previewUrl = URL.createObjectURL(file);
    dimensions = decoded;
    validationMessage = '';
  }

  function handleInput(event: Event) {
    void selectFile((event.target as HTMLInputElement).files?.[0]);
  }

  function handleDropzoneKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    fileInput?.click();
  }

  const bannerDropZone = dropZone({
    onDrop: (files) => void selectFile(files[0]),
    onDragStateChange: (dragging) => (isDragging = dragging),
    acceptedTypes: ['image/jpeg', 'image/png', 'image/webp']
  });

  async function saveBanner() {
    if (!selectedFile || saving || removing) return;
    saving = true;
    validationMessage = '';
    try {
      await uploadProfileBanner(config, selectedFile);
      toast.success(profileBannerMessage('saved'));
      invalidateSelection();
      onChanged(null);
    } catch (error) {
      toast.error(localizedErrorMessage(error, profileBannerMessage('save_failed')));
    } finally {
      saving = false;
    }
  }

  async function removeBanner() {
    if (!currentBannerUrl || saving || removing) return;
    removing = true;
    validationMessage = '';
    try {
      await deleteProfileBanner(config);
      toast.success(profileBannerMessage('removed'));
      invalidateSelection();
      onChanged(null);
    } catch (error) {
      toast.error(localizedErrorMessage(error, profileBannerMessage('delete_failed')));
    } finally {
      removing = false;
    }
  }
</script>

<section class="profile-banner-editor" aria-labelledby="profile-banner-editor-title">
  <header class="profile-banner-editor-header">
    <button
      type="button"
      class="profile-banner-back btn-ghost"
      onclick={onClose}
      aria-label={profileBannerMessage('back')}
    >
      <span class="iconify uil--arrow-left" aria-hidden="true"></span>
      <span>{profileBannerMessage('back')}</span>
    </button>

    <div class="profile-banner-heading">
      <span class="profile-banner-heading-icon" aria-hidden="true">
        <span class="iconify uil--image"></span>
      </span>
      <div>
        <h2 id="profile-banner-editor-title">{profileBannerMessage('title')}</h2>
        <p>{profileBannerMessage('subtitle')}</p>
      </div>
    </div>
  </header>

  <div class="profile-banner-editor-body">
    <div class="profile-banner-preview-shell">
      {#if displayedBannerUrl}
        <img
          src={displayedBannerUrl}
          alt={profileBannerMessage('preview_alt')}
          class="profile-banner-preview"
        />
      {:else}
        <div class="profile-banner-empty">
          <span class="iconify uil--image" aria-hidden="true"></span>
          <span>{profileBannerMessage('no_banner')}</span>
        </div>
      {/if}
      <div class="profile-banner-preview-grid" aria-hidden="true"></div>
      <div class="profile-banner-avatar-preview" aria-hidden="true"></div>
    </div>

    <div
      class="profile-banner-dropzone"
      class:profile-banner-dropzone-active={isDragging}
      role="button"
      tabindex="0"
      data-testid="profile-banner-dropzone"
      aria-label={profileBannerMessage(selectedFile ? 'replace' : 'choose')}
      onclick={() => fileInput?.click()}
      onkeydown={handleDropzoneKeydown}
      {@attach bannerDropZone}
    >
      <DropZoneOverlay
        visible={isDragging}
        title={profileBannerMessage('drop_title')}
        subtitle={profileBannerMessage('drop_subtitle')}
      />
      <span class="profile-banner-dropzone-icon" aria-hidden="true">
        <span class="iconify uil--image-upload"></span>
      </span>
      <div>
        <strong>{profileBannerMessage(selectedFile ? 'replace' : 'choose')}</strong>
        <span>{profileBannerMessage('drop_subtitle')}</span>
      </div>
    </div>

    <input
      type="file"
      accept={PROFILE_BANNER_ACCEPT}
      class="hidden"
      bind:this={fileInput}
      onchange={handleInput}
    />

    <div class="profile-banner-guidance">
      <span class="iconify uil--info-circle" aria-hidden="true"></span>
      <p>{profileBannerMessage('recommendation')}</p>
    </div>

    {#if dimensions}
      <div class="profile-banner-selection" aria-live="polite">
        <p>
          {profileBannerMessage('selected', {
            width: dimensions.width,
            height: dimensions.height
          })}
        </p>
        {#if belowRecommendation}
          <p class="profile-banner-warning">
            <span class="iconify uil--exclamation-triangle" aria-hidden="true"></span>
            {profileBannerMessage('low_resolution')}
          </p>
        {/if}
      </div>
    {/if}

    {#if validationMessage}
      <p class="profile-banner-error" role="alert">{validationMessage}</p>
    {/if}
  </div>

  <footer class="profile-banner-editor-actions">
    <Button
      variant="accent"
      fullWidth
      disabled={!selectedFile || removing}
      loading={saving}
      loadingText={profileBannerMessage('saving')}
      onclick={saveBanner}
    >
      <span class="inline-flex items-center justify-center gap-2">
        <span class="iconify uil--check" aria-hidden="true"></span>
        {profileBannerMessage('save')}
      </span>
    </Button>

    {#if currentBannerUrl}
      <Button
        variant="danger"
        fullWidth
        disabled={saving}
        loading={removing}
        loadingText={profileBannerMessage('removing')}
        onclick={removeBanner}
      >
        <span class="inline-flex items-center justify-center gap-2">
          <span class="iconify uil--trash-alt" aria-hidden="true"></span>
          {profileBannerMessage('remove')}
        </span>
      </Button>
    {/if}
  </footer>
</section>

<style>
  .profile-banner-editor {
    display: grid;
    min-height: min(39rem, calc(100dvh - 3rem));
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-text) 12%, transparent);
    border-radius: 1.5rem;
    background: var(--color-background);
    color: var(--color-text);
  }

  .profile-banner-editor-header {
    display: grid;
    gap: 1rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-100);
    padding: 1.25rem;
  }

  .profile-banner-back {
    display: inline-flex;
    width: fit-content;
    min-height: 44px;
    align-items: center;
    gap: 0.55rem;
    padding: 0.45rem 0.75rem;
  }

  .profile-banner-heading {
    display: grid;
    grid-template-columns: 2.75rem minmax(0, 1fr);
    align-items: start;
    gap: 0.85rem;
  }

  .profile-banner-heading-icon,
  .profile-banner-dropzone-icon {
    display: grid;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-text) 16%, transparent);
    background: color-mix(in srgb, var(--color-surface-200) 80%, transparent);
    color: var(--color-text-top);
  }

  .profile-banner-heading-icon {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.85rem;
    font-size: 1.25rem;
  }

  .profile-banner-heading h2 {
    margin: 0;
    color: var(--color-text-top);
    font-size: 1.25rem;
    font-weight: 780;
    letter-spacing: -0.02em;
  }

  .profile-banner-heading p {
    margin: 0.35rem 0 0;
    color: var(--color-muted);
    font-size: 0.875rem;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .profile-banner-editor-body {
    min-width: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 1.25rem;
  }

  .profile-banner-preview-shell {
    position: relative;
    width: 100%;
    aspect-ratio: 3 / 1;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-text) 15%, transparent);
    border-radius: 1.1rem;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-surface-300) 86%, var(--color-background)),
      var(--color-surface-100)
    );
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 7%, transparent);
  }

  .profile-banner-preview {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .profile-banner-empty {
    display: grid;
    height: 100%;
    place-items: center;
    align-content: center;
    gap: 0.45rem;
    color: var(--color-muted);
    font-size: 0.8rem;
    font-weight: 650;
  }

  .profile-banner-empty .iconify {
    font-size: 2rem;
  }

  .profile-banner-preview-grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(color-mix(in srgb, white 20%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, white 20%, transparent) 1px, transparent 1px);
    background-size: 33.333% 33.333%;
    pointer-events: none;
  }

  .profile-banner-avatar-preview {
    position: absolute;
    bottom: -1.35rem;
    left: 1.25rem;
    width: 4rem;
    height: 4rem;
    border: 0.25rem solid var(--color-surface-100);
    border-radius: 9999px;
    background: var(--color-surface-300);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-text) 18%, transparent);
  }

  .profile-banner-dropzone {
    position: relative;
    display: grid;
    min-height: 5rem;
    grid-template-columns: 2.75rem minmax(0, 1fr);
    align-items: center;
    gap: 0.85rem;
    margin-top: 1.5rem;
    border: 1px dashed color-mix(in srgb, var(--color-text) 24%, transparent);
    border-radius: 1rem;
    background: var(--color-surface-100);
    padding: 0.9rem;
    cursor: pointer;
    transition:
      border-color 140ms ease,
      background-color 140ms ease,
      transform 140ms ease;
    touch-action: manipulation;
  }

  .profile-banner-dropzone:hover,
  .profile-banner-dropzone-active {
    border-color: var(--color-accent);
    background: var(--color-surface-200);
  }

  .profile-banner-dropzone:active {
    transform: translateY(1px);
  }

  .profile-banner-dropzone:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .profile-banner-dropzone-icon {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.8rem;
    font-size: 1.2rem;
  }

  .profile-banner-dropzone strong,
  .profile-banner-dropzone span {
    display: block;
  }

  .profile-banner-dropzone strong {
    color: var(--color-text-top);
    font-size: 0.875rem;
  }

  .profile-banner-dropzone div > span {
    margin-top: 0.2rem;
    color: var(--color-muted);
    font-size: 0.75rem;
  }

  .profile-banner-guidance,
  .profile-banner-warning {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 0.55rem;
  }

  .profile-banner-guidance {
    margin-top: 1rem;
    color: var(--color-muted);
    font-size: 0.78rem;
    line-height: 1.5;
  }

  .profile-banner-guidance p,
  .profile-banner-selection p {
    margin: 0;
  }

  .profile-banner-selection {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.9rem;
    border: 1px solid color-mix(in srgb, var(--color-text) 11%, transparent);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--color-surface-100) 82%, transparent);
    padding: 0.75rem;
    font-size: 0.78rem;
  }

  .profile-banner-warning {
    color: var(--color-warning);
    line-height: 1.45;
  }

  .profile-banner-error {
    margin: 0.9rem 0 0;
    border: 1px solid color-mix(in srgb, var(--color-danger) 36%, transparent);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--color-danger) 9%, var(--color-background));
    padding: 0.75rem;
    color: var(--color-danger);
    font-size: 0.8rem;
    font-weight: 650;
  }

  .profile-banner-editor-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
    gap: 0.75rem;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface-100);
    padding: 1rem 1.25rem;
  }

  .profile-banner-editor-actions :global(button) {
    min-height: 44px;
  }

  @media (max-width: 640px), (max-height: 620px) {
    .profile-banner-editor {
      min-height: 100vh;
      min-height: 100dvh;
      border: 0;
      border-radius: 0;
    }

    .profile-banner-editor-header {
      padding-top: max(1rem, env(safe-area-inset-top));
      padding-right: max(1rem, env(safe-area-inset-right));
      padding-left: max(1rem, env(safe-area-inset-left));
    }

    .profile-banner-editor-body {
      padding-right: max(1rem, env(safe-area-inset-right));
      padding-left: max(1rem, env(safe-area-inset-left));
    }

    .profile-banner-editor-actions {
      padding-right: max(1rem, env(safe-area-inset-right));
      padding-bottom: max(1rem, env(safe-area-inset-bottom));
      padding-left: max(1rem, env(safe-area-inset-left));
    }
  }

  @media (max-width: 390px) {
    .profile-banner-editor-actions {
      grid-template-columns: minmax(0, 1fr);
    }

    .profile-banner-heading {
      grid-template-columns: 2.5rem minmax(0, 1fr);
    }

    .profile-banner-heading-icon {
      width: 2.5rem;
      height: 2.5rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .profile-banner-dropzone {
      transition: none;
    }

    .profile-banner-dropzone:active {
      transform: none;
    }
  }

  @media (forced-colors: active) {
    .profile-banner-editor,
    .profile-banner-heading-icon,
    .profile-banner-preview-shell,
    .profile-banner-dropzone,
    .profile-banner-dropzone-icon,
    .profile-banner-selection,
    .profile-banner-error {
      border: 1px solid CanvasText;
      box-shadow: none;
    }
  }
</style>
