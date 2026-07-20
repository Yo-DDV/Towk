import {
  authHeaders,
  createTowkClient,
  handleAuthError,
  type ConnectAPIConfig as BaseConnectAPIConfig
} from './connect.js';
import * as m from '$lib/i18n/messages';
import { NotificationPreferencesService } from '@towk/api-types/api/v1/notification_preferences_pb';
import {
  NotificationLevel,
  type NotificationPreference as APINotificationPreference
} from '@towk/api-types/api/v1/notification_preferences_pb';

export type ConnectAPIConfig = BaseConnectAPIConfig & {
  serverId: string;
};

export type NotificationPreference = {
  level: NotificationLevel;
  effectiveLevel: NotificationLevel;
};

export async function getServerNotificationPreference(
  config: ConnectAPIConfig
): Promise<NotificationPreference> {
  const client = createNotificationPreferencesClient(config);
  let response;
  try {
    response = await client.getServerNotificationPreference(
      {},
      {
        headers: connectHeaders(config)
      }
    );
  } catch (err) {
    handleAuthError(config, err);
  }
  return notificationPreference(response.preference);
}

export async function updateServerNotificationPreference(
  config: ConnectAPIConfig,
  level: NotificationLevel
): Promise<NotificationPreference> {
  const client = createNotificationPreferencesClient(config);
  let response;
  try {
    response = await client.updateServerNotificationPreference(
      { level },
      {
        headers: connectHeaders(config)
      }
    );
  } catch (err) {
    handleAuthError(config, err);
  }
  return notificationPreference(response.preference);
}

export async function updateRoomNotificationPreference(
  config: ConnectAPIConfig,
  roomId: string,
  level: NotificationLevel
): Promise<NotificationPreference> {
  const client = createNotificationPreferencesClient(config);
  let response;
  try {
    response = await client.updateRoomNotificationPreference(
      {
        roomId,
        level
      },
      {
        headers: connectHeaders(config)
      }
    );
  } catch (err) {
    handleAuthError(config, err);
  }
  return notificationPreference(response.preference);
}

function createNotificationPreferencesClient(config: ConnectAPIConfig) {
  return createTowkClient(NotificationPreferencesService, config);
}

function connectHeaders(config: ConnectAPIConfig) {
  return authHeaders(config);
}

function notificationPreference(
  preference: APINotificationPreference | undefined
): NotificationPreference {
  if (!preference) {
    throw new Error(m['common.error.unexpected_server_response']());
  }
  return {
    level: preference.level,
    effectiveLevel: preference.effectiveLevel
  };
}
