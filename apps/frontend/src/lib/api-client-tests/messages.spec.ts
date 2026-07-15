import { Timestamp } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApiClientHooks } from '$lib/api-client/hooks';
import { createMessageAPI, MAX_MESSAGE_ATTACHMENTS } from '$lib/api-client/messages';
import { CreateMessageResponse, UpdateMessageResponse } from '@towk/api-types/api/v1/messages_pb';
import {
  AssetUpload,
  AssetUploadStatus,
  CompleteUploadResponse,
  CreateUploadResponse,
  UploadChunkResponse
} from '@towk/api-types/api/v1/asset_uploads_pb';
import { Asset } from '@towk/api-types/api/v1/attachments_pb';
import { Message } from '@towk/api-types/api/v1/message_types_pb';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createConnectTransport: vi.fn(),
  handleAuthenticationRequired: vi.fn(),
  createMessage: vi.fn(),
  updateMessage: vi.fn(),
  deleteMessage: vi.fn(),
  deleteAttachment: vi.fn(),
  deleteLinkPreview: vi.fn(),
  batchGetUsers: vi.fn(),
  createUpload: vi.fn(),
  uploadChunk: vi.fn(),
  getUpload: vi.fn(),
  completeUpload: vi.fn(),
  cancelUpload: vi.fn()
}));

vi.mock('@connectrpc/connect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@connectrpc/connect')>();
  return {
    ...actual,
    createClient: mocks.createClient
  };
});

vi.mock('@connectrpc/connect-web', () => ({
  createConnectTransport: mocks.createConnectTransport
}));

