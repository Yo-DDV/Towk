import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { PresenceStatus } from '$lib/render/types';
import { q } from '$lib/test-utils';
import UserContextMenu from './UserContextMenu.svelte';

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  startDMWith: vi.fn(),
  startCallWith: vi.fn(),
  goto: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
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

vi.mock('$lib/api-client/memberDirectory', () => ({
  createMemberDirectoryAPI: () => ({ getUserProfile: mocks.getUserProfile }),
  mapDirectoryMember: (member: unknown) => member
}));

vi.mock('$lib/dm/startDM', () => ({
  startDMWith: mocks.startDMWith,
  startCallWith: mocks.startCallWith
}));

vi.mock('$lib/state/userProfiles.svelte', () => ({
  getLiveDisplayName: (_userId: string, fallback: string) => fallback,
  getLiveLogin: (_userId: string, fallback: string) => fallback,
  getLiveAvatarUrl: (_userId: string, fallback: string | null) => fallback,
  getLiveCustomStatus: (_userId: string, fallback: unknown) => fallback,
  getDetailedUserProfileRevision: () => 0,
  loadDetailedUserProfile: (_serverId: string, _userId: string, load: () => Promise<unknown>) =>
    load()
}));

vi.mock('$lib/state/presenceCache.svelte', () => ({
  getPresenceCache: () => ({
    get: (_scope: { serverId: string; userId: string }, fallback: string) => fallback
  })
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
  mocks.startDMWith.mockReset();
  mocks.startCallWith.mockReset();
  mocks.goto.mockReset();
  mocks.pushState.mockReset();
  mocks.replaceState.mockReset();
  for (const key of Object.keys(mocks.pageState)) delete mocks.pageState[key];
  mocks.getUserProfile.mockResolvedValue(profile);
});

describe('UserContextMenu', () => {
  it('loads and renders the canonical detailed profile', async () => {
    const { container } = renderMenu();

    await expect.element(q(container, '[data-testid="user-profile-dialog"]')).toBeInTheDocument();
    const dialog = container.querySelector('dialog');
    if (!dialog) throw new Error('Expected the profile dialog to be rendered.');
    expect(dialog.getAttribute('aria-label')).toBe('User profile');
    expect(dialog.querySelector('header h2')).toBeNull();
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));
    expect(container.textContent).toContain('Alice Example');
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

    const heroRoles = q(container, '[data-testid="profile-hero-roles"]');
    if (!heroRoles) throw new Error('Expected the profile hero roles to be rendered.');
    expect(heroRoles.textContent).toContain('Moderator');
    expect(heroRoles.closest('.profile-hero')).not.toBeNull();
    expect(container.querySelectorAll('.profile-section-icon').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps a polished loading state visible until the detailed profile resolves', async () => {
    let resolveProfile!: (value: typeof profile) => void;
    mocks.getUserProfile.mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );

    const { container } = renderMenu();

    await expect.element(q(container, '[data-testid="user-profile-loading"]')).toBeVisible();
    expect(container.textContent).toContain('Alice Example');

    resolveProfile(profile);
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));
  });

  it('renders a bounded error state when profile details cannot be loaded', async () => {
    mocks.getUserProfile.mockRejectedValue(new Error('network'));

    const { container } = renderMenu();

    await vi.waitFor(() => expect(container.textContent).toContain('Could not load this profile.'));
    expect(q(container, '[data-testid="user-profile-error"]')).toBeTruthy();
    expect(container.textContent).toContain('Alice Example');
  });

  it('opens direct messages and calls from capability-filtered actions', async () => {
    const { container } = renderMenu();
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    buttonByText(container, 'Send Message').click();
    await vi.waitFor(() => expect(mocks.startDMWith).toHaveBeenCalledWith('server-1', 'user-1'));

    const second = renderMenu();
    await vi.waitFor(() => expect(second.container.textContent).toContain('Moderator'));
    buttonByText(second.container, 'Call').click();
    await vi.waitFor(() => expect(mocks.startCallWith).toHaveBeenCalledWith('server-1', 'user-1'));
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

  it('does not expose message or call actions for deleted users', async () => {
    mocks.getUserProfile.mockResolvedValue({
      ...profile,
      user: { ...profile.user, deleted: true },
      viewerCanMessage: true,
      viewerCanCall: true
    });
    const { container } = renderMenu();
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    expect(container.textContent).not.toContain('Send Message');
    expect(buttonByText.bind(null, container, 'Call')).toThrow();
  });

  it('offers profile editing only for the authenticated user', async () => {
    mocks.getUserProfile.mockResolvedValue({ ...profile, viewerIsSelf: true });
    const { container } = renderMenu();
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

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
