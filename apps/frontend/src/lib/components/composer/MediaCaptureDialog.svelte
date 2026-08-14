<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import Dialog from '$lib/ui/Dialog.svelte';
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
  let visible = $state(true);
  let cameraRequestRevision = 0;
  let disposed = false;

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
    const requestRevision = ++cameraRequestRevision;
    error = '';
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      error = m['capture.unavailable']();
      return;
    }
    busy = true;
    let requestedStream: MediaStream | null = null;
    try {
      const profile = resolveCaptureProfile('uhd');
      requestedStream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(cameraId
            ? { deviceId: { exact: cameraId } }
            : { facingMode: { ideal: 'environment' } }),
          width: { ideal: profile.maxWidth },
          height: { ideal: profile.maxHeight }
        },
        audio: mode === 'video'
      });
      if (disposed || requestRevision !== cameraRequestRevision) {
        requestedStream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (!videoElement) throw new Error('video-preview-unavailable');
      videoElement.srcObject = requestedStream;
      await videoElement.play();
      if (disposed || requestRevision !== cameraRequestRevision) {
        requestedStream.getTracks().forEach((track) => track.stop());
        videoElement.srcObject = null;
        return;
      }
      stream = requestedStream;
      await refreshCameras();
      const activeId = requestedStream.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeId) cameraId = activeId;
    } catch (reason) {
      requestedStream?.getTracks().forEach((track) => track.stop());
      if (disposed || requestRevision !== cameraRequestRevision) return;
      const name = reason instanceof DOMException ? reason.name : '';
      error =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? m['capture.permission_denied']()
          : m['capture.unavailable']();
    } finally {
      if (!disposed && requestRevision === cameraRequestRevision) busy = false;
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
          1
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

  function discardRecording() {
    const activeRecorder = recorder;
    recorder = null;
    recording = false;
    if (!activeRecorder) return;
    activeRecorder.ondataavailable = null;
    activeRecorder.onstop = null;
    activeRecorder.onerror = null;
    if (activeRecorder.state === 'recording') activeRecorder.stop();
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
      visible = false;
    } catch {
      error = m['capture.failed']();
      busy = false;
    }
  }

  async function retake() {
    clearCapture();
    await startCamera();
  }

  function handleClosed() {
    disposed = true;
    cameraRequestRevision += 1;
    discardRecording();
    stopStream();
    clearCapture();
    onClose();
  }

  onMount(() => {
    quality = normalizeCaptureQuality(localStorage.getItem(CAPTURE_QUALITY_STORAGE_KEY));
    void startCamera();
    return () => {
      disposed = true;
      cameraRequestRevision += 1;
      discardRecording();
      stopStream();
      clearCapture();
    };
  });
</script>

<Dialog
  bind:visible
  title={m['capture.title']()}
  size="lg"
  tall
  mobileFullScreen
  swipeToClose
  onclose={handleClosed}
