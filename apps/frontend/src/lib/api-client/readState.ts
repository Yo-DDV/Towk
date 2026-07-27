import { authHeaders, createTowkClient, handleAuthError } from './connect.js';
import { RoomService } from '@towk/api-types/api/v1/rooms_pb';
import type { User as APIUser } from '@towk/api-types/api/v1/users_pb';
import { ThreadService } from '@towk/api-types/api/v1/threads_pb';
import { protobufTimestampToISOString } from '$lib/protobufTimestamp';

export type ConnectAPIConfig = {
  serverId?: string;
  baseUrl: string;
  bearerToken: string | null;
  onAuthenticationRequired?: (serverId: string) => void;
};

export type MarkRoomAsReadResult = {
  lastReadAt: string | null;
  previousLastReadAt: string | null;
};

export type MarkThreadAsReadResult = {
  previousReadAt: string | null;
};

export type ReadReceiptSummary = {
  messageEventId: string;
  readerCount: number;
};

export type ReadReceiptReader = {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  deleted: boolean;
  readAt: string | null;
};

export type ReadReceiptSummariesResult = {
  enabled: boolean;
  summaries: ReadReceiptSummary[];
};

export type ReadReceiptReadersResult = {
  enabled: boolean;
  readers: ReadReceiptReader[];
  totalCount: number;
  hasMore: boolean;
};

export function createReadStateAPI(config: ConnectAPIConfig) {
  const rooms = createTowkClient(RoomService, config);
  const threads = createTowkClient(ThreadService, config);
  const headers = () => authHeaders(config);
  return {
    async markRoomAsRead(input: {
      roomId: string;
      upToEventId?: string;
    }): Promise<MarkRoomAsReadResult> {
      try {
        const response = await rooms.markRoomAsRead(
          {
            roomId: input.roomId,
            upToEventId: input.upToEventId ?? ''
          },
          { headers: headers() }
        );
        return {
          lastReadAt: protobufTimestampToISOString(response.lastReadAt) ?? null,
          previousLastReadAt: protobufTimestampToISOString(response.previousLastReadAt) ?? null
        };
      } catch (err) {
        return handleAuthError(config, err);
      }
    },

    async markThreadAsRead(input: {
      roomId: string;
      threadRootEventId: string;
      upToEventId?: string;
    }): Promise<MarkThreadAsReadResult> {
      try {
        const response = await threads.markThreadAsRead(
          {
            roomId: input.roomId,
            threadRootEventId: input.threadRootEventId,
            upToEventId: input.upToEventId ?? ''
          },
          { headers: headers() }
        );
        return {
          previousReadAt: protobufTimestampToISOString(response.previousReadAt) ?? null
        };
      } catch (err) {
        return handleAuthError(config, err);
      }
    },

    async advanceReadReceipt(input: {
      roomId: string;
      threadRootEventId?: string | null;
      upToEventId: string;
    }): Promise<boolean> {
      try {
        const response = await rooms.advanceReadReceipt(
          {
            roomId: input.roomId,
            threadRootEventId: input.threadRootEventId ?? '',
            upToEventId: input.upToEventId
          },
          { headers: headers() }
        );
        return response.updated;
      } catch (err) {
        return handleAuthError(config, err);
      }
    },

    async getReadReceiptSummaries(input: {
      roomId: string;
      threadRootEventId?: string | null;
      messageEventIds: string[];
    }): Promise<ReadReceiptSummariesResult> {
      if (input.messageEventIds.length === 0) {
        return { enabled: true, summaries: [] };
      }
      try {
        const response = await rooms.getReadReceiptSummaries(
          {
            roomId: input.roomId,
            threadRootEventId: input.threadRootEventId ?? '',
            messageEventIds: input.messageEventIds
          },
          { headers: headers() }
        );
        return {
          enabled: response.enabled,
          summaries: response.summaries.map((summary) => ({
            messageEventId: summary.messageEventId,
            readerCount: summary.readerCount
          }))
        };
      } catch (err) {
        return handleAuthError(config, err);
      }
    },

    async listReadReceiptReaders(input: {
      roomId: string;
      threadRootEventId?: string | null;
      messageEventId: string;
      limit?: number;
      offset?: number;
    }): Promise<ReadReceiptReadersResult> {
      try {
        const response = await rooms.listReadReceiptReaders(
          {
            roomId: input.roomId,
            threadRootEventId: input.threadRootEventId ?? '',
            messageEventId: input.messageEventId,
            page: { limit: input.limit ?? 50, offset: input.offset ?? 0 }
          },
          { headers: headers() }
        );
        return {
          enabled: response.enabled,
          readers: response.readers.map((reader) => readReceiptReader(reader.user, reader.readAt)),
          totalCount: Number(response.page?.totalCount ?? response.readers.length),
          hasMore: response.page?.hasMore ?? false
        };
      } catch (err) {
        return handleAuthError(config, err);
      }
    }
  };
}

function readReceiptReader(
  user: APIUser | undefined,
  readAt: Parameters<typeof protobufTimestampToISOString>[0]
): ReadReceiptReader {
  return {
    id: user?.id ?? '',
    login: user?.login ?? '',
    displayName: user?.displayName || user?.login || '',
    avatarUrl: user?.avatarUrl ?? null,
    deleted: user?.deleted ?? false,
    readAt: protobufTimestampToISOString(readAt) ?? null
  };
}
