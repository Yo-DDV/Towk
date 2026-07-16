<script lang="ts">
  import { onDestroy } from 'svelte';
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

  let audio = $state<HTMLAudioElement>();
  let paused = $state(true);
  let currentTimeSeconds = $state(0);
  let browserDurationSeconds = $state(0);
  let playbackRate = $state(1);
  let loading = $state(false);

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

  async function togglePlayback() {
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    claimVoiceMessagePlayback(audio);
    loading = true;
    try {
      await audio.play();
    } catch {
      paused = true;
      toast.error(m['composer.voice.playback_failed']());
    } finally {
      loading = false;
    }
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

  onDestroy(() => {
    if (audio) releaseVoiceMessagePlayback(audio);
  });
</script>

<div
  class={[
    'voice-message-player flex min-w-0 items-center gap-2.5 rounded-2xl border px-2.5 py-2 shadow-sm',
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
    onplay={updateFromAudio}
    onpause={updateFromAudio}
    onended={updateFromAudio}
    onerror={onMediaError}
  >
    {filename}
  </audio>

  <button
    type="button"
    onclick={togglePlayback}
    class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow-sm transition-[transform,filter] active:scale-95 enabled:hover:brightness-110"
    aria-label={paused ? m['composer.voice.play']() : m['composer.voice.pause']()}
    title={paused ? m['composer.voice.play']() : m['composer.voice.pause']()}
    disabled={loading}
  >
    <span class={['iconify text-xl', paused ? 'uil--play' : 'uil--pause']} aria-hidden="true"
    ></span>
  </button>

  <div class="min-w-0 flex-1">
    <div
      class="relative h-10 min-w-0 overflow-hidden rounded-full bg-background/35 px-2"
      data-testid="voice-message-waveform"
    >
      <div class="pointer-events-none absolute inset-x-2 top-1/2 h-px bg-muted/25"></div>
      <div class="pointer-events-none absolute inset-x-2 inset-y-0 flex items-center gap-[2px] overflow-hidden">
        {#each normalizedPeaks as peak, index (index)}
          <span
            class={[
              'min-w-[3px] flex-1 rounded-full transition-[background-color,height,opacity]',
              (index + 1) / normalizedPeaks.length <= progress
                ? 'bg-primary opacity-100'
                : 'bg-muted/40 opacity-80'
            ]}
            style={`height: ${Math.max(4, Math.round(peak * 36))}px`}
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

    <div class="mt-0.5 flex items-center justify-between gap-2 text-[11px] leading-none text-muted">
      <span class="font-mono tabular-nums">
        {paused && currentTimeSeconds === 0
          ? formatVoiceMessageTime(durationMs)
          : `−${formatVoiceMessageTime(remainingMs)}`}
      </span>
      <button
        type="button"
        onclick={cyclePlaybackRate}
        class="min-h-7 min-w-9 cursor-pointer rounded-full px-1.5 font-semibold text-muted transition-colors hover:bg-surface-highlighted hover:text-text"
        aria-label={m['composer.voice.playback_speed']({ rate: playbackRate })}
        title={m['composer.voice.playback_speed']({ rate: playbackRate })}
      >
        {playbackRate}×
      </button>
    </div>
  </div>
</div>