>
  <div
    data-testid="media-capture-dialog"
    class="media-capture-shell flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl p-2 sm:p-3"
  >
    <div
      data-testid="media-capture-stage"
      class="media-capture-stage relative min-h-72 flex-1 overflow-hidden rounded-[1.15rem] bg-black"
    >
      {#if capturedKind === 'photo'}
        <img
          src={previewUrl}
          alt={m['capture.title']()}
          class="h-full max-h-[62dvh] min-h-72 w-full object-contain"
        />
      {:else if capturedKind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src={previewUrl}
          controls
          playsinline
          class="h-full max-h-[62dvh] min-h-72 w-full object-contain"
        ></video>
      {:else}
        <video
          bind:this={videoElement}
          autoplay
          muted
          playsinline
          class="h-full max-h-[62dvh] min-h-72 w-full object-contain"
        ></video>
      {/if}
      {#if recording}
        <div
          class="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-sm text-white"
        >
          <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500"></span>
          {m['capture.recording']()}
        </div>
      {/if}
      {#if busy}
        <div class="absolute inset-0 grid place-items-center bg-black/35">
          <span class="loading loading-spinner loading-lg text-white"></span>
        </div>
      {/if}
    </div>

    <div class="capture-controls mt-2 flex flex-col gap-3 rounded-xl p-3 sm:p-4">
      {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
      {#if !capturedKind}
        <div class="grid grid-cols-2 gap-2 sm:flex">
          <div
            data-testid="capture-mode-switcher"
            class="capture-segmented flex w-full gap-1 rounded-xl p-1 sm:w-auto"
          >
            <button
              type="button"
              class="btn flex-1 border-0 sm:min-w-28"
              class:btn-primary={mode === 'photo'}
              onclick={() => changeMode('photo')}>{m['capture.photo']()}</button
            >
            <button
              type="button"
              class="btn flex-1 border-0 sm:min-w-28"
              class:btn-primary={mode === 'video'}
              onclick={() => changeMode('video')}>{m['capture.video']()}</button
            >
          </div>
          {#if cameras.length > 1}
            <label class="sr-only" for="capture-camera">{m['capture.camera']()}</label>
            <select
              id="capture-camera"
              class="select select-bordered min-w-0"
              value={cameraId}
              onchange={changeCamera}
            >
              {#each cameras as camera, index (camera.deviceId)}
                <option value={camera.deviceId}>{cameraLabel(camera, index)}</option>
              {/each}
            </select>
          {/if}
        </div>
      {/if}

      {#if capturedKind}
        <div class="capture-quality rounded-2xl p-3">
          <div class="mb-2 flex items-center justify-between gap-3">
            <span class="text-sm font-semibold">{m['capture.quality']()}</span>
            {#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
          </div>
          <div class="flex flex-wrap items-center gap-2">
            {#each qualityOptions as option (option)}
              <button
                type="button"
                class="btn flex-1 btn-sm sm:flex-none"
                class:btn-primary={quality === option}
                disabled={busy}
                onclick={() => setQuality(option)}>{qualityLabel(option)}</button
              >
            {/each}
          </div>
          {#if quality === 'auto'}<p class="mt-2 text-xs text-muted">
              {m['capture.quality_auto_hint']()}
            </p>{/if}
        </div>
      {/if}

      <div class="flex items-center justify-end gap-2">
        {#if capturedKind}
          <button type="button" class="btn-ghost btn" disabled={busy} onclick={retake}
            >{m['capture.retake']()}</button
          >
          <button type="button" class="btn-primary btn" disabled={busy} onclick={useCapture}
            >{m['capture.use']()}</button
          >
        {:else if mode === 'photo'}
          <button
            data-testid="capture-shutter"
            type="button"
            class="capture-shutter btn-primary btn"
            disabled={busy || !stream}
            onclick={takePhoto}>{m['capture.take_photo']()}</button
          >
        {:else if recording}
          <button
            data-testid="capture-shutter"
            type="button"
            class="capture-shutter btn-error btn"
            onclick={stopRecording}>{m['capture.stop_video']()}</button
          >
        {:else}
          <button
            data-testid="capture-shutter"
            type="button"
            class="capture-shutter btn-primary btn"
            disabled={busy || !stream}
            onclick={startRecording}>{m['capture.start_video']()}</button
          >
        {/if}
      </div>
    </div>
  </div>
</Dialog>

<style>
  .media-capture-shell {
    box-sizing: border-box;
    min-height: min(42rem, calc(100dvh - 8rem));
    background-color: color-mix(in srgb, var(--color-surface) 88%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-text) 12%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 22%, transparent),
      inset 1px 0 0 color-mix(in srgb, white 8%, transparent),
      0 24px 70px rgb(0 0 0 / 28%);
    backdrop-filter: blur(16px) saturate(100%);
  }

  .media-capture-stage {
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 10%),
      inset 0 14px 34px rgb(0 0 0 / 24%),
      0 8px 24px rgb(0 0 0 / 20%);
  }

  .capture-controls,
  .capture-segmented,
  .capture-quality {
    background-color: color-mix(in srgb, var(--color-surface-100) 82%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 16%, transparent),
      inset 0 -1px 0 rgb(0 0 0 / 8%);
  }

  .capture-shutter {
    min-height: 3rem;
    min-width: min(100%, 9.5rem);
    border-radius: 999px;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 32%),
      0 0 0 4px color-mix(in srgb, currentColor 12%, transparent),
      0 8px 18px rgb(0 0 0 / 18%);
  }

  @media (prefers-reduced-transparency: reduce) {
    .media-capture-shell,
    .capture-controls,
    .capture-segmented,
    .capture-quality {
      background-color: var(--color-surface);
      backdrop-filter: none;
    }
  }

  @media (max-width: 640px), (max-height: 620px) {
    .media-capture-shell {
      min-height: calc(100dvh - 9rem);
    }
  }

  @media (forced-colors: active) {
    .media-capture-shell,
    .media-capture-stage,
    .capture-controls,
    .capture-segmented,
    .capture-quality,
    .capture-shutter {
      border: 1px solid CanvasText;
      box-shadow: none;
    }
  }
</style>
