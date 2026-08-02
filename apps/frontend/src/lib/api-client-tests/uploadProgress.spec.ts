import { create } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApiClientHooks } from '$lib/api-client/hooks';
import { createMessageAPI, type MessageUploadProgress } from '$lib/api-client/messages';
import { messageUploadProgress } from '$lib/uploads/messageUploadProgress.svelte';
import {
  AssetUploadSchema,
  AssetUploadStatus,
  CompleteUploadResponseSchema,
  CreateUploadResponseSchema,
  GetUploadResponseSchema,
  UploadChunkResponseSchema
} from '@towk/api-types/api/v1/asset_uploads_pb';
import { AssetSchema } from '@towk/api-types/api/v1/attachments_pb';
import { CreateMessageResponseSchema } from '@towk/api-types/api/v1/messages_pb';
import { MessageSchema } from '@towk/api-types/api/v1/message_types_pb';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createConnectTransport: vi.fn(),
  handleAuthenticationRequired: vi.fn(),
  createMessage: vi.fn(),
  batchGetUsers: vi.fn(),
  createUpload: vi.fn(),
  uploadChunk: vi.fn(),
  getUpload: vi.fn(),
  completeUpload: vi.fn(),
  cancelUpload: vi.fn()
}));

vi.mock('@connectrpc/connect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@connectrpc/connect')>();
  return { ...actual, createClient: mocks.createClient };
});

vi.mock('@connectrpc/connect-web', () => ({
  createConnectTransport: mocks.createConnectTransport
}));

beforeEach(() => {
  messageUploadProgress.resetForTests();
  configureApiClientHooks({ onAuthenticationRequired: mocks.handleAuthenticationRequired });
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.createConnectTransport.mockReturnValue({ kind: 'transport' });
  mocks.batchGetUsers.mockResolvedValue({ users: [] });
  mocks.cancelUpload.mockResolvedValue({});
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
      return { batchGetUsers: mocks.batchGetUsers };
    }
    return { createMessage: mocks.createMessage };
  });
});

afterEach(() => messageUploadProgress.resetForTests());

