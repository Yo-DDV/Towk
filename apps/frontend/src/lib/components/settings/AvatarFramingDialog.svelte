<script lang="ts">
  import { browser } from '$app/environment';
  import './AvatarFramingDialog.css';
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import Dialog from '$lib/ui/Dialog.svelte';
  import { Button } from '$lib/ui/form';
  import * as m from '$lib/i18n/messages';
  import {
    AvatarFileError,
    MAX_AVATAR_ZOOM,
    avatarCropFromFrame,
    avatarScale,
    centeredAvatarFrame,
    inspectAvatarFile,
    panAvatarFrame,
    resizeAvatarFrame,
    zoomAvatarFrameAt,
    type AvatarFrameState,
    type AvatarFramingMode,
    type AvatarFramingSelection,
    type AvatarSource
  } from '$lib/avatarFraming';
  import {
    avatarFramingMessages,
    formatAvatarFramingMessage
  } from '$lib/i18n/avatarFraming';
  import { AvatarFramingPointerController } from './avatarFramingPointer';
  import {
    avatarImageTransformStyle,
    avatarPreviewImageStyle,
    decodeAvatarPreview,
    sameAvatarFrame
  } from './avatarFramingView';

  let {
    file,
    visible = $bindable(false),
    busy = false,
    onsubmit,
    oncancel,
    oncomplete
  }: {
    file: File;
    visible?: boolean;
    busy?: boolean;
    onsubmit: (selection: AvatarFramingSelection) => Promise<boolean>;
    oncancel?: () => void;
    oncomplete?: () => void;
  } = $props();

  let objectUrl = $state('');
  let source = $state<AvatarSource | null>(null);
  let loading = $state(false);
  let loadError = $state<'type' | 'size' | 'decode' | 'dimensions' | 'animation' | ''>('');
  let stageSize = $state(0);
  let frame = $state<AvatarFrameState>(centeredAvatarFrame());
  let submitting = $state(false);
  let completed = false;
  let interacting = $state(false);
  const componentId = $props.id();
  const historyMarker = `avatar-framing:${componentId}`;
  let historyArmed = false;
  let previousPageState: App.PageState = {};
  let previousStageSize = 0;

  const copy = $derived(avatarFramingMessages());
  const crop = $derived(
    source && stageSize > 0 ? avatarCropFromFrame(source, stageSize, frame) : null
  );
  const scale = $derived(source && stageSize > 0 ? avatarScale(source, stageSize, frame) : 0);
  const selection = $derived.by<AvatarFramingSelection | null>(() => {
    if (!source) return null;
    if (frame.mode === 'contain') {
      return { mode: 'contain', sourceWidth: source.width, sourceHeight: source.height };
    }
    if (stageSize <= 0 || !crop) return null;
    return { mode: 'crop', crop };
  });
  const canSubmit = $derived(!!selection && !loading && !loadError && !busy && !submitting);
  const liveSelection = $derived.by(() => {
    if (!source) return '';
    if (frame.mode === 'contain') return copy.full_image_selected;
    if (!crop) return '';
    return formatAvatarFramingMessage(copy.live_crop, { size: crop.size, x: crop.x, y: crop.y });
  });

  const pointerController = new AvatarFramingPointerController({
    source: () => source,
    stageSize: () => stageSize,
    frame: () => frame,
    setFrame: (next) => (frame = next),
    disabled: () => busy || submitting,
    setInteracting: (next) => (interacting = next)
  });

  $effect(() => {
    if (!browser || !visible) return;
    if (!historyArmed) {
      previousPageState = { ...page.state };
      pushState('', { ...page.state, avatarFramingDialog: historyMarker });
      historyArmed = true;
      return;
    }
    if (page.state.avatarFramingDialog === historyMarker) return;
    if (busy || submitting) {
      history.forward();
      return;
    }
    visible = false;
  });

  $effect(() => {
    return () => {
      if (browser && historyArmed && page.state.avatarFramingDialog === historyMarker) {
        replaceState('', previousPageState);
      }
      historyArmed = false;
    };
  });

  $effect(() => {
    if (!visible) return;

    const selectedFile = file;
    let cancelled = false;
    const decodeController = new AbortController();
    let nextUrl = '';
    objectUrl = '';
    source = null;
    frame = centeredAvatarFrame();
    loadError = '';
    loading = true;
    completed = false;

    void inspectAvatarFile(selectedFile)
      .then(async (metadata) => {
        if (cancelled) return;
        nextUrl = URL.createObjectURL(selectedFile);
        objectUrl = nextUrl;
        await decodeAvatarPreview(nextUrl, decodeController.signal);
        if (cancelled) return;
        source = metadata;
        frame = centeredAvatarFrame();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (nextUrl) {
          URL.revokeObjectURL(nextUrl);
          if (objectUrl === nextUrl) objectUrl = '';
          nextUrl = '';
        }
        loadError =
          error instanceof AvatarFileError && error.code === 'type'
            ? 'type'
            : error instanceof AvatarFileError && error.code === 'size'
              ? 'size'
              : error instanceof AvatarFileError && error.code === 'dimensions'
                ? 'dimensions'
                : error instanceof AvatarFileError && error.code === 'animation'
                  ? 'animation'
                  : 'decode';
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
      decodeController.abort();
      source = null;
      objectUrl = '';
      if (nextUrl) URL.revokeObjectURL(nextUrl);
      pointerController.clear();
    };
  });

  $effect(() => {
    if (!source || stageSize <= 0) {
      previousStageSize = stageSize;
      return;
    }

    const next = resizeAvatarFrame(source, previousStageSize, stageSize, frame);
    previousStageSize = stageSize;
    if (!sameAvatarFrame(next, frame)) frame = next;
  });

  function setMode(mode: AvatarFramingMode) {
    if (busy || submitting || frame.mode === mode) return;
    frame = centeredAvatarFrame(mode);
  }

  function resetFrame() {
    if (busy || submitting) return;
    frame = centeredAvatarFrame(frame.mode);
  }

  function setZoom(nextZoom: number, pointX = stageSize / 2, pointY = stageSize / 2) {
    if (!source || stageSize <= 0 || frame.mode === 'contain' || busy || submitting) return;
    frame = zoomAvatarFrameAt(source, stageSize, frame, nextZoom, pointX, pointY);
  }

  function attachStage(node: HTMLElement) {
    pointerController.attachStage(node);
    return () => pointerController.attachStage(null);
  }

  function handleKeyboard(event: KeyboardEvent) {
    if (!source || frame.mode === 'contain' || busy || submitting) return;
    const step = event.shiftKey ? 24 : 8;
    switch (event.key) {
      case 'ArrowLeft':
        frame = panAvatarFrame(source, stageSize, frame, -step, 0);
        break;
      case 'ArrowRight':
        frame = panAvatarFrame(source, stageSize, frame, step, 0);
        break;
      case 'ArrowUp':
        frame = panAvatarFrame(source, stageSize, frame, 0, -step);
        break;
      case 'ArrowDown':
        frame = panAvatarFrame(source, stageSize, frame, 0, step);
        break;
      case '+':
      case '=':
        setZoom(frame.zoom + 0.1);
        break;
      case '-':
      case '_':
        setZoom(frame.zoom - 0.1);
        break;
      case 'Home':
      case '0':
        resetFrame();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function imageTransformStyle(): string {
    return avatarImageTransformStyle(source, scale, frame);
  }

  function previewImageStyle(size: number): string {
    return avatarPreviewImageStyle(source, crop, frame.mode, size);
  }

  async function submit() {
    if (!canSubmit) return;
    submitting = true;
    try {
      const accepted = selection ? await onsubmit(selection) : false;
      if (accepted) {
        completed = true;
        if (browser && historyArmed && page.state.avatarFramingDialog === historyMarker) {
          history.back();
        }
        historyArmed = false;
        visible = false;
      }
    } finally {
      submitting = false;
    }
  }

  function handleClosed() {
    pointerController.clear();
    if ((busy || submitting) && !completed) {
      if (browser && historyArmed && page.state.avatarFramingDialog !== historyMarker) {
        historyArmed = false;
      }
      queueMicrotask(() => (visible = true));
      return;
    }
    if (browser && historyArmed && page.state.avatarFramingDialog === historyMarker) {
      history.back();
    }
    historyArmed = false;
    if (completed) oncomplete?.();
    else oncancel?.();
    completed = false;
  }

</script>

{#snippet preview(size: number, visibleLabel: string, label: string)}
  <div class="grid justify-items-center gap-2">
    <div
      class="avatar-preview relative overflow-hidden rounded-full border border-white/10 bg-surface-200 shadow-lg"
      style:width={`${size}px`}
      style:height={`${size}px`}
      role="img"
      aria-label={label}
    >
      {#if objectUrl && source && (frame.mode === 'contain' || crop)}
        <img
          src={objectUrl}
          alt=""
          draggable="false"
          decoding="async"
          class="motion-reduce:[image-animation:paused]"
          style={previewImageStyle(size)}
        />
      {/if}
    </div>
    <span class="max-w-20 text-center text-[0.68rem] leading-tight text-muted">{visibleLabel}</span>
  </div>
{/snippet}

<Dialog
  bind:visible
  title={copy.title}
  size="lg"
  tall
  mobileFullScreen
  describedBy="avatar-framing-description avatar-framing-keyboard-help"
  onclose={handleClosed}
>
  <div
    class="avatar-framing-shell grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"
    data-testid="avatar-framing-dialog"
    aria-busy={loading || busy || submitting || undefined}
  >
    <section class="min-w-0">
      <p id="avatar-framing-description" class="mb-3 text-sm leading-relaxed text-muted">
        {copy.description}
      </p>

      <div
        class="avatar-stage-shell mx-auto w-full max-w-[min(68vh,42rem)] rounded-[1.4rem] border border-text/10 bg-surface-200/80 p-2 shadow-[0_24px_70px_rgb(0_0_0_/_0.28)] backdrop-blur-xl sm:p-3"
      >
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (custom keyboard-operable framing canvas) -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions (custom pointer and keyboard framing canvas) -->
        <div
          bind:clientWidth={stageSize}
          data-testid="avatar-framing-stage"
          class="avatar-stage relative aspect-square w-full overflow-hidden rounded-[1.05rem] bg-surface-300 outline-none select-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          class:is-interacting={interacting}
          class:contain-mode={frame.mode === 'contain'}
          role="group"
          aria-label={copy.stage_label}
          aria-describedby="avatar-framing-gesture-help avatar-framing-keyboard-help avatar-framing-selection"
          aria-disabled={busy || submitting || !!loadError || undefined}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - Home 0"
          tabindex={source && frame.mode === 'crop' && !busy && !submitting && !loadError ? 0 : -1}
          {@attach attachStage}
          onpointerdown={pointerController.begin}
          onpointermove={pointerController.move}
          onpointerup={pointerController.finish}
          onpointercancel={pointerController.finish}
          onlostpointercapture={pointerController.lost}
          onwheel={pointerController.wheel}
          onkeydown={handleKeyboard}
          oncontextmenu={(event) => event.preventDefault()}
        >
          <div class="avatar-checker absolute inset-0" aria-hidden="true"></div>
          {#if objectUrl && source && scale > 0}
            <img
              src={objectUrl}
              alt=""
              draggable="false"
              decoding="async"
              class="pointer-events-none absolute top-1/2 left-1/2 max-w-none transform-gpu motion-reduce:[image-animation:paused]"
              style={imageTransformStyle()}
            />
          {/if}

          {#if loading}
            <div class="absolute inset-0 grid place-items-center bg-background/75" role="status">
              <span class="iconify uil--spinner-alt animate-spin text-3xl text-primary" aria-hidden="true"></span>
              <span class="sr-only">{m['common.loading']()}</span>
            </div>
          {:else if loadError}
            <div class="absolute inset-0 grid place-items-center bg-background/90 p-6 text-center" role="alert">
              <div class="grid max-w-sm justify-items-center gap-3">
                <span class="iconify uil--exclamation-triangle text-4xl text-danger" aria-hidden="true"></span>
                <p class="text-sm font-medium text-danger">
                  {loadError === 'type'
                    ? m['settings.profile.avatar.invalid_type']()
                    : loadError === 'size'
                      ? m['settings.profile.avatar.too_large']()
                      : loadError === 'dimensions'
                        ? copy.dimensions_too_large
                        : loadError === 'animation'
                          ? copy.animation_too_large
                          : copy.decode_failed}
                </p>
              </div>
            </div>
          {/if}

          <div class="avatar-mask pointer-events-none absolute inset-0 rounded-full" aria-hidden="true"></div>
          <div class="composition-grid pointer-events-none absolute inset-0 overflow-hidden rounded-full" aria-hidden="true">
            <span class="grid-line vertical first"></span>
            <span class="grid-line vertical second"></span>
            <span class="grid-line horizontal first"></span>
            <span class="grid-line horizontal second"></span>
          </div>
          <div class="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/70 ring-inset" aria-hidden="true"></div>
        </div>
      </div>

      <p id="avatar-framing-gesture-help" class="mt-3 text-center text-xs text-muted">
        {copy.gesture_hint}
      </p>
      <p id="avatar-framing-keyboard-help" class="sr-only">{copy.keyboard_hint}</p>
      <p id="avatar-framing-selection" class="sr-only" aria-live="polite">{liveSelection}</p>
    </section>

    <aside class="grid min-w-0 content-start gap-4 lg:sticky lg:top-0">
      <fieldset class="grid gap-2" disabled={busy || submitting || !!loadError || !source}>
        <legend class="sr-only">{copy.title}</legend>
        <div class="mode-switch grid grid-cols-2 gap-1 rounded-xl border border-text/10 bg-surface-100/80 p-1 shadow-inner">
          <button
            type="button"
            class="mode-button"
            data-testid="avatar-framing-mode-crop"
            class:active={frame.mode === 'crop'}
            aria-pressed={frame.mode === 'crop'}
            disabled={busy || submitting || !!loadError || !source}
            onclick={() => setMode('crop')}
          >
            <span class="iconify uil--crop-alt text-lg" aria-hidden="true"></span>
            <span>{copy.crop}</span>
          </button>
          <button
            type="button"
            class="mode-button"
            data-testid="avatar-framing-mode-contain"
            class:active={frame.mode === 'contain'}
            aria-pressed={frame.mode === 'contain'}
            disabled={busy || submitting || !!loadError || !source}
            onclick={() => setMode('contain')}
          >
            <span class="iconify uil--expand-arrows-alt text-lg" aria-hidden="true"></span>
            <span>{copy.contain}</span>
          </button>
        </div>
        <p class="min-h-8 text-xs leading-relaxed text-muted">
          {frame.mode === 'crop' ? copy.crop_description : copy.contain_description}
        </p>
      </fieldset>

      <div class="grid gap-2" class:opacity-50={frame.mode === 'contain'}>
        <div class="flex items-center justify-between gap-3">
          <label for="avatar-framing-zoom" class="text-sm font-medium">{copy.zoom}</label>
          <output data-testid="avatar-framing-zoom-output" for="avatar-framing-zoom" class="min-w-12 text-right text-xs tabular-nums text-muted">
            {Math.round(frame.zoom * 100)}%
          </output>
        </div>
        <div class="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2">
          <button
            type="button"
            class="zoom-button"
            aria-label={copy.zoom_out}
            disabled={!source || !!loadError || frame.mode === 'contain' || frame.zoom <= 1 || busy || submitting}
            onclick={() => setZoom(frame.zoom - 0.1)}
          >
            <span class="iconify uil--minus" aria-hidden="true"></span>
          </button>
          <input
            id="avatar-framing-zoom"
            data-testid="avatar-framing-zoom"
            type="range"
            min="1"
            max={MAX_AVATAR_ZOOM}
            step="0.01"
            value={frame.zoom}
            disabled={!source || !!loadError || frame.mode === 'contain' || busy || submitting}
            aria-label={copy.zoom}
            oninput={(event) => setZoom(Number((event.currentTarget as HTMLInputElement).value))}
          />
          <button
            type="button"
            class="zoom-button"
            aria-label={copy.zoom_in}
            disabled={!source || !!loadError || frame.mode === 'contain' || frame.zoom >= MAX_AVATAR_ZOOM || busy || submitting}
            onclick={() => setZoom(frame.zoom + 0.1)}
          >
            <span class="iconify uil--plus" aria-hidden="true"></span>
          </button>
        </div>
        <button
          type="button"
          class="btn-ghost min-h-11 justify-center"
          disabled={!source || !!loadError || frame.mode === 'contain' || busy || submitting}
          onclick={resetFrame}
        >
          <span class="iconify uil--redo" aria-hidden="true"></span>
          {copy.reset}
        </button>
      </div>

      <section class="grid gap-3 rounded-xl border border-text/10 bg-surface-100/70 p-3 shadow-sm" aria-labelledby="avatar-framing-preview-title">
        <h3 id="avatar-framing-preview-title" class="text-xs font-semibold tracking-wide text-muted uppercase">
          {copy.preview}
        </h3>
        <div class="flex items-end justify-around gap-3">
          {@render preview(24, copy.compact_label, copy.compact_preview)}
          {@render preview(40, copy.message_label, copy.message_preview)}
          {@render preview(72, copy.profile_label, copy.profile_preview)}
        </div>
      </section>
    </aside>
  </div>

  {#snippet footer()}
    <Button variant="secondary" disabled={busy || submitting} onclick={() => (visible = false)}>
      {m['common.cancel']()}
    </Button>
    <Button disabled={!canSubmit} loading={busy || submitting} loadingText={copy.applying} onclick={submit}>
      <span class="inline-flex items-center gap-2">
        <span class="iconify uil--check" aria-hidden="true"></span>
        {copy.apply}
      </span>
    </Button>
  {/snippet}
</Dialog>
