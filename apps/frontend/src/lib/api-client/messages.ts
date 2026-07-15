import { authHeaders, createTowkClient, handleAuthError } from './connect.js';
import type { LinkPreviewInput, RoomEventView } from './renderTypes.js';
import { MessageService } from '@towk/api-types/api/v1/messages_connect';
import { messageToRawEvent, timelineUsersForMessages } from './roomTimeline.js';
import { createAssetUploadAPI } from './assetUploads.js';
import { MAX_MESSAGE_ATTACHMENTS } from '$lib/attachments/filePolicy';
import type { VoiceMessageMetadataInput } from '$lib/voiceMessages/policy';

export { MAX_MESSAGE_ATTACHMENTS };

export type MessageAPIConfig = {
  serverId?: string;
  baseUrl: string;
  bearerToken: string | null;
  onAuthenticationRequired?: (serverId: string) => void;
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
    const uploadedAttachmentAssetIds = await uploadMessageAttachments(config, input);
    return {
      roomId: input.roomId,
      body: input.body,
      attachmentAssetIds: [...(input.attachmentAssetIds ?? []), ...uploadedAttachmentAssetIds],
      threadRootEventId: input.threadRootEventId ?? null,
      inReplyTo: input.inReplyTo ?? null,
      alsoSendToChannel: input.alsoSendToChannel ?? false,
      linkPreviewToken: input.linkPreview?.previewToken ?? '',
      clientRequestId: input.clientRequestId?.trim() || createClientRequestId(),
      isVoiceMessage: !!input.voiceMessage
    };
  }

  async function createPreparedMessage(input: PreparedMessageInput): Promise<CreateMessageResult> {
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

      const users = await timelineUsersForMessages(
        config,
        response.message ? [response.message] : []
      );
      return {
        event: response.message
          ? (messageToRawEvent(response.message, users) as RoomEventView | null)
          : null
      };
    } catch (err) {
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

async function uploadMessageAttachments(config: MessageAPIConfig, input: CreateMessageInput) {
  const files = input.attachments;
  const voiceMessage = input.voiceMessage;
  if (!files?.length && !voiceMessage) return [];
  const uploads = createAssetUploadAPI(config);
  const genericUploads = (files ?? []).map((file) =>
    uploads.uploadAttachment({
      roomId: input.roomId,
      file
    })
  );
  const voiceUpload = voiceMessage
    ? [
        uploads.uploadAttachment({
          roomId: input.roomId,
          file: voiceMessage.file,
          voiceMessage: {
            durationMs: BigInt(Math.round(voiceMessage.durationMs)),
            waveformPeaks: voiceMessage.waveformPeaks
          }
        })
      ]
    : [];
  const assets = await Promise.all([...genericUploads, ...voiceUpload]);
  return assets.map((asset) => asset.assetId);
}
