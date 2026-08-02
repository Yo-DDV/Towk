import { authHeaders, createTowkClient, handleAuthError } from './connect.js';
import type { LinkPreviewInput, RoomEventView } from './renderTypes.js';
import { MessageService } from '@towk/api-types/api/v1/messages_pb';
import { messageToRawEvent, timelineUsersForMessages } from './roomTimeline.js';
import {
  createAssetUploadAPI,
  type AttachmentUploadPhase,
  type AttachmentUploadProgress
} from './assetUploads.js';
import { MAX_MESSAGE_ATTACHMENTS } from '$lib/attachments/filePolicy';
import type { VoiceMessageMetadataInput } from '$lib/voiceMessages/policy';
import { messageUploadProgress } from '$lib/uploads/messageUploadProgress.svelte';

export { MAX_MESSAGE_ATTACHMENTS };

export type MessageAPIConfig = {
  serverId?: string;
  baseUrl: string;
  bearerToken: string | null;
  onAuthenticationRequired?: (serverId: string) => void;
};

export type MessageUploadProgress = {
  phase: AttachmentUploadPhase;
  fileName: string;
  fileIndex: number;
  fileCount: number;
  currentFileCommittedBytes: number;
  currentFileTotalBytes: number;
  committedBytes: number;
  totalBytes: number;
};

export type CreateMessageInput = {
  roomId: string;
  body: string;
  attachmentAssetIds?: string[];
  attachments?: File[] | null;
  voiceMessage?: VoiceMessageMetadataInput | null;
  threadRootEventId?: string | null;
  inReplyTo?: string | null;
  alsoSendToChannel?: boolean;
  linkPreview?: LinkPreviewInput | null;
  clientRequestId?: string;
  signal?: AbortSignal;
  onUploadProgress?: (progress: MessageUploadProgress) => void;
};

export type PreparedMessageInput = {
  roomId: string;
  body: string;
  attachmentAssetIds: string[];
  threadRootEventId: string | null;
  inReplyTo: string | null;
  alsoSendToChannel: boolean;
  linkPreviewToken: string;
  clientRequestId: string;
  isVoiceMessage?: boolean;
};

export type UpdateMessageInput = {
  roomId: string;
  eventId: string;
  body?: string;
  alsoSendToChannel?: boolean;
};

export type CreateMessageResult = {
  event: RoomEventView | null;
};

export type UpdateMessageResult = {
  updated: boolean;
  event: RoomEventView | null;
};

function createClientRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export function createMessageAPI(config: MessageAPIConfig) {
  const client = createTowkClient(MessageService, config);
  const headers = () => authHeaders(config);

  async function prepareMessage(input: CreateMessageInput): Promise<PreparedMessageInput> {
    validateMessageAttachments(input);
    const clientRequestId = input.clientRequestId?.trim() || createClientRequestId();
    const uploadFiles = messageUploadFiles(input);
    if (uploadFiles.length > 0) {
      messageUploadProgress.begin({
        id: clientRequestId,
        serverId: config.serverId,
        roomId: input.roomId,
        threadRootEventId: input.threadRootEventId,
        fileNames: uploadFiles.map((file) => file.name || 'attachment'),
        totalBytes: uploadFiles.reduce((total, file) => total + file.size, 0)
      });
    }

    try {
      const uploadedAttachmentAssetIds = await uploadMessageAttachments(
        config,
        input,
        clientRequestId
      );
      return {
        roomId: input.roomId,
        body: input.body,
        attachmentAssetIds: [...(input.attachmentAssetIds ?? []), ...uploadedAttachmentAssetIds],
        threadRootEventId: input.threadRootEventId ?? null,
        inReplyTo: input.inReplyTo ?? null,
        alsoSendToChannel: input.alsoSendToChannel ?? false,
        linkPreviewToken: input.linkPreview?.previewToken ?? '',
        clientRequestId,
        isVoiceMessage: !!input.voiceMessage
      };
    } catch (err) {
      messageUploadProgress.fail(clientRequestId);
      throw err;
    }
  }

  async function createPreparedMessage(input: PreparedMessageInput): Promise<CreateMessageResult> {
    messageUploadProgress.markSending(input.clientRequestId);
    try {
      const response = await client.createMessage(
        {
          roomId: input.roomId,
          body: input.body,
          attachmentAssetIds: input.attachmentAssetIds,
          threadRootEventId: input.threadRootEventId ?? '',
          inReplyTo: input.inReplyTo ?? '',
          alsoSendToChannel: input.alsoSendToChannel,
          linkPreviewToken: input.linkPreviewToken,
          clientRequestId: input.clientRequestId
        },
        { headers: headers() }
      );

      messageUploadProgress.markConfirming(input.clientRequestId);
      const users = await timelineUsersForMessages(
        config,
        response.message ? [response.message] : []
      );
      const result = {
        event: response.message
          ? (messageToRawEvent(response.message, users) as RoomEventView | null)
          : null
      };
      messageUploadProgress.markConfirmed(input.clientRequestId);
      return result;
    } catch (err) {
      messageUploadProgress.fail(input.clientRequestId);
      return handleAuthError(config, err);
    }
  }

  return {
    prepareMessage,
    createPreparedMessage,

    async createMessage(input: CreateMessageInput): Promise<CreateMessageResult> {
      return createPreparedMessage(await prepareMessage(input));
    },

    async updateMessage(input: UpdateMessageInput): Promise<UpdateMessageResult> {
      try {
        const request: {
          roomId: string;
          eventId: string;
          body?: string;
          alsoSendToChannel?: boolean;
        } = {
          roomId: input.roomId,
          eventId: input.eventId
        };
        if (input.body !== undefined) {
          request.body = input.body;
        }
        if (input.alsoSendToChannel !== undefined) {
          request.alsoSendToChannel = input.alsoSendToChannel;
        }
        const response = await client.updateMessage(request, {
          headers: headers()
        });
        const users = await timelineUsersForMessages(
          config,
          response.message ? [response.message] : []
        );
        return {
          updated: true,
          event: response.message
            ? (messageToRawEvent(response.message, users) as RoomEventView | null)
            : null
        };
      } catch (err) {
        return handleAuthError(config, err);
      }
    },

    async deleteMessage(roomId: string, eventId: string): Promise<boolean> {
      try {
        const response = await client.deleteMessage({ roomId, eventId }, { headers: headers() });
        return response.deleted;
      } catch (err) {
        return handleAuthError(config, err);
      }
    },

    async deleteAttachment(
      roomId: string,
      eventId: string,
      attachmentId: string
    ): Promise<boolean> {
      try {
        const response = await client.deleteAttachment(
          { roomId, eventId, attachmentId },
          { headers: headers() }
        );
        return response.deleted;
      } catch (err) {
        return handleAuthError(config, err);
      }
    },

    async deleteLinkPreview(roomId: string, eventId: string, url: string): Promise<boolean> {
      try {
        const response = await client.deleteLinkPreview(
          { roomId, eventId, url },
          { headers: headers() }
        );
        return response.deleted;
      } catch (err) {
        return handleAuthError(config, err);
      }
    }
  };
}

