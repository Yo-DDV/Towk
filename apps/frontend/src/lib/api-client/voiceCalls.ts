import { authHeaders, Code, ConnectError, createTowkClient } from './connect.js';
import { VoiceCallService } from '@towk/api-types/api/v1/voice_calls_connect';
import { JoinCallMode, JoinCallStatus } from '@towk/api-types/api/v1/voice_calls_pb';

export type VoiceCallAPIConfig = {
  baseUrl: string;
  bearerToken: string | null;
  onAuthenticationRequired?: (serverId: string) => void;
};

export type VoiceCallParticipantUser = {
  id: string;
  login: string;
  displayName: string;
  deleted: boolean;
  avatarUrl: string | null;
};

export type VoiceCallParticipant = {
  user: VoiceCallParticipantUser;
  joinedAt: string;
  callId: string;
  participantId: string;
  deviceIndex: number;
};

export type ActiveVoiceCall = {
  roomId: string;
  callId: string;
  participants: VoiceCallParticipant[];
};

export type VoiceCallToken = {
  token: string;
  e2eeKey: string;
  callId: string;
  participantId: string;
  deviceIndex: number;
};

export type VoiceCallJoinMode = 'ask' | 'companion' | 'transfer';

export type VoiceCallJoinResult =
  | {
      status: 'joined';
      participantId: string;
      deviceIndex: number;
    }
  | {
      status: 'selection-required';
      activeDeviceCount: number;
      companionAllowed: boolean;
    };

type APICallParticipant = {
  user?: {
    id: string;
    login: string;
    displayName: string;
    deleted: boolean;
    avatarUrl?: string;
  };
  joinedAt?: { toDate(): Date };
  callId: string;
  participantId: string;
  deviceIndex: number;
};

export function createVoiceCallAPI(config: VoiceCallAPIConfig) {
  const client = createTowkClient(VoiceCallService, config);
  const headers = () => authHeaders(config);

  return {
    async listActiveCalls(): Promise<ActiveVoiceCall[]> {
      const response = await client.listActiveCalls({}, { headers: headers() });
      return response.calls.map(activeCall);
    },

    async getActiveCall(roomId: string): Promise<ActiveVoiceCall | null> {
      try {
        const response = await client.getActiveCall({ roomId }, { headers: headers() });
        return response.call ? activeCall(response.call) : null;
      } catch (err) {
        if (err instanceof ConnectError && err.code === Code.NotFound) {
          return null;
        }
        throw err;
      }
    },

    async batchGetActiveCalls(roomIds: string[]): Promise<ActiveVoiceCall[]> {
      const response = await client.batchGetActiveCalls({ roomIds }, { headers: headers() });
      return response.calls.map(activeCall);
    },

    async listCallParticipants(roomId: string): Promise<VoiceCallParticipant[]> {
      const response = await client.listCallParticipants({ roomId }, { headers: headers() });
      return response.participants.flatMap(callParticipant);
    },

    async joinCall(
      roomId: string,
      clientInstanceId = '',
      mode: VoiceCallJoinMode = 'ask',
      expectedCallId?: string
    ): Promise<VoiceCallJoinResult> {
      const response = await client.joinCall(
        { roomId, clientInstanceId, mode: apiJoinCallMode(mode), expectedCallId },
        { headers: headers() }
      );
      if (response.status === JoinCallStatus.SELECTION_REQUIRED) {
        return {
          status: 'selection-required',
          activeDeviceCount: response.activeDeviceCount,
          companionAllowed: response.companionAllowed
        };
      }
      if (!response.joined || !response.participantId || response.deviceIndex < 1) {
        throw new Error('call join was not admitted');
      }
      return {
        status: 'joined',
        participantId: response.participantId,
        deviceIndex: response.deviceIndex
      };
    },

    async getCallToken(
      roomId: string,
      clientInstanceId = '',
      expectedCallId?: string
    ): Promise<VoiceCallToken | null> {
      const response = await client.getCallToken(
        { roomId, clientInstanceId, expectedCallId },
        { headers: headers() }
      );
      if (
        !response.token ||
        !response.e2eeKey ||
        !response.callId ||
        !response.participantId ||
        response.deviceIndex < 1
      ) {
        return null;
      }
      return {
        token: response.token,
        e2eeKey: response.e2eeKey,
        callId: response.callId,
        participantId: response.participantId,
        deviceIndex: response.deviceIndex
      };
    },

    async leaveCall(roomId: string, clientInstanceId = ''): Promise<boolean> {
      return (await client.leaveCall({ roomId, clientInstanceId }, { headers: headers() })).left;
    }
  };
}

export type VoiceCallAPI = ReturnType<typeof createVoiceCallAPI>;

function activeCall(call: {
  room?: { id: string };
  callId: string;
  participants: readonly APICallParticipant[];
}): ActiveVoiceCall {
  return {
    roomId: call.room?.id ?? '',
    callId: call.callId,
    participants: call.participants.flatMap(callParticipant)
  };
}

function callParticipant(participant: APICallParticipant): VoiceCallParticipant[] {
  const summary = participant.user;
  if (!summary) return [];
  return [
    {
      user: {
        id: summary.id,
        login: summary.login,
        displayName: summary.displayName,
        deleted: summary.deleted,
        avatarUrl: summary.avatarUrl ?? null
      },
      joinedAt: participant.joinedAt?.toDate().toISOString() ?? new Date(0).toISOString(),
      callId: participant.callId,
      participantId: participant.participantId || summary.id,
      deviceIndex: participant.deviceIndex || 1
    }
  ];
}

function apiJoinCallMode(mode: VoiceCallJoinMode): JoinCallMode {
  switch (mode) {
    case 'companion':
      return JoinCallMode.COMPANION;
    case 'transfer':
      return JoinCallMode.TRANSFER;
    default:
      return JoinCallMode.UNSPECIFIED;
  }
}
