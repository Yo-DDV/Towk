import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { PresenceStatus } from '$lib/render/types';
import { q } from '$lib/test-utils';
import UserContextMenu from './UserContextMenu.svelte';

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  getLiveDisplayName: vi.fn(),
  getLiveLogin: vi.fn(),
  getLiveCustomStatus: vi.fn(),
  getPresence: vi.fn(),
  startDMWith: vi.fn(),
  startCallWith: vi.fn(),
  goto: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
  callJoinController: { request: vi.fn() },
  pageState: {} as Record<string, unknown>
}));

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$app/state', () => ({
  page: { state: mocks.pageState }
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto,
  pushState: (_url: string, state: Record<string, unknown>) => {
    for (const key of Object.keys(mocks.pageState)) delete mocks.pageState[key];
    Object.assign(mocks.pageState, state);
    mocks.pushState(_url, state);
  },
  replaceState: (_url: string, state: Record<string, unknown>) => {
    for (const key of Object.keys(mocks.pageState)) delete mocks.pageState[key];
    Object.assign(mocks.pageState, state);
    mocks.replaceState(_url, state);
  }
}));

vi.mock('$app/paths', () => ({
  resolve: (_route: string, params: { serverId: string }) => `/chat/${params.serverId}/settings`
}));

vi.mock('$lib/navigation', () => ({
  serverIdToSegment: (serverId: string) => serverId,
  segmentToServerId: (segment: string) => (segment === '-' ? 'server-1' : segment)
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    connectBaseUrl: '/api/connect',
    bearerToken: 'token'
  })
}));

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'server-1'
}));

vi.mock('$lib/state/callJoinController.svelte', () => ({
  getCallJoinController: () => mocks.callJoinController
}));

vi.mock('$lib/api-client/memberDirectory', () => ({
  createMemberDirectoryAPI: () => ({ getUserProfile: mocks.getUserProfile }),
  mapDirectoryMember: (member: unknown) => member
}));

vi.mock('$lib/dm/startDM', () => ({
  startDMWith: mocks.startDMWith,
  startCallWith: mocks.startCallWith
}));

vi.mock('$lib/state/userProfiles.svelte', () => ({
  getLiveDisplayName: mocks.getLiveDisplayName,
  getLiveLogin: mocks.getLiveLogin,
  getLiveAvatarUrl: (_userId: string, fallback: string | null) => fallback,
  getLiveCustomStatus: mocks.getLiveCustomStatus,
  getDetailedUserProfileRevision: () => 0,
  loadDetailedUserProfile: (_serverId: string, _userId: string, load: () => Promise<unknown>) =>
    load()
}));

vi.mock('$lib/state/presenceCache.svelte', () => ({
  getPresenceCache: () => ({ get: mocks.getPresence })
}));

const user = {
  id: 'user-1',
  login: 'alice',
  displayName: 'Alice Example',
  avatarUrl: null,
  presenceStatus: PresenceStatus.Online,
  customStatus: null
};

const profile = {
  user: { ...user, deleted: false },
  roles: [{ name: 'moderator', displayName: 'Moderator', position: 10, moderation: true }],
  joinedAt: '2026-01-01T09:00:00.000Z',
  biographyMarkdown: '**Hello** from Alice.',
  lastActivity: '2026-07-24T12:00:00.000Z',
  lastActivityVisible: true,
  viewerIsSelf: false,
  viewerCanMessage: true,
  viewerCanCall: true
};

