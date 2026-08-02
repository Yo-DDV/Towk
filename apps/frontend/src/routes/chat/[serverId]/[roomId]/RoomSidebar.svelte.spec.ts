import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { q } from '$lib/test-utils';
import { loadLocaleMessages } from '$lib/i18n/messages';
import { setReactiveLocale } from '$lib/i18n/state.svelte';
import { ROOM_MEMBERS_PAGE_SIZE, type RoomMember } from '$lib/state/room/members.svelte';
import type { PresenceCache } from '$lib/state/presenceCache.svelte';
import type { RoomData } from '$lib/hooks/useRoomData.svelte';
import { PresenceStatus } from '$lib/render/types';
import { RoomKind } from '@towk/api-types/api/v1/rooms_pb';
import { callFullscreenMedia } from '$lib/state/callFullscreenMedia.svelte';
import RoomSidebarTestHarness from './RoomSidebarTestHarness.svelte';
import type { ServerRole } from '$lib/api-client/roles';

const queryMock = vi.hoisted(() => vi.fn());
const memberDirectoryMocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  listRoomMembers: vi.fn()
}));
const attachmentMocks = vi.hoisted(() => ({
  listRoomAttachments: vi.fn(),
  refreshAssetUrls: vi.fn()
}));
const navigationMocks = vi.hoisted(() => ({
  goto: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
  pageState: {} as Record<string, unknown>
}));
const callStore = vi.hoisted(() => ({
  voiceCall: {
    roomId: null as string | null,
    connecting: false,
    connected: false,
    isInAnyCall: false,
    isMuted: false,
    isCameraEnabled: false,
    isScreenShareEnabled: false,
    canShareScreen: true,
    participants: [] as Array<{
      identity: string;
      name: string;
      login: string;
      avatarUrl: string | null;
      isMuted: boolean;
      isLocal: boolean;
      isLocallyMuted?: boolean;
      connectionQuality: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';
      isCameraEnabled: boolean;
      videoTrack: unknown;
      isScreenShareEnabled: boolean;
      screenShareTrack: unknown;
    }>,
    audioDevices: [],
    audioOutputDevices: [],
    videoDevices: [],
    selectedDeviceId: null,
    selectedOutputDeviceId: null,
    selectedVideoDeviceId: null,
    isInCall: vi.fn(
      (roomId: string) => callStore.voiceCall.connected && callStore.voiceCall.roomId === roomId
    ),
    isJoiningRoom: vi.fn((roomId: string) => callStore.voiceCall.connecting && roomId === 'room-1'),
    join: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    toggleMute: vi.fn().mockResolvedValue(undefined),
    toggleCamera: vi.fn().mockResolvedValue(undefined),
    toggleScreenShare: vi.fn().mockResolvedValue(undefined),
    setParticipantMediaExpanded: vi.fn(),
    toggleParticipantLocalMute: vi.fn(),
    refreshDevices: vi.fn().mockResolvedValue(undefined),
    getAudioLevel: vi.fn((_identity?: string) => ({ isSpeaking: false, audioLevel: 0 })),
    subscribeAudioLevels: vi.fn(() => () => undefined),
    handleParticipantLeftEvent: vi.fn(),
    handleCallEndedEvent: vi.fn()
  },
  activeCallRooms: {
    active: false,
    load: vi.fn().mockResolvedValue(undefined),
    has: vi.fn(() => callStore.activeCallRooms.active),
    getParticipantCallPresenceInAnyRoom: vi.fn((_userId: string): 'voice' | 'video' | null => null),
    handleEnd: vi.fn()
  },
  callParticipants: {
    participants: [] as Array<{
      userId: string;
      displayName: string;
      login: string;
      avatarUrl: string | null;
    }>,
    load: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    handleJoin: vi.fn(),
    handleLeave: vi.fn(),
    handleEnd: vi.fn()
  },
  rooms: {
    currentUserId: 'viewer'
  },
  handleVoiceCallJoinFailed: vi.fn()
}));

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly callback: IntersectionObserverCallback;
  readonly elements = new Set<Element>();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
  }

  trigger(isIntersecting = true) {
    const entries = Array.from(this.elements).map((target) => ({
      isIntersecting,
      target
    }));
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

vi.mock('$lib/hooks/useEvent.svelte', () => ({
  useEvent: vi.fn(),
  usePresenceChange: vi.fn()
}));

vi.mock('$lib/hooks', () => ({
  useEvent: vi.fn()
}));

vi.mock('$lib/components/menus/UserContextMenu.svelte', async () => {
  const { default: UserContextMenuMock } = await import('./RoomSidebarUserContextMenuMock.svelte');
  return { default: UserContextMenuMock };
});

vi.mock('$app/state', () => ({
  navigating: { complete: null },
  page: { state: navigationMocks.pageState }
}));

vi.mock('$app/navigation', () => ({
  goto: navigationMocks.goto,
  pushState: (_url: string, state: Record<string, unknown>) => {
    for (const key of Object.keys(navigationMocks.pageState)) delete navigationMocks.pageState[key];
    Object.assign(navigationMocks.pageState, state);
    navigationMocks.pushState(_url, state);
  },
  replaceState: (_url: string, state: Record<string, unknown>) => {
    for (const key of Object.keys(navigationMocks.pageState)) delete navigationMocks.pageState[key];
    Object.assign(navigationMocks.pageState, state);
    navigationMocks.replaceState(_url, state);
  }
}));

vi.mock('$app/paths', () => ({
  resolve: (_route: string, params: { serverId: string }) => `/chat/${params.serverId}/settings`
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    serverId: 'test-server',
    connectBaseUrl: 'https://chat.example.test/api/connect',
    bearerToken: 'test-token',
    isConnected: true,
    showConnectionLostBanner: false,
    client: {
      query: (...args: unknown[]) => {
        const result = queryMock(...args);
        return Object.assign(result, {
          toPromise: () => result
        });
      },
      mutation: vi.fn(),
      subscription: vi.fn()
    }
  })
}));

