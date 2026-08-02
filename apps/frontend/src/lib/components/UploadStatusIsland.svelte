<script lang="ts">
  import { onMount } from 'svelte';
  import { getReactiveLocale } from '$lib/i18n/state.svelte';
  import { uploadProgressMessage } from '$lib/i18n/uploadProgressMessages';
  import {
    canRetryMessageUpload,
    uploadProgressPercent,
    type MessageUploadProgressEntry
  } from '$lib/uploads/messageUploadProgressModel';

  let {
    entry,
    onRetry,
    onDismiss
  }: {
    entry: MessageUploadProgressEntry;
    onRetry?: () => void;
    onDismiss?: () => void;
  } = $props();

  let now = $state(Date.now());

  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 1_000);
    return () => clearInterval(timer);
  });

  const percent = $derived(uploadProgressPercent(entry));
  const canRetry = $derived(canRetryMessageUpload(entry));
  const showProgress = $derived(entry.phase !== 'failed');
  const isIndeterminate = $derived(entry.phase === 'preparing' || entry.totalBytes <= 0);
  const title = $derived.by(() => {
    switch (entry.phase) {
      case 'preparing':
        return uploadProgressMessage('preparing', { filename: entry.fileName });
      case 'uploading':
        return uploadProgressMessage('uploading', { filename: entry.fileName });
      case 'finalizing':
        return uploadProgressMessage('finalizing');
      case 'sending':
        return uploadProgressMessage('sending');
      case 'confirming':
        return uploadProgressMessage('confirming');
      case 'confirmed':
        return uploadProgressMessage('confirmed');
      case 'failed':
        return uploadProgressMessage(
          entry.failureStage === 'sending' || entry.failureStage === 'confirming'
            ? 'message_unconfirmed'
            : 'upload_interrupted'
        );
    }
  });
  const fileDetail = $derived(
    entry.fileCount > 1
      ? uploadProgressMessage('file_position', {
          filename: entry.fileName,
          current: entry.fileIndex + 1,
          total: entry.fileCount
        })
      : entry.fileName
  );
  const transferredDetail = $derived(
    entry.totalBytes > 0
      ? uploadProgressMessage('transferred', {
          committed: formatBytes(entry.committedBytes),
          total: formatBytes(entry.totalBytes)
        })
      : ''
  );
  const elapsedDetail = $derived(
    uploadProgressMessage('elapsed', { time: formatDuration(Math.max(0, now - entry.startedAt)) })
  );
  const remainingDetail = $derived(
    entry.estimatedRemainingMs === null
      ? ''
      : uploadProgressMessage('remaining', {
          time: formatDuration(entry.estimatedRemainingMs)
        })
  );
  const announcement = $derived(
    entry.phase === 'uploading' && entry.announcementPercent !== null
      ? `${title}. ${entry.announcementPercent}%`
      : title
  );
  const iconClass = $derived.by(() => {
    switch (entry.phase) {
      case 'preparing':
        return 'uil--process';
      case 'uploading':
        return 'uil--cloud-upload';
      case 'finalizing':
        return 'uil--shield-check';
      case 'sending':
        return 'uil--message';
      case 'confirming':
        return 'uil--sync';
      case 'confirmed':
        return 'uil--check';
      case 'failed':
        return 'uil--exclamation-triangle';
    }
  });

  function formatBytes(bytes: number): string {
    const locale = getReactiveLocale();
    if (bytes < 1_000) return `${Math.max(0, Math.round(bytes))} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1_000;
    let unit = units[0];
    for (let index = 1; index < units.length && value >= 1_000; index += 1) {
      value /= 1_000;
      unit = units[index];
    }
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${unit}`;
  }

  function formatDuration(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
</script>

<section
  data-testid="upload-status-island"
  data-phase={entry.phase}
  class:upload-status-island--failed={entry.phase === 'failed'}
  class:upload-status-island--confirmed={entry.phase === 'confirmed'}
  class="upload-status-island pointer-events-auto w-full overflow-hidden rounded-2xl border border-border bg-surface-100/95 shadow-xl backdrop-blur-xl"
  aria-busy={entry.phase !== 'confirmed' && entry.phase !== 'failed'}
>
  <div class="flex min-h-18 items-center gap-3 px-3 py-2.5 sm:px-4">
    <div
      class="upload-status-icon grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-200 text-text"
      aria-hidden="true"
    >
      <span class={['iconify text-xl', iconClass]}></span>
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-baseline gap-2">
        <strong class="min-w-0 truncate text-sm font-semibold text-text">{title}</strong>
        {#if percent !== null && entry.phase !== 'preparing' && entry.phase !== 'failed'}
          <span class="shrink-0 text-xs font-semibold text-muted tabular-nums">{percent}%</span>
        {/if}
      </div>

      <div class="mt-0.5 flex min-w-0 items-center gap-x-2 text-xs text-muted">
        <span class="min-w-0 truncate">{fileDetail}</span>
        {#if transferredDetail && entry.phase !== 'preparing'}
          <span class="hidden shrink-0 sm:inline">{transferredDetail}</span>
        {/if}
      </div>

      {#if showProgress}
        {#if isIndeterminate}
          <progress
            class="upload-status-progress mt-2 block h-1.5 w-full overflow-hidden rounded-full"
            aria-label={uploadProgressMessage('progress_label')}
          ></progress>
        {:else}
          <progress
            class="upload-status-progress mt-2 block h-1.5 w-full overflow-hidden rounded-full"
            max={entry.totalBytes}
            value={entry.committedBytes}
            aria-label={uploadProgressMessage('progress_label')}
          ></progress>
        {/if}
      {/if}

      <div class="mt-1 flex min-w-0 gap-x-2 text-[0.6875rem] leading-4 text-muted/80">
        <span>{elapsedDetail}</span>
        {#if remainingDetail && entry.phase === 'uploading'}
          <span class="truncate">{remainingDetail}</span>
        {/if}
      </div>
    </div>

    {#if entry.phase === 'failed'}
      <div class="flex shrink-0 items-center gap-1">
        {#if canRetry && onRetry}
          <button
            type="button"
            class="btn btn-secondary min-h-11 min-w-11 px-3 text-xs"
            onclick={onRetry}
            aria-label={uploadProgressMessage('retry')}
            title={uploadProgressMessage('retry')}
          >
            <span class="iconify uil--redo" aria-hidden="true"></span>
            <span class="hidden sm:inline">{uploadProgressMessage('retry')}</span>
          </button>
        {/if}
        {#if onDismiss}
          <button
            type="button"
            class="btn btn-ghost h-11 w-11 p-0"
            onclick={onDismiss}
            aria-label={uploadProgressMessage('dismiss')}
            title={uploadProgressMessage('dismiss')}
          >
            <span class="iconify uil--times" aria-hidden="true"></span>
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {announcement}
  </span>
</section>

<style>
  .upload-status-island {
    --upload-status-accent: #e8783b;
    isolation: isolate;
    animation: upload-status-enter 180ms cubic-bezier(0.2, 0.85, 0.25, 1);
    box-shadow:
      0 1rem 2.5rem rgba(0, 0, 0, 0.24),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    box-shadow:
      0 1rem 2.5rem color-mix(in srgb, var(--color-background) 58%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent);
  }

  .upload-status-island--failed {
    border-color: color-mix(in srgb, var(--color-error) 52%, var(--color-border));
  }

  .upload-status-island--confirmed {
    border-color: color-mix(in srgb, var(--color-success) 52%, var(--color-border));
  }

  .upload-status-island--failed .upload-status-icon {
    color: var(--color-error);
  }

  .upload-status-island--confirmed .upload-status-icon {
    color: var(--color-success);
  }

  .upload-status-progress {
    border: 0;
    background: var(--color-surface-300);
    appearance: none;
  }

  .upload-status-progress::-webkit-progress-bar {
    border-radius: 999px;
    background: var(--color-surface-300);
  }

  .upload-status-progress::-webkit-progress-value {
    border-radius: 999px;
    background: var(--upload-status-accent);
    transition: width 180ms ease-out;
  }

  .upload-status-progress::-moz-progress-bar {
    border-radius: 999px;
    background: var(--upload-status-accent);
    transition: width 180ms ease-out;
  }

  .upload-status-progress:indeterminate {
    background: linear-gradient(
      90deg,
      var(--color-surface-300) 0 35%,
      var(--upload-status-accent) 48% 62%,
      var(--color-surface-300) 75% 100%
    );
    background-size: 220% 100%;
    animation: upload-status-indeterminate 1.2s linear infinite;
  }

  @keyframes upload-status-enter {
    from {
      opacity: 0;
      transform: translateY(0.5rem) scale(0.98);
    }
  }

  @keyframes upload-status-indeterminate {
    to {
      background-position: -220% 0;
    }
  }

  @media (max-width: 420px) {
    .upload-status-island {
      border-radius: 1rem;
    }
  }

  @media (max-width: 330px) {
    .upload-status-icon {
      display: none;
    }
  }

  @media (forced-colors: active) {
    .upload-status-island {
      border: 1px solid CanvasText;
      background: Canvas;
      box-shadow: none;
    }

    .upload-status-progress,
    .upload-status-progress::-webkit-progress-bar {
      background: Canvas;
    }

    .upload-status-progress::-webkit-progress-value,
    .upload-status-progress::-moz-progress-bar {
      background: Highlight;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .upload-status-island,
    .upload-status-progress,
    .upload-status-progress::-webkit-progress-value,
    .upload-status-progress::-moz-progress-bar {
      animation: none;
      transition: none;
    }
  }
</style>
