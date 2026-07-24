import {
  authHeaders,
  Code,
  ConnectError,
  createTowkClient,
  type ConnectAPIConfig
} from './connect.js';
import { UserService } from '@towk/api-types/api/v1/member_directory_pb';
import { RoomService } from '@towk/api-types/api/v1/rooms_pb';
import type {
  DirectoryMember as APIDirectoryMember,
  UserProfile as APIUserProfile
} from '@towk/api-types/api/v1/member_directory_pb';
import { PresenceStatus as APIPresenceStatus } from '@towk/api-types/api/v1/presence_pb';
import { PresenceStatus } from './renderTypes.js';
import { protobufTimestampToISOString } from '$lib/protobufTimestamp';

export type MemberDirectoryAPIConfig = ConnectAPIConfig;

export type DirectoryMember = {
  id: string;
  login: string;
  displayName: string;
  deleted: boolean;
  avatarUrl: string | null;
  presenceStatus: PresenceStatus;
  customStatus: {
    emoji: string;
    text: string;
    expiresAt: string | null;
  } | null;
  roles: string[];
  createdAt: string | null;
};

export type DetailedUserProfile = {
  user: {
    id: string;
    login: string;
    displayName: string;
    deleted: boolean;
    avatarUrl: string | null;
    presenceStatus: PresenceStatus;
    customStatus: {
      emoji: string;
      text: string;
      expiresAt: string | null;
    } | null;
  };
  roles: Array<{
    name: string;
    displayName: string;
    position: number;
    moderation: boolean;
  }>;
  joinedAt: string | null;
  biographyMarkdown: string;
  lastActivity: string | null;
  lastActivityVisible: boolean;
  viewerIsSelf: boolean;
  viewerCanMessage: boolean;
  viewerCanCall: boolean;
};

export type MemberDirectoryPage = {
  members: DirectoryMember[];
  totalCount: number;
  hasMore: boolean;
};

export function createMemberDirectoryAPI(config: MemberDirectoryAPIConfig) {
  const users = createTowkClient(UserService, config);
  const rooms = createTowkClient(RoomService, config);
  const headers = () => authHeaders(config);

  return {
    async listUsers(search = '', limit = 20, offset = 0): Promise<MemberDirectoryPage> {
      const response = await users.listUsers(
        { search, page: { limit, offset } },
        { headers: headers() }
      );
      return {
        members: response.users.map(mapDirectoryMember),
        totalCount: Number(response.page?.totalCount ?? 0),
        hasMore: response.page?.hasMore ?? false
      };
    },

    async getUser(userId: string): Promise<DirectoryMember | null> {
      try {
        const response = await users.getUser(
          { target: { case: 'userId', value: userId } },
          { headers: headers() }
        );
        return response.user ? mapDirectoryMember(response.user) : null;
      } catch (err) {
        if (err instanceof ConnectError && err.code === Code.NotFound) {
          return null;
        }
        throw err;
      }
    },

    async getUserProfile(userId: string): Promise<DetailedUserProfile | null> {
      try {
        const response = await users.getUserProfile(
          { target: { case: 'userId', value: userId } },
          { headers: headers() }
        );
        return response.profile ? mapDetailedUserProfile(response.profile) : null;
      } catch (err) {
        if (err instanceof ConnectError && err.code === Code.NotFound) {
          return null;
        }
        throw err;
      }
    },

    async getUserByLogin(login: string): Promise<DirectoryMember | null> {
      try {
        const response = await users.getUser(
          { target: { case: 'login', value: login } },
          { headers: headers() }
        );
        return response.user ? mapDirectoryMember(response.user) : null;
      } catch (err) {
        if (err instanceof ConnectError && err.code === Code.NotFound) {
          return null;
        }
        throw err;
      }
    },

    async batchGetUsers(userIds: string[]): Promise<DirectoryMember[]> {
      const response = await users.batchGetUsers({ userIds }, { headers: headers() });
      return response.users.map(mapDirectoryMember);
    },

    async listRoomMembers(
      roomId: string,
      search = '',
      limit = 250,
      offset = 0
    ): Promise<MemberDirectoryPage> {
      const response = await rooms.listMembers(
        { roomId, search, page: { limit, offset } },
        { headers: headers() }
      );
      return {
        members: response.members.map(mapDirectoryMember),
        totalCount: Number(response.page?.totalCount ?? 0),
        hasMore: response.page?.hasMore ?? false
      };
    },

    async getRoomMember(roomId: string, userId: string): Promise<DirectoryMember | null> {
      try {
        const response = await rooms.getMember({ roomId, userId }, { headers: headers() });
        return response.member ? mapDirectoryMember(response.member) : null;
      } catch (err) {
        if (err instanceof ConnectError && err.code === Code.NotFound) {
          return null;
        }
        throw err;
      }
    },

    async batchGetRoomMembers(roomId: string, userIds: string[]): Promise<DirectoryMember[]> {
      const response = await rooms.batchGetMembers({ roomId, userIds }, { headers: headers() });
      return response.members.map(mapDirectoryMember);
    }
  };
}

