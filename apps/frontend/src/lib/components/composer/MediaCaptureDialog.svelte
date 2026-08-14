<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import {
    CAPTURE_QUALITY_STORAGE_KEY,
    encodeCapturedPhoto,
    encodeCapturedVideo,
    normalizeCaptureQuality,
    preferredVideoMimeType,
    resolveCaptureProfile,
    type CaptureQuality
  } from '$lib/mediaCapture/captureQuality';

  type CaptureMode = 'photo' | 'video';
  type Props = { onCaptured: (file: File) => void | Promise<void>; onClose: () => void };
  let { onCaptured, onClose }: Props = $props();

  let videoElement = $state<HTMLVideoElement>();
  let stream = $state<MediaStream | null>(null);
  let cameras = $state<MediaDeviceInfo[]>([]);
  let cameraId = $state('');
  let mode = $state<CaptureMode>('photo');
  let quality = $state<CaptureQuality>('auto');
  let capturedBlob = $state<Blob | null>(null);
  let capturedKind = $state<CaptureMode | null>(null);
  let previewUrl = $state('');
  let recorder = $state<MediaRecorder | null>(null);
  let recording = $state(false);
  let busy = $state(false);
  let error = $state('');

  const qualityOptions: CaptureQuality[] = ['auto', 'sd', 'hd', 'uhd'];

  function qualityLabel(value: CaptureQuality): string {
    if (value === 'sd') return m['capture.quality_sd']();
    if (value === 'hd') return m['capture.quality_hd']();
    if (value === 'uhd') return m['capture.quality_uhd']();
    return m['capture.quality_auto']();
  }

  function stopStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function clearCapture() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    capturedBlob = null;
    capturedKind = null;
  }

  async function refreshCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameras = devices.filter((device) => device.kind === 'videoinput');
    if (!cameraId && cameras[0]) cameraId = cameras[0].deviceId;
  }

  function cameraLabel(camera: MediaDeviceInfo, index: number): string {
    if (camera.label) return camera.label;
    if (index === 0) return m['capture.back_camera']();
    if (index === 1) return m['capture.front_camera']();
    return m['capture.camera_number']({ number: String(index + 1) });
  }

  async function startCamera() {
    error = '';
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      error = m['capture.unavailable']();
      return;
    }
    busy = true;
    try {
      const profile = resolveCaptureProfile('uhd');
      const next = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: 'environment' } }),
          width: { ideal: profile.maxWidth },
          height: { ideal: profile.maxHeight }
        },
        audio: mode === 'video'
      });
      if (!videoElement) throw new Error('video-preview-unavailable');
      stream = next;
      videoElement.srcObject = next;
      await videoElement.play();
      await refreshCameras();
      const activeId = next.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeId) cameraId = activeId;
    } catch (reason) {
      const name = reason instanceof DOMException ? reason.name : '';
      error =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? m['capture.permission_denied']()
          : m['capture.unavailable']();
    } finally {
      busy = false;
    }
  }

  async function changeMode(next: CaptureMode) {
    if (recording || next === mode) return;
    mode = next;
    clearCapture();
    await startCamera();
  }

  async function changeCamera(event: Event) {
    cameraId = (event.currentTarget as HTMLSelectElement).value;
    clearCapture();
    await startCamera();
  }

  function setQuality(next: CaptureQuality) {
    quality = next;
    localStorage.setItem(CAPTURE_QUALITY_STORAGE_KEY, next);
  }

  async function takePhoto() {
    const preview = videoElement;
    if (!preview?.videoWidth || !preview.videoHeight) return;
    busy = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = preview.videoWidth;
      canvas.height = preview.videoHeight;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('canvas-unavailable');
      context.drawImage(preview, 0, 0);
      capturedBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('photo-capture-failed'))),
          'image/jpeg',
          0.98
        )
      );
      capturedKind = 'photo';
      previewUrl = URL.createObjectURL(capturedBlob);
      stopStream();
    } catch {
      error = m['capture.failed']();
    } finally {
      busy = false;
    }
  }

  function startRecording() {
    if (!stream || typeof MediaRecorder === 'undefined') {
      error = m['capture.unavailable']();
      return;
    }
    const mimeType = preferredVideoMimeType();
    const chunks: Blob[] = [];
    try {
      const profile = resolveCaptureProfile('uhd');
      const nextRecorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: profile.videoBitsPerSecond
      });
      nextRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      nextRecorder.onstop = () => {
        const type = nextRecorder.mimeType || mimeType || 'video/webm';
        capturedBlob = new Blob(chunks, { type });
        capturedKind = 'video';
        previewUrl = URL.createObjectURL(capturedBlob);
        recording = false;
        stopStream();
      };
      nextRecorder.onerror = () => {
        error = m['capture.failed']();
        recording = false;
      };
      recorder = nextRecorder;
      nextRecorder.start(500);
      recording = true;
    } catch {
      error = m['capture.failed']();
    }
  }

  function stopRecording() {
    if (recorder?.state === 'recording') recorder.stop();
  }

  async function useCapture() {
    if (!capturedBlob || !capturedKind) return;
    busy = true;
    try {
      let file: File;
      if (capturedKind === 'photo') {
        if (quality === 'uhd') {
          file = new File([capturedBlob], `towk-photo-${Date.now()}.jpg`, {
            type: capturedBlob.type || 'image/jpeg',
            lastModified: Date.now()
          });
        } else {
          const bitmap = await createImageBitmap(capturedBlob);
          try {
            file = await encodeCapturedPhoto(bitmap, bitmap.width, bitmap.height, quality);
          } finally {
            bitmap.close();
          }
        }
      } else {
        file = await encodeCapturedVideo(capturedBlob, quality);
      }
      await onCaptured(file);
      closeDialog();
    } catch {
      error = m['capture.failed']();
      busy = false;
    }
  }

  async function retake() {
    clearCapture();
    await startCamera();
  }

  function closeDialog() {
    if (recording) recorder?.stop();
    stopStream();
    clearCapture();
    onClose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeDialog();
  }

  onMount(() => {
    quality = normalizeCaptureQuality(localStorage.getItem(CAPTURE_QUALITY_STORAGE_KEY));
    void startCamera();
    return () => {
      stopStream();
      clearCapture();
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center sm:p-4">
  <div
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="capture-dialog-title"
    class="flex max-h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-2xl sm:max-h-[min(92dvh,860px)] sm:max-w-3xl sm:rounded-2xl"
  >
    <header class="flex min-h-14 items-center gap-3 border-b border-surface-300 px-4">
      <h2 id="capture-dialog-title" class="min-w-0 flex-1 truncate text-base font-semibold">
        {m['capture.title']()}
      </h2>
      <button type="button" onclick={closeDialog} class="btn btn-ghost btn-circle" aria-label={m['capture.close']()}>
        <span class="iconify text-xl uil--times"></span>
      </button>
    </header>

    <div class="relative min-h-0 flex-1 bg-black">
      {#if capturedKind === 'photo'}
        <img src={previewUrl} alt={m['capture.title']()} class="h-full max-h-[62dvh] min-h-72 w-full object-contain" />
      {:else if capturedKind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={previewUrl} controls playsinline class="h-full max-h-[62dvh] min-h-72 w-full object-contain"></video>
      {:else}
        <video bind:this={videoElement} autoplay muted playsinline class="h-full max-h-[62dvh] min-h-72 w-full object-contain"></video>
      {/if}
      {#if recording}
        <div class="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-sm text-white">
          <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500"></span>
          {m['capture.recording']()}
        </div>
      {/if}
      {#if busy}
        <div class="absolute inset-0 grid place-items-center bg-black/35"><span class="loading loading-spinner loading-lg text-white"></span></div>
      {/if}
    </div>

    <div class="flex flex-col gap-3 border-t border-surface-300 p-3 sm:p-4">
      {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
      {#if !capturedKind}
        <div class="grid grid-cols-2 gap-2 sm:flex">
          <div class="join w-full sm:w-auto">
            <button type="button" class="btn join-item flex-1" class:btn-primary={mode === 'photo'} onclick={() => changeMode('photo')}>{m['capture.photo']()}</button>
            <button type="button" class="btn join-item flex-1" class:btn-primary={mode === 'video'} onclick={() => changeMode('video')}>{m['capture.video']()}</button>
          </div>
          {#if cameras.length > 1}
            <label class="sr-only" for="capture-camera">{m['capture.camera']()}</label>
            <select id="capture-camera" class="select select-bordered min-w-0" value={cameraId} onchange={changeCamera}>
              {#each cameras as camera, index (camera.deviceId)}
                <option value={camera.deviceId}>{cameraLabel(camera, index)}</option>
              {/each}
            </select>
          {/if}
        </div>
      {/if}

      {#if capturedKind}
        <div class="rounded-2xl border border-surface-300 bg-surface-100/80 p-3 shadow-sm">
          <div class="mb-2 flex items-center justify-between gap-3">
            <span class="text-sm font-semibold">{m['capture.quality']()}</span>
            {#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
          </div>
          <div class="flex flex-wrap items-center gap-2">
            {#each qualityOptions as option (option)}
              <button type="button" class="btn btn-sm flex-1 sm:flex-none" class:btn-primary={quality === option} disabled={busy} onclick={() => setQuality(option)}>{qualityLabel(option)}</button>
            {/each}
          </div>
          {#if quality === 'auto'}<p class="mt-2 text-xs text-muted">{m['capture.quality_auto_hint']()}</p>{/if}
        </div>
      {/if}

      <div class="flex items-center justify-end gap-2">
        {#if capturedKind}
          <button type="button" class="btn btn-ghost" disabled={busy} onclick={retake}>{m['capture.retake']()}</button>
          <button type="button" class="btn btn-primary" disabled={busy} onclick={useCapture}>{m['capture.use']()}</button>
        {:else if mode === 'photo'}
          <button type="button" class="btn btn-primary" disabled={busy || !stream} onclick={takePhoto}>{m['capture.take_photo']()}</button>
        {:else if recording}
          <button type="button" class="btn btn-error" onclick={stopRecording}>{m['capture.stop_video']()}</button>
        {:else}
          <button type="button" class="btn btn-primary" disabled={busy || !stream} onclick={startRecording}>{m['capture.start_video']()}</button>
        {/if}
      </div>
    </div>
  </div>
</div>
