import { describe, expect, it } from 'vitest';
import {
  canBanMembersFromRoomSidebar,
  CHANNEL_ROOM_SIDEBAR_PANELS,
  DM_ROOM_SIDEBAR_PANELS,
  roomSidebarPanelForRoom,
  roomSidebarPanelsForRoom,
  roomSidebarShellClass
} from './roomSidebarBehavior';

describe('room sidebar behavior', () => {
  it('allows channel member bans when the room capability is present', () => {
    expect(canBanMembersFromRoomSidebar(false, true)).toBe(true);
  });

  it('suppresses member bans for DM rooms even if stale capability data says otherwise', () => {
    expect(canBanMembersFromRoomSidebar(true, true)).toBe(false);
  });

  it('suppresses member bans when the room capability is absent', () => {
    expect(canBanMembersFromRoomSidebar(false, false)).toBe(false);
    expect(canBanMembersFromRoomSidebar(false, null)).toBe(false);
    expect(canBanMembersFromRoomSidebar(false, undefined)).toBe(false);
  });

  it('keeps only files in the DM room sidebar', () => {
    expect(DM_ROOM_SIDEBAR_PANELS).toEqual(['files']);
  });

  it('keeps only members and files in the channel room sidebar', () => {
    expect(roomSidebarPanelForRoom(false, 'members')).toBe('members');
    expect(roomSidebarPanelForRoom(false, 'files')).toBe('files');
    expect(roomSidebarPanelForRoom(false, null)).toBeNull();
    expect(CHANNEL_ROOM_SIDEBAR_PANELS).toEqual(['members', 'files']);
    expect(roomSidebarPanelsForRoom(false)).toEqual(['members', 'files']);
  });

  it('treats the members default as closed for DM rooms', () => {
    expect(roomSidebarPanelForRoom(true, 'members')).toBeNull();
    expect(roomSidebarPanelForRoom(true, null)).toBeNull();
  });

  it('allows the files panel to open for DM rooms', () => {
    expect(roomSidebarPanelForRoom(true, 'files')).toBe('files');
  });

  it('returns files as the complete DM sidebar contract', () => {
    expect(roomSidebarPanelsForRoom(true)).toEqual(['files']);
  });

  it('uses a fixed desktop width and a fluid mobile overlay', () => {
    expect(roomSidebarShellClass('desktop')).toBe('border-l border-border w-64 shrink-0');
    expect(roomSidebarShellClass('overlay')).toBe('w-full min-w-0 flex-1 overflow-hidden');
  });
});
