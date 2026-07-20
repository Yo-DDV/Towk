import {
  authHeaders,
  createTowkClient,
  handleAuthError,
  type ConnectAPIConfig
} from './connect.js';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { MyAccountService } from '@towk/api-types/api/v1/account_pb';
import type { Timestamp } from '@bufbuild/protobuf/wkt';
import { protobufTimestampToISOString } from '$lib/protobufTimestamp';

export type CustomUserStatusAPIConfig = ConnectAPIConfig & {
  serverId: string;
};

export type CustomUserStatus = {
  emoji: string;
  text: string;
  expiresAt: string | null;
};

export async function updateCustomStatus(
  config: CustomUserStatusAPIConfig,
  input: {
    emoji: string;
    text: string;
    expiresAt?: string | null;
  }
): Promise<CustomUserStatus | null> {
  const client = createUserStatusClient(config);
  try {
    const response = await client.updateCustomStatus(
      {
        emoji: input.emoji,
        text: input.text,
        expiresAt: input.expiresAt ? timestampFromDate(new Date(input.expiresAt)) : undefined
      },
      { headers: authHeaders(config) }
    );
    return apiStatus(response.status);
  } catch (err) {
    handleAuthError(config, err);
  }
}

export async function deleteCustomStatus(
  config: CustomUserStatusAPIConfig
): Promise<CustomUserStatus | null> {
  const client = createUserStatusClient(config);
  try {
    const response = await client.deleteCustomStatus({}, { headers: authHeaders(config) });
    return apiStatus(response.status);
  } catch (err) {
    handleAuthError(config, err);
  }
}

function createUserStatusClient(config: CustomUserStatusAPIConfig) {
  return createTowkClient(MyAccountService, config);
}

function apiStatus(
  status:
    | {
        emoji: string;
        text: string;
        expiresAt?: Timestamp;
      }
    | undefined
): CustomUserStatus | null {
  if (!status) return null;
  return {
    emoji: status.emoji,
    text: status.text,
    expiresAt: protobufTimestampToISOString(status.expiresAt) ?? null
  };
}