function renderMenu(props: Record<string, unknown> = {}) {
  return render(UserContextMenu, {
    props: {
      user,
      anchorRect: { top: 10, bottom: 30, left: 20 },
      onClose: vi.fn(),
      ...props
    }
  });
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(text)
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

beforeEach(() => {
  mocks.getUserProfile.mockReset();
  mocks.getLiveDisplayName.mockReset();
  mocks.getLiveLogin.mockReset();
  mocks.getLiveCustomStatus.mockReset();
  mocks.getPresence.mockReset();
  mocks.startDMWith.mockReset();
  mocks.startCallWith.mockReset();
  mocks.goto.mockReset();
  mocks.pushState.mockReset();
  mocks.replaceState.mockReset();
  for (const key of Object.keys(mocks.pageState)) delete mocks.pageState[key];
  mocks.getLiveDisplayName.mockImplementation((_userId: string, fallback: string) => fallback);
  mocks.getLiveLogin.mockImplementation((_userId: string, fallback: string) => fallback);
  mocks.getLiveCustomStatus.mockImplementation((_userId: string, fallback: unknown) => fallback);
  mocks.getPresence.mockImplementation(
    (_scope: { serverId: string; userId: string }, fallback: PresenceStatus) => fallback
  );
  mocks.getUserProfile.mockResolvedValue(profile);
});

describe('UserContextMenu', () => {
  it('loads the canonical detailed profile into the responsive identity and content composition', async () => {
    const { container } = renderMenu();

    await expect.element(q(container, '[data-testid="user-profile-dialog"]')).toBeInTheDocument();
    const dialog = container.querySelector('dialog');
    if (!dialog) throw new Error('Expected the profile dialog to be rendered.');
    expect(dialog.getAttribute('aria-label')).toBe('User profile');
    expect(dialog.querySelector('header h2')).toBeNull();

    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    const shell = q(container, '.profile-shell');
    const identityPanel = q(container, '[data-testid="profile-identity-panel"]');
    const contentPanel = q(container, '[data-testid="profile-content-panel"]');
    const nameHeading = q(container, '[data-testid="profile-display-name"]');

    if (!shell || !identityPanel || !contentPanel || !nameHeading) {
      throw new Error('Expected the complete profile composition to be rendered.');
    }

    expect(identityPanel.tagName).toBe('SECTION');
    expect(identityPanel.getAttribute('aria-labelledby')).toBe(nameHeading.id);
    expect(identityPanel.querySelector('.profile-cover')).not.toBeNull();
    expect(identityPanel.querySelector('[data-testid="profile-hero-roles"]')).not.toBeNull();
    expect(
      identityPanel.querySelector('.profile-role-chip-moderation')?.getAttribute('title')
    ).toBe('Moderator');

    const roleList = identityPanel.querySelector<HTMLElement>('[role="list"].profile-role-list');
    if (!roleList) throw new Error('Expected an accessible role list.');
    expect(roleList.querySelectorAll('[role="listitem"]')).toHaveLength(1);

    const facts = contentPanel.querySelector<HTMLDListElement>('dl.profile-facts-grid');
    if (!facts) throw new Error('Expected account facts to use a description list.');
    expect(facts.querySelectorAll('dt')).toHaveLength(2);
    expect(facts.querySelectorAll('dd')).toHaveLength(2);
    expect(contentPanel.querySelectorAll('.profile-fact')).toHaveLength(2);
    expect(nameHeading.tagName).toBe('H2');
    expect(nameHeading.textContent).toContain('Alice Example');
    expect(container.textContent).toContain('@alice');
    expect(container.textContent).toContain('Hello');
    expect(container.textContent).toContain('Last activity');
    expect(mocks.getUserProfile).toHaveBeenCalledWith('user-1');

    const avatarShell = q(container, '[data-testid="profile-avatar-shell"]');
    if (!avatarShell) throw new Error('Expected the profile avatar shell to be rendered.');
    const avatarRect = avatarShell.getBoundingClientRect();
    expect(avatarRect.width).toBeGreaterThan(64);
    expect(Math.abs(avatarRect.width - avatarRect.height)).toBeLessThan(1);
    expect(getComputedStyle(avatarShell).borderRadius).not.toBe('0px');

    const actions = container.querySelector<HTMLElement>('[role="group"].profile-actions');
    if (!actions) throw new Error('Expected capability-filtered profile actions.');
    expect(actions.getAttribute('aria-label')).toBe('Profile actions');
  });

  it('keeps detailed identity and presence synchronized with the live caches', async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile,
      user: {
        ...profile.user,
        login: 'snapshot-login',
        displayName: 'Snapshot Identity',
        presenceStatus: PresenceStatus.Offline,
        customStatus: null
      }
    });
    mocks.getLiveDisplayName.mockReturnValue('Alice Live');
    mocks.getLiveLogin.mockReturnValue('alice-live');
    mocks.getLiveCustomStatus.mockReturnValue({
      emoji: '🧭',
      text: 'Live status',
      expiresAt: null
    });
    mocks.getPresence.mockReturnValue(PresenceStatus.Away);

    const { container } = renderMenu();
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    expect(container.textContent).toContain('Alice Live');
    expect(container.textContent).toContain('@alice-live');
    expect(container.textContent).toContain('Away');
    expect(container.textContent).toContain('Live status');
    expect(container.textContent).not.toContain('Snapshot Identity');
    expect(container.textContent).not.toContain('@snapshot-login');
  });

  it('keeps long identity, status, and role content bounded by the profile surface', async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile,
      user: {
        ...profile.user,
        login: 'alice-with-a-deliberately-long-login-for-responsive-qualification',
        displayName:
          'Alice Example With a Deliberately Long Display Name for Responsive Qualification',
        customStatus: {
          emoji: '🧭',
          text: 'Reviewing a very long localized status without clipping the surrounding profile',
          expiresAt: null
        }
      },
      roles: [
        ...profile.roles,
        {
          name: 'very-long-configured-role-name',
          displayName: 'Very long configured role name that must remain bounded',
          position: 5,
          moderation: false
        }
      ]
    });

    const { container } = renderMenu();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Very long configured role name')
    );

    const nameHeading = q(container, '[data-testid="profile-display-name"]');
    const roleLabel = container.querySelector<HTMLElement>('.profile-role-label');
    const customStatus = container.querySelector<HTMLElement>('.profile-custom-status');

    if (!nameHeading || !roleLabel || !customStatus) {
      throw new Error('Expected long-content profile affordances.');
    }

    expect(getComputedStyle(nameHeading).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(roleLabel).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(customStatus).maxWidth).toBe('100%');
  });

  it('keeps a stable loading state visible until the detailed profile resolves', async () => {
    let resolveProfile!: (value: typeof profile) => void;
    mocks.getUserProfile.mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );

    const { container } = renderMenu();

    await expect.element(q(container, '[data-testid="user-profile-loading"]')).toBeVisible();
    expect(container.textContent).toContain('Alice Example');
    expect(container.querySelectorAll('.profile-skeleton')).toHaveLength(3);

    resolveProfile(profile);
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));
  });

  it('drops stale profile data immediately when the target user changes', async () => {
    const nextUser = {
      ...user,
      id: 'user-2',
      login: 'bob',
      displayName: 'Bob Fallback'
    };
    const nextProfile = {
      ...profile,
      user: { ...nextUser, deleted: false },
      roles: [
        { name: 'helper', displayName: 'Helper', position: 5, moderation: false }
      ],
      biographyMarkdown: 'Bob profile details.'
    };
    let resolveNextProfile!: (value: typeof nextProfile) => void;

    mocks.getUserProfile.mockImplementation((userId: string) => {
      if (userId === user.id) return Promise.resolve(profile);
      return new Promise((resolve) => {
        resolveNextProfile = resolve;
      });
    });

    const { container, rerender } = renderMenu();
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    await rerender({ user: nextUser });
    await vi.waitFor(() => expect(mocks.getUserProfile).toHaveBeenCalledWith('user-2'));

    expect(container.textContent).toContain('Bob Fallback');
    expect(container.textContent).not.toContain('Alice Example');
    expect(container.textContent).not.toContain('Moderator');
    expect(q(container, '[data-testid="user-profile-loading"]')).toBeTruthy();

    resolveNextProfile(nextProfile);
    await vi.waitFor(() => expect(container.textContent).toContain('Helper'));
    expect(container.textContent).toContain('Bob profile details.');
  });

  it('fails closed when the detailed response identity does not match the requested user', async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile,
      user: {
        ...profile.user,
        id: 'unexpected-user',
        login: 'unexpected',
        displayName: 'Unexpected Identity'
      }
    });

    const { container } = renderMenu();

    await vi.waitFor(() => expect(container.textContent).toContain('Could not load this profile.'));
    expect(container.textContent).toContain('Alice Example');
    expect(container.textContent).not.toContain('Unexpected Identity');
    expect(container.textContent).not.toContain('Moderator');
    expect(q(container, '[data-testid="user-profile-error"]')).toBeTruthy();
  });

  it('renders a bounded error state while preserving fallback identity', async () => {
    mocks.getUserProfile.mockRejectedValue(new Error('network'));

    const { container } = renderMenu();

    await vi.waitFor(() => expect(container.textContent).toContain('Could not load this profile.'));
    expect(q(container, '[data-testid="user-profile-error"]')).toBeTruthy();
    expect(container.textContent).toContain('Alice Example');
    expect(container.querySelector('[data-testid="profile-identity-panel"]')).not.toBeNull();
  });

  it('opens direct messages and calls from capability-filtered actions', async () => {
    const { container } = renderMenu();
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    buttonByText(container, 'Send Message').click();
    await vi.waitFor(() => expect(mocks.startDMWith).toHaveBeenCalledWith('server-1', 'user-1'));

    const second = renderMenu();
    await vi.waitFor(() => expect(second.container.textContent).toContain('Moderator'));
    buttonByText(second.container, 'Call').click();
    await vi.waitFor(() =>
      expect(mocks.startCallWith).toHaveBeenCalledWith(
        'server-1',
        'user-1',
        mocks.callJoinController
      )
    );
  });

  it('exposes a disabled busy state while a room ban is in progress', async () => {
    const onBanFromRoom = vi.fn();
    const { container } = renderMenu({
      canBanFromRoom: true,
      banningFromRoom: true,
      onBanFromRoom
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    const action = container.querySelector<HTMLButtonElement>(
      '.profile-action[aria-busy="true"]'
    );
    if (!action) throw new Error('Expected the busy room-ban action to be rendered.');

    expect(action.disabled).toBe(true);
    expect(action.getAttribute('aria-busy')).toBe('true');
    action.click();
    expect(onBanFromRoom).not.toHaveBeenCalled();
  });

  it('does not expose a moderation action without an executable callback', async () => {
    const { container } = renderMenu({ canBanFromRoom: true });
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    expect(container.textContent).not.toContain('Ban from room');
  });

  it('uses a member fallback when no explicit role is assigned', async () => {
    mocks.getUserProfile.mockResolvedValue({ ...profile, roles: [] });
    const { container } = renderMenu();

    await vi.waitFor(() => expect(container.textContent).toContain('Member'));
  });

  it('keeps a long biography compact until the viewer expands it', async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile,
      biographyMarkdown: Array.from(
        { length: 24 },
        (_, index) =>
          `## Section ${index + 1}\n\nA useful profile paragraph with **Markdown** content.`
      ).join('\n\n')
    });
    const { container } = renderMenu();

    await vi.waitFor(() => expect(container.textContent).toContain('Show full biography'));
    const content = q(container, '[data-testid="profile-biography-content"]');
    if (!content) throw new Error('Expected the biography content to be rendered.');
    expect(content.classList.contains('profile-biography-content-collapsed')).toBe(true);

    buttonByText(container, 'Show full biography').click();
    await vi.waitFor(() =>
      expect(content.classList.contains('profile-biography-content-collapsed')).toBe(false)
    );
    expect(container.textContent).toContain('Collapse biography');
  });

  it('expands a long biography before a clipped link receives keyboard focus', async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile,
      biographyMarkdown: [
        ...Array.from(
          { length: 24 },
          (_, index) => `Paragraph ${index + 1} keeps the biography preview deliberately long.`
        ),
        '[Profile link](https://example.com/profile)'
      ].join('\n\n')
    });
    const { container } = renderMenu();

    await vi.waitFor(() => expect(container.textContent).toContain('Show full biography'));
    const content = q(container, '[data-testid="profile-biography-content"]');
    const link = content?.querySelector<HTMLAnchorElement>('a');
    if (!content || !link) throw new Error('Expected the long biography link to be rendered.');
    expect(content.classList.contains('profile-biography-content-collapsed')).toBe(true);

    link.focus();

    await vi.waitFor(() =>
      expect(content.classList.contains('profile-biography-content-collapsed')).toBe(false)
    );
    expect(document.activeElement).toBe(link);
    expect(container.textContent).toContain('Collapse biography');
  });

  it('keeps deleted users on their tombstone identity and hides live metadata and actions', async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile,
      user: {
        ...profile.user,
        deleted: true,
        login: 'deleted-user',
        displayName: 'Deleted account',
        customStatus: null
      },
      viewerCanMessage: true,
      viewerCanCall: true
    });
    mocks.getLiveDisplayName.mockReturnValue('Stale live identity');
    mocks.getLiveLogin.mockReturnValue('stale-live-login');
    mocks.getLiveCustomStatus.mockReturnValue({
      emoji: '⚠️',
      text: 'Stale live status',
      expiresAt: null
    });
    mocks.getPresence.mockReturnValue(PresenceStatus.Away);

    const { container } = renderMenu();
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    expect(container.textContent).toContain('Deleted account');
    expect(container.textContent).toContain('@deleted-user');
    expect(container.textContent).toContain('Offline');
    expect(container.textContent).not.toContain('Stale live identity');
    expect(container.textContent).not.toContain('stale-live-login');
    expect(container.textContent).not.toContain('Stale live status');
    expect(container.textContent).not.toContain('Away');
    expect(container.textContent).not.toContain('Send Message');
    expect(buttonByText.bind(null, container, 'Call')).toThrow();
  });

  it('offers only profile editing for the authenticated user even if capabilities are inconsistent', async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile,
      viewerIsSelf: true,
      viewerCanMessage: true,
      viewerCanCall: true
    });
    const { container } = renderMenu({ canSendMessage: true });
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    expect(container.textContent).not.toContain('Send Message');
    expect(buttonByText.bind(null, container, 'Call')).toThrow();
    buttonByText(container, 'Edit profile').click();
    await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/chat/server-1/settings'));
  });

  it('preserves the existing send callback when supplied by a caller', async () => {
    const onSendMessage = vi.fn();
    const { container } = renderMenu({ onSendMessage });
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    buttonByText(container, 'Send Message').click();

    await vi.waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    expect(mocks.startDMWith).not.toHaveBeenCalled();
  });
});
