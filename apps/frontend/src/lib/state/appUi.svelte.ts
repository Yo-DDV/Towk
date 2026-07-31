import { createContext } from 'svelte';
import {
  getRoomSidebarPanelState,
  ROOM_SIDEBAR_DEFAULT_PANEL,
  setRoomSidebarPanelState,
  type RoomSidebarPanel,
  type RoomSidebarPanelState
} from '$lib/storage/roomSidebarPanel';

export type AppRoomScope = {
  serverId: string;
  roomId: string;
};

export type RoomPrimarySurface = 'messages' | 'call';

export type AppFullscreenSurface = {
  id?: string;
  surface: string;
};

/**
 * App-scoped UI state that should be shared across route components.
 *
 * The URL remains the source of truth for the active server/room; route
 * components report that scope here so sibling UI concerns such as the room
 * sidebar and primary room surface can coordinate without custom event bridges.
 */
export class AppUiState {
  #activeServerId = $state<string | null>(null);
  #activeRoomId = $state<string | null>(null);
  #desktopRoomSidebarSessionState = $state<Record<string, RoomSidebarPanelState | undefined>>({});
  #mobileRoomSidebarPanel = $state<RoomSidebarPanelState>(null);
  #mobileRoomSidebarScope = $state<string | null>(null);
  #roomPrimarySurfaceSessionState = $state<Record<string, RoomPrimarySurface | undefined>>({});
  #fullscreenSurface = $state<AppFullscreenSurface | null>(null);

  get activeServerId(): string | null {
    return this.#activeServerId;
  }

  get activeRoomId(): string | null {
    return this.#activeRoomId;
  }

  get activeRoomScope(): AppRoomScope | null {
    if (!this.#activeServerId || !this.#activeRoomId) return null;
    return { serverId: this.#activeServerId, roomId: this.#activeRoomId };
  }

  setActiveServer(serverId: string): void {
    this.#activeServerId = serverId;
    this.#activeRoomId = null;
  }

  setActiveRoomScope(serverId: string, roomId: string): void {
    this.#activeServerId = serverId;
    this.#activeRoomId = roomId;
  }

  clearActiveRoomScope(serverId: string, roomId: string): void {
    if (this.#activeServerId !== serverId || this.#activeRoomId !== roomId) return;
    this.#activeRoomId = null;
  }

  get selectedDesktopRoomSidebarPanel(): RoomSidebarPanel {
    return this.#desktopRoomSidebarPanelForActiveRoom ?? ROOM_SIDEBAR_DEFAULT_PANEL;
  }

  get activeDesktopRoomSidebarPanel(): RoomSidebarPanelState {
    return this.#desktopRoomSidebarPanelForActiveRoom;
  }

  get mobileRoomSidebarPanel(): RoomSidebarPanelState {
    if (this.#mobileRoomSidebarScope !== this.#activeRoomScopeKey) return null;
    return this.#mobileRoomSidebarPanel;
  }

  toggleDesktopRoomSidebarPanel(panel: RoomSidebarPanel): void {
    if (this.activeDesktopRoomSidebarPanel === panel) {
      this.closeDesktopRoomSidebarPanel();
      return;
    }

    this.openDesktopRoomSidebarPanel(panel);
  }

  openDesktopRoomSidebarPanel(panel: RoomSidebarPanel): void {
    this.#setDesktopRoomSidebarPanel(panel);
  }

  closeDesktopRoomSidebarPanel(): void {
    this.#setDesktopRoomSidebarPanel(null);
  }

  toggleMobileRoomSidebarPanel(panel: RoomSidebarPanel): void {
    if (this.mobileRoomSidebarPanel === panel) {
      this.closeMobileRoomSidebarPanel();
      return;
    }

    this.openMobileRoomSidebarPanel(panel);
  }

  openMobileRoomSidebarPanel(panel: RoomSidebarPanel): void {
    const scope = this.#activeRoomScopeKey;
    if (!scope) return;

    this.#mobileRoomSidebarScope = scope;
    this.#mobileRoomSidebarPanel = panel;
  }

  closeMobileRoomSidebarPanel(): void {
    this.#mobileRoomSidebarPanel = null;
  }

  get activeRoomPrimarySurface(): RoomPrimarySurface {
    const scope = this.activeRoomScope;
    if (!scope) return 'messages';
    return (
      this.#roomPrimarySurfaceSessionState[roomScopeKey(scope.serverId, scope.roomId)] ?? 'messages'
    );
  }

  roomPrimarySurfaceFor(serverId: string, roomId: string): RoomPrimarySurface {
    return this.#roomPrimarySurfaceSessionState[roomScopeKey(serverId, roomId)] ?? 'messages';
  }

  selectRoomPrimarySurface(serverId: string, roomId: string, surface: RoomPrimarySurface): void {
    const key = roomScopeKey(serverId, roomId);
    if ((this.#roomPrimarySurfaceSessionState[key] ?? 'messages') === surface) return;
    this.#roomPrimarySurfaceSessionState = {
      ...this.#roomPrimarySurfaceSessionState,
      [key]: surface
    };
  }

  selectActiveRoomPrimarySurface(surface: RoomPrimarySurface): void {
    const scope = this.activeRoomScope;
    if (!scope) return;
    this.selectRoomPrimarySurface(scope.serverId, scope.roomId, surface);
  }

  resetRoomPrimarySurface(serverId: string, roomId: string): void {
    this.selectRoomPrimarySurface(serverId, roomId, 'messages');
  }

  get fullscreenSurface(): AppFullscreenSurface | null {
    return this.#fullscreenSurface;
  }

  get hasFullscreenSurface(): boolean {
    return this.#fullscreenSurface !== null;
  }

  setFullscreenSurface(surface: AppFullscreenSurface): void {
    this.#fullscreenSurface = surface;
  }

  clearFullscreenSurface(): void {
    this.#fullscreenSurface = null;
  }

  get #activeRoomScopeKey(): string | null {
    if (!this.#activeServerId || !this.#activeRoomId) return null;
    return roomScopeKey(this.#activeServerId, this.#activeRoomId);
  }

  get #desktopRoomSidebarPanelForActiveRoom(): RoomSidebarPanelState {
    const scope = this.activeRoomScope;
    if (!scope) return null;

    const key = roomScopeKey(scope.serverId, scope.roomId);
    if (key in this.#desktopRoomSidebarSessionState) {
      return this.#desktopRoomSidebarSessionState[key] ?? null;
    }

    return getRoomSidebarPanelState(scope.serverId, scope.roomId);
  }

  #setDesktopRoomSidebarPanel(panel: RoomSidebarPanelState): void {
    const scope = this.activeRoomScope;
    if (!scope) return;

    if (panel !== null) {
      setRoomSidebarPanelState(scope.serverId, scope.roomId, panel);
    }
    this.#desktopRoomSidebarSessionState = {
      ...this.#desktopRoomSidebarSessionState,
      [roomScopeKey(scope.serverId, scope.roomId)]: panel
    };
  }
}

function roomScopeKey(serverId: string, roomId: string): string {
  return `${serverId}:${roomId}`;
}

const [getAppUiContext, setAppUiContext] = createContext<AppUiState>();

export function provideAppUiState(state = new AppUiState()): AppUiState {
  setAppUiContext(state);
  return state;
}

export function getAppUiState(): AppUiState {
  return getAppUiContext();
}
