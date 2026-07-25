import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import { loadLocaleMessages } from '$lib/i18n/messages';
import { setReactiveLocale } from '$lib/i18n/state.svelte';

const GIPHY_URL = 'https://giphy.com/gifs/justin-word-oh-really-wow-QUENDfi6DEMLzQ0CKt';
const KLIPY_URL =
  'https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif';
const CAPABILITY = 'external-gif-embeds-v1';

const mocks = vi.hoisted(() => {
  const serverInfo = {
    capabilities: [] as string[],
    supportsCapability(capability: string) {
      return this.capabilities.includes(capability);
    }
  };
  const registered = {
    id: 'origin',
    url: 'https://towk.example',
    capabilities: [] as string[]
  };
  return {
    serverInfo,
    registered,
    store: {
      currentUser: { user: undefined as { login: string } | undefined },
      serverInfo
    }
  };
});

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'origin'
}));
vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    tryGetStore: () => mocks.store,
    getServer: () => mocks.registered,
    get servers() {
      return [mocks.registered];
    }
  }
}));

import MessageContent, { rendererReady } from './MessageContent.svelte';

beforeAll(async () => {
  await rendererReady;
});

beforeEach(async () => {
  mocks.serverInfo.capabilities = [];
  mocks.registered.capabilities = [];
  await loadLocaleMessages('en');
  setReactiveLocale('en');
});

describe('MessageContent external GIF capability wiring', () => {
  it('replaces the standalone GIPHY URL with the privacy card when the live store advertises support', async () => {
    mocks.serverInfo.capabilities = [CAPABILITY];
    const screen = render(MessageContent, { props: { body: GIPHY_URL } });

    await expect.element(screen.getByTestId('external-gif-embed')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Load external GIF' })).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Open source' }))
      .toHaveAttribute('href', GIPHY_URL);
    await expect.element(screen.getByRole('link', { name: GIPHY_URL })).not.toBeInTheDocument();
  });

  it('uses the registered capability while the live store is temporarily partial', async () => {
    mocks.registered.capabilities = [CAPABILITY];
    const partialStore = mocks.store as {
      currentUser: typeof mocks.store.currentUser;
      serverInfo?: typeof mocks.serverInfo;
    };
    const liveServerInfo = mocks.serverInfo;
    delete partialStore.serverInfo;

    try {
      const screen = render(MessageContent, { props: { body: GIPHY_URL } });
      await expect.element(screen.getByTestId('external-gif-embed')).toBeVisible();
      await expect.element(screen.getByRole('link', { name: GIPHY_URL })).not.toBeInTheDocument();
    } finally {
      partialStore.serverInfo = liveServerInfo;
    }
  });

  it('renders the strict KLIPY media URL observed on Docker 1', async () => {
    mocks.serverInfo.capabilities = [CAPABILITY];
    const screen = render(MessageContent, { props: { body: KLIPY_URL } });

    const embed = screen.getByTestId('external-gif-embed');
    await expect.element(embed).toBeVisible();
    await expect.element(embed).toHaveAttribute('data-provider', 'klipy');
    await expect.element(screen.getByText(/KLIPY/)).toBeVisible();
    await expect.element(screen.getByRole('link', { name: KLIPY_URL })).not.toBeInTheDocument();
  });

  it('honors a live disabled capability over stale registered support', async () => {
    mocks.registered.capabilities = [CAPABILITY];
    const screen = render(MessageContent, { props: { body: GIPHY_URL } });

    await expect.element(screen.getByTestId('external-gif-embed')).not.toBeInTheDocument();
    await expect.element(screen.getByRole('link', { name: GIPHY_URL })).toBeVisible();
  });

  it('keeps the URL as a normal link when neither capability source enables the feature', async () => {
    const screen = render(MessageContent, { props: { body: GIPHY_URL } });

    await expect.element(screen.getByTestId('external-gif-embed')).not.toBeInTheDocument();
    await expect.element(screen.getByRole('link', { name: GIPHY_URL })).toBeVisible();
  });

  it('keeps mixed text as ordinary Markdown when support is enabled', async () => {
    mocks.serverInfo.capabilities = [CAPABILITY];
    const body = `reaction ${KLIPY_URL}`;
    const screen = render(MessageContent, { props: { body } });

    await expect.element(screen.getByTestId('external-gif-embed')).not.toBeInTheDocument();
    await expect.element(screen.getByRole('link', { name: KLIPY_URL })).toBeVisible();
  });
});
