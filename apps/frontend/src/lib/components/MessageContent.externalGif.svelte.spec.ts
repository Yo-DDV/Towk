import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import { loadLocaleMessages } from '$lib/i18n/messages';
import { setReactiveLocale } from '$lib/i18n/state.svelte';
import { userPreferences } from '$lib/state/userPreferences.svelte';

const GIPHY_URL = 'https://giphy.com/gifs/justin-word-oh-really-wow-QUENDfi6DEMLzQ0CKt';
const GIPHY_MEDIA_URL = 'https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.gif';
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
  userPreferences.externalGifAutoLoad = false;
  await loadLocaleMessages('en');
  setReactiveLocale('en');
});

describe('MessageContent external GIF capability wiring', () => {
  it(
    'replaces the standalone GIPHY URL with the privacy card when the live store advertises support',
    async () => {
      mocks.serverInfo.capabilities = [CAPABILITY];
      const screen = render(MessageContent, { props: { body: GIPHY_URL } });

      await expect.element(screen.getByTestId('external-gif-embed')).toBeVisible();
      await expect.element(screen.getByRole('button', { name: 'Load external GIF' })).toBeVisible();
      await expect
        .element(screen.getByRole('link', { name: 'Open source' }))
        .toHaveAttribute('href', GIPHY_URL);
      await expect.element(screen.getByRole('link', { name: GIPHY_URL })).not.toBeInTheDocument();
    }
  );

  it('renders the persisted rich-composer hybrid body as ordered GIF cards', async () => {
    mocks.serverInfo.capabilities = [CAPABILITY];
    const body = `[${GIPHY_MEDIA_URL}](${GIPHY_MEDIA_URL})\n\n${GIPHY_URL}`;
    const screen = render(MessageContent, { props: { body } });

    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="external-gif-embed"]')).toHaveLength(2);
    });
    await expect
      .element(screen.getByTestId('external-gif-message'))
      .toHaveAttribute('data-embed-count', '2');
    expect(
      Array.from(document.querySelectorAll('[data-testid="external-gif-embed"]')).map((element) =>
        element.getAttribute('data-provider')
      )
    ).toEqual(['giphy', 'giphy']);
    await expect
      .element(screen.getByRole('link', { name: GIPHY_MEDIA_URL }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole('link', { name: GIPHY_URL })).not.toBeInTheDocument();
    expect(document.querySelectorAll(`a[href="${GIPHY_MEDIA_URL}"]`)).toHaveLength(1);
    expect(document.querySelectorAll(`a[href="${GIPHY_URL}"]`)).toHaveLength(1);
  });

  it('renders duplicate GIF URLs as distinct cards', async () => {
    mocks.serverInfo.capabilities = [CAPABILITY];
    const body = `[${GIPHY_URL}](${GIPHY_URL})\n\n[${GIPHY_URL}](${GIPHY_URL})`;
    const screen = render(MessageContent, { props: { body } });

    await expect.element(screen.getByTestId('external-gif-message')).toHaveAttribute(
      'data-embed-count',
      '2'
    );
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-testid="external-gif-embed"]')).toHaveLength(2);
    });
    expect(document.querySelectorAll(`a[href="${GIPHY_URL}"]`)).toHaveLength(2);
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

  it(
    'keeps the URL as a normal link when neither capability source enables the feature',
    async () => {
      const screen = render(MessageContent, { props: { body: GIPHY_URL } });

      await expect.element(screen.getByTestId('external-gif-embed')).not.toBeInTheDocument();
      await expect.element(screen.getByRole('link', { name: GIPHY_URL })).toBeVisible();
    }
  );

  it('keeps mixed text as ordinary Markdown when support is enabled', async () => {
    mocks.serverInfo.capabilities = [CAPABILITY];
    const body = `reaction ${KLIPY_URL}`;
    const screen = render(MessageContent, { props: { body } });

    await expect.element(screen.getByTestId('external-gif-embed')).not.toBeInTheDocument();
    await expect.element(screen.getByRole('link', { name: KLIPY_URL })).toBeVisible();
  });

  it('keeps the whole message as Markdown when one URL is unsupported', async () => {
    mocks.serverInfo.capabilities = [CAPABILITY];
    const unsupportedUrl = 'https://example.com/reaction.gif';
    const body = `${GIPHY_URL}\n${unsupportedUrl}`;
    const screen = render(MessageContent, { props: { body } });

    await expect.element(screen.getByTestId('external-gif-embed')).not.toBeInTheDocument();
    await expect.element(screen.getByRole('link', { name: GIPHY_URL })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: unsupportedUrl })).toBeVisible();
  });
});
