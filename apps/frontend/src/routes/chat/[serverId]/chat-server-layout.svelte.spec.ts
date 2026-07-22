import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { q, testSnippet } from '$lib/test-utils';
import { CurrentUserState } from '$lib/auth/currentUser.svelte';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    goto: vi.fn(),
    page: {
      params: { serverId: '-' } as Record<string, string | undefined>,
      url: new URL('https://chat.example.test/chat/-/room-1'),
      state: {}
    },
    reauthRequiredAt: null as number | null,
    serverStore: null as null | {
      currentUser: CurrentUserState;
    }
  }
}));

vi.mock('$app/environment', () => ({
  browser: true
}));

vi.mock('$app/state', () => ({
  page: mocks.page
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
  resolve: (path: string) => path.replace('[serverId]', mocks.page.params.serverId ?? '')
}));

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'origin'
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    originProbed: true,
    originServer: { id: 'origin' },
    tryGetStore: () => mocks.serverStore,
    getServer: () => ({ reauthRequiredAt: mocks.reauthRequiredAt })
  }
}));

vi.mock('$lib/state/server/serverConnection.svelte', () => ({
  serverConnectionManager: {
    getClient: () => ({})
  }
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  provideConnection: vi.fn()
}));

vi.mock('$lib/eventBus.svelte', () => ({
  provideEventBus: vi.fn()
}));

vi.mock('$lib/components/chat/Chrome.svelte', async () => {
  const { default: ChromeMock } = await import('./ChatServerChromeMock.svelte');
  return { default: ChromeMock };
});

import Layout from './+layout.svelte';

function currentUserState(options: { authenticated?: boolean; loading?: boolean } = {}) {
  const state = new CurrentUserState();
  state.user = options.authenticated
    ? ({
        id: 'user-1',
        login: 'yoan',
        displayName: 'Yoan'
      } as never)
    : undefined;
  state.loading = options.loading ?? false;
  return state;
}

function renderLayout() {
  return render(Layout, {
    props: {
      children: testSnippet('<div data-testid="chat-child"></div>')
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.page.params = { serverId: '-' };
  mocks.page.url = new URL('https://chat.example.test/chat/-/room-1');
  mocks.page.state = {};
  mocks.reauthRequiredAt = null;
  mocks.serverStore = {
    currentUser: currentUserState({ authenticated: true, loading: false })
  };
});

describe('chat server layout auth shell stability', () => {
  it('keeps the chat chrome mounted during a transient current-user reload after authentication', async () => {
    const { container } = renderLayout();

    await tick();
    expect(q(container, '[data-testid="chat-chrome"]')).not.toBeNull();

    mocks.serverStore!.currentUser.user = undefined;
    mocks.serverStore!.currentUser.loading = true;
    await tick();

    expect(q(container, '[data-testid="chat-chrome"]')).not.toBeNull();
    expect(mocks.goto).not.toHaveBeenCalled();

    mocks.serverStore!.currentUser.loading = false;
    await tick();

    expect(q(container, '[data-testid="chat-chrome"]')).toBeNull();
    expect(mocks.goto).toHaveBeenCalledWith('/login', { replaceState: true });
  });

  it('does not mount the chat chrome for the first unauthenticated loading state', async () => {
    mocks.serverStore = {
      currentUser: currentUserState({ authenticated: false, loading: true })
    };

    const { container } = renderLayout();

    await tick();
    expect(q(container, '[data-testid="chat-chrome"]')).toBeNull();
    expect(q(container, '[data-testid="chat-child"]')).not.toBeNull();
  });
});
