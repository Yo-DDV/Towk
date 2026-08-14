import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import MediaCaptureDialog from './MediaCaptureDialog.svelte';
import { CAPTURE_QUALITY_STORAGE_KEY } from '$lib/mediaCapture/captureQuality';

const stopTrack = vi.fn();
const getUserMedia = vi.fn();
const enumerateDevices = vi.fn();

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
    getUserMedia.mockReset();
    enumerateDevices.mockReset();
    localStorage.clear();
    getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
      getVideoTracks: () => [{ getSettings: () => ({ deviceId: 'rear-wide' }) }]
    });
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
    await userEvent.click(button(container, 'Take photo'));

    await vi.waitFor(() => expect(container.textContent).toContain('Upload quality'));
    await userEvent.click(button(container, 'SD'));
    expect(localStorage.getItem(CAPTURE_QUALITY_STORAGE_KEY)).toBe('sd');
    await userEvent.click(button(container, 'Add to message'));

    await vi.waitFor(() => expect(onCaptured).toHaveBeenCalledOnce());
    expect(onCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image/jpeg', name: expect.stringMatching(/\.jpg$/) })
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalled();
  });
});
