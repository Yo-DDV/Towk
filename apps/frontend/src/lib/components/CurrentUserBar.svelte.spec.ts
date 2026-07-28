import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import { q } from '$lib/test-utils';
import { PresenceStatus } from '$lib/render/types';
import { presencePreference } from '$lib/state/presencePreference.svelte';
import { sidebarNav } from '$lib/state/globals.svelte';
import CurrentUserBarTestHarness from './CurrentUserBarTestHarness.svelte';

function computedBackgroundColor(color: string): string {
  const element = document.createElement('span');
  element.style.backgroundColor = color;
  document.body.append(element);
  const computed = window.getComputedStyle(element).backgroundColor;
  element.remove();
  return computed;
}

type MockRoomMember = {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  presenceStatus: PresenceStatus;
};

type MockRoom = {
  id: string;
  name: string;
  type: 'CHANNEL' | 'DM';
  members: MockRoomMember[];
};

const {
  currentUserState,
  voiceCallState,
  remoteVoiceCallState,
  roomsState,
  remoteRoomsState,
  permissionsState,
  activeCallRoomsState,
  callParticipantsState
} = vi.hoisted(() => ({
  currentUserState: {
    user: null as {
      id: string;
      login: string;
      displayName: string;
      avatarUrl: string | null;
      presenceStatus: PresenceStatus;
      customStatus?: {
        emoji: string;
        text: string;
        expiresAt?: string | null;
      } | null;
      hasVerifiedEmail: boolean;
      settings: null;
    } | null
  },
  voiceCallState: {
    connected: false,
    reconnecting: false,
    roomId: null as string | null,
    targetRoomId: null as string | null,
    callId: null as string | null,
    isMuted: false,
    isOutputMuted: false,
    audioPlaybackBlocked: false,
    isMicrophonePending: false,
    isCameraEnabled: false,
    isCameraPending: false,
    isScreenShareEnabled: false,
    isScreenSharePending: false,
    canShareScreen: true,
    toggleOutputMuteFromGesture: vi.fn(),
    toggleMute: vi.fn(),
    toggleCamera: vi.fn(),
    toggleScreenShare: vi.fn(),
    leave: vi.fn(),
    join: vi.fn(),
    refreshDevices: vi.fn(),
    toggleParticipantLocalMute: vi.fn(),
    handleCallEndedEvent: vi.fn(),
    handleParticipantLeftEvent: vi.fn(),
    getAudioLevel: vi.fn(() => 0),
    isInAnyCall: false,
    isInCall: vi.fn((roomId: string) => roomId === 'storybook-call-room'),
    participants: [] as unknown[]
  },
  remoteVoiceCallState: {
    connected: false,
    reconnecting: false,
    roomId: null as string | null,
    targetRoomId: null as string | null,
    callId: null as string | null,
    isMuted: false,
    isOutputMuted: false,
    audioPlaybackBlocked: false,
    isMicrophonePending: false,
    isCameraEnabled: false,
    isCameraPending: false,
    isScreenShareEnabled: false,
    isScreenSharePending: false,
    canShareScreen: true,
    toggleOutputMuteFromGesture: vi.fn(),
    toggleMute: vi.fn(),
    toggleCamera: vi.fn(),
    toggleScreenShare: vi.fn(),
    leave: vi.fn(),
    refreshDevices: vi.fn(),
    isInAnyCall: false
  },
  roomsState: {
    currentUserId: 'user-1',
    rooms: [
      {
        id: 'room-1',
        name: 'general',
        type: 'CHANNEL',
        members: []
      }
    ] as MockRoom[]
  },
  remoteRoomsState: {
    currentUserId: 'remote-user-1',
    rooms: [
      {
        id: 'remote-room',
        name: 'operations',
        type: 'CHANNEL',
        members: []
      }
    ] as MockRoom[]
  },
  permissionsState: {
    loaded: true,
    canViewAdmin: false,
    canStartDMs: false,
    canAdminViewUsers: false,
    canAdminManageAccounts: false,
    canAssignRoles: false,
    canAdminViewRoles: false,
    canAdminManageRoles: false,
    canAdminViewSystem: false,
    canAdminViewAudit: false
  },
  activeCallRoomsState: {
    has: vi.fn(() => false),
    load: vi.fn(),
    handleEnd: vi.fn()
  },
  callParticipantsState: {
    participants: [] as unknown[],
    load: vi.fn(),
    clear: vi.fn(),
    handleJoin: vi.fn(),
    handleLeave: vi.fn(),
    handleEnd: vi.fn()
  }
}));
const navigation = vi.hoisted(() => ({
  goto: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
  pageState: {} as Record<string, unknown>,
  getUserProfile: vi.fn()
}));

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'origin'
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    connectBaseUrl: 'https://chat.example.test',
    bearerToken: 'token'
  })
}));