describe('createMessageAPI', () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.createConnectTransport.mockReset();
    mocks.handleAuthenticationRequired.mockReset();

    configureApiClientHooks({ onAuthenticationRequired: mocks.handleAuthenticationRequired });
    mocks.createMessage.mockReset();
    mocks.updateMessage.mockReset();
    mocks.deleteMessage.mockReset();
    mocks.deleteAttachment.mockReset();
    mocks.deleteLinkPreview.mockReset();
    mocks.batchGetUsers.mockReset();
    mocks.batchGetUsers.mockResolvedValue({ users: [] });
    mocks.createUpload.mockReset();
    mocks.uploadChunk.mockReset();
    mocks.getUpload.mockReset();
    mocks.completeUpload.mockReset();
    mocks.cancelUpload.mockReset();
    mocks.createConnectTransport.mockReturnValue({ kind: 'transport' });
    mocks.createClient.mockImplementation((service) => {
      if (service?.typeName === 'chatto.api.v1.AssetUploadService') {
        return {
          createUpload: mocks.createUpload,
          uploadChunk: mocks.uploadChunk,
          getUpload: mocks.getUpload,
          completeUpload: mocks.completeUpload,
          cancelUpload: mocks.cancelUpload
        };
      }
      if (service?.typeName === 'chatto.api.v1.UserService') {
        return {
          batchGetUsers: mocks.batchGetUsers
        };
      }
      return {
        createMessage: mocks.createMessage,
        updateMessage: mocks.updateMessage,
        deleteMessage: mocks.deleteMessage,
        deleteAttachment: mocks.deleteAttachment,
        deleteLinkPreview: mocks.deleteLinkPreview
      };
    });
  });

  it('posts a message with bearer auth and maps the renderable event response', async () => {
    mocks.createMessage.mockResolvedValue(
      new CreateMessageResponse({
        message: new Message({
          id: 'evt-1',
          actorId: 'user-1',
          createdAt: Timestamp.fromDate(new Date('2026-06-20T10:00:00Z')),
          roomId: 'room-1',
          body: 'hello',
          thread: { viewerState: { isFollowing: true } }
        })
      })
    );
    mocks.batchGetUsers.mockResolvedValue({
      users: [
        {
          user: {
            id: 'user-1',
            login: 'alice',
            displayName: 'Alice',
            deleted: false
          }
        }
      ]
    });

    const api = createMessageAPI({
      serverId: 'remote',
      baseUrl: 'https://remote.example.test/api/connect',
      bearerToken: 'remote-token'
    });

    const result = await api.createMessage({
      roomId: 'room-1',
      body: 'hello',
      threadRootEventId: 'root-1',
      inReplyTo: 'reply-1',
      alsoSendToChannel: true,
      linkPreview: {
        previewToken: 'cht_LPpreviewtoken'
      }
    });

    expect(mocks.createConnectTransport).toHaveBeenCalledWith({
      baseUrl: 'https://remote.example.test/api/connect',
      useBinaryFormat: true
    });
    expect(mocks.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        body: 'hello',
        threadRootEventId: 'root-1',
        inReplyTo: 'reply-1',
        alsoSendToChannel: true,
        linkPreviewToken: 'cht_LPpreviewtoken',
        clientRequestId: expect.any(String)
      }),
      {
        headers: { Authorization: 'Bearer remote-token' }
      }
    );
    expect(mocks.batchGetUsers).toHaveBeenCalledWith(
      { userIds: ['user-1'] },
      {
        headers: { Authorization: 'Bearer remote-token' }
      }
    );
    expect(result).toMatchObject({
      event: {
        id: 'evt-1',
        actor: { id: 'user-1', displayName: 'Alice' },
        event: { kind: 'messagePosted', body: 'hello' }
      }
    });
  });

  it('uploads browser files through AssetUploadService and posts attachment asset IDs', async () => {
    mocks.createUpload.mockResolvedValue(
      new CreateUploadResponse({
        upload: new AssetUpload({
          uploadId: 'upload-note',
          roomId: 'room-1',
          status: AssetUploadStatus.OPEN,
          committedOffset: 0n,
          size: 5n,
          maxChunkSize: 1024,
          sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
        })
      })
    );
    mocks.uploadChunk.mockResolvedValue(
      new UploadChunkResponse({
        upload: new AssetUpload({
          uploadId: 'upload-note',
          roomId: 'room-1',
          status: AssetUploadStatus.OPEN,
          committedOffset: 5n,
          size: 5n,
          maxChunkSize: 1024
        })
      })
    );
    mocks.completeUpload.mockResolvedValue(
      new CompleteUploadResponse({
        upload: new AssetUpload({
          uploadId: 'upload-note',
          status: AssetUploadStatus.COMPLETED,
          committedOffset: 5n,
          size: 5n,
          assetId: 'asset-note'
        }),
        asset: new Asset({
          id: 'asset-note',
          filename: 'note.txt',
          contentType: 'text/plain'
        })
      })
    );
    mocks.createMessage.mockResolvedValue(
      new CreateMessageResponse({
        message: new Message({
          id: 'evt-attachment',
          actorId: 'user-1',
          roomId: 'room-1',
          body: 'with file'
        })
      })
    );

    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const api = createMessageAPI({
      baseUrl: 'https://remote.example.test/api/connect',
      bearerToken: null
    });

    await api.createMessage({
      roomId: 'room-1',
      body: 'with file',
      attachments: [file],
      threadRootEventId: 'root-1',
      alsoSendToChannel: true
    });

    const uploadRequest = mocks.createUpload.mock.calls[0][0];
    expect(mocks.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        filename: 'note.txt',
        contentType: 'text/plain',
        size: 5n,
        sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      }),
      { headers: undefined }
    );
    expect(uploadRequest.threadRootEventId).toBeUndefined();
    expect(uploadRequest.alsoSendToChannel).toBeUndefined();
    expect(mocks.uploadChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadId: 'upload-note',
        offset: 0n,
        chunkSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      }),
      { headers: undefined }
    );
    expect(Array.from(mocks.uploadChunk.mock.calls[0][0].content)).toEqual([
      104, 101, 108, 108, 111
    ]);
    expect(mocks.completeUpload).toHaveBeenCalledWith(
      { uploadId: 'upload-note' },
      { headers: undefined }
    );
    const request = mocks.createMessage.mock.calls[0][0];
    expect(request.attachmentAssetIds).toEqual(['asset-note']);
    expect(request.attachments).toBeUndefined();
    expect(request.threadRootEventId).toBe('root-1');
    expect(request.alsoSendToChannel).toBe(true);
  });

  it('uploads first-class voice metadata and marks the prepared outbox message', async () => {
    mocks.createUpload.mockResolvedValue(
      new CreateUploadResponse({
        upload: new AssetUpload({
          uploadId: 'upload-voice',
          roomId: 'room-1',
          status: AssetUploadStatus.OPEN,
          committedOffset: 0n,
          size: 4n,
          maxChunkSize: 1024
        })
      })
    );
    mocks.uploadChunk.mockResolvedValue(
      new UploadChunkResponse({
        upload: new AssetUpload({
          uploadId: 'upload-voice',
          status: AssetUploadStatus.OPEN,
          committedOffset: 4n,
          size: 4n,
          maxChunkSize: 1024
        })
      })
    );
    mocks.completeUpload.mockResolvedValue(
      new CompleteUploadResponse({
        upload: new AssetUpload({
          uploadId: 'upload-voice',
          status: AssetUploadStatus.COMPLETED,
          committedOffset: 4n,
          size: 4n,
          assetId: 'asset-voice'
        }),
        asset: new Asset({
          id: 'asset-voice',
          filename: 'voice-message.webm',
          contentType: 'audio/webm'
        })
      })
    );
    mocks.createMessage.mockResolvedValue(
      new CreateMessageResponse({
        message: new Message({ id: 'evt-voice', actorId: 'user-1', roomId: 'room-1' })
      })
    );

    const file = new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], 'voice-message.webm', {
      type: 'audio/webm'
    });
    const api = createMessageAPI({
      baseUrl: 'https://remote.example.test/api/connect',
      bearerToken: null
    });

    const prepared = await api.prepareMessage({
      roomId: 'room-1',
      body: '',
      voiceMessage: {
        file,
        durationMs: 1_234,
        waveformPeaks: Array.from({ length: 32 }, (_, index) => index / 31)
      }
    });

    expect(mocks.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        filename: 'voice-message.webm',
        contentType: 'audio/webm',
        size: 4n,
        voiceMessage: {
          durationMs: 1_234n,
          waveformPeaks: expect.arrayContaining([0, 1])
        }
      }),
      { headers: undefined }
    );
    expect(prepared.attachmentAssetIds).toEqual(['asset-voice']);
    expect(prepared.isVoiceMessage).toBe(true);

    await api.createPreparedMessage(prepared);
    expect(mocks.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentAssetIds: ['asset-voice'], body: '' }),
      { headers: undefined }
    );
  });

  it('cancels an upload session when attachment completion fails', async () => {
    mocks.createUpload.mockResolvedValue(
      new CreateUploadResponse({
        upload: new AssetUpload({
          uploadId: 'upload-rejected',
          roomId: 'room-1',
          status: AssetUploadStatus.OPEN,
          committedOffset: 0n,
          size: 1n,
          maxChunkSize: 1024
        })
      })
    );
    mocks.uploadChunk.mockResolvedValue(
      new UploadChunkResponse({
        upload: new AssetUpload({
          uploadId: 'upload-rejected',
          status: AssetUploadStatus.OPEN,
          committedOffset: 1n,
          size: 1n,
          maxChunkSize: 1024
        })
      })
    );
    const rejection = new ConnectError(
      'executable attachments are not allowed',
      Code.InvalidArgument
    );
    mocks.completeUpload.mockRejectedValue(rejection);
    mocks.cancelUpload.mockResolvedValue({});

    const api = createMessageAPI({
      baseUrl: 'https://remote.example.test/api/connect',
      bearerToken: null
    });

    await expect(
      api.createMessage({
        roomId: 'room-1',
        body: 'blocked',
        attachments: [new File(['x'], 'renamed.txt', { type: 'text/plain' })]
      })
    ).rejects.toBe(rejection);

    expect(mocks.cancelUpload).toHaveBeenCalledWith(
      { uploadId: 'upload-rejected' },
      { headers: undefined }
    );
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it('rejects too many attachments before starting any upload', async () => {
    const api = createMessageAPI({
      baseUrl: 'https://remote.example.test/api/connect',
      bearerToken: null
    });
    const attachments = Array.from(
      { length: MAX_MESSAGE_ATTACHMENTS + 1 },
      (_, index) => new File(['x'], `file-${index}.txt`, { type: 'text/plain' })
    );

    await expect(
      api.createMessage({ roomId: 'room-1', body: 'bounded', attachments })
    ).rejects.toThrow(`message attachment count exceeds ${MAX_MESSAGE_ATTACHMENTS}`);
    expect(mocks.createUpload).not.toHaveBeenCalled();
    expect(mocks.createMessage).not.toHaveBeenCalled();
  });

  it('marks the server authentication stale on unauthenticated Connect errors', async () => {
    const err = new ConnectError('authentication required', Code.Unauthenticated);
    mocks.createMessage.mockRejectedValue(err);

    const api = createMessageAPI({
      serverId: 'remote',
      baseUrl: 'https://remote.example.test/api/connect',
      bearerToken: 'expired-token'
    });

    await expect(api.createMessage({ roomId: 'room-1', body: 'hello' })).rejects.toBe(err);
    expect(mocks.handleAuthenticationRequired).toHaveBeenCalledWith('remote');
  });

  it('updates a message through MessageService', async () => {
    mocks.updateMessage.mockResolvedValue(
      new UpdateMessageResponse({
        message: new Message({
          id: 'event-1',
          actorId: 'user-1',
          createdAt: Timestamp.fromDate(new Date('2026-06-20T10:00:00Z')),
          roomId: 'room-1',
          body: 'edited'
        })
      })
    );
    mocks.batchGetUsers.mockResolvedValue({
      users: [
        {
          user: {
            id: 'user-1',
            login: 'alice',
            displayName: 'Alice',
            deleted: false
          }
        }
      ]
    });

    const api = createMessageAPI({
      baseUrl: 'https://remote.example.test/api/connect',
      bearerToken: 'remote-token'
    });

    await expect(
      api.updateMessage({
        roomId: 'room-1',
        eventId: 'event-1',
        body: 'edited',
        alsoSendToChannel: false
      })
    ).resolves.toMatchObject({
      updated: true,
      event: {
        id: 'event-1',
        actor: { id: 'user-1', displayName: 'Alice' },
        event: { kind: 'messagePosted', body: 'edited' }
      }
    });

    expect(mocks.updateMessage).toHaveBeenCalledWith(
      {
        roomId: 'room-1',
        eventId: 'event-1',
        body: 'edited',
        alsoSendToChannel: false
      },
      { headers: { Authorization: 'Bearer remote-token' } }
    );
    expect(mocks.batchGetUsers).toHaveBeenCalledWith(
      { userIds: ['user-1'] },
      { headers: { Authorization: 'Bearer remote-token' } }
    );
  });

  it('can patch message echo state without sending a body', async () => {
    mocks.updateMessage.mockResolvedValue(new UpdateMessageResponse());

    const api = createMessageAPI({
      baseUrl: 'https://remote.example.test/api/connect',
      bearerToken: null
    });

    await expect(
      api.updateMessage({
        roomId: 'room-1',
        eventId: 'event-1',
        alsoSendToChannel: true
      })
    ).resolves.toEqual({ updated: true, event: null });

    expect(mocks.updateMessage).toHaveBeenCalledWith(
      {
        roomId: 'room-1',
        eventId: 'event-1',
        alsoSendToChannel: true
      },
      { headers: undefined }
    );
  });

  it('deletes message content through MessageService', async () => {
    mocks.deleteMessage.mockResolvedValue({ deleted: true });
    mocks.deleteAttachment.mockResolvedValue({ deleted: true });
    mocks.deleteLinkPreview.mockResolvedValue({ deleted: true });

    const api = createMessageAPI({
      baseUrl: 'https://remote.example.test/api/connect',
      bearerToken: null
    });

    await expect(api.deleteMessage('room-1', 'event-1')).resolves.toBe(true);
    await expect(api.deleteAttachment('room-1', 'event-1', 'attachment-1')).resolves.toBe(true);
    await expect(
      api.deleteLinkPreview('room-1', 'event-1', 'https://example.test/article')
    ).resolves.toBe(true);

    expect(mocks.deleteMessage).toHaveBeenCalledWith(
      { roomId: 'room-1', eventId: 'event-1' },
      { headers: undefined }
    );
    expect(mocks.deleteAttachment).toHaveBeenCalledWith(
      { roomId: 'room-1', eventId: 'event-1', attachmentId: 'attachment-1' },
      { headers: undefined }
    );
    expect(mocks.deleteLinkPreview).toHaveBeenCalledWith(
      { roomId: 'room-1', eventId: 'event-1', url: 'https://example.test/article' },
      { headers: undefined }
    );
  });
});
