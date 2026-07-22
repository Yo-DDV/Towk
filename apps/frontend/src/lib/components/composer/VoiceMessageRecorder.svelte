<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import { toast } from '$lib/ui/toast';
  import VoiceMessagePlayer from '$lib/components/chat/VoiceMessagePlayer.svelte';
  import {
    VOICE_MESSAGE_AUDIO_BITS_PER_SECOND,
    VOICE_MESSAGE_DEFAULT_MAX_SIZE,
    VOICE_MESSAGE_MAX_DURATION_MS,
    VOICE_MESSAGE_MIN_DURATION_MS,
    formatVoiceMessageTime,
    normalizedWaveformLevel,
    reduceWaveformPeaks,
    selectVoiceRecorderMimeType,
    visualWaveformLevel,
    voiceMessageFilename,
    type VoiceMessageDraft
  } from '$lib/voiceMessages/policy';

  type RecorderMode = 'idle' | 'requesting' | 'recording' | 'stopping' | 'review' | 'sending';
  type CompatibleAudioContextConstructor = typeof AudioContext;

  const LIVE_WAVEFORM_SAMPLE_COUNT = 42;
  const LIVE_WAVEFORM_SAMPLE_INTERVAL_MS = 100;

  let {
    disabled = false,
    maxUploadSize = VOICE_MESSAGE_DEFAULT_MAX_SIZE,
    onSend,
    onActiveChange
  }: {
    disabled?: boolean;
    maxUploadSize?: number;
    onSend: (draft: VoiceMessageDraft) => Promise<boolean>;
    onActiveChange?: (active: boolean) => void;
  } = $props();

  let mode = $state<RecorderMode>('idle');
  let elapsedMs = $state(0);
  let liveLevel = $state(0);
  let livePeaks = $state<number[]>(Array.from({ length: LIVE_WAVEFORM_SAMPLE_COUNT }, () => 0));
  let draft = $state<VoiceMessageDraft | null>(null);

  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let analyserSamples: Uint8Array<ArrayBuffer> | null = null;
  let animationFrame = 0;
  let lastWaveformSampleAt = Number.NEGATIVE_INFINITY;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;
  let recordedChunks: Blob[] = [];
  let recordedPeaks: number[] = [];
  let discardStoppedRecording = false;
  let captureGeneration = 0;
  let destroyed = false;

  const isActive = $derived(mode !== 'idle');
  const isNearLimit = $derived(elapsedMs >= VOICE_MESSAGE_MAX_DURATION_MS - 60_000);
  const visualLiveLevel = $derived(visualWaveformLevel(liveLevel));
  const visualLivePeaks = $derived(
    livePeaks.map((peak) => Math.max(0.05, visualWaveformLevel(peak)))
  );

  $effect(() => {
    onActiveChange?.(isActive);
  });

  function clearElapsedTimer() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  function stopAnalyser() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    lastWaveformSampleAt = Number.NEGATIVE_INFINITY;
    analyser = null;
    analyserSamples = null;
    if (audioContext) void audioContext.close();
    audioContext = null;
  }

  function stopStream() {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  function cleanupCapture() {
    clearElapsedTimer();
    stopAnalyser();
    stopStream();
    mediaRecorder = null;
  }

  function clearDraft() {
    if (draft) URL.revokeObjectURL(draft.objectUrl);
    draft = null;
  }

  function resetToIdle() {
    cleanupCapture();
    clearDraft();
    elapsedMs = 0;
    liveLevel = 0;
    livePeaks = Array.from({ length: LIVE_WAVEFORM_SAMPLE_COUNT }, () => 0);
    mode = 'idle';
  }

  function microphoneErrorMessage(error: unknown): string {
    const name = error instanceof DOMException ? error.name : '';
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return m['composer.voice.microphone_denied']();
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return m['composer.voice.microphone_not_found']();
      case 'NotReadableError':
      case 'TrackStartError':
        return m['composer.voice.microphone_in_use']();
      default:
        return m['composer.voice.recording_failed']();
    }
  }

  function audioContextConstructor(): CompatibleAudioContextConstructor | undefined {
    if (typeof window === 'undefined') return undefined;
    return (
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: CompatibleAudioContextConstructor })
        .webkitAudioContext
    );
  }

  function sampleWaveform(timestamp: number) {
    if (!analyser || !analyserSamples || mode !== 'recording') return;

    if (timestamp - lastWaveformSampleAt >= LIVE_WAVEFORM_SAMPLE_INTERVAL_MS) {
      analyser.getByteTimeDomainData(analyserSamples);
      const level = normalizedWaveformLevel(analyserSamples);
      liveLevel = level;
      recordedPeaks.push(level);
      livePeaks = [...livePeaks.slice(1), level];
      lastWaveformSampleAt = timestamp;
    }

    animationFrame = requestAnimationFrame(sampleWaveform);
  }

  function updateElapsed() {
    if (mode !== 'recording') return;
    elapsedMs = Math.min(VOICE_MESSAGE_MAX_DURATION_MS, performance.now() - startedAt);
    if (elapsedMs >= VOICE_MESSAGE_MAX_DURATION_MS) stopRecording();
  }

  function finalizeRecording(generation: number, mimeType: string) {
    if (destroyed || generation !== captureGeneration || discardStoppedRecording) {
      cleanupCapture();
      return;
    }

    const durationMs = Math.max(0, Math.min(VOICE_MESSAGE_MAX_DURATION_MS, elapsedMs));
    const blob = new Blob(recordedChunks, { type: mimeType });
    cleanupCapture();

    if (durationMs < VOICE_MESSAGE_MIN_DURATION_MS || blob.size === 0) {
      mode = 'idle';
      toast.warning(m['composer.voice.too_short']());
      return;
    }
    if (blob.size > maxUploadSize) {
      mode = 'idle';
      toast.error(m['composer.voice.too_large']());
      return;
    }

    const file = new File([blob], voiceMessageFilename(mimeType), { type: mimeType });
    draft = {
      file,
      durationMs: Math.round(durationMs),
      waveformPeaks: reduceWaveformPeaks(recordedPeaks),
      objectUrl: URL.createObjectURL(file)
    };
    mode = 'review';
  }

  async function startRecording() {
    if (disabled || mode !== 'idle') return;
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined' ||
      typeof MediaRecorder.isTypeSupported !== 'function'
    ) {
      toast.error(m['composer.voice.unsupported']());
      return;
    }

    const AudioContextCtor = audioContextConstructor();
    if (!AudioContextCtor) {
      toast.error(m['composer.voice.unsupported']());
      return;
    }

    const selectedMimeType = selectVoiceRecorderMimeType((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType)
    );
    if (!selectedMimeType) {
      toast.error(m['composer.voice.unsupported']());
      return;
    }

    mode = 'requesting';
    const generation = ++captureGeneration;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        }
      });
      if (destroyed || generation !== captureGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        audioBitsPerSecond: VOICE_MESSAGE_AUDIO_BITS_PER_SECOND
      });
      const outputMimeType = recorder.mimeType || selectedMimeType;

      mediaStream = stream;
      mediaRecorder = recorder;
      recordedChunks = [];
      recordedPeaks = [];
      discardStoppedRecording = false;
      elapsedMs = 0;
      liveLevel = 0;
      livePeaks = Array.from({ length: LIVE_WAVEFORM_SAMPLE_COUNT }, () => 0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      };
      recorder.onerror = () => {
        if (generation !== captureGeneration || destroyed) return;
        discardStoppedRecording = true;
        cleanupCapture();
        mode = 'idle';
        toast.error(m['composer.voice.recording_failed']());
      };
      recorder.onstop = () => finalizeRecording(generation, outputMimeType);

      audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      analyserSamples = new Uint8Array(new ArrayBuffer(analyser.fftSize));

      mode = 'recording';
      startedAt = performance.now();
      lastWaveformSampleAt = Number.NEGATIVE_INFINITY;
      recorder.start(1000);
      sampleWaveform(startedAt);
      elapsedTimer = setInterval(updateElapsed, 100);
    } catch (error) {
      if (destroyed || generation !== captureGeneration) return;
      cleanupCapture();
      mode = 'idle';
      toast.error(microphoneErrorMessage(error));
    }
  }

  function stopRecording() {
    if (mode !== 'recording' || !mediaRecorder) return;
    updateElapsed();
    mode = 'stopping';
    clearElapsedTimer();
    if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    stopAnalyser();
    stopStream();
  }

  function cancelRecording() {
    captureGeneration += 1;
    discardStoppedRecording = true;
    const recorder = mediaRecorder;
    cleanupCapture();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    clearDraft();
    elapsedMs = 0;
    mode = 'idle';
  }

  async function sendDraft() {
    if (!draft || mode !== 'review') return;
    mode = 'sending';
    const accepted = await onSend(draft);
    if (accepted) {
      resetToIdle();
    } else {
      mode = 'review';
    }
  }

  async function recordAgain() {
    clearDraft();
    mode = 'idle';
    await startRecording();
  }

  onDestroy(() => {
    destroyed = true;
    captureGeneration += 1;
    discardStoppedRecording = true;
    const recorder = mediaRecorder;
    cleanupCapture();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    clearDraft();
  });