vi.mock('$app/environment', () => ({ browser: true, version: 'test' }));

vi.mock('$app/state', () => ({
  navigating: { complete: null },
  page: { state: navigation.pageState }
}));

vi.mock('$app/navigation', () => ({
  goto: navigation.goto,
  pushState: (_url: string, state: Record<string, unknown>) => {
    for (const key of Object.keys(navigation.pageState)) delete navigation.pageState[key];
    Object.assign(navigation.pageState, state);
    navigation.pushState(_url, state);
  },
  replaceState: (_url: string, state: Record<string, unknown>) => {
    for (const key of Object.keys(navigation.pageState)) delete navigation.pageState[key];
    Object.assign(navigation.pageState, state);
    navigation.replaceState(_url, state);
  }
}));

vi.mock('$lib/state/server/registry.svelte', () => {
  // Browser specs can share one transformed module graph. Keep this mock a
  // stable registry superset so neighboring component specs are order-independent.
  const originStore = {
    currentUser: currentUserState,
    voiceCall: voiceCallState,
    rooms: roomsState,
    permissions: permissionsState,
    activeCallRooms: activeCallRoomsState,
    callParticipants: callParticipantsState,
    notifications: { count: 0 },
    serverInfo: { version: 'test' }
  };
  const remoteStore = {
    currentUser: currentUserState,
    voiceCall: remoteVoiceCallState,
    rooms: remoteRoomsState,
    permissions: permissionsState,
    activeCallRooms: activeCallRoomsState,
    callParticipants: callParticipantsState,
    notifications: { count: 0 },
    serverInfo: { version: 'test' }
  };
  const servers = [
    { id: 'origin', url: 'https://chat.example.test', name: 'Home' },
    { id: 'remote', url: 'https://remote.example.test', name: 'Operations' }
  ];

  return {
    serverRegistry: {
      originServer: {
        id: 'origin',
        url: 'https://chat.example.test'
      },
      servers,
      getServer: (serverId: string) => servers.find((server) => server.id === serverId),
      isOriginServer: (serverId: string) => serverId === 'origin',
      getStore: (serverId: string) => (serverId === 'remote' ? remoteStore : originStore),
      tryGetStore: (serverId: string) => (serverId === 'remote' ? remoteStore : originStore)
    }
  };
});

vi.mock('$lib/state/userProfiles.svelte', () => ({
  getLiveAvatarUrl: (_userId: string, fallback: string | null) => fallback,
  getLiveCustomStatus: (_userId: string, fallback: unknown) => fallback,
  getLiveDisplayName: (_userId: string, fallback: string) => fallback,
  getLiveLogin: (_userId: string, fallback: string) => fallback,
  getDetailedUserProfileRevision: () => 0,
  loadDetailedUserProfile: (_serverId: string, _userId: string, load: () => Promise<unknown>) =>
    load()
}));

vi.mock('$lib/api-client/memberDirectory', () => ({
  createMemberDirectoryAPI: () => ({ getUserProfile: navigation.getUserProfile }),
  mapDirectoryMember: (member: unknown) => member
}));