vi.mock('$lib/api-client/attachments', () => ({
  createAttachmentAPI: vi.fn(() => ({
    listRoomAttachments: attachmentMocks.listRoomAttachments,
    refreshAssetUrls: attachmentMocks.refreshAssetUrls
  }))
}));

vi.mock('$lib/api-client/memberDirectory', async (importActual) => ({
  ...(await importActual<typeof import('$lib/api-client/memberDirectory')>()),
  createMemberDirectoryAPI: vi.fn(() => ({
    getUserProfile: memberDirectoryMocks.getUserProfile,
    listRoomMembers: memberDirectoryMocks.listRoomMembers
  }))
}));

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'test-server'
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    getStore: () => callStore,
    getServer: () => ({ id: 'test-server', url: 'https://chat.example.test' })
  }
}));

vi.mock('$lib/state/server/permissions.svelte', () => ({
  getServerPermissions: () => ({
    current: {
      canStartDMs: false
    }
  })
}));

vi.mock('$lib/state/userProfiles.svelte', () => ({
  getLiveAvatarUrl: (_userId: string, fallback: string | null) => fallback,
  getLiveCustomStatus: (_userId: string, fallback: unknown) => fallback,
  getLiveDisplayName: (_userId: string, fallback: string) => fallback,
  getLiveLogin: (_userId: string, fallback: string) => fallback,
  getDetailedUserProfileRevision: () => 0,
  loadDetailedUserProfile: (_serverId: string, _userId: string, load: () => Promise<unknown>) =>
    load()
}));

function member(index: number, roles: string[] = []): RoomMember {
  return {
    id: `user-${index}`,
    login: `user${index}`,
    displayName: `User ${index}`,
    avatarUrl: null,
    presenceStatus: PresenceStatus.Online,
    roles
  };
}

function serverRole(
  name: string,
  displayName: string,
  position: number,
  color: string
): ServerRole {
  return {
    name,
    displayName,
    description: '',
    permissions: [],
    permissionDenials: [],
    isSystem: ['owner', 'admin', 'moderator', 'everyone'].includes(name),
    position,
    pingable: false,
    color
  };
}

function buttonByText(container: Element, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text)
  );
}

function renderedMemberTitles(container: Element): string[] {
  return Array.from(container.querySelectorAll('[title^="View profile of "]')).map(
    (element) => element.getAttribute('title') ?? ''
  );
}

function presenceBadge(container: Element, label: string): Element | null {
  return container.querySelector(`[aria-label="${label}"]`);
}

function roomFileGroupHeadings(container: Element): string[] {
  return Array.from(container.querySelectorAll('[data-testid="room-file-group-heading"]')).map(
    (element) => element.textContent?.trim() ?? ''
  );
}

