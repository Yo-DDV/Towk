import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import ProfilePage from './+page.svelte';
import { q } from '$lib/test-utils';

const avatarDataUrl =
  'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';

function pngFile(width: number, height: number, name: string): File {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return new File([bytes], name, { type: 'image/png' });
}

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
  serverInfo: {
    loading: false,
    error: null,
    supportsCapability: vi.fn(() => false)
  },
  currentUser: {
    user: {
      id: 'user-1',
      login: 'alice',
      displayName: 'Alice',
      avatarUrl: null,
      viewerCanDeleteAccount: true,
      lastLoginChange: null
    },
    loading: false
  }
}));

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'origin'
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    getStore: () => ({
      currentUser: mocks.currentUser,
      serverInfo: mocks.serverInfo
    })
  }
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    isConnected: true,
    showConnectionLostBanner: false,
    connectBaseUrl: '/api/connect',
    bearerToken: null,
    client: {
      query: mocks.query,
      mutation: mocks.mutation,
      subscription: vi.fn()
    }
  })
}));

vi.mock('$lib/api-client/account', () => ({
  createAccountAPI: () => ({
    updateProfile: mocks.updateProfile,
    uploadAvatar: mocks.uploadAvatar,
    deleteAvatar: mocks.deleteAvatar
  })
}));

function settle() {
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => flushSync());
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('Profile settings page', () => {
  beforeEach(() => {
    mocks.currentUser.user = {
      id: 'user-1',
      login: 'alice',
      displayName: 'Alice',
      avatarUrl: null,
      viewerCanDeleteAccount: true,
      lastLoginChange: null
    };
    mocks.query.mockReset();
    mocks.mutation.mockReset();
    mocks.updateProfile.mockReset();
    mocks.updateProfile.mockImplementation((input) =>
      Promise.resolve({
        id: 'user-1',
        displayName: input.displayName ?? mocks.currentUser.user!.displayName,
        login: input.login ?? mocks.currentUser.user!.login,
        avatarUrl: mocks.currentUser.user!.avatarUrl
      })
    );
    mocks.uploadAvatar.mockReset();
    mocks.uploadAvatar.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      login: 'alice',
      avatarUrl: avatarDataUrl
    });
    mocks.deleteAvatar.mockReset();
  });

  it('renders the current profile and keeps Save disabled until a field changes', async () => {
    const { container } = render(ProfilePage);
    await settle();

    const displayNameInput = q(
      container,
      'input[placeholder="Enter your display name"]'
    ) as HTMLInputElement;
    const usernameInput = q(container, '[data-testid="settings-username"]') as HTMLInputElement;
    const saveButton = q(container, 'button[type="submit"]') as HTMLButtonElement;

    await expect.element(displayNameInput).toHaveValue('Alice');
    await expect.element(usernameInput).toHaveValue('alice');
    await expect.element(saveButton).toBeDisabled();
  });

  it('submits a valid display name through the account API', async () => {
    const { container } = render(ProfilePage);
    await settle();

    const displayNameInput = q(
      container,
      'input[placeholder="Enter your display name"]'
    ) as HTMLInputElement;
    setInputValue(displayNameInput, 'Ada Lovelace');

    const saveButton = q(container, 'button[type="submit"]') as HTMLButtonElement;
    await expect.element(saveButton).toBeEnabled();
    saveButton.click();

    await vi.waitFor(() => {
      expect(mocks.updateProfile).toHaveBeenCalledWith({
        displayName: 'Ada Lovelace',
        login: undefined
      });
    });
    await expect.element(q(container, 'form')).toHaveTextContent('Profile updated successfully');
    await expect.element(displayNameInput).toHaveValue('Ada Lovelace');
  });

  it('shows client validation errors without calling the profile mutation', async () => {
    const { container } = render(ProfilePage);
    await settle();

    const displayNameInput = q(
      container,
      'input[placeholder="Enter your display name"]'
    ) as HTMLInputElement;
    setInputValue(displayNameInput, 'John  Doe');

    (q(container, 'button[type="submit"]') as HTMLButtonElement).click();

    await expect.element(q(container, 'form')).toHaveTextContent('consecutive spaces');
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('uploads an avatar through the account API', async () => {
    const { container } = render(ProfilePage);
    await settle();

    const input = q(container, 'input[type="file"]') as HTMLInputElement;
    const file = pngFile(640, 640, 'avatar.png');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file]
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(mocks.uploadAvatar).toHaveBeenCalledWith(file);
    });
    expect(mocks.currentUser.user?.avatarUrl).toBe(avatarDataUrl);
    await vi.waitFor(() => {
      const img = container.querySelector('img') as HTMLImageElement | null;
      expect(img?.src).toBe(avatarDataUrl);
    });
  });
});
