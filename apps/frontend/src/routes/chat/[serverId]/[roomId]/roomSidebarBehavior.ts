import type { RoomSidebarPanel, RoomSidebarPanelState } from '$lib/storage/roomSidebarPanel';

export const CHANNEL_ROOM_SIDEBAR_PANELS: RoomSidebarPanel[] = ['members', 'files', 'call'];
export const DM_ROOM_SIDEBAR_PANELS: RoomSidebarPanel[] = ['files', 'call'];

export function canBanMembersFromRoomSidebar(
  isDM: boolean,
  roomCanBanMembers: boolean | null | undefined
): boolean {
  return !isDM && !!roomCanBanMembers;
}

export function roomSidebarPanelForRoom(
  isDM: boolean,
  panel: RoomSidebarPanelState,
  livekitEnabled = true
): RoomSidebarPanelState {
  if (panel === null) return null;
  const panels = isDM ? DM_ROOM_SIDEBAR_PANELS : CHANNEL_ROOM_SIDEBAR_PANELS;
  if (!panels.includes(panel)) return null;
  if (panel === 'call' && !livekitEnabled) return null;
  return panel;
}

export function roomSidebarPanelsForRoom(isDM: boolean, livekitEnabled: boolean): RoomSidebarPanel[] {
  const panels = isDM ? DM_ROOM_SIDEBAR_PANELS : CHANNEL_ROOM_SIDEBAR_PANELS;
  return livekitEnabled ? panels : panels.filter((panel) => panel !== 'call');
}

export function roomSidebarShellClass(
  presentation: 'desktop' | 'overlay',
  maximized: boolean
): string {
  if (presentation === 'overlay') return 'w-full min-w-0 flex-1 overflow-hidden';
  return maximized
    ? 'border-l border-border min-w-0 flex-1'
    : 'border-l border-border w-64 shrink-0';
}
