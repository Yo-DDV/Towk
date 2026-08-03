import {
  AvatarFileError,
  type AvatarCrop,
  type AvatarFrameState,
  type AvatarFramingMode,
  type AvatarSource
} from '$lib/avatarFraming';

export function decodeAvatarPreview(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', abort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      image.src = '';
      finish(new DOMException('Avatar preview decode cancelled', 'AbortError'));
    };

    image.decoding = 'async';
    image.onload = () => finish();
    image.onerror = () => finish(new AvatarFileError('decode', 'browser could not decode avatar'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    image.src = url;
  });
}

export function sameAvatarFrame(left: AvatarFrameState, right: AvatarFrameState): boolean {
  return (
    left.mode === right.mode &&
    Math.abs(left.zoom - right.zoom) < 1e-6 &&
    Math.abs(left.offsetX - right.offsetX) < 1e-6 &&
    Math.abs(left.offsetY - right.offsetY) < 1e-6
  );
}

export function avatarImageTransformStyle(
  source: AvatarSource | null,
  scale: number,
  frame: AvatarFrameState
): string {
  if (!source || scale <= 0) return '';
  return [
    `width:${source.width * scale}px`,
    `height:${source.height * scale}px`,
    `transform:translate3d(calc(-50% + ${frame.offsetX}px), calc(-50% + ${frame.offsetY}px), 0)`
  ].join(';');
}

export function avatarPreviewImageStyle(
  source: AvatarSource | null,
  crop: AvatarCrop | null,
  mode: AvatarFramingMode,
  size: number
): string {
  if (!source) return '';
  if (mode === 'contain') {
    const factor = size / Math.hypot(source.width, source.height);
    const width = source.width * factor;
    const height = source.height * factor;
    return [
      'position:absolute',
      `width:${width}px`,
      `height:${height}px`,
      `left:${(size - width) / 2}px`,
      `top:${(size - height) / 2}px`,
      'max-width:none'
    ].join(';');
  }
  if (!crop) return '';
  const factor = size / crop.size;
  return [
    'position:absolute',
    `width:${source.width * factor}px`,
    `height:${source.height * factor}px`,
    `left:${-crop.x * factor}px`,
    `top:${-crop.y * factor}px`,
    'max-width:none'
  ].join(';');
}
