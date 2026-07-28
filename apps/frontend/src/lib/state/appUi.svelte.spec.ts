import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUiState } from './appUi.svelte';

const mocks = vi.hoisted(() => ({
  roomSidebarPanel: new Map<string, string>(),
  getRoomSidebarPanelState: vi.fn((serverId: string, roomId: string) => {
    return mocks.roomSidebarPanel.get(`${serverId}:${roomId}`) ?? 'members';
  }),
  setRoomSidebarPanelState: vi.fn((serverId: string, roomId: string, panel: string | null) => {
    if (panel) mocks.roomSidebarPanel.set(`${serverId}:${roomId}`, panel);
  })
}));

vi.mock('$lib/storage/roomSidebarPanel', () => ({
  ROOM_SIDEBAR_DEFAULT_PANEL: 'members',
  getRoomSidebarPanelState: mocks.getRoomSidebarPanelState,
  setRoomSidebarPanelState: mocks.setRoomSidebarPanelState
}));

describe('AppUiState', () => {
  beforeEach(() => {
    mocks.roomSidebarPanel.clear();
    mocks.getRoomSidebarPanelState.mockClear();
    mocks.setRoomSidebarPanelState.mockClear();
  });

  it('tracks the active chat route scope', () => {
    const appUi = new AppUiState();

    expect(appUi.activeRoomScope).toBe(null);

    appUi.setActiveRoomScope('server-a', 'room-1');

    expect(appUi.activeServerId).toBe('server-a');
    expect(appUi.activeRoomId).toBe('room-1');
    expect(appUi.activeRoomScope).toEqual({ serverId: 'server-a', roomId: 'room-1' });
  });

  it('clears room scope when the active route moves to a server page', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.selectRoomPrimarySurface('server-a', 'room-1', 'call');
    appUi.setActiveServer('server-a');

    expect(appUi.activeServerId).toBe('server-a');
    expect(appUi.activeRoomId).toBe(null);
    expect(appUi.activeRoomScope).toBe(null);
    expect(appUi.activeRoomPrimarySurface).toBe('messages');
  });

  it('tracks the active room sidebar panel inside the active room scope', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');

    expect(appUi.selectedDesktopRoomSidebarPanel).toBe('members');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('members');

    appUi.openDesktopRoomSidebarPanel('files');

    expect(appUi.activeDesktopRoomSidebarPanel).toBe('files');
    expect(mocks.setRoomSidebarPanelState).toHaveBeenCalledWith('server-a', 'room-1', 'files');

    appUi.closeDesktopRoomSidebarPanel();
    expect(appUi.activeDesktopRoomSidebarPanel).toBe(null);

    appUi.setActiveRoomScope('server-a', 'room-2');
    expect(appUi.activeDesktopRoomSidebarPanel).toBe('members');
  });

  it('scopes mobile room sidebar state to the active room', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    appUi.openMobileRoomSidebarPanel('files');

    expect(appUi.mobileRoomSidebarPanel).toBe('files');

    appUi.setActiveRoomScope('server-a', 'room-2');
    expect(appUi.mobileRoomSidebarPanel).toBe(null);
  });

  it('tracks the primary surface per room without persisting media state', () => {
    const appUi = new AppUiState();

    appUi.setActiveRoomScope('server-a', 'room-1');
    expect(appUi.activeRoomPrimarySurface).toBe('messages');

    appUi.selectActiveRoomPrimarySurface('call');
    expect(appUi.activeRoomPrimarySurface).toBe('call');

    appUi.setActiveRoomScope('server-a', 'room-2');
    expect(appUi.activeRoomPrimarySurface).toBe('messages');
    expect(appUi.roomPrimarySurfaceFor('server-a', 'room-1')).toBe('call');
  });

  it('returns the room to messages when the call ends', () => {
    const appUi = new AppUiState();

    appUi.selectRoomPrimarySurface('server-a', 'room-1', 'call');
    appUi.resetRoomPrimarySurface('server-a', 'room-1');

    expect(appUi.roomPrimarySurfaceFor('server-a', 'room-1')).toBe('messages');
  });

  it('exposes generic fullscreen UI state for top-level consumers', () => {
    const appUi = new AppUiState();

    expect(appUi.hasFullscreenSurface).toBe(false);

    appUi.setFullscreenSurface({ surface: 'media-viewer', id: 'asset-1' });
    expect(appUi.hasFullscreenSurface).toBe(true);
    expect(appUi.fullscreenSurface).toEqual({ surface: 'media-viewer', id: 'asset-1' });

    appUi.clearFullscreenSurface();
    expect(appUi.fullscreenSurface).toBe(null);
  });
});
