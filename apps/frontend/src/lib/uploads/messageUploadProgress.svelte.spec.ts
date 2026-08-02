import { afterEach, describe, expect, it, vi } from 'vitest';
import { messageUploadProgress } from './messageUploadProgress.svelte';

afterEach(() => {
  messageUploadProgress.resetForTests();
  vi.useRealTimers();
});

describe('message upload progress store', () => {
  it('records the accepted event identity before visible confirmation', () => {
    messageUploadProgress.begin({
      id: 'request-1',
      roomId: 'room-1',
      fileNames: ['photo.png'],
      totalBytes: 10
    });

    messageUploadProgress.markConfirming('request-1', 'event-1');

    expect(messageUploadProgress.entries[0]).toMatchObject({
      phase: 'confirming',
      eventId: 'event-1'
    });
  });

  it('keeps visible confirmation briefly before removing the island', () => {
    vi.useFakeTimers();
    messageUploadProgress.begin({
      id: 'request-1',
      roomId: 'room-1',
      fileNames: ['photo.png'],
      totalBytes: 10
    });

    messageUploadProgress.markConfirmed('request-1');
    expect(messageUploadProgress.entries).toHaveLength(1);
    vi.advanceTimersByTime(1_099);
    expect(messageUploadProgress.entries).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(messageUploadProgress.entries).toHaveLength(0);
  });

  it('does not let an old confirmation timer remove a reused request ID', () => {
    vi.useFakeTimers();
    messageUploadProgress.begin({
      id: 'request-reused',
      roomId: 'room-1',
      fileNames: ['first.png'],
      totalBytes: 10
    });
    messageUploadProgress.markConfirmed('request-reused');

    messageUploadProgress.begin({
      id: 'request-reused',
      roomId: 'room-1',
      fileNames: ['second.png'],
      totalBytes: 20
    });
    vi.advanceTimersByTime(1_100);

    expect(messageUploadProgress.entries).toHaveLength(1);
    expect(messageUploadProgress.entries[0]).toMatchObject({
      id: 'request-reused',
      phase: 'preparing',
      fileName: 'second.png'
    });
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
