import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { PresenceStatus } from '$lib/render/types';
import { q } from '$lib/test-utils';
import UserContextMenu from './UserContextMenu.svelte';

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  startDMWith: vi.fn(),
  startCallWith: vi.fn()
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
  getLiveCustomStatus: (_userId: string, fallback: unknown) => fallback
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
  mocks.getUserProfile.mockResolvedValue(profile);
});

describe('UserContextMenu', () => {
  it('loads and renders the canonical detailed profile', async () => {
    const { container } = renderMenu();

    await expect.element(q(container, '[data-testid="user-profile-dialog"]')).toBeInTheDocument();
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));
    expect(container.textContent).toContain('Alice Example');
    expect(container.textContent).toContain('@alice');
    expect(container.textContent).toContain('Hello');
    expect(container.textContent).toContain('Last activity');
    expect(mocks.getUserProfile).toHaveBeenCalledWith('user-1');
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

  it('preserves the existing send callback when supplied by a caller', async () => {
    const onSendMessage = vi.fn();
    const { container } = renderMenu({ onSendMessage });
    await vi.waitFor(() => expect(container.textContent).toContain('Moderator'));

    buttonByText(container, 'Send Message').click();

    await vi.waitFor(() => expect(onSendMessage).toHaveBeenCalledOnce());
    expect(mocks.startDMWith).not.toHaveBeenCalled();
  });
});