function roomFileRowLabels(container: Element): string[] {
  return Array.from(container.querySelectorAll('[data-testid="room-file-row"]')).map(
    (element) => element.textContent?.trim() ?? ''
  );
}

async function flushRoomFilesPanel(): Promise<void> {
  await tick();
  await Promise.resolve();
  await tick();
  await Promise.resolve();
  await tick();
}

async function waitForMemberSearchDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await tick();
}

function roomData(members: RoomMember[], totalCount: number, hasMore: boolean): RoomData {
  void members;
  void totalCount;
  void hasMore;
  return {
    room: {
      id: 'room-1',
      name: 'general',
      type: RoomKind.CHANNEL,
      isUniversal: false,
      isLocked: false,
      historyEpoch: 0n,
      revision: 1n
    },
    spaceName: 'Test Server',
    canPostMessage: true,
    canPostInThread: true,
    canAttach: true,
    canVoice: true,
    canReact: true,
    canManageOthersMessage: false,
    canEchoMessage: false,
    canManageRoom: false,
    canBanRoomMembers: false,
    canLockRoom: false,
    canPurgeMessages: false,
    canBypassLock: false
  };
}

function mockRoomMembers(members: RoomMember[], totalCount = members.length, hasMore = false) {
  memberDirectoryMocks.listRoomMembers.mockResolvedValue(memberPage(members, totalCount, hasMore));
}

function memberPage(members: RoomMember[], totalCount = members.length, hasMore = false) {
  return {
    members: members.map((member) => ({
      ...member,
      deleted: member.deleted ?? false,
      avatarUrl: member.avatarUrl ?? null,
      customStatus: member.customStatus ?? null,
      roles: member.roles ?? [],
      createdAt: null
    })),
    totalCount,
    hasMore
  };
}

function roomFile(
  messageEventId: string,
  threadRootEventId: string | null,
  filename: string,
  createdAt = '2026-06-15T12:00:00Z'
) {
  return {
    messageEventId,
    threadRootEventId,
    createdAt,
    attachment: {
      id: `att-${filename}`,
      filename,
      contentType: 'text/plain',
      width: 0,
      height: 0,
      assetUrl: {
        url: `/assets/files/att-${filename}?access=ticket`,
        expiresAt: '2099-01-01T00:00:00Z'
      },
      thumbnailAssetUrl: null,
      videoProcessing: null,
      voiceMessage: null
    }
  };
}

