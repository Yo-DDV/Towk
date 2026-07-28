import type { RoomSidebarPanel, RoomSidebarPanelState } from '$lib/storage/roomSidebarPanel';

export const CHANNEL_ROOM_SIDEBAR_PANELS: RoomSidebarPanel[] = ['members', 'files'];
export const DM_ROOM_SIDEBAR_PANELS: RoomSidebarPanel[] = ['files'];

export function canBanMembersFromRoomSidebar(
  isDM: boolean,
  roomCanBanMembers: boolean | null | undefined
): boolean {
  return !isDM && !!roomCanBanMembers;
}

export function roomSidebarPanelForRoom(
  isDM: boolean,
  panel: RoomSidebarPanelState
): RoomSidebarPanelState {
  if (panel === null) return null;
  const panels = isDM ? DM_ROOM_SIDEBAR_PANELS : CHANNEL_ROOM_SIDEBAR_PANELS;
  if (!panels.includes(panel)) return null;
  return panel;
}

export function roomSidebarPanelsForRoom(isDM: boolean): RoomSidebarPanel[] {
  return isDM ? DM_ROOM_SIDEBAR_PANELS : CHANNEL_ROOM_SIDEBAR_PANELS;
}

export function roomSidebarShellClass(presentation: 'desktop' | 'overlay'): string {
  if (presentation === 'overlay') return 'w-full min-w-0 flex-1 overflow-hidden';
  return 'border-l border-border w-64 shrink-0';
}