describe('message attachment upload progress', () => {
  it('reports preparation, committed aggregate bytes, finalization, and confirmation', async () => {
    mocks.createUpload.mockImplementation((request) =>
      Promise.resolve(
        create(CreateUploadResponseSchema, {
          upload: create(AssetUploadSchema, {
            uploadId: `upload-${request.filename}`,
            roomId: request.roomId,
            status: AssetUploadStatus.OPEN,
            committedOffset: 0n,
            size: request.size,
            maxChunkSize: 2
          })
        })
      )
    );
    mocks.uploadChunk.mockImplementation((request) =>
      Promise.resolve(
        create(UploadChunkResponseSchema, {
          upload: create(AssetUploadSchema, {
            uploadId: request.uploadId,
            roomId: 'room-1',
            status: AssetUploadStatus.OPEN,
            committedOffset: request.offset + BigInt(request.content.length),
            size: request.uploadId.endsWith('first.txt') ? 5n : 3n,
            maxChunkSize: 2
          })
        })
      )
    );
    mocks.completeUpload.mockImplementation((request) => {
      const filename = request.uploadId.replace('upload-', '');
      const size = filename === 'first.txt' ? 5n : 3n;
      return Promise.resolve(
        create(CompleteUploadResponseSchema, {
          upload: create(AssetUploadSchema, {
            uploadId: request.uploadId,
            status: AssetUploadStatus.COMPLETED,
            committedOffset: size,
            size,
            assetId: `asset-${filename}`
          }),
          asset: create(AssetSchema, {
            id: `asset-${filename}`,
            filename,
            contentType: 'text/plain',
            size
          })
        })
      );
    });
    mocks.createMessage.mockResolvedValue(
      create(CreateMessageResponseSchema, {
        message: create(MessageSchema, {
          id: 'message-1',
          actorId: 'user-1',
          roomId: 'room-1',
          createdAt: timestampFromDate(new Date('2026-08-02T12:00:00Z'))
        })
      })
    );

    const progress: MessageUploadProgress[] = [];
    const api = createMessageAPI({
      serverId: 'server-1',
      baseUrl: 'https://example.test/api/connect',
      bearerToken: null
    });
    await api.createMessage({
      roomId: 'room-1',
      body: 'files',
      clientRequestId: 'request-1',
      attachments: [
        new File(['hello'], 'first.txt', { type: 'text/plain' }),
        new File(['bye'], 'second.txt', { type: 'text/plain' })
      ],
      onUploadProgress: (update) => progress.push(update)
    });

    expect(progress.map((update) => update.phase)).toEqual(
      expect.arrayContaining(['preparing', 'uploading', 'finalizing', 'completed'])
    );
    expect(progress.some((update) => update.committedBytes === 8 && update.totalBytes === 8)).toBe(
      true
    );
    expect(mocks.createMessage.mock.calls[0][0].attachmentAssetIds).toEqual([
      'asset-first.txt',
      'asset-second.txt'
    ]);
    expect(messageUploadProgress.entries[0]).toMatchObject({
      id: 'request-1',
      phase: 'confirming',
      eventId: 'message-1',
      roomId: 'room-1',
      committedBytes: 8,
      totalBytes: 8
    });
  });

  it('reconciles a completed server upload after the completion response is lost', async () => {
    mocks.createUpload.mockResolvedValue(
      create(CreateUploadResponseSchema, {
        upload: create(AssetUploadSchema, {
          uploadId: 'upload-recovered',
          roomId: 'room-1',
          status: AssetUploadStatus.OPEN,
          committedOffset: 0n,
          size: 1n,
          maxChunkSize: 1024
        })
      })
    );
    mocks.uploadChunk.mockResolvedValue(
      create(UploadChunkResponseSchema, {
        upload: create(AssetUploadSchema, {
          uploadId: 'upload-recovered',
          roomId: 'room-1',
          status: AssetUploadStatus.OPEN,
          committedOffset: 1n,
          size: 1n,
          maxChunkSize: 1024
        })
      })
    );
    mocks.completeUpload.mockRejectedValue(new TypeError('response lost'));
    mocks.getUpload.mockResolvedValue(
      create(GetUploadResponseSchema, {
        upload: create(AssetUploadSchema, {
          uploadId: 'upload-recovered',
          roomId: 'room-1',
          status: AssetUploadStatus.COMPLETED,
          committedOffset: 1n,
          size: 1n,
          assetId: 'asset-recovered'
        })
      })
    );
    mocks.createMessage.mockResolvedValue(
      create(CreateMessageResponseSchema, {
        message: create(MessageSchema, {
          id: 'message-recovered',
          actorId: 'user-1',
          roomId: 'room-1'
        })
      })
    );

    const api = createMessageAPI({
      serverId: 'server-1',
      baseUrl: 'https://example.test/api/connect',
      bearerToken: null
    });
    await api.createMessage({
      roomId: 'room-1',
      body: 'recover',
      clientRequestId: 'request-recovered',
      attachments: [new File(['x'], 'recover.txt', { type: 'text/plain' })]
    });

    expect(mocks.createMessage.mock.calls[0][0].attachmentAssetIds).toEqual(['asset-recovered']);
    expect(mocks.cancelUpload).not.toHaveBeenCalled();
  });

  it('propagates abort and cancels the open server upload session', async () => {
    mocks.createUpload.mockResolvedValue(
      create(CreateUploadResponseSchema, {
        upload: create(AssetUploadSchema, {
          uploadId: 'upload-abort',
          roomId: 'room-1',
          status: AssetUploadStatus.OPEN,
          committedOffset: 0n,
          size: 4n,
          maxChunkSize: 2
        })
      })
    );
    mocks.uploadChunk.mockImplementation((_request, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true
        });
      })
    );

    const controller = new AbortController();
    const api = createMessageAPI({
      serverId: 'server-1',
      baseUrl: 'https://example.test/api/connect',
      bearerToken: null
    });
    const uploading = api.createMessage({
      roomId: 'room-1',
      body: 'cancel',
      clientRequestId: 'request-abort',
      attachments: [new File(['stop'], 'cancel.txt', { type: 'text/plain' })],
      signal: controller.signal
    });

    await vi.waitFor(() => expect(mocks.uploadChunk).toHaveBeenCalled());
    const abortError = new Error('cancelled by test');
    abortError.name = 'AbortError';
    controller.abort(abortError);

    await expect(uploading).rejects.toBe(abortError);
    expect(mocks.cancelUpload).toHaveBeenCalledWith(
      { uploadId: 'upload-abort' },
      { headers: undefined }
    );
    expect(messageUploadProgress.entries[0]).toMatchObject({
      id: 'request-abort',
      phase: 'failed',
      failureStage: 'uploading'
    });
  });
});