function roomVideoFile(filename: string) {
  const base = roomFile('video-message', null, filename);
  return {
    ...base,
    attachment: {
      ...base.attachment,
      contentType: 'video/mp4',
      thumbnailAssetUrl: {
        url: `/assets/files/att-${filename}/image/120x120/cover?access=broken`,
        expiresAt: '2099-01-01T00:00:00Z'
      },
      videoProcessing: {
        status: 'COMPLETED',
        thumbnailAssetUrl: {
          url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      }
    }
  };
}

function roomAudioFile(filename: string) {
  const base = roomFile('audio-message', null, filename);
  return {
    ...base,
    attachment: {
      ...base.attachment,
      contentType: 'audio/mpeg',
      thumbnailAssetUrl: {
        url: `/assets/files/att-${filename}/image/120x120/cover?access=broken`,
        expiresAt: '2099-01-01T00:00:00Z'
      }
    }
  };
}

function roomVoiceFile(filename: string) {
  const base = roomAudioFile(filename);
  return {
    ...base,
    attachment: {
      ...base.attachment,
      contentType: 'audio/webm;codecs=opus',
      voiceMessage: { durationMs: 65_000, waveformPeaks: [0.1, 0.8, 0.3] }
    }
  };
}

describe('RoomSidebar', () => {
  beforeEach(async () => {
    callFullscreenMedia.close();
    await loadLocaleMessages('en');
    setReactiveLocale('en');
    queryMock.mockReset();
    memberDirectoryMocks.getUserProfile.mockReset();
    memberDirectoryMocks.listRoomMembers.mockReset();
    attachmentMocks.listRoomAttachments.mockReset();
    attachmentMocks.refreshAssetUrls.mockReset();
    memberDirectoryMocks.getUserProfile.mockResolvedValue({
      user: { ...member(1), deleted: false },
      roles: [],
      joinedAt: '2026-01-01T00:00:00.000Z',
      biographyMarkdown: '',
      lastActivity: null,
      lastActivityVisible: true,
      viewerIsSelf: false,
      viewerCanMessage: false,
      viewerCanCall: false
    });
    memberDirectoryMocks.listRoomMembers.mockResolvedValue(memberPage([member(1)]));
    attachmentMocks.listRoomAttachments.mockResolvedValue({
      items: [],
      totalCount: 0,
      hasMore: false
    });
    attachmentMocks.refreshAssetUrls.mockResolvedValue(new Map());
    queryMock.mockResolvedValue({
      data: {
        room: {
          members: {
            users: [member(1)],
            totalCount: 1,
            hasMore: false
          }
        }
      },
      error: null
    });
    localStorage.clear();
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    callStore.voiceCall.roomId = null;
    callStore.voiceCall.connecting = false;
    callStore.voiceCall.connected = false;
    callStore.voiceCall.isInAnyCall = false;
    callStore.voiceCall.isMuted = false;
    callStore.voiceCall.isCameraEnabled = false;
    callStore.voiceCall.isScreenShareEnabled = false;
    callStore.voiceCall.canShareScreen = true;
    callStore.voiceCall.participants = [];
    callStore.voiceCall.isInCall.mockClear();
    callStore.voiceCall.isJoiningRoom.mockClear();
    callStore.voiceCall.join.mockClear();
    callStore.voiceCall.leave.mockClear();
    callStore.voiceCall.toggleMute.mockClear();
    callStore.voiceCall.toggleCamera.mockClear();
    callStore.voiceCall.toggleScreenShare.mockClear();
    callStore.voiceCall.toggleParticipantLocalMute.mockClear();
    callStore.voiceCall.refreshDevices.mockClear();
    callStore.voiceCall.getAudioLevel.mockClear();
    callStore.voiceCall.subscribeAudioLevels.mockClear();
    callStore.voiceCall.getAudioLevel.mockImplementation(() => ({
      isSpeaking: false,
      audioLevel: 0
    }));
    callStore.activeCallRooms.active = false;
    callStore.activeCallRooms.load.mockClear();
    callStore.activeCallRooms.has.mockClear();
    callStore.activeCallRooms.getParticipantCallPresenceInAnyRoom.mockClear();
    callStore.activeCallRooms.getParticipantCallPresenceInAnyRoom.mockReturnValue(null);
    callStore.callParticipants.participants = [];
    callStore.callParticipants.load.mockClear();
    callStore.callParticipants.clear.mockClear();
    callStore.callParticipants.handleJoin.mockClear();
    callStore.callParticipants.handleLeave.mockClear();
    callStore.callParticipants.handleEnd.mockClear();
    callStore.handleVoiceCallJoinFailed.mockClear();
  });

  it('shows the exact total count and eagerly loads all member pages', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => member(index + 1));
    const secondPage = Array.from({ length: 42 }, (_, index) => member(index + 101));

    memberDirectoryMocks.listRoomMembers
      .mockResolvedValueOnce(memberPage(firstPage, 142, true))
      .mockResolvedValueOnce(memberPage(secondPage, 142, false));

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        roomData: roomData([], 0, false)
      }
    });

    await expect.element(q(container, 'h1')).toHaveTextContent('Members (142)');
    await vi.waitFor(() => {
      expect(memberDirectoryMocks.listRoomMembers).toHaveBeenCalledWith(
        'room-1',
        '',
        ROOM_MEMBERS_PAGE_SIZE,
        0
      );
      expect(memberDirectoryMocks.listRoomMembers).toHaveBeenCalledWith(
        'room-1',
        '',
        ROOM_MEMBERS_PAGE_SIZE,
        100
      );
    });

    await vi.waitFor(() => {
      expect(renderedMemberTitles(container)).toHaveLength(142);
    });
    for (let index = 1; index <= 142; index++) {
      expect(renderedMemberTitles(container)).toContain(`View profile of User ${index}`);
    }
    expect(container.querySelector('[data-testid="room-members-load-more-sentinel"]')).toBeFalsy();
  });

  it('shows call presence for members active in any room call on the server', async () => {
    mockRoomMembers([member(1), member(2)]);
    callStore.activeCallRooms.getParticipantCallPresenceInAnyRoom.mockImplementation(
      (userId: string) => (userId === 'user-2' ? 'voice' : null)
    );

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        roomData: roomData([], 0, false)
      }
    });

    await vi.waitFor(() => {
      expect(q(container, '[data-testid="member-call-presence-voice"]')).toBeTruthy();
    });
    expect(callStore.activeCallRooms.getParticipantCallPresenceInAnyRoom).toHaveBeenCalledWith(
      'user-2'
    );
  });

  it('separates online members by highest role and keeps role colors while offline', async () => {
    mockRoomMembers([
      member(1, ['everyone', 'moderator', 'owner']),
      member(2, ['moderator']),
      member(3, ['helpers']),
      member(4, ['everyone']),
      { ...member(5, ['owner']), presenceStatus: PresenceStatus.Offline },
      { ...member(6, ['everyone']), presenceStatus: PresenceStatus.Offline }
    ]);
    const roles = [
      serverRole('everyone', 'Everyone', 0, ''),
      serverRole('helpers', '🛟 Équipe d’aide', 10, '#2563EB'),
      serverRole('moderator', 'Moderator', 100, '#16A34A'),
      serverRole('owner', 'Owner', 1000, '#F97316')
    ];

    const { container } = render(RoomSidebarTestHarness, {
      props: { roomData: roomData([], 0, false), roles }
    });

    await vi.waitFor(() => {
      expect(buttonByText(container, 'Owner — 1')).toBeTruthy();
      expect(buttonByText(container, 'Moderator — 1')).toBeTruthy();
      expect(buttonByText(container, '🛟 Équipe d’aide — 1')).toBeTruthy();
      expect(buttonByText(container, 'Online (1)')).toBeTruthy();
      expect(buttonByText(container, 'Offline (2)')).toBeTruthy();
    });

    const userOne = container.querySelector('[title="View profile of User 1"] .role-member-name');
    expect(userOne).toBeTruthy();
    expect((userOne as HTMLElement).style.getPropertyValue('--member-role-color')).toBe('#F97316');
    expect(container.querySelectorAll('[title="View profile of User 1"]')).toHaveLength(1);
    buttonByText(container, 'Offline (2)')?.click();
    await tick();
    expect(container.querySelector('[title="View profile of User 5"]')).toBeTruthy();
    const offlineOwner = container.querySelector(
      '[title="View profile of User 5"] .role-member-name'
    );
    expect(offlineOwner).toBeTruthy();
    expect((offlineOwner as HTMLElement).style.getPropertyValue('--member-role-color')).toBe(
      '#F97316'
    );
    expect(
      container.querySelector('[title="View profile of User 6"] .role-member-name')
    ).toBeNull();
  });

  it('filters room members locally without changing the canonical total count', async () => {
    memberDirectoryMocks.listRoomMembers.mockResolvedValueOnce(
      memberPage([member(1), { ...member(2), displayName: 'Boris Member' }])
    );

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        roomData: roomData([], 0, false)
      }
    });

    await vi.waitFor(() => {
      expect(renderedMemberTitles(container)).toHaveLength(2);
    });

    const input = container.querySelector('#room-member-search') as HTMLInputElement;
    input.value = 'bor';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForMemberSearchDebounce();

    await vi.waitFor(() => {
      expect(renderedMemberTitles(container)).toEqual(['View profile of Boris Member']);
      expect(q(container, 'h1')?.textContent).toContain('Members (2)');
    });
    expect(memberDirectoryMocks.listRoomMembers).toHaveBeenCalledTimes(1);
  });

  it('clears the member search with the Towk-styled clear button without refetching', async () => {
    memberDirectoryMocks.listRoomMembers.mockResolvedValueOnce(
      memberPage([member(1), { ...member(2), displayName: 'Boris Member' }])
    );

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        roomData: roomData([], 0, false)
      }
    });

    await vi.waitFor(() => {
      expect(renderedMemberTitles(container)).toHaveLength(2);
    });

    const input = container.querySelector('#room-member-search') as HTMLInputElement;
    input.value = 'bor';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForMemberSearchDebounce();

    await vi.waitFor(() => {
      expect(renderedMemberTitles(container)).toEqual(['View profile of Boris Member']);
    });

    const clearButton = q(
      container,
      'button[aria-label="Clear member search"]'
    ) as HTMLButtonElement;
    expect(clearButton.className).toContain('pane-header-icon-button');
    clearButton.click();
    await tick();

    await vi.waitFor(() => {
      expect(input.value).toBe('');
      expect(renderedMemberTitles(container)).toHaveLength(2);
      expect(q(container, 'h1')?.textContent).toContain('Members (2)');
      expect(document.activeElement).toBe(input);
    });

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(memberDirectoryMocks.listRoomMembers).toHaveBeenCalledTimes(1);
  });

  it('shows an empty local search result without changing the canonical total count', async () => {
    memberDirectoryMocks.listRoomMembers.mockResolvedValueOnce(memberPage([member(1), member(2)]));

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        roomData: roomData([], 0, false)
      }
    });

    await vi.waitFor(() => {
      expect(renderedMemberTitles(container)).toHaveLength(2);
    });

    const input = container.querySelector('#room-member-search') as HTMLInputElement;
    input.value = 'no-match';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForMemberSearchDebounce();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('No members found.');
      expect(q(container, 'h1')?.textContent).toContain('Members (2)');
      expect(renderedMemberTitles(container)).toEqual([]);
    });

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(memberDirectoryMocks.listRoomMembers).toHaveBeenCalledTimes(1);
  });

  it('filters the loaded member directory without refetching', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    memberDirectoryMocks.listRoomMembers.mockResolvedValueOnce(
      memberPage([member(1), { ...member(2), displayName: 'Boris Member' }])
    );

    try {
      const { container } = render(RoomSidebarTestHarness, {
        props: {
          roomData: roomData([], 0, false)
        }
      });

      await vi.waitFor(() => {
        expect(renderedMemberTitles(container)).toHaveLength(2);
      });

      const input = container.querySelector('#room-member-search') as HTMLInputElement;
      input.value = 'bor';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await waitForMemberSearchDebounce();

      await vi.waitFor(() => {
        expect(renderedMemberTitles(container)).toEqual(['View profile of Boris Member']);
      });
      expect(memberDirectoryMocks.listRoomMembers).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('keeps away members present while showing the global away badge', async () => {
    let presenceCache: PresenceCache | null = null;
    const [user] = [member(1)];

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        roomData: roomData([user], 1, false),
        onPresenceCacheReady: (cache: PresenceCache) => {
          presenceCache = cache;
        }
      }
    });

    await expect.element(q(container, 'h1')).toHaveTextContent('Members (1)');
    expect(presenceBadge(container, 'Online')).toBeTruthy();
    await vi.waitFor(() => {
      expect(buttonByText(container, 'Online (1)')).toBeTruthy();
    });

    await vi.waitFor(() => {
      expect(presenceCache).toBeTruthy();
    });
    presenceCache!.update({ serverId: 'test-server', userId: user.id }, PresenceStatus.Away);
    await tick();

    expect(presenceBadge(container, 'Away')).toBeTruthy();
    expect(buttonByText(container, 'Online (1)')).toBeTruthy();

    presenceCache!.update({ serverId: 'test-server', userId: user.id }, PresenceStatus.Online);
    await tick();

    expect(presenceBadge(container, 'Online')).toBeTruthy();
    expect(buttonByText(container, 'Online (1)')).toBeTruthy();
  });

  it('calls onClose when the room extras close button is clicked', async () => {
    const onClose = vi.fn();
    const { container } = render(RoomSidebarTestHarness, {
      props: {
        roomData: roomData([member(1)], 1, false),
        onClose
      }
    });

    const closeButton = container.querySelector(
      '[aria-label="Hide room extras"]'
    ) as HTMLButtonElement | null;
    expect(closeButton).toBeTruthy();

    closeButton!.click();
    await tick();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders overlay presentation without desktop resizing chrome', async () => {
    const { container } = render(RoomSidebarTestHarness, {
      props: {
        presentation: 'overlay',
        roomData: roomData([member(1)], 1, false)
      }
    });

    const sidebar = container.querySelector('[aria-label="Room extras"]') as HTMLElement | null;
    expect(sidebar).toBeTruthy();
    expect(sidebar!.style.width).toBe('');
    expect(container.querySelector('[aria-label="Resize room extras pane"]')).toBeFalsy();
  });

  it('renders an empty files panel', async () => {
    attachmentMocks.listRoomAttachments.mockResolvedValue({
      items: [],
      totalCount: 0,
      hasMore: false
    });

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        activePanel: 'files',
        roomData: roomData([member(1)], 1, false)
      }
    });

    await expect.element(q(container, 'h1')).toHaveTextContent('Files');
    await vi.waitFor(() => {
      expect(container.textContent).toContain('No files in this room yet.');
    });
    expect(container.querySelector('[aria-label="Members"]')).toBeFalsy();
  });

  it('keeps the files panel usable when attachment loading fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    attachmentMocks.listRoomAttachments.mockRejectedValue(new Error('attachments unavailable'));

    try {
      const { container } = render(RoomSidebarTestHarness, {
        props: {
          activePanel: 'files',
          roomData: roomData([member(1)], 1, false)
        }
      });

      await expect.element(q(container, 'h1')).toHaveTextContent('Files');
      await vi.waitFor(() => {
        expect(container.textContent).toContain('No files in this room yet.');
      });
      expect(container.querySelector('[data-testid="room-files-load-more-sentinel"]')).toBeFalsy();
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('renders room files, opens their message anchors, and automatically loads more', async () => {
    const onOpenFile = vi.fn();
    attachmentMocks.listRoomAttachments
      .mockResolvedValueOnce({
        items: [roomFile('root-message', null, 'root.txt')],
        totalCount: 2,
        hasMore: true
      })
      .mockResolvedValueOnce({
        items: [roomFile('thread-message', 'thread-root', 'thread.txt')],
        totalCount: 2,
        hasMore: false
      });

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        activePanel: 'files',
        roomData: roomData([member(1)], 1, false),
        onOpenFile
      }
    });

    await expect.element(q(container, 'h1')).toHaveTextContent('Files');
    await vi.waitFor(() => {
      expect(container.textContent).toContain('root.txt');
      expect(container.querySelector('[data-testid="room-files-load-more-sentinel"]')).toBeTruthy();
      expect(MockIntersectionObserver.instances).toHaveLength(1);
    });

    buttonByText(container, 'root.txt')!.click();
    await tick();
    expect(onOpenFile).toHaveBeenCalledWith('root-message', null);

    MockIntersectionObserver.instances[0].trigger();
    await tick();

    await vi.waitFor(() => {
      expect(attachmentMocks.listRoomAttachments).toHaveBeenCalledWith({
        roomId: 'room-1',
        limit: 50,
        offset: 1,
        thumbnail: {
          width: 120,
          height: 120,
          fit: 'COVER'
        }
      });
      expect(container.textContent).toContain('thread.txt');
      expect(container.querySelector('[data-testid="room-files-load-more-sentinel"]')).toBeFalsy();
    });

    buttonByText(container, 'thread.txt')!.click();
    await tick();
    expect(onOpenFile).toHaveBeenCalledWith('thread-message', 'thread-root');
  });

  it('groups room files by date and appends loaded pages into the matching groups', async () => {
    const fileGroupingNow = new Date('2026-06-17T12:00:00Z');

    attachmentMocks.listRoomAttachments
      .mockResolvedValueOnce({
        items: [
          roomFile('today-message', null, 'today.txt', '2026-06-17T08:00:00Z'),
          roomFile('yesterday-message', null, 'yesterday.txt', '2026-06-16T08:00:00Z')
        ],
        totalCount: 5,
        hasMore: true
      })
      .mockResolvedValueOnce({
        items: [
          roomFile('week-message', null, 'week.txt', '2026-06-15T08:00:00Z'),
          roomFile('month-message', null, 'month.txt', '2026-06-10T08:00:00Z'),
          roomFile('older-month-message', null, 'older-month.txt', '2026-05-21T08:00:00Z')
        ],
        totalCount: 5,
        hasMore: false
      });

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        activePanel: 'files',
        roomData: roomData([member(1)], 1, false),
        fileGroupingNow
      }
    });

    await flushRoomFilesPanel();
    expect(roomFileGroupHeadings(container)).toEqual(['Today', 'Yesterday']);
    expect(roomFileRowLabels(container)).toHaveLength(2);
    expect(roomFileRowLabels(container)[0]).toContain('today.txt');
    expect(roomFileRowLabels(container)[1]).toContain('yesterday.txt');

    MockIntersectionObserver.instances[0].trigger();
    await flushRoomFilesPanel();

    expect(roomFileGroupHeadings(container)).toEqual([
      'Today',
      'Yesterday',
      'This week',
      'This month',
      'May 2026'
    ]);
    const labels = roomFileRowLabels(container);
    expect(labels).toHaveLength(5);
    expect(labels.filter((label) => label.includes('today.txt'))).toHaveLength(1);
    expect(labels[2]).toContain('week.txt');
    expect(labels[3]).toContain('month.txt');
    expect(labels[4]).toContain('older-month.txt');
  });

  it('localizes room file date groups with the active locale', async () => {
    await loadLocaleMessages('de');
    setReactiveLocale('de');
    const fileGroupingNow = new Date('2026-06-17T12:00:00Z');

    attachmentMocks.listRoomAttachments.mockResolvedValueOnce({
      items: [
        roomFile('today-message', null, 'today.txt', '2026-06-17T08:00:00Z'),
        roomFile('yesterday-message', null, 'yesterday.txt', '2026-06-16T08:00:00Z'),
        roomFile('week-message', null, 'week.txt', '2026-06-15T08:00:00Z'),
        roomFile('month-message', null, 'month.txt', '2026-06-10T08:00:00Z'),
        roomFile('older-month-message', null, 'older-month.txt', '2026-05-21T08:00:00Z')
      ],
      totalCount: 5,
      hasMore: false
    });

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        activePanel: 'files',
        roomData: roomData([member(1)], 1, false),
        fileGroupingNow
      }
    });

    await flushRoomFilesPanel();

    expect(roomFileGroupHeadings(container)).toEqual([
      'Heute',
      'Gestern',
      'Diese Woche',
      'Dieser Monat',
      'Mai 2026'
    ]);
  });

  it('falls back to a file icon when a video thumbnail fails to load', async () => {
    attachmentMocks.listRoomAttachments.mockResolvedValueOnce({
      items: [roomVideoFile('clip.mp4')],
      totalCount: 1,
      hasMore: false
    });
    attachmentMocks.refreshAssetUrls.mockResolvedValueOnce(new Map());

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        activePanel: 'files',
        roomData: roomData([member(1)], 1, false)
      }
    });

    await vi.waitFor(() => {
      const image = container.querySelector('img[src^="data:image/gif"]');
      expect(image).toBeTruthy();
      image!.dispatchEvent(new Event('error'));
    });

    await vi.waitFor(() => {
      expect(container.querySelector('img[src^="data:image/gif"]')).toBeFalsy();
      expect(container.querySelector('.mdi--file-video-outline')).toBeTruthy();
    });
  });

  it('renders an icon instead of a broken thumbnail for audio files', async () => {
    attachmentMocks.listRoomAttachments.mockResolvedValueOnce({
      items: [roomAudioFile('song.mp3')],
      totalCount: 1,
      hasMore: false
    });

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        activePanel: 'files',
        roomData: roomData([member(1)], 1, false)
      }
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('song.mp3');
      expect(container.querySelector('img')).toBeFalsy();
      expect(container.querySelector('.mdi--file-music-outline')).toBeTruthy();
    });
  });

  it('labels first-class voice messages without exposing their technical filename', async () => {
    attachmentMocks.listRoomAttachments.mockResolvedValueOnce({
      items: [roomVoiceFile('voice-message-20260715.webm')],
      totalCount: 1,
      hasMore: false
    });

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        activePanel: 'files',
        roomData: roomData([member(1)], 1, false)
      }
    });

    await vi.waitFor(() => {
      const labels = roomFileRowLabels(container);
      expect(labels).toHaveLength(1);
      expect(labels[0]).toContain('Voice message');
      expect(labels[0]).toContain('1:05');
      expect(labels[0]).not.toContain('voice-message-20260715.webm');
    });
  });

  it('shows the room-ban action for other members when allowed', async () => {
    mockRoomMembers([
      { ...member(0), id: 'viewer', displayName: 'Viewer' },
      { ...member(1), id: 'other', displayName: 'Other Member' }
    ]);

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        currentUserId: 'viewer',
        canBanRoomMembers: true,
        roomData: roomData([], 0, false)
      }
    });

    await vi.waitFor(() => {
      expect(buttonByText(container, 'Other Member')).toBeTruthy();
    });
    buttonByText(container, 'Other Member')!.click();
    await tick();

    expect(container.textContent).toContain('Ban from room');
  });

  it('hides the room-ban action when member moderation is disabled', async () => {
    mockRoomMembers([
      { ...member(0), id: 'viewer', displayName: 'Viewer' },
      { ...member(1), id: 'other', displayName: 'Other Member' }
    ]);

    const { container } = render(RoomSidebarTestHarness, {
      props: {
        currentUserId: 'viewer',
        canBanRoomMembers: false,
        roomData: roomData([], 0, false)
      }
    });

    await vi.waitFor(() => {
      expect(buttonByText(container, 'Other Member')).toBeTruthy();
    });
    buttonByText(container, 'Other Member')!.click();
    await tick();

    expect(container.textContent).not.toContain('Ban from room');
  });
});
