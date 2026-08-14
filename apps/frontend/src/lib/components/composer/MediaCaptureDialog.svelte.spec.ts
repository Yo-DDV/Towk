import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MediaCaptureDialog from './MediaCaptureDialog.svelte';
import { CAPTURE_QUALITY_STORAGE_KEY } from '$lib/mediaCapture/captureQuality';

const stopTrack = vi.fn();
const stopRecording = vi.fn();
const getUserMedia = vi.fn();
const enumerateDevices = vi.fn();

class MockMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  state: RecordingState = 'inactive';
  mimeType = 'video/webm';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    stopRecording();
    this.onstop?.();
  }
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return match;
}

describe('MediaCaptureDialog', () => {
  beforeEach(() => {
    stopTrack.mockReset();
    stopRecording.mockReset();
    getUserMedia.mockReset();
    enumerateDevices.mockReset();
    localStorage.clear();
    const cameraStream = new MediaStream();
    vi.spyOn(cameraStream, 'getTracks').mockReturnValue([
      { stop: stopTrack } as unknown as MediaStreamTrack
    ]);
    vi.spyOn(cameraStream, 'getVideoTracks').mockReturnValue([
      { getSettings: () => ({ deviceId: 'rear-wide' }) } as unknown as MediaStreamTrack
    ]);
    getUserMedia.mockResolvedValue(cameraStream);
    enumerateDevices.mockResolvedValue([
      { kind: 'videoinput', deviceId: 'rear-wide', label: 'Rear wide camera' },
      { kind: 'videoinput', deviceId: 'front', label: 'Front camera' }
    ]);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices }
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn()
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['jpeg-source'], { type: 'image/jpeg' }));
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:towk-capture');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1920, height: 1080, close: vi.fn() }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('captures the richest source, then exposes and persists delivery quality in review', async () => {
    const onCaptured = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const { container } = render(MediaCaptureDialog, { props: { onCaptured, onClose } });

    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(button(container, 'Take photo')).not.toBeDisabled());
    expect(getUserMedia).toHaveBeenCalledWith({
      video: expect.objectContaining({
        facingMode: { ideal: 'environment' },
        width: { ideal: 3840 },
        height: { ideal: 2160 }
      }),
      audio: false
    });
    expect(container.textContent).not.toContain('Upload quality');

    const livePreview = container.querySelector('video');
    Object.defineProperties(livePreview!, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 }
    });
    button(container, 'Take photo').click();

    await vi.waitFor(() => expect(container.textContent).toContain('Upload quality'));
    button(container, 'SD').click();
    expect(localStorage.getItem(CAPTURE_QUALITY_STORAGE_KEY)).toBe('sd');
    button(container, 'Add to message').click();

    await vi.waitFor(() => expect(onCaptured).toHaveBeenCalledOnce());
    expect(onCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image/jpeg', name: expect.stringMatching(/\.jpg$/) })
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('uses the canonical immersive dialog with glass capture surfaces', async () => {
    const { container } = render(MediaCaptureDialog, {
      props: { onCaptured: vi.fn(), onClose: vi.fn() }
    });

    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    const shell = container.querySelector('[data-testid="media-capture-dialog"]');
    const stage = container.querySelector('[data-testid="media-capture-stage"]');

    expect(container.querySelector('dialog')).toBeTruthy();
    expect(shell).toHaveClass('media-capture-shell');
    expect(stage).toHaveClass('media-capture-stage');
    expect(container.querySelector('[data-testid="capture-mode-switcher"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="capture-shutter"]')).toBeTruthy();
  });

  it('discards an active recording before the dialog unmounts', async () => {
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);
    const onClose = vi.fn();
    const { container } = render(MediaCaptureDialog, {
      props: { onCaptured: vi.fn(), onClose }
    });

    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    button(container, 'Video').click();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(button(container, 'Start recording')).not.toBeDisabled());
    button(container, 'Start recording').click();
    await vi.waitFor(() => expect(container.textContent).toContain('Recording'));
    (container.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(stopRecording).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('stops a camera stream that resolves after the dialog has closed', async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        resolveStream = resolve;
      })
    );
    const onClose = vi.fn();
    const { container } = render(MediaCaptureDialog, {
      props: { onCaptured: vi.fn(), onClose }
    });

    (container.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    resolveStream?.({
      getTracks: () => [{ stop: stopTrack }],
      getVideoTracks: () => []
    } as unknown as MediaStream);

    await vi.waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
  });
});
