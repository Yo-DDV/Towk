import { afterEach, describe, expect, it, vi } from 'vitest';
import { messageUploadProgress } from './messageUploadProgress.svelte';

afterEach(() => {
  messageUploadProgress.resetForTests();
  vi.useRealTimers();
});

describe('message upload progress store', () => {
  it('keeps confirmation visible briefly before removing the island', () => {
    vi.useFakeTimers();
    messageUploadProgress.begin({
      id: 'request-1',
      roomId: 'room-1',
      fileNames: ['photo.png'],
      totalBytes: 10
    });

    messageUploadProgress.markConfirmed('request-1');
    expect(messageUploadProgress.entries).toHaveLength(1);
    vi.advanceTimersByTime(899);
    expect(messageUploadProgress.entries).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(messageUploadProgress.entries).toHaveLength(0);
  });

  it('replaces a failed status when the same composer starts a new attempt', () => {
    messageUploadProgress.begin({
      id: 'request-1',
      serverId: 'server-1',
      roomId: 'room-1',
      threadRootEventId: 'thread-1',
      fileNames: ['photo.png'],
      totalBytes: 10
    });
    messageUploadProgress.fail('request-1');

    messageUploadProgress.begin({
      id: 'request-2',
      serverId: 'server-1',
      roomId: 'room-1',
      threadRootEventId: 'thread-1',
      fileNames: ['video.mp4'],
      totalBytes: 20
    });

    expect(messageUploadProgress.entries.map((entry) => entry.id)).toEqual(['request-2']);
  });
});
