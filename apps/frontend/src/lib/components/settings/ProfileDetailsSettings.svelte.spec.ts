import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { PresenceStatus } from '$lib/render/types';
import ProfileDetailsSettings from './ProfileDetailsSettings.svelte';

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  updateProfile: vi.fn(),
  updateSettings: vi.fn(),
  invalidateDetailedUserProfile: vi.fn(),
  currentUser: {
    user: {
      id: 'user-1',
      login: 'alice',
      displayName: 'Alice',
      avatarUrl: null,
      presenceStatus: 'ONLINE' as PresenceStatus,
      customStatus: null,
      hasVerifiedEmail: true,
      settings: {
        timezone: null,
        timeFormat: 'AUTO',
        showLastActivity: true
      }
    }
  }
}));

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'server-1'
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    connectBaseUrl: '/api/connect',
    bearerToken: 'token'
  })
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    originServer: { id: 'server-1', url: 'https://example.test' },
    servers: [{ id: 'server-1', url: 'https://example.test', capabilities: [] }],
    getServer: () => ({ id: 'server-1', url: 'https://example.test', capabilities: [] }),
    getStore: () => ({ currentUser: mocks.currentUser }),
    isOriginServer: (serverId: string) => serverId === 'server-1',
    tryGetStore: () => ({ currentUser: mocks.currentUser })
  }
}));

vi.mock('$lib/api-client/memberDirectory', () => ({
  createMemberDirectoryAPI: () => ({ getUserProfile: mocks.getUserProfile })
}));

vi.mock('$lib/api-client/account', () => ({
  createAccountAPI: () => ({
    updateProfile: mocks.updateProfile,
    updateSettings: mocks.updateSettings
  })
}));

vi.mock('$lib/state/userProfiles.svelte', () => ({
  invalidateDetailedUserProfile: mocks.invalidateDetailedUserProfile
}));

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
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
  mocks.updateProfile.mockReset();
  mocks.updateSettings.mockReset();
  mocks.invalidateDetailedUserProfile.mockReset();
  mocks.currentUser.user = {
    id: 'user-1',
    login: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
    presenceStatus: PresenceStatus.Online,
    customStatus: null,
    hasVerifiedEmail: true,
    settings: {
      timezone: null,
      timeFormat: 'AUTO',
      showLastActivity: true
    }
  };
  mocks.getUserProfile.mockResolvedValue({
    user: { ...mocks.currentUser.user, deleted: false },
    roles: [],
    joinedAt: '2026-01-01T00:00:00.000Z',
    biographyMarkdown: 'Hello profile',
    lastActivity: null,
    lastActivityVisible: true,
    viewerIsSelf: true,
    viewerCanMessage: false,
    viewerCanCall: false
  });
  mocks.updateProfile.mockResolvedValue(undefined);
  mocks.updateSettings.mockResolvedValue({
    timezone: null,
    timeFormat: 'AUTO',
    showLastActivity: false
  });
});

describe('ProfileDetailsSettings', () => {
  it('loads biography and exposes the complete Markdown toolbar', async () => {
    const { container } = render(ProfileDetailsSettings);

    await vi.waitFor(() => {
      expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Hello profile');
    });
    for (const label of [
      'Bold',
      'Italic',
      'Heading',
      'Bulleted list',
      'Numbered list',
      'Quote',
      'Add link',
      'Inline code'
    ]) {
      expect(buttonByLabel(container, label)).toBeTruthy();
    }
    expect(container.textContent).toContain('Preview');
    expect(mocks.getUserProfile).toHaveBeenCalledWith('user-1');
  });

  it('renders a bounded error state instead of an infinite biography load', async () => {
    mocks.getUserProfile.mockRejectedValue(new Error('offline'));

    const { container } = render(ProfileDetailsSettings);

    await vi.waitFor(() =>
      expect(container.textContent).toContain('Could not load profile details.')
    );
    expect(container.querySelector('[data-testid="profile-details-error"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="profile-details-loading"]')).toBeNull();
  });

  it('stops the biography loading state when the current user is unavailable', async () => {
    (mocks.currentUser as { user?: unknown }).user = undefined;

    const { container } = render(ProfileDetailsSettings);

    await vi.waitFor(() =>
      expect(container.textContent).toContain('Could not load profile details.')
    );
    expect(container.querySelector('[data-testid="profile-details-loading"]')).toBeNull();
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
  });

  it('applies Markdown to the current selection and saves the source', async () => {
    const { container } = render(ProfileDetailsSettings);
    const textarea = await vi.waitFor(() => {
      const node = container.querySelector<HTMLTextAreaElement>('textarea');
      expect(node?.value).toBe('Hello profile');
      return node!;
    });

    textarea.focus();
    textarea.setSelectionRange(0, 5);
    buttonByLabel(container, 'Bold').click();
    await vi.waitFor(() => expect(textarea.value).toBe('**Hello** profile'));

    buttonByText(container, 'Save biography').click();
    await vi.waitFor(() =>
      expect(mocks.updateProfile).toHaveBeenCalledWith({ biographyMarkdown: '**Hello** profile' })
    );
    expect(mocks.invalidateDetailedUserProfile).toHaveBeenCalledWith('server-1', 'user-1');
  });

  it('saves the last-activity opt-out and updates the current viewer state', async () => {
    const { container } = render(ProfileDetailsSettings);
    const checkbox = await vi.waitFor(() => {
      const node = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(node?.checked).toBe(true);
      return node!;
    });
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="profile-details-loading"]')).toBeNull()
    );

    checkbox.click();
    await vi.waitFor(() => expect(checkbox.checked).toBe(false));
    buttonByText(container, 'Save privacy').click();

    await vi.waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({ showLastActivity: false })
    );
    expect(mocks.currentUser.user.settings?.showLastActivity).toBe(false);
    expect(mocks.invalidateDetailedUserProfile).toHaveBeenCalledWith('server-1', 'user-1');
  });
});
