import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentsState, type AttachmentLimits } from './attachments.svelte';
import { getToasts, toast } from '$lib/ui/toast';
import { MAX_MESSAGE_ATTACHMENTS } from '$lib/api-client/messages';

const prepareFilesMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/attachments/prepareFiles', () => ({
  prepareFiles: prepareFilesMock
}));

function imageFile(name = 'image.png', bytes = 3): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

function videoFile(name = 'clip.mp4', bytes = 3): File {
  return new File([new Uint8Array(bytes)], name, { type: 'video/mp4' });
}

function documentFile(name = 'document.pdf', bytes = 3): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
}

describe('AttachmentsState', () => {
  let limits: AttachmentLimits;
  let state: AttachmentsState;

  beforeEach(() => {
    limits = {
      maxUploadSize: 25 * 1024 * 1024,
      maxVideoUploadSize: 25 * 1024 * 1024
    };
    state = new AttachmentsState(() => limits);
    toast.clear();
    prepareFilesMock.mockReset();
    prepareFilesMock.mockImplementation(async (files: File[]) => files);
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn((file: File) => `blob:${file.name}`),
      configurable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true
    });
  });

  it('accepts non-media files', async () => {
    const file = documentFile();

    await state.stageFiles([file]);

    expect(state.selectedFiles).toEqual([file]);
  });

  it('stages prepared files and appends subsequent files', async () => {
    const first = imageFile('first.png');
    const second = imageFile('second.png');

    await state.stageFiles([first]);
    await state.stageFiles([second]);

    expect(state.filesWithUrls.map(({ file }) => file.name)).toEqual(['first.png', 'second.png']);
    expect(state.filesWithUrls.map(({ url }) => url)).toEqual([
      'blob:first.png',
      'blob:second.png'
    ]);
  });

  it('accepts video files using the runtime-provided video limit', async () => {
    const file = videoFile();

    await state.stageFiles([file]);

    expect(state.selectedFiles).toEqual([file]);
  });

  it('rejects files over the matching upload size limit', async () => {
    limits.maxUploadSize = 1;

    await state.stageFiles([imageFile('too-large.png', 2)]);

    expect(
      getToasts()
        .map((t) => t.message)
        .join('\n')
    ).toContain('too-large.png is too large');
    expect(state.filesWithUrls).toEqual([]);
    expect(prepareFilesMock).not.toHaveBeenCalled();
  });

  it('uses the video-specific upload limit for videos', async () => {
    limits.maxUploadSize = 10;
    limits.maxVideoUploadSize = 1;

    await state.stageFiles([videoFile('too-large.mp4', 2)]);

    expect(
      getToasts()
        .map((t) => t.message)
        .join('\n')
    ).toContain('too-large.mp4 is too large');
    expect(state.filesWithUrls).toEqual([]);
    expect(prepareFilesMock).not.toHaveBeenCalled();
  });

  it('uses the video-specific upload limit for mobile videos with generic MIME types', async () => {
    limits.maxUploadSize = 1;
    limits.maxVideoUploadSize = 10;
    const mov = new File([new Uint8Array(2)], 'IMG_0420.MOV', { type: '' });
    const mp4 = new File([new Uint8Array(2)], 'clip.mp4', { type: 'application/octet-stream' });

    await state.stageFiles([mov, mp4]);

    expect(state.selectedFiles.map((file) => [file.name, file.type, file.size])).toEqual([
      ['IMG_0420.MOV', 'video/quicktime', 2],
      ['clip.mp4', 'video/mp4', 2]
    ]);
    expect(prepareFilesMock).toHaveBeenCalledWith([mov, mp4]);
  });

  it('keeps generic non-video files on the standard upload limit', async () => {
    limits.maxUploadSize = 1;
    limits.maxVideoUploadSize = 10;

    await state.stageFiles([
      new File([new Uint8Array(2)], 'report.pdf', { type: 'application/octet-stream' })
    ]);

    expect(
      getToasts()
        .map((t) => t.message)
        .join('\n')
    ).toContain('report.pdf is too large');
    expect(state.filesWithUrls).toEqual([]);
    expect(prepareFilesMock).not.toHaveBeenCalled();
  });

  it('rejects executable files before preparing them', async () => {
    await state.stageFiles([
      new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], 'renamed.txt', {
        type: 'text/plain'
      }),
      new File(['installer'], 'setup.exe', { type: 'application/octet-stream' })
    ]);

    expect(
      getToasts()
        .map((t) => t.message)
        .join('\n')
    ).toContain('Executable files are not allowed');
    expect(state.filesWithUrls).toEqual([]);
    expect(prepareFilesMock).not.toHaveBeenCalled();
  });

  it('keeps archives eligible for staging', async () => {
    const archive = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'bundle.zip', {
      type: 'application/zip'
    });

    await state.stageFiles([archive]);

    expect(state.selectedFiles).toEqual([archive]);
  });

  it('caps staged files at the message attachment limit', async () => {
    const files = Array.from({ length: MAX_MESSAGE_ATTACHMENTS + 1 }, (_, index) =>
      documentFile(`document-${index}.pdf`)
    );

    await state.stageFiles(files);

    expect(state.selectedFiles).toHaveLength(MAX_MESSAGE_ATTACHMENTS);
    expect(
      getToasts()
        .map((t) => t.message)
        .join('\n')
    ).toContain(`up to ${MAX_MESSAGE_ATTACHMENTS} files`);
  });

  it('reserves attachment slots across concurrent staging calls', async () => {
    let finishPreparation: ((files: File[]) => void) | undefined;
    prepareFilesMock.mockImplementationOnce(
      (files: File[]) =>
        new Promise<File[]>((resolve) => {
          finishPreparation = () => resolve(files);
        })
    );

    const firstStage = state.stageFiles(
      Array.from({ length: MAX_MESSAGE_ATTACHMENTS }, (_, index) =>
        documentFile(`document-${index}.pdf`)
      )
    );
    await vi.waitFor(() => expect(prepareFilesMock).toHaveBeenCalledTimes(1));

    await state.stageFiles([documentFile('overflow.pdf')]);

    expect(prepareFilesMock).toHaveBeenCalledTimes(1);
    expect(getToasts().map((t) => t.message).join('\n')).toContain(
      `up to ${MAX_MESSAGE_ATTACHMENTS} files`
    );

    finishPreparation?.([]);
    await firstStage;
  });

  it('does not restore a prepared file after its draft generation is invalidated', async () => {
    let finishPreparation: ((files: File[]) => void) | undefined;
    prepareFilesMock.mockImplementationOnce(
      (files: File[]) =>
        new Promise<File[]>((resolve) => {
          finishPreparation = () => resolve(files);
        })
    );

    const staging = state.stageFiles([documentFile('previous-room.pdf')]);
    await vi.waitFor(() => expect(prepareFilesMock).toHaveBeenCalledTimes(1));

    state.invalidatePending();
    state.restore([]);
    finishPreparation?.([]);
    await staging;

    expect(state.filesWithUrls).toEqual([]);
  });

  it('clears staged object URLs', async () => {
    await state.stageFiles([imageFile('clear.png')]);

    state.clear();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:clear.png');
    expect(state.filesWithUrls).toEqual([]);
  });
});
