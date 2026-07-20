<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import { toast } from '$lib/ui/toast';
  import {
    formatVoiceMessageTime,
    reduceWaveformPeaks,
    visualWaveformLevel
  } from '$lib/voiceMessages/policy';
  import {
    claimVoiceMessagePlayback,
    releaseVoiceMessagePlayback
  } from '$lib/voiceMessages/playbackCoordinator';

  let {
    src,
    durationMs,
    waveformPeaks,
    filename,
    localPreview = false,
    onMediaError
  }: {
    src: string;
    durationMs: number;
    waveformPeaks: readonly number[];
    filename: string;
    localPreview?: boolean;
    onMediaError?: () => void;
  } = $props();

  type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'buffering' | 'offline' | 'error';

  let audio = $state<HTMLAudioElement>();
  let paused = $state(true);
  let currentTimeSeconds = $state(0);
  let browserDurationSeconds = $state(0);
  let playbackRate = $state(1);
  let status = $state<PlaybackStatus>('idle');
  let animationFrame: number | null = null;
  let prefersReducedMotion = false;

  const loading = $derived(status === 'loading');

  const metadataDurationSeconds = $derived(Math.max(0, durationMs / 1000));
  const effectiveDurationSeconds = $derived(
    Number.isFinite(browserDurationSeconds) && browserDurationSeconds > 0
      ? browserDurationSeconds
      : metadataDurationSeconds
  );
  const progress = $derived(
    effectiveDurationSeconds > 0
      ? Math.max(0, Math.min(1, currentTimeSeconds / effectiveDurationSeconds))
      : 0
  );
  const remainingMs = $derived(Math.max(0, (effectiveDurationSeconds - currentTimeSeconds) * 1000));
  const displayPeaks = $derived(
    waveformPeaks.length > 0
      ? reduceWaveformPeaks(waveformPeaks, localPreview ? 48 : 42)
      : Array.from({ length: localPreview ? 48 : 42 }, (_, index) => 0.2 + ((index * 7) % 9) / 20)
  );
  const normalizedPeaks = $derived(
    displayPeaks.map((peak) =>
      Math.max(0.06, visualWaveformLevel(Number.isFinite(peak) ? peak : 0))
    )
  );
  const playedBarCount = $derived(
    progress <= 0
      ? 0
      : Math.min(normalizedPeaks.length, Math.ceil(progress * normalizedPeaks.length))
  );

  function waveformBarFill(index: number): number {
    if (normalizedPeaks.length === 0) return 0;
    const fill = progress * normalizedPeaks.length - index;
    return Math.max(0, Math.min(1, fill));
  }

  function waveformBarState(index: number): 'played' | 'active' | 'remaining' {
    const fill = waveformBarFill(index);
    if (fill >= 0.999) return 'played';
    if (fill > 0) return 'active';
    return 'remaining';
  }

  function stopProgressLoop() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  function canAnimateProgress() {
    return Boolean(
      audio &&
      !audio.paused &&
      !audio.ended &&
      !prefersReducedMotion &&
      (typeof document === 'undefined' || document.visibilityState === 'visible')
    );
  }

  function scheduleProgressLoop() {
    if (animationFrame !== null || !canAnimateProgress()) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      updateFromAudio();
      scheduleProgressLoop();
    });
  }

  async function startPlayback(forceReload = false) {
    if (!audio) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      status = 'offline';
      return;
    }

    restoreAudioSource();
    if (forceReload) audio.load();
    claimVoiceMessagePlayback(audio);
    status = 'loading';
    try {
      await audio.play();
      updateFromAudio();
      if (audio.paused && status === 'loading') status = 'idle';
    } catch {
      paused = true;
      status = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error';
      releaseVoiceMessagePlayback(audio);
      toast.error(m['composer.voice.playback_failed']());
    }
  }

  async function togglePlayback() {
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    await startPlayback(status === 'error');
  }

  function updateFromAudio() {
    if (!audio) return;
    currentTimeSeconds = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    paused = audio.paused;
  }

  function handleMetadata() {
    if (!audio) return;
    browserDurationSeconds = Number.isFinite(audio.duration) ? audio.duration : 0;
    updateFromAudio();
  }

  function handlePlay() {
    updateFromAudio();
    status = 'playing';
    scheduleProgressLoop();
  }

  function handlePause() {
    stopProgressLoop();
    updateFromAudio();
    if (audio) releaseVoiceMessagePlayback(audio);
    if (status !== 'error' && status !== 'offline') status = 'idle';
  }

  function handleWaiting() {
    stopProgressLoop();
    status = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'buffering';
  }

  function handlePlaying() {
    updateFromAudio();
    status = 'playing';
    scheduleProgressLoop();
  }

  function handleError() {
    stopProgressLoop();
    paused = true;
    status = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error';
    if (audio) releaseVoiceMessagePlayback(audio);
    onMediaError?.();
  }

  async function retryPlayback() {
    if (!audio || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    stopProgressLoop();
    await startPlayback(true);
  }

  function restoreAudioSource() {
    if (!audio || audio.getAttribute('src') === src) return;
    audio.setAttribute('src', src);
    audio.load();
  }

  function releaseAudioSource() {
    if (!audio) return;
    stopProgressLoop();
    releaseVoiceMessagePlayback(audio);
    audio.removeAttribute('src');
    audio.load();
    currentTimeSeconds = 0;
    paused = true;
    status = 'idle';
  }

  function handleEnded() {
    releaseAudioSource();
  }

  function seek(event: Event) {
    if (!audio || !(event.currentTarget instanceof HTMLInputElement)) return;
    const next = Number(event.currentTarget.value);
    if (!Number.isFinite(next)) return;
    audio.currentTime = next;
    currentTimeSeconds = next;
  }

  function cyclePlaybackRate() {
    if (!audio) return;
    playbackRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    audio.playbackRate = playbackRate;
  }

  onMount(() => {
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = motionQuery?.matches ?? false;

    const handleMotionPreference = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;
      if (prefersReducedMotion) stopProgressLoop();
      else scheduleProgressLoop();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') stopProgressLoop();
      else scheduleProgressLoop();
    };
    const handleOffline = () => {
      if (status === 'loading' || status === 'buffering') {
        stopProgressLoop();
        status = 'offline';
      }
    };
    const handleOnline = () => {
      if (status === 'offline') status = 'error';
    };

    motionQuery?.addEventListener('change', handleMotionPreference);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      motionQuery?.removeEventListener('change', handleMotionPreference);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  });

  onDestroy(() => {
    stopProgressLoop();
    releaseAudioSource();
  });
