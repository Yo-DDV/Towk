import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import UploadProgressOverlay from './UploadProgressOverlay.svelte';
import { messageUploadProgress } from '$lib/uploads/messageUploadProgress.svelte';

const pageState = vi.hoisted(() => ({
  params: {
    roomId: 'room-1',
    threadId: undefined as string | undefined
  }
}));

vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'server-1'
}));

beforeEach(() => {
  pageState.params.roomId = 'room-1';
  pageState.params.threadId = undefined;
  messageUploadProgress.resetForTests();
});

afterEach(() => {
  document.querySelectorAll('[data-upload-confirmation-fixture]').forEach((node) => node.remove());
  messageUploadProgress.resetForTests();
});

describe('UploadProgressOverlay', () => {
  it('confirms an upload only after the accepted event is rendered in the conversation', async () => {
    messageUploadProgress.begin({
      id: 'request-1',
      serverId: 'server-1',
      roomId: 'room-1',
      fileNames: ['photo.png'],
      totalBytes: 10
    });
    messageUploadProgress.markConfirming('request-1', 'event-1');

    render(UploadProgressOverlay);
    expect(messageUploadProgress.entries[0]?.phase).toBe('confirming');

    const row = document.createElement('article');
    row.dataset.eventId = 'event-1';
    row.dataset.uploadConfirmationFixture = 'true';
    document.body.append(row);

    await vi.waitFor(() =>
      expect(messageUploadProgress.entries[0]).toMatchObject({
        id: 'request-1',
        phase: 'confirmed',
        eventId: 'event-1'
      })
    );
  });

  it('does not confirm against an unrelated rendered message', async () => {
    messageUploadProgress.begin({
      id: 'request-1',
      serverId: 'server-1',
      roomId: 'room-1',
      fileNames: ['photo.png'],
      totalBytes: 10
    });
    messageUploadProgress.markConfirming('request-1', 'event-expected');

    render(UploadProgressOverlay);
    const row = document.createElement('article');
    row.dataset.eventId = 'event-other';
    row.dataset.uploadConfirmationFixture = 'true';
    document.body.append(row);
    await Promise.resolve();

    expect(messageUploadProgress.entries[0]?.phase).toBe('confirming');
  });
});