export type MemberDirectoryAPI = Omit<
  ReturnType<typeof createMemberDirectoryAPI>,
  'getUserProfile'
>;

export function mapDirectoryMember(member: APIDirectoryMember): DirectoryMember {
  const user = member.user;
  return {
    id: user?.id ?? '',
    login: user?.login ?? '',
    displayName: user?.displayName ?? '',
    deleted: user?.deleted ?? false,
    avatarUrl: user?.avatarUrl ?? null,
    presenceStatus: apiPresenceStatus(user?.presenceStatus ?? APIPresenceStatus.UNSPECIFIED),
    customStatus: user?.customStatus
      ? {
          emoji: user.customStatus.emoji,
          text: user.customStatus.text,
          expiresAt: protobufTimestampToISOString(user.customStatus.expiresAt) ?? null
        }
      : null,
    roles: [...member.roles],
    createdAt: protobufTimestampToISOString(member.createdAt) ?? null
  };
}

export function mapDetailedUserProfile(profile: APIUserProfile): DetailedUserProfile {
  const user = profile.user;
  if (!user) {
    throw new Error('Detailed user profile is missing its user identity');
  }

  return {
    user: {
      id: user.id,
      login: user.login,
      displayName: user.displayName,
      deleted: user.deleted,
      avatarUrl: user.avatarUrl ?? null,
      presenceStatus: apiPresenceStatus(user.presenceStatus),
      customStatus: user.customStatus
        ? {
            emoji: user.customStatus.emoji,
            text: user.customStatus.text,
            expiresAt: protobufTimestampToISOString(user.customStatus.expiresAt) ?? null
          }
        : null
    },
    roles: profile.roles.map((role) => ({
      name: role.name,
      displayName: role.displayName,
      position: role.position,
      moderation: role.moderation
    })),
    joinedAt: protobufTimestampToISOString(profile.joinedAt) ?? null,
    biographyMarkdown: profile.biographyMarkdown,
    lastActivity: protobufTimestampToISOString(profile.lastActivity) ?? null,
    lastActivityVisible: profile.lastActivityVisible,
    viewerIsSelf: profile.viewerIsSelf,
    viewerCanMessage: profile.viewerCanMessage,
    viewerCanCall: profile.viewerCanCall
  };
}

function apiPresenceStatus(status: APIPresenceStatus): PresenceStatus {
  switch (status) {
    case APIPresenceStatus.AWAY:
      return PresenceStatus.Away;
    case APIPresenceStatus.DO_NOT_DISTURB:
      return PresenceStatus.DoNotDisturb;
    case APIPresenceStatus.ONLINE:
      return PresenceStatus.Online;
    case APIPresenceStatus.OFFLINE:
    case APIPresenceStatus.UNSPECIFIED:
    default:
      return PresenceStatus.Offline;
  }
}
