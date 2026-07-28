import { segmentToServerId } from '$lib/navigation';
import type { AppUiState } from '$lib/state/appUi.svelte';

type NotificationUiController = Pick<AppUiState, 'selectRoomPrimarySurface'>;

export function notificationRoomTargetFromPathname(
  pathname: string
): { serverId: string; roomId: string } | null {
  const [, chatSegment, serverSegment, roomSegment] = pathname.split('/');
  if (chatSegment !== 'chat' || !serverSegment || !roomSegment) return null;

  const decodedServerSegment = decodePathSegment(serverSegment);
  const roomId = decodePathSegment(roomSegment);
  if (!decodedServerSegment || !roomId) return null;

  const serverId = segmentToServerId(decodedServerSegment);
  if (!serverId) return null;

  return { serverId, roomId };
}

export function prepareUiForNotificationPath(
  appUi: NotificationUiController,
  pathname: string
): void {
  const target = notificationRoomTargetFromPathname(pathname);
  if (target) appUi.selectRoomPrimarySurface(target.serverId, target.roomId, 'messages');
}

export function prepareUiForNotificationTarget(
  appUi: NotificationUiController,
  serverId: string,
  target: { roomId: string | null }
): void {
  if (target.roomId) appUi.selectRoomPrimarySurface(serverId, target.roomId, 'messages');
}

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
