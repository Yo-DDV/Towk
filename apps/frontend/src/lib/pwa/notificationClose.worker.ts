export const NATIVE_NOTIFICATION_CLOSED_MESSAGE_TYPE = 'towk-native-notification-closed';
export const NATIVE_NOTIFICATION_CLOSE_ACK_MESSAGE_TYPE = 'towk-native-notification-close-ack';
export const NATIVE_NOTIFICATION_CLOSE_DRAIN_MESSAGE_TYPE = 'towk-native-notification-close-drain';

export type NativeNotificationClosedMessage = {
  type: typeof NATIVE_NOTIFICATION_CLOSED_MESSAGE_TYPE;
  notificationId: string;
  source: 'native-close' | 'replay';
};

export type NativeNotificationCloseAckMessage = {
  type: typeof NATIVE_NOTIFICATION_CLOSE_ACK_MESSAGE_TYPE;
  notificationId: string;
};

export type NativeNotificationCloseDrainMessage = {
  type: typeof NATIVE_NOTIFICATION_CLOSE_DRAIN_MESSAGE_TYPE;
};

export function nativeNotificationClosedMessage(
  notificationId: string,
  source: NativeNotificationClosedMessage['source']
): NativeNotificationClosedMessage {
  return {
    type: NATIVE_NOTIFICATION_CLOSED_MESSAGE_TYPE,
    notificationId,
    source
  };
}
