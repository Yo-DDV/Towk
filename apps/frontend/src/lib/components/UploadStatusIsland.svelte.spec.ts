import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import UploadStatusIsland from './UploadStatusIsland.svelte';
import {
  applyMessageUploadProgress,
  createMessageUploadProgressEntry,
  failMessageUploadProgress,
  transitionMessageUploadProgress
} from '$lib/uploads/messageUploadProgressModel';

function uploadingEntry() {
  return applyMessageUploadProgress(
    createMessageUploadProgressEntry({
      id: 'request-1',
      roomId: 'room-1',
      fileNames: ['holiday-video-with-a-long-name.mp4', 'notes.pdf'],
      totalBytes: 1_000_000,
      now: Date.now() - 2_000
    }),
    {
      phase: 'uploading',
      fileName: 'holiday-video-with-a-long-name.mp4',
      fileIndex: 0,
      fileCount: 2,
      committedBytes: 420_000,
      totalBytes: 1_000_000
    }
  );
}

describe('UploadStatusIsland', () => {
  it('renders real aggregate progress and the active file', async () => {
    const { getByRole, getByText } = render(UploadStatusIsland, {
      props: { entry: uploadingEntry() }
    });

    await expect.element(getByText('Uploading holiday-video-with-a-long-name.mp4')).toBeVisible();
    await expect.element(getByText('42%')).toBeVisible();
    await expect
      .element(getByRole('progressbar', { name: 'Message upload progress' }))
      .toHaveAttribute('value', '420000');
  });

  it('keeps server finalization explicitly indeterminate', async () => {
    const finalizing = applyMessageUploadProgress(uploadingEntry(), {
      phase: 'completed',
      fileName: 'holiday-video-with-a-long-name.mp4',
      fileIndex: 0,
      fileCount: 2,
      committedBytes: 1_000_000,
      totalBytes: 1_000_000
    });
    const { getByRole } = render(UploadStatusIsland, {
      props: { entry: finalizing }
    });

    await expect
      .element(getByRole('progressbar', { name: 'Message upload progress' }))
      .not.toHaveAttribute('value');
  });

  it('offers retry only for a failure that happened before message creation', async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const uploadFailure = failMessageUploadProgress(uploadingEntry());
    const rendered = render(UploadStatusIsland, {
      props: { entry: uploadFailure, onRetry, onDismiss }
    });

    await userEvent.click(rendered.getByRole('button', { name: 'Retry upload' }));
    await userEvent.click(rendered.getByRole('button', { name: 'Dismiss upload status' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();

    const sendingFailure = failMessageUploadProgress(
      transitionMessageUploadProgress(uploadingEntry(), 'sending')
    );
    await rendered.rerender({ entry: sendingFailure, onRetry, onDismiss });
    expect(rendered.container.querySelector('button[aria-label="Retry upload"]')).toBeNull();
    await expect.element(rendered.getByText('Message not confirmed')).toBeVisible();

    const voiceFailure = failMessageUploadProgress({
      ...uploadingEntry(),
      isVoiceMessage: true
    });
    await rendered.rerender({ entry: voiceFailure, onRetry, onDismiss });
    expect(rendered.container.querySelector('button[aria-label="Retry upload"]')).toBeNull();
  });
});