function validateMessageAttachments(input: CreateMessageInput): void {
  const existingAssetIds = input.attachmentAssetIds ?? [];
  const pendingFiles = input.attachments ?? [];
  const voiceMessageCount = input.voiceMessage ? 1 : 0;
  if (existingAssetIds.length + pendingFiles.length + voiceMessageCount > MAX_MESSAGE_ATTACHMENTS) {
    throw new RangeError(`message attachment count exceeds ${MAX_MESSAGE_ATTACHMENTS}`);
  }
  if (new Set(existingAssetIds).size !== existingAssetIds.length) {
    throw new RangeError('message attachment asset IDs must be unique');
  }
}

type UploadCandidate = {
  file: File;
  voiceMessage?: VoiceMessageMetadataInput;
};

function messageUploadFiles(input: CreateMessageInput): File[] {
  return [...(input.attachments ?? []), ...(input.voiceMessage ? [input.voiceMessage.file] : [])];
}

async function uploadMessageAttachments(
  config: MessageAPIConfig,
  input: CreateMessageInput,
  clientRequestId: string
) {
  const candidates: UploadCandidate[] = [
    ...(input.attachments ?? []).map((file) => ({ file })),
    ...(input.voiceMessage ? [{ file: input.voiceMessage.file, voiceMessage: input.voiceMessage }] : [])
  ];
  if (candidates.length === 0) return [];

  const totalBytes = candidates.reduce((total, candidate) => total + candidate.file.size, 0);
  const committedBytes = candidates.map(() => 0);
  const uploads = createAssetUploadAPI(config);
  const batchController = new AbortController();
  const unlinkAbort = linkAbortSignal(input.signal, batchController);

  const report = (index: number, progress: AttachmentUploadProgress) => {
    committedBytes[index] = progress.committedBytes;
    const aggregate: MessageUploadProgress = {
      phase: progress.phase,
      fileName: progress.fileName,
      fileIndex: index,
      fileCount: candidates.length,
      currentFileCommittedBytes: progress.committedBytes,
      currentFileTotalBytes: progress.totalBytes,
      committedBytes: committedBytes.reduce((total, value) => total + value, 0),
      totalBytes
    };
    input.onUploadProgress?.(aggregate);
    messageUploadProgress.update(clientRequestId, aggregate);
  };

  try {
    return await Promise.all(
      candidates.map(async (candidate, index) => {
        try {
          const asset = await uploads.uploadAttachment({
            roomId: input.roomId,
            file: candidate.file,
            signal: batchController.signal,
            voiceMessage: candidate.voiceMessage
              ? {
                  durationMs: BigInt(Math.round(candidate.voiceMessage.durationMs)),
                  waveformPeaks: candidate.voiceMessage.waveformPeaks
                }
              : undefined,
            onProgress: (progress) => report(index, progress)
          });
          return asset.assetId;
        } catch (err) {
          if (!batchController.signal.aborted) batchController.abort(err);
          throw err;
        }
      })
    );
  } finally {
    unlinkAbort();
  }
}

function linkAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined;
  const abort = () => target.abort(source.reason);
  if (source.aborted) abort();
  else source.addEventListener('abort', abort, { once: true });
  return () => source.removeEventListener('abort', abort);
}