describe('CurrentUserBar', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    currentUserState.user = {
      id: 'user-1',
      login: 'alice',
      displayName: 'Alice',
      avatarUrl: null,
      presenceStatus: PresenceStatus.Offline,
      customStatus: null,
      hasVerifiedEmail: true,
      settings: null
    };
    presencePreference.mode = 'auto';
    presencePreference.effectiveStatus = PresenceStatus.Online;
    voiceCallState.connected = false;
    voiceCallState.reconnecting = false;
    voiceCallState.roomId = null;
    voiceCallState.targetRoomId = null;
    voiceCallState.callId = null;
    voiceCallState.isInAnyCall = false;
    voiceCallState.isMuted = false;
    voiceCallState.isOutputMuted = false;
    voiceCallState.audioPlaybackBlocked = false;
    voiceCallState.isMicrophonePending = false;
    voiceCallState.isCameraEnabled = false;
    voiceCallState.isCameraPending = false;
    voiceCallState.isScreenShareEnabled = false;
    voiceCallState.isScreenSharePending = false;
    voiceCallState.canShareScreen = true;
    voiceCallState.toggleOutputMuteFromGesture.mockClear();
    voiceCallState.toggleMute.mockClear();
    voiceCallState.toggleCamera.mockClear();
    voiceCallState.toggleScreenShare.mockClear();
    voiceCallState.leave.mockClear();
    remoteVoiceCallState.connected = false;
    remoteVoiceCallState.reconnecting = false;
    remoteVoiceCallState.roomId = null;
    remoteVoiceCallState.targetRoomId = null;
    remoteVoiceCallState.callId = null;
    remoteVoiceCallState.isInAnyCall = false;
    remoteVoiceCallState.isMuted = false;
    remoteVoiceCallState.isOutputMuted = false;
    remoteVoiceCallState.audioPlaybackBlocked = false;
    remoteVoiceCallState.isMicrophonePending = false;
    remoteVoiceCallState.isCameraEnabled = false;
    remoteVoiceCallState.isCameraPending = false;
    remoteVoiceCallState.isScreenShareEnabled = false;
    remoteVoiceCallState.isScreenSharePending = false;
    remoteVoiceCallState.canShareScreen = true;
    remoteVoiceCallState.toggleOutputMuteFromGesture.mockClear();
    remoteVoiceCallState.toggleMute.mockClear();
    remoteVoiceCallState.toggleCamera.mockClear();
    remoteVoiceCallState.toggleScreenShare.mockClear();
    remoteVoiceCallState.leave.mockClear();
    remoteVoiceCallState.refreshDevices.mockClear();
    navigation.goto.mockClear();
    navigation.pushState.mockClear();
    navigation.replaceState.mockClear();
    navigation.getUserProfile.mockReset();
    navigation.getUserProfile.mockResolvedValue({
      user: { ...currentUserState.user, deleted: false },
      roles: [],
      joinedAt: '2026-01-01T00:00:00.000Z',
      biographyMarkdown: '',
      lastActivity: null,
      lastActivityVisible: true,
      viewerIsSelf: true,
      viewerCanMessage: false,
      viewerCanCall: false
    });
    for (const key of Object.keys(navigation.pageState)) delete navigation.pageState[key];
    roomsState.currentUserId = 'user-1';
    roomsState.rooms = [
      {
        id: 'room-1',
        name: 'general',
        type: 'CHANNEL',
        members: []
      }
    ];
    sidebarNav.setMobile(false);
    sidebarNav.open();
  });

  it('uses the seeded presence cache instead of the first-login offline fallback', () => {
    const { container } = render(CurrentUserBarTestHarness);

    expect(q(container, '[aria-label="Presence: Online"]')).toBeTruthy();
    expect(q(container, '[aria-label="Offline"]')).toBeFalsy();
    const presenceDot = q(
      container,
      '[data-testid="current-user-presence-menu"] [aria-label="Online"] span'
    )!;
    expect(presenceDot.className).toContain('bg-presence-online');
    expect(container.textContent).toContain('Alice');
    expect(container.textContent).toContain('@alice');
  });

  it('uses the presence cache instead of local presence preference for the current user dot', () => {
    presencePreference.effectiveStatus = PresenceStatus.Away;

    const { container } = render(CurrentUserBarTestHarness);

    expect(q(container, '[aria-label="Presence: Online"]')).toBeTruthy();
    const presenceDot = q(
      container,
      '[data-testid="current-user-presence-menu"] [aria-label="Online"] span'
    )!;
    expect(presenceDot.className).toContain('bg-presence-online');
    expect(presenceDot.className).not.toContain('bg-presence-away');
  });

  it('renders the current user dot from the seeded away presence cache value', () => {
    presencePreference.effectiveStatus = PresenceStatus.Online;

    const { container } = render(CurrentUserBarTestHarness, {
      cachedPresence: PresenceStatus.Away
    });

    expect(q(container, '[aria-label="Presence: Away"]')).toBeTruthy();
    const presenceDot = q(
      container,
      '[data-testid="current-user-presence-menu"] [aria-label="Away"] span'
    )!;
    expect(presenceDot.className).toContain('bg-presence-away');
  });

  it('opens the current user profile from the identity area', async () => {
    const { container } = render(CurrentUserBarTestHarness);

    (q(container, '[data-testid="current-user-identity-text"]') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(q(container, '[data-testid="user-profile-dialog"]')).toBeTruthy();
      expect(container.textContent).toContain('Edit profile');
    });
    expect(navigation.getUserProfile).toHaveBeenCalledWith('user-1');
  });

  it('keeps the username line when display name and username match', () => {
    currentUserState.user = {
      ...currentUserState.user!,
      displayName: 'alice',
      login: 'alice'
    };

    const { container } = render(CurrentUserBarTestHarness);

    const card = q(container, '[data-testid="current-user-identity-card"]')!;
    expect(card.textContent).toContain('alice');
    expect(card.textContent).toContain('@alice');
  });

  it('opens the combined presence menu with a custom status action from the avatar', async () => {
    const { container } = render(CurrentUserBarTestHarness);

    (q(container, '[data-testid="current-user-presence-menu"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Do Not Disturb');
      expect(container.textContent).toContain('Look offline');
      expect(container.textContent).toContain('Set custom status');
      expect(q(container, '[data-testid="custom-status-editor"]')).toBeFalsy();
    });
    expect(q(container, '[data-testid="current-user-edit-status"]')).toBeFalsy();
  });

  it('renders the away presence menu dot in yellow', async () => {
    const { container } = render(CurrentUserBarTestHarness);

    (q(container, '[data-testid="current-user-presence-menu"]') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      const awayOption = Array.from(container.querySelectorAll('[role="menuitemradio"]')).find(
        (item) => item.textContent?.includes('Away')
      )!;
      const awayDot = awayOption.querySelector('.rounded-full')!;
      const yellow500 = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue('--color-yellow-500')
        .trim();

      expect(awayDot.className).toContain('bg-presence-away');
      expect(window.getComputedStyle(awayDot).backgroundColor).toBe(
        computedBackgroundColor(yellow500)
      );
    });
  });

  it('closes the presence menu after choosing a presence mode', async () => {
    const { container } = render(CurrentUserBarTestHarness);

    (q(container, '[data-testid="current-user-presence-menu"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Away');
    });

    (q(container, '[role="menuitemradio"][aria-checked="false"]') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('Do Not Disturb');
    });
    expect(presencePreference.mode).toBe('away');
  });

  it('opens the custom status dialog from the status menu', async () => {
    currentUserState.user = {
      ...currentUserState.user!,
      customStatus: {
        emoji: '🍜',
        text: 'chatto:status:out_for_lunch',
        expiresAt: null
      }
    };

    const { container } = render(CurrentUserBarTestHarness);

    (q(container, '[data-testid="current-user-presence-menu"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(q(container, '[data-testid="current-user-custom-status-action"]')).toBeTruthy();
    });

    (
      q(container, '[data-testid="current-user-custom-status-action"]') as HTMLButtonElement
    ).click();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Set a status');
      expect(container.textContent).toContain('Suggestions');
      expect(container.textContent).toContain('Clear Status');
      expect(q(container, '[data-testid="custom-status-editor"]')).toBeTruthy();
    });
  });

  it('shows the custom status emoji next to the display name, not on the avatar', () => {
    currentUserState.user = {
      ...currentUserState.user!,
      customStatus: {
        emoji: '🍜',
        text: 'chatto:status:out_for_lunch',
        expiresAt: null
      }
    };

    const { container } = render(CurrentUserBarTestHarness);

    expect(container.querySelectorAll('[aria-label="🍜 Out for lunch"]')).toHaveLength(1);
    expect(q(container, '[data-testid="current-user-identity-card"]')!.textContent).toContain('🍜');
    expect(q(container, '[data-testid="current-user-identity-card"]')!.textContent).not.toContain(
      'Out for lunch'
    );
  });

  it('keeps the identity card at the compact composer height with long profile content', () => {
    currentUserState.user = {
      ...currentUserState.user!,
      login: 'alice-with-a-very-long-login-name-that-must-truncate',
      displayName: 'Alice With A Very Long Display Name That Must Stay Inside The User Card',
      customStatus: {
        emoji: '🍜',
        text: 'chatto:status:out_for_lunch',
        expiresAt: null
      }
    };

    const { container } = render(CurrentUserBarTestHarness);
    const bar = container.firstElementChild as HTMLElement;
    bar.style.width = '224px';

    const card = q(container, '[data-testid="current-user-identity-card"]')!;
    const cardRect = card.getBoundingClientRect();
    const controlReference = document.createElement('div');
    controlReference.className = 'h-15';
    document.body.append(controlReference);
    const expectedHeight = controlReference.getBoundingClientRect().height;
    controlReference.remove();

    expect(expectedHeight).toBeGreaterThan(0);
    expect(cardRect.height).toBe(expectedHeight);
    expect(card.scrollHeight).toBeLessThanOrEqual(card.clientHeight);

    for (const child of Array.from(card.children)) {
      const rect = child.getBoundingClientRect();
      expect(rect.top).toBeGreaterThanOrEqual(cardRect.top);
      expect(rect.bottom).toBeLessThanOrEqual(cardRect.bottom);
    }

    const presenceButton = q(card, '[data-testid="current-user-presence-menu"]')!;
    const avatar = q(presenceButton, '[aria-label]')!;
    const identityText = q(card, '[data-testid="current-user-identity-text"]')!;
    const settingsLink = q(card, 'a[href$="/settings"]')!;
    const presenceRect = presenceButton.getBoundingClientRect();
    const avatarRect = avatar.getBoundingClientRect();
    const textRect = identityText.getBoundingClientRect();
    const settingsRect = settingsLink.getBoundingClientRect();

    expect(presenceRect.left).toBeGreaterThanOrEqual(cardRect.left);
    expect(avatarRect.height).toBeLessThan(cardRect.height);
    expect(avatarRect.top - cardRect.top).toBeGreaterThanOrEqual(6);
    expect(cardRect.bottom - avatarRect.bottom).toBeGreaterThanOrEqual(6);
    expect(textRect.left).toBeGreaterThan(presenceRect.right);
    expect(settingsRect.left).toBeGreaterThan(textRect.right);
    expect(settingsRect.right).toBeLessThanOrEqual(cardRect.right);
    expect(textRect.left - presenceRect.right).toBeLessThanOrEqual(12);

    const settingsIcon = q(card, 'a[href$="/settings"] .iconify')!;
    const settingsIconRect = settingsIcon.getBoundingClientRect();
    expect(settingsIconRect.height).toBeLessThan(cardRect.height / 2);
  });

  it('hides call controls when the user is not in a call', () => {
    const { container } = render(CurrentUserBarTestHarness);

    expect(container.querySelector('[data-testid="global-call-dock"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="global-call-dock-microphone"]')).toBeFalsy();
  });

  it('composes the global call dock with identity and controls the real session', async () => {
    voiceCallState.connected = true;
    voiceCallState.isInAnyCall = true;
    voiceCallState.roomId = 'room-1';
    voiceCallState.targetRoomId = 'room-1';
    voiceCallState.callId = 'call-1';

    const { container } = render(CurrentUserBarTestHarness);

    expect(q(container, '[data-testid="global-call-dock"]')).toBeTruthy();
    expect(q(container, '[data-call-dock-host="sidebar"]')).toBeTruthy();
    expect(q(container, '[data-testid="current-user-identity-card"]')).toBeTruthy();
    const link = q(container, '[data-testid="global-call-dock-return"]') as HTMLButtonElement;
    expect(link.textContent).toContain('# general');
    link.click();

    const outputButton = q(
      container,
      '[data-testid="global-call-dock-output"]'
    ) as HTMLButtonElement;
    const muteButton = q(
      container,
      '[data-testid="global-call-dock-microphone"]'
    ) as HTMLButtonElement;
    const cameraButton = q(
      container,
      '[data-testid="global-call-dock-camera"]'
    ) as HTMLButtonElement;
    const screenShareButton = q(
      container,
      '[data-testid="global-call-dock-screen-share"]'
    ) as HTMLButtonElement;
    const leaveButton = q(container, '[data-testid="global-call-dock-leave"]') as HTMLButtonElement;

    expect(muteButton.className).toContain('border-primary');
    expect(cameraButton.className).toContain('border-border');
    expect(screenShareButton.className).toContain('border-border');
    expect(leaveButton.className).toContain('border-danger');

    outputButton.click();
    muteButton.click();
    cameraButton.click();
    screenShareButton.click();
    leaveButton.click();

    expect(navigation.goto).toHaveBeenCalledWith('/chat/-/room-1');
    expect(voiceCallState.toggleOutputMuteFromGesture).toHaveBeenCalledOnce();
    expect(voiceCallState.toggleMute).toHaveBeenCalledOnce();
    expect(voiceCallState.toggleCamera).toHaveBeenCalledOnce();
    expect(voiceCallState.toggleScreenShare).toHaveBeenCalledOnce();
    expect(voiceCallState.leave).toHaveBeenCalledOnce();
  });

  it('uses the Towk accent for active media and red only for leave', () => {
    voiceCallState.connected = true;
    voiceCallState.isInAnyCall = true;
    voiceCallState.roomId = 'room-1';
    voiceCallState.targetRoomId = 'room-1';
    voiceCallState.callId = 'call-1';
    voiceCallState.isMuted = true;
    voiceCallState.isCameraEnabled = true;
    voiceCallState.isScreenShareEnabled = true;

    const { container } = render(CurrentUserBarTestHarness);

    expect(q(container, '[data-testid="global-call-dock-microphone"]')!.className).toContain(
      'border-border'
    );
    expect(q(container, '[data-testid="global-call-dock-camera"]')!.className).toContain(
      'border-primary'
    );
    expect(q(container, '[data-testid="global-call-dock-screen-share"]')!.className).toContain(
      'border-primary'
    );
    expect(q(container, '[data-testid="global-call-dock-leave"]')!.className).toContain(
      'border-danger'
    );
  });

  it('moves the one command cluster to the floating host when the sidebar closes', async () => {
    voiceCallState.connected = true;
    voiceCallState.isInAnyCall = true;
    voiceCallState.roomId = 'room-1';
    voiceCallState.targetRoomId = 'room-1';
    voiceCallState.callId = 'call-1';

    const { container } = render(CurrentUserBarTestHarness);

    expect(container.querySelectorAll('[data-testid="global-call-dock"]')).toHaveLength(1);
    expect(q(container, '[data-call-dock-host="sidebar"]')).toBeTruthy();

    sidebarNav.close();

    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-testid="global-call-dock"]')).toHaveLength(1);
      expect(q(container, '[data-call-dock-host="floating"]')).toBeTruthy();
      expect(q(container, '[data-call-dock-host="sidebar"]')).toBeFalsy();
    });

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const appRegion = q(container, '.mobile-navigation-swipe-region') as HTMLElement;
    const floatingDock = q(container, '[data-call-dock-host="floating"]') as HTMLElement;
    expect(floatingDock.className).toContain('global-call-dock-floating');
    expect(floatingDock.className).not.toContain('bottom-[calc(env(safe-area-inset-bottom)');
    const reservedHeight = Number.parseFloat(
      appRegion.style.getPropertyValue('--global-call-dock-reserved-height')
    );
    const expectedReservedHeight = Math.ceil(
      floatingDock.getBoundingClientRect().height +
        Math.max(12, Number.parseFloat(window.getComputedStyle(floatingDock).bottom))
    );
    expect(appRegion.dataset.callDockReserved).toBe('true');
    expect(reservedHeight).toBe(expectedReservedHeight);

    floatingDock.style.setProperty('--global-call-safe-area-bottom', '34px');
    await vi.waitFor(() => {
      expect(window.getComputedStyle(floatingDock).paddingBottom).toBe('34px');
    });
    window.dispatchEvent(new Event('resize'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(floatingDock.getBoundingClientRect().bottom).toBe(window.innerHeight);
    expect(
      Number.parseFloat(appRegion.style.getPropertyValue('--global-call-dock-reserved-height'))
    ).toBe(Math.ceil(floatingDock.getBoundingClientRect().height + 12));

    sidebarNav.open();
    await vi.waitFor(() => {
      expect(appRegion.isConnected).toBe(false);
      expect(appRegion.dataset.callDockReserved).toBeUndefined();
      expect(appRegion.style.getPropertyValue('--global-call-dock-reserved-height')).toBe('');
    });
  });

  it('keeps a remote-server call labeled and routes every command to its own store', async () => {
    remoteVoiceCallState.connected = true;
    remoteVoiceCallState.isInAnyCall = true;
    remoteVoiceCallState.roomId = 'remote-room';
    remoteVoiceCallState.targetRoomId = 'remote-room';
    remoteVoiceCallState.callId = 'remote-call';

    const { container } = render(CurrentUserBarTestHarness);
    const dock = q(container, '[data-testid="global-call-dock"]')!;
    expect(dock.textContent).toContain('# operations');
    expect(dock.textContent).toContain('Operations');

    (q(container, '[data-testid="global-call-dock-return"]') as HTMLButtonElement).click();
    (q(container, '[data-testid="global-call-dock-microphone"]') as HTMLButtonElement).click();

    expect(navigation.goto).toHaveBeenCalledWith('/chat/remote.example.test/remote-room');
    expect(remoteVoiceCallState.toggleMute).toHaveBeenCalledOnce();
    expect(voiceCallState.toggleMute).not.toHaveBeenCalled();
  });

  it('shows spinners on pending compact call media controls', () => {
    voiceCallState.connected = true;
    voiceCallState.isInAnyCall = true;
    voiceCallState.roomId = 'room-1';
    voiceCallState.targetRoomId = 'room-1';
    voiceCallState.callId = 'call-1';
    voiceCallState.isMicrophonePending = true;
    voiceCallState.isCameraPending = true;
    voiceCallState.isScreenSharePending = true;

    const { container } = render(CurrentUserBarTestHarness);

    for (const testId of [
      'global-call-dock-microphone',
      'global-call-dock-camera',
      'global-call-dock-screen-share'
    ]) {
      const button = q(container, `[data-testid="${testId}"]`) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(q(button, '.animate-spin.uil--spinner')).toBeTruthy();
    }
  });

  it('surfaces network recovery outside the call room and keeps hang-up available', () => {
    voiceCallState.connected = true;
    voiceCallState.isInAnyCall = true;
    voiceCallState.reconnecting = true;
    voiceCallState.roomId = 'room-1';
    voiceCallState.targetRoomId = 'room-1';
    voiceCallState.callId = 'call-1';

    const { container } = render(CurrentUserBarTestHarness);

    const dock = q(container, '[data-testid="global-call-dock"]');
    expect(dock).toBeTruthy();
    expect(dock!.textContent).toContain('Reconnecting');
    for (const testId of [
      'global-call-dock-microphone',
      'global-call-dock-camera',
      'global-call-dock-screen-share'
    ]) {
      expect((q(container, `[data-testid="${testId}"]`) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      (q(container, '[data-testid="global-call-dock-leave"]') as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('explains when this browser cannot expose screen capture to web apps', () => {
    voiceCallState.connected = true;
    voiceCallState.isInAnyCall = true;
    voiceCallState.roomId = 'room-1';
    voiceCallState.targetRoomId = 'room-1';
    voiceCallState.callId = 'call-1';
    voiceCallState.canShareScreen = false;

    const { container } = render(CurrentUserBarTestHarness);
    const screenShareButton = q(
      container,
      '[data-testid="global-call-dock-screen-share"]'
    ) as HTMLButtonElement;

    expect(screenShareButton.title).toBe(
      'This browser or web app cannot share the screen. Screen sharing remains available on supported desktop browsers.'
    );
    expect(screenShareButton.getAttribute('aria-disabled')).toBe('true');
    expect(screenShareButton.disabled).toBe(false);
    screenShareButton.click();
    expect(voiceCallState.toggleScreenShare).toHaveBeenCalledOnce();
  });

  it('uses the DM participant label for active direct-message calls', () => {
    voiceCallState.connected = true;
    voiceCallState.isInAnyCall = true;
    voiceCallState.roomId = 'dm-1';
    voiceCallState.targetRoomId = 'dm-1';
    voiceCallState.callId = 'call-dm';
    roomsState.rooms = [
      {
        id: 'dm-1',
        name: 'dm-1',
        type: 'DM',
        members: [
          {
            id: 'user-1',
            login: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            presenceStatus: PresenceStatus.Online
          },
          {
            id: 'user-2',
            login: 'bob',
            displayName: 'Bob',
            avatarUrl: null,
            presenceStatus: PresenceStatus.Online
          }
        ]
      }
    ];

    const { container } = render(CurrentUserBarTestHarness);

    const callLink = q(container, '[data-testid="global-call-dock-return"]');
    expect(callLink).toBeTruthy();
    expect(callLink!.textContent ?? '').toContain('Bob');
  });
});
