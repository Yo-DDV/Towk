import { createTowkClient, type ConnectAPIConfig } from './connect.js';
import { NativeNotificationService } from '@towk/api-types/chatto/api/v1/native_notifications_pb';

export type NativeNotificationConfig = {
  enabled: boolean;
  androidManagedFcmEnabled: boolean;
  linuxResidentWebsocketEnabled: boolean;
  managedFcmRelayUrl: string;
  managedFcmEnrollmentState: string;
  managedFcmInstanceId: string;
};

type APIConfig = ConnectAPIConfig;

function client(config: APIConfig) {
  return createTowkClient(NativeNotificationService, config);
}

export async function getNativeNotificationConfig(
  config: APIConfig
): Promise<NativeNotificationConfig> {
  const response = await client(config).getNativeNotificationConfig({});
  return {
    enabled: response.enabled,
    androidManagedFcmEnabled: response.androidManagedFcmEnabled,
    linuxResidentWebsocketEnabled: response.linuxResidentWebsocketEnabled,
    managedFcmRelayUrl: response.managedFcmRelayUrl,
    managedFcmEnrollmentState: response.managedFcmEnrollmentState,
    managedFcmInstanceId: response.managedFcmInstanceId
  };
}

export async function enrollManagedFCM(config: APIConfig): Promise<NativeNotificationConfig> {
  await client(config).enrollManagedFCM({});
  return getNativeNotificationConfig(config);
}
