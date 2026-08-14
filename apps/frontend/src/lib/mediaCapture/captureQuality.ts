export type CaptureQuality = 'auto' | 'sd' | 'hd' | 'uhd';

export const CAPTURE_QUALITY_STORAGE_KEY = 'towk.capture.quality.v1';

export type CaptureProfile = {
  maxWidth: number;
  maxHeight: number;
  imageQuality: number;
  videoBitsPerSecond: number;
};

const PROFILES: Record<Exclude<CaptureQuality, 'auto'>, CaptureProfile> = {
  sd: { maxWidth: 854, maxHeight: 480, imageQuality: 0.68, videoBitsPerSecond: 800_000 },
  hd: { maxWidth: 1920, maxHeight: 1080, imageQuality: 0.84, videoBitsPerSecond: 3_000_000 },
  uhd: { maxWidth: 3840, maxHeight: 2160, imageQuality: 0.96, videoBitsPerSecond: 14_000_000 }
};

export function normalizeCaptureQuality(value: string | null | undefined): CaptureQuality {
  return value === 'sd' || value === 'hd' || value === 'uhd' || value === 'auto'
    ? value
    : 'auto';
}

export function resolveCaptureProfile(quality: CaptureQuality): CaptureProfile {
  return PROFILES[quality === 'auto' ? 'hd' : quality];
}

export function fitCaptureDimensions(
  width: number,
  height: number,
  profile: CaptureProfile
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, profile.maxWidth / width, profile.maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function preferredVideoMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return (
    [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ].find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
  );
}

export function videoExtension(mimeType: string): 'mp4' | 'webm' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export async function encodeCapturedPhoto(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  quality: CaptureQuality,
  filename = `towk-photo-${Date.now()}.jpg`
): Promise<File> {
  const profile = resolveCaptureProfile(quality);
  const dimensions = fitCaptureDimensions(sourceWidth, sourceHeight, profile);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('canvas-unavailable');
  context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('photo-encoding-failed'))),
      'image/jpeg',
      profile.imageQuality
    );
  });
  return new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() });
}

export async function encodeCapturedVideo(
  source: Blob,
  quality: CaptureQuality,
  filenameBase = `towk-video-${Date.now()}`
): Promise<File> {
  if (quality === 'uhd') {
    const sourceType = source.type || 'video/webm';
    return new File([source], `${filenameBase}.${videoExtension(sourceType)}`, {
      type: sourceType,
      lastModified: Date.now()
    });
  }
  if (typeof MediaRecorder === 'undefined') throw new Error('video-encoding-unavailable');
  const profile = resolveCaptureProfile(quality);
  const sourceUrl = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.src = sourceUrl;
  video.playsInline = true;
  video.muted = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('video-decoding-failed'));
  });
  const dimensions = fitCaptureDimensions(video.videoWidth, video.videoHeight, profile);
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context || typeof canvas.captureStream !== 'function') {
    URL.revokeObjectURL(sourceUrl);
    throw new Error('video-encoding-unavailable');
  }
  const outputStream = canvas.captureStream(30);
  let audioContext: AudioContext | null = null;
  try {
    audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaElementSource(video);
    const destination = audioContext.createMediaStreamDestination();
    sourceNode.connect(destination);
    destination.stream.getAudioTracks().forEach((track) => outputStream.addTrack(track));
  } catch {
    await audioContext?.close().catch(() => undefined);
    audioContext = null;
  }
  const mimeType = preferredVideoMimeType();
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(outputStream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: profile.videoBitsPerSecond
  });
  const completed = new Promise<void>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('video-encoding-failed'));
  });
  const drawFrame = () => {
    if (!video.ended && !video.paused) {
      context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
      requestAnimationFrame(drawFrame);
    }
  };
  try {
    recorder.start(500);
    await video.play();
    drawFrame();
    await new Promise<void>((resolve, reject) => {
      video.onended = () => resolve();
      video.onerror = () => reject(new Error('video-decoding-failed'));
    });
    recorder.stop();
    await completed;
    const outputType = recorder.mimeType || mimeType || 'video/webm';
    return new File([new Blob(chunks, { type: outputType })], `${filenameBase}.${videoExtension(outputType)}`, {
      type: outputType,
      lastModified: Date.now()
    });
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    outputStream.getTracks().forEach((track) => track.stop());
    await audioContext?.close().catch(() => undefined);
    URL.revokeObjectURL(sourceUrl);
  }
}