</script>

<div class="relative h-[44px] w-[44px] shrink-0">
  {#if mode === 'idle'}
    <button
      type="button"
      onclick={startRecording}
      {disabled}
      class="flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-[color,background-color,transform] active:scale-95 enabled:hover:bg-surface-highlighted enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
      aria-label={m['composer.voice.record']()}
      title={m['composer.voice.record']()}
      data-testid="voice-message-record-button"
    >
      <span class="iconify text-xl uil--microphone" aria-hidden="true"></span>
    </button>
  {:else}
    <span
      class={[
        'flex h-[44px] w-[44px] items-center justify-center rounded-full',
        mode === 'recording' || mode === 'stopping'
          ? 'bg-red-500/12 text-red-400'
          : 'bg-primary/12 text-primary'
      ]}
      aria-hidden="true"
    >
      <span
        class={[
          'iconify text-xl',
          mode === 'sending' || mode === 'requesting' ? 'animate-spin uil--spinner-alt' : 'uil--microphone'
        ]}
      ></span>
    </span>
  {/if}

  {#if mode !== 'idle'}
    <div
      class={[
        'voice-capture-panel fixed inset-x-2 bottom-[5.25rem] z-40 min-h-16 min-w-0 items-center gap-2 rounded-[1.65rem] border border-primary/25 bg-surface-200/95 px-2.5 py-2 shadow-[0_18px_55px_rgba(0,0,0,0.28)] backdrop-blur sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-[calc(100%+0.625rem)] sm:w-[min(28rem,calc(100vw-1rem))]',
        draft ? 'grid grid-cols-[44px_minmax(0,1fr)_44px] sm:flex' : 'flex'
      ]}
      data-testid="voice-message-recorder"
      aria-live="polite"
    >
    {#if mode === 'requesting'}
      <span
        class="ml-2 iconify animate-spin text-xl text-primary uil--spinner-alt"
        aria-hidden="true"
      ></span>
      <span class="min-w-0 flex-1 truncate text-sm text-muted">
        {m['composer.voice.requesting_microphone']()}
      </span>
      <button
        type="button"
        onclick={cancelRecording}
        class="flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface-highlighted hover:text-text"
        aria-label={m['common.cancel']()}
      >
        <span class="iconify text-xl uil--times" aria-hidden="true"></span>
      </button>
    {:else if mode === 'recording' || mode === 'stopping'}
      <button
        type="button"
        onclick={cancelRecording}
        class="flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-highlighted hover:text-red-400"
        aria-label={m['composer.voice.cancel_recording']()}
        title={m['composer.voice.cancel_recording']()}
      >
        <span class="iconify text-xl uil--trash-alt" aria-hidden="true"></span>
      </button>

      <div class="min-w-0 flex-1">
        <div
          class="relative flex h-[44px] items-center gap-[2px] overflow-hidden rounded-full bg-background/35 px-3"
          data-testid="voice-message-live-waveform"
          aria-hidden="true"
        >
          <span class="absolute inset-x-3 top-1/2 h-px bg-primary/20"></span>
          {#each visualLivePeaks as peak, index (index)}
            <span
              class="relative min-w-[3px] flex-1 rounded-full bg-primary transition-[height,opacity] duration-75 motion-reduce:transition-none"
              style={`height: ${Math.max(4, Math.round(peak * 36))}px; opacity: ${0.36 + peak * 0.64}`}
            ></span>
          {/each}
        </div>
        <div class="mt-1 flex items-center justify-between gap-2 px-1 text-[11px] leading-none">
          <span class={['font-mono tabular-nums', isNearLimit ? 'text-amber-400' : 'text-muted']}>
            {formatVoiceMessageTime(elapsedMs)}
          </span>
          <span class="flex items-center gap-1 text-muted">
            <span
              class="h-1.5 w-1.5 rounded-full bg-red-500 motion-safe:animate-pulse"
              style={`transform: scale(${1 + visualLiveLevel * 0.85})`}
              aria-hidden="true"
            ></span>
            {isNearLimit
              ? m['composer.voice.limit_remaining']({
                  time: formatVoiceMessageTime(VOICE_MESSAGE_MAX_DURATION_MS - elapsedMs)
                })
              : m['composer.voice.recording']()}
          </span>
        </div>
      </div>

      <button
        type="button"
        onclick={stopRecording}
        disabled={mode === 'stopping'}
        class="flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-red-500 text-white shadow-sm transition-transform active:scale-95 disabled:cursor-wait disabled:opacity-60"
        aria-label={m['composer.voice.stop']()}
        title={m['composer.voice.stop']()}
      >
        <span class="h-3.5 w-3.5 rounded-[4px] bg-white" aria-hidden="true"></span>
      </button>
    {:else if draft}
      <button
        type="button"
        onclick={cancelRecording}
        disabled={mode === 'sending'}
        class="col-start-1 row-start-2 flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-highlighted hover:text-red-400 disabled:opacity-50 sm:col-auto sm:row-auto"
        aria-label={m['composer.voice.delete_draft']()}
        title={m['composer.voice.delete_draft']()}
      >
        <span class="iconify text-xl uil--trash-alt" aria-hidden="true"></span>
      </button>

      <div
        class="col-span-3 row-start-1 min-w-0 sm:col-auto sm:row-auto sm:flex-1"
        data-testid="voice-message-preview-slot"
      >
        <VoiceMessagePlayer
          src={draft.objectUrl}
          durationMs={draft.durationMs}
          waveformPeaks={draft.waveformPeaks}
          filename={draft.file.name}
          localPreview
        />
      </div>

      <button
        type="button"
        onclick={recordAgain}
        disabled={mode === 'sending'}
        class="hidden h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-highlighted hover:text-text disabled:opacity-50 sm:flex"
        aria-label={m['composer.voice.record_again']()}
        title={m['composer.voice.record_again']()}
      >
        <span class="iconify text-xl uil--redo" aria-hidden="true"></span>
      </button>

      <button
        type="button"
        onclick={sendDraft}
        disabled={mode === 'sending'}
        class="col-start-3 row-start-2 flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow-sm transition-[transform,filter] active:scale-95 enabled:hover:brightness-110 disabled:cursor-wait disabled:opacity-60 sm:col-auto sm:row-auto"
        aria-label={m['composer.voice.send']()}
        title={m['composer.voice.send']()}
      >
        <span
          class={[
            'iconify text-xl',
            mode === 'sending' ? 'animate-spin uil--spinner-alt' : 'uil--telegram-alt'
          ]}
        aria-hidden="true"
      ></span>
      </button>
    {/if}
    </div>
  {/if}
</div>
