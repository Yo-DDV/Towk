import { describe, expect, it } from 'vitest';
import {
  applyMessageUploadProgress,
  canRetryMessageUpload,
  createMessageUploadProgressEntry,
  failMessageUploadProgress,
  transitionMessageUploadProgress,
  uploadProgressPercent
} from './messageUploadProgressModel';

function entry(now = 1_000) {
  return createMessageUploadProgressEntry({
    id: 'request-1',
    serverId: 'server-1',
    roomId: 'room-1',
    fileNames: ['clip.mp4', 'notes.pdf'],
    totalBytes: 10 * 1024 * 1024,
    now
  });
}

describe('message upload progress model', () => {
  it('starts in a room-scoped preparation state', () => {
    expect(entry()).toMatchObject({
      id: 'request-1',
      serverId: 'server-1',
      roomId: 'room-1',
      phase: 'preparing',
      fileName: 'clip.mp4',
      fileCount: 2,
      committedBytes: 0
    });
  });

  it('derives bounded aggregate progress and a stable transfer estimate', () => {
    const first = applyMessageUploadProgress(
      entry(),
      {
        phase: 'uploading',
        fileName: 'clip.mp4',
        fileIndex: 0,
        fileCount: 2,
        committedBytes: 1024 * 1024,
        totalBytes: 10 * 1024 * 1024
      },
      2_000
    );
    const second = applyMessageUploadProgress(
      first,
      {
        phase: 'uploading',
        fileName: 'clip.mp4',
        fileIndex: 0,
        fileCount: 2,
        committedBytes: 2 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024
      },
      3_000
    );

    expect(uploadProgressPercent(second)).toBe(20);
    expect(second.announcementPercent).toBe(20);
    expect(second.estimatedRemainingMs).toBe(8_000);
  });

  it('never moves the screen-reader percentage backwards', () => {
    const advanced = applyMessageUploadProgress(
      entry(),
      {
        phase: 'uploading',
        fileName: 'clip.mp4',
        fileIndex: 0,
        fileCount: 2,
        committedBytes: 6 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024
      }
    );
    const stale = applyMessageUploadProgress(
      advanced,
      {
        phase: 'uploading',
        fileName: 'clip.mp4',
        fileIndex: 0,
        fileCount: 2,
        committedBytes: 5 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024
      }
    );

    expect(stale.announcementPercent).toBe(60);
    expect(stale.committedBytes).toBe(6 * 1024 * 1024);
  });

  it('distinguishes retryable upload failures from unconfirmed messages', () => {
    const uploading = applyMessageUploadProgress(entry(), {
      phase: 'uploading',
      fileName: 'clip.mp4',
      fileIndex: 0,
      fileCount: 2,
      committedBytes: 1024,
      totalBytes: 10 * 1024 * 1024
    });
    const uploadFailure = failMessageUploadProgress(uploading);
    const sendingFailure = failMessageUploadProgress(
      transitionMessageUploadProgress(uploading, 'sending')
    );

    expect(uploadFailure.failureStage).toBe('uploading');
    expect(canRetryMessageUpload(uploadFailure)).toBe(true);
    expect(sendingFailure.failureStage).toBe('sending');
    expect(canRetryMessageUpload(sendingFailure)).toBe(false);

    const voiceFailure = failMessageUploadProgress({
      ...uploading,
      isVoiceMessage: true
    });
    expect(canRetryMessageUpload(voiceFailure)).toBe(false);
  });

  it('holds terminal confirmation against late progress callbacks', () => {
    const confirmed = transitionMessageUploadProgress(entry(), 'confirmed');
    const late = applyMessageUploadProgress(confirmed, {
      phase: 'uploading',
      fileName: 'notes.pdf',
      fileIndex: 1,
      fileCount: 2,
      committedBytes: 1,
      totalBytes: 10 * 1024 * 1024
    });

    expect(late).toBe(confirmed);
    expect(late.phase).toBe('confirmed');
  });
});