</script>

<div
  class={[
    'voice-message-player min-w-0 rounded-2xl border px-2.5 py-2 shadow-sm',
    localPreview
      ? 'w-full border-primary/30 bg-primary/8'
      : 'w-full max-w-full border-border bg-surface-200/80'
  ]}
  data-testid={localPreview ? 'voice-message-preview' : 'voice-message-player'}
>
  <audio
    bind:this={audio}
    {src}
    preload="metadata"
    onloadedmetadata={handleMetadata}
    ondurationchange={handleMetadata}
    ontimeupdate={updateFromAudio}
    onplay={handlePlay}
    onplaying={handlePlaying}
    onpause={handlePause}
    onwaiting={handleWaiting}
    onended={handleEnded}
    onerror={handleError}
  >
    {filename}
  </audio>

  <div
    class="flex min-w-0 items-center gap-1.5 sm:gap-2.5"
    data-testid="voice-message-controls"
  >
    <button
      type="button"
      onclick={togglePlayback}
      class="flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow-sm transition-[transform,filter] active:scale-95 enabled:hover:brightness-110"
      aria-label={paused ? m['composer.voice.play']() : m['composer.voice.pause']()}
      title={paused ? m['composer.voice.play']() : m['composer.voice.pause']()}
      disabled={loading}
    >
      <span class={['iconify text-xl', paused ? 'uil--play' : 'uil--pause']} aria-hidden="true"
      ></span>
    </button>

    <div
      class="relative flex h-[44px] min-w-0 flex-1 items-center overflow-hidden rounded-full bg-background/35 px-2"
      data-testid="voice-message-waveform"
    >
      <div
        class="pointer-events-none flex min-h-0 flex-1 items-center gap-px overflow-hidden sm:gap-[2px]"
        data-waveform-layer="base"
        data-testid="voice-message-progress"
        data-played-bars={playedBarCount}
      >
        {#each normalizedPeaks as peak, index (index)}
          {@const barFill = waveformBarFill(index)}
          {@const barState = waveformBarState(index)}
          <span
            class={[
              'voice-waveform-bar relative min-w-0 flex-1 rounded-full transition-[background-color,box-shadow,filter,opacity,transform] duration-100 ease-linear motion-reduce:transition-none',
              barState === 'played' && 'voice-waveform-bar--played',
              barState === 'active' && 'voice-waveform-bar--active',
              barState === 'remaining' && 'voice-waveform-bar--remaining'
            ]}
            data-progress-state={barState}
            data-progress-fill={barFill.toFixed(3)}
            style={`height: ${Math.max(4, Math.round(peak * 26))}px`}
            aria-hidden="true"
          ></span>
        {/each}
      </div>
      <input
        type="range"
        min="0"
        max={effectiveDurationSeconds || 0}
        step="0.01"
        value={currentTimeSeconds}
        oninput={seek}
        class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label={m['composer.voice.seek']()}
      />
    </div>

    <span
      class="flex h-11 min-w-[2.25rem] shrink-0 items-center justify-end text-right font-mono text-[11px] leading-none text-muted tabular-nums"
      data-testid="voice-message-time"
    >
      {paused && currentTimeSeconds === 0
        ? formatVoiceMessageTime(durationMs)
        : `−${formatVoiceMessageTime(remainingMs)}`}
    </span>

    <button
      type="button"
      onclick={cyclePlaybackRate}
      class="h-[44px] w-[44px] shrink-0 cursor-pointer rounded-full px-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-highlighted hover:text-text"
      aria-label={m['composer.voice.playback_speed']({ rate: playbackRate })}
      title={m['composer.voice.playback_speed']({ rate: playbackRate })}
    >
      {playbackRate}×
    </button>
  </div>

  {#if status === 'loading' || status === 'buffering' || status === 'offline' || status === 'error'}
    <div
      class="mt-1 flex min-w-0 items-center justify-between gap-2 rounded-lg bg-background/45 px-2 py-1 text-[11px] leading-tight text-muted"
      data-testid="voice-message-status"
      aria-live="polite"
    >
      <span class="min-w-0">
        {status === 'loading'
          ? m['composer.voice.loading']()
          : status === 'buffering'
            ? m['composer.voice.buffering']()
            : status === 'offline'
              ? m['composer.voice.offline']()
              : m['composer.voice.playback_failed']()}
      </span>
      {#if status === 'error' || status === 'offline'}
        <button
          type="button"
          onclick={retryPlayback}
          class="min-h-[44px] shrink-0 cursor-pointer rounded-full bg-surface-highlighted px-2.5 font-semibold text-text disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={m['composer.voice.retry']()}
          disabled={status === 'offline'}
        >
          {m['composer.voice.retry_short']()}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .voice-waveform-bar {
    background-color: var(--color-muted);
    background-color: color-mix(in srgb, var(--color-muted) 34%, transparent);
  }

  .voice-waveform-bar--played,
  .voice-waveform-bar--active {
    background: var(--color-accent);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-accent) 82%, white 18%),
      color-mix(in srgb, var(--color-accent) 88%, black 12%)
    );
    box-shadow: 0 0 8px rgb(14 165 233 / 0.22);
    box-shadow: 0 0 8px color-mix(in srgb, var(--color-accent) 34%, transparent);
    opacity: 1;
  }

  .voice-waveform-bar--active {
    filter: brightness(1.18);
    transform: scaleY(1.08);
  }

  .voice-waveform-bar--remaining {
    opacity: 0.5;
  }

  :global(:root[data-theme='dark']) .voice-waveform-bar {
    background-color: var(--color-muted);
    background-color: color-mix(in srgb, var(--color-muted) 46%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .voice-waveform-bar {
      transition: none;
    }
  }
</style>
