import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { q, testSnippet } from '$lib/test-utils';
import type { PublicServerInfo } from '$lib/api-client/server';
import { sidebarNav } from '$lib/state/globals.svelte';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    goto: vi.fn(),
    pushState: vi.fn(),
    afterNavigate: vi.fn(),
    onNavigate: vi.fn(),
    pendingNavigation: null as Promise<void> | null,
    registeredServers: [] as Array<{ id: string }>,
    appUi: {
      setActiveRoomScope: vi.fn(),
      setActiveServer: vi.fn()
    },
    originClient: {
      showConnectionLostIcon: false,
      showConnectionLostBanner: false,
      forceReconnect: vi.fn()
    }
  }
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: mocks.afterNavigate,
  goto: mocks.goto,
  onNavigate: mocks.onNavigate,
  pushState: mocks.pushState
}));

vi.mock('$app/paths', () => ({
  resolve: (path: string) => path
}));

vi.mock('$app/state', () => ({
  navigating: {
    get complete() {
      return mocks.pendingNavigation;
    }
  },
  page: {
    params: {},
    route: { id: '/' },
    state: {},
    url: new URL('https://chat.example.test/')
  },
  updated: {
    current: false
  }
}));

vi.mock('$lib/hooks', () => ({
  useAutoHideScrollbars: vi.fn(),
  usePageTitle: () => () => 'Towk',
  usePinchZoomPrevention: vi.fn(),
  useVisualViewport: vi.fn()
}));

vi.mock('$lib/notifications/pushNotifications', () => ({
  onNotificationClick: vi.fn(() => vi.fn())
}));

vi.mock('$lib/notifications/notificationNavigationUi', () => ({
  prepareUiForNotificationPath: vi.fn(),
  prepareUiForNotificationTarget: vi.fn()
}));

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'origin'
}));

vi.mock('$lib/state/appUi.svelte', () => ({
  getAppUiState: () => mocks.appUi,
  provideAppUiState: () => mocks.appUi
}));

vi.mock('$lib/state/server/useServerRegistry.svelte', () => ({
  useServerRegistry: vi.fn()
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    servers: mocks.registeredServers,
    originServer: { id: 'origin' },
    getStore: vi.fn(() => ({ notifications: { count: 0 } })),
    tryGetStore: vi.fn(() => null)
  }
}));

vi.mock('$lib/state/server/serverConnection.svelte', () => ({
  serverConnectionManager: {
    originClient: mocks.originClient,
    getClient: vi.fn(() => mocks.originClient)
  }
}));

import Layout from './+layout.svelte';

function installMobileMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: '(max-width: 767px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

function resetSidebar() {
  sidebarNav.setMobile(false);
  if (!sidebarNav.isOpen) sidebarNav.toggle();
  sidebarNav.setMobile(true);
}

function renderLayout() {
  const serverInfo: PublicServerInfo = {
    name: 'Test Server',
    version: 'test',
    authorizeUrl: '/oauth/authorize',
    directRegistrationEnabled: true,
    welcomeMessage: null,
    description: null,
    iconUrl: null,
    bannerUrl: null,
    capabilities: [],
    authProviders: []
  };

  return render(Layout, {
    props: {
      data: {
        serverInfo,
        serverInfoLoaded: true,
        user: null
      },
      children: testSnippet('<main data-testid="layout-child"></main>')
    }
  });
}

function pointer(type: string, x: number, y = 120) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    clientX: x,
    clientY: y
  });
}

describe('root layout mobile sidebar animation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pendingNavigation = null;
    mocks.registeredServers.length = 0;
    installMobileMatchMedia();
    resetSidebar();
  });

  it('keeps the runtime version in an accessible header popover', async () => {
    const { container } = renderLayout();
    await tick();

    expect(q(container, '[data-testid="corresponding-source-link"]')).toBeNull();
    const trigger = q(
      container,
      '[data-testid="version-info-trigger"]'
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger).toHaveClass('app-header-icon');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    header!.style.width = '320px';
    expect(header!.scrollWidth).toBeLessThanOrEqual(header!.clientWidth);
    const sidebarToggle = q(container, 'button[aria-label="Toggle sidebar"]');
    expect(trigger?.getBoundingClientRect().width).toBe(
      sidebarToggle?.getBoundingClientRect().width
    );
    expect(trigger?.getBoundingClientRect().height).toBe(
      sidebarToggle?.getBoundingClientRect().height
    );

    trigger?.click();
    await tick();

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    const popover = q(container, '[data-testid="version-info-popover"]');
    expect(popover).not.toBeNull();
    expect(q(popover!, '[data-testid="deployed-version"]')?.textContent?.trim()).toMatch(/^v\S+$/);

    const sourceLink = q(
      popover!,
      '[data-testid="corresponding-source-link"]'
    ) as HTMLAnchorElement | null;
    expect(sourceLink).not.toBeNull();
    expect(sourceLink?.href).toBe('https://github.com/Yo-DDV/towk');
    expect(sourceLink?.target).toBe('_blank');
    expect(sourceLink?.rel).toContain('noopener');

    const versionText = q(popover!, '[data-testid="deployed-version"]')?.textContent?.trim();
    expect(versionText).toBeTruthy();
    expect(header?.textContent).not.toContain(versionText!);

    sourceLink?.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(q(container, '[data-testid="version-info-popover"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('uses the standard header icon geometry for sign out', async () => {
    mocks.registeredServers.push({ id: 'origin' });
    const { container } = renderLayout();
    await tick();

    const signOut = q(container, '[data-testid="sign-out-trigger"]') as HTMLButtonElement | null;
    expect(signOut).not.toBeNull();
    expect(signOut).toHaveClass('app-header-icon');
    expect(signOut?.querySelector('.iconify.uil--signout')).not.toBeNull();
    const sidebarToggle = q(container, 'button[aria-label="Toggle sidebar"]');
    expect(signOut?.getBoundingClientRect().width).toBe(
      sidebarToggle?.getBoundingClientRect().width
    );
    expect(signOut?.getBoundingClientRect().height).toBe(
      sidebarToggle?.getBoundingClientRect().height
    );

    signOut?.click();
    await tick();
    expect(mocks.pushState).toHaveBeenCalledWith('', { modal: { type: 'logout' } });
  });

  it('does not let a finishing navigation discard the sign-out modal', async () => {
    mocks.registeredServers.push({ id: 'origin' });
    let finishNavigation!: () => void;
    mocks.pendingNavigation = new Promise<void>((resolve) => {
      finishNavigation = resolve;
    });
    const { container } = renderLayout();
    await tick();

    const signOut = q(container, '[data-testid="sign-out-trigger"]') as HTMLButtonElement;
    signOut.click();
    await tick();
    expect(mocks.pushState).not.toHaveBeenCalled();

    finishNavigation();
    await mocks.pendingNavigation;
    await tick();
    expect(mocks.pushState).toHaveBeenCalledWith('', { modal: { type: 'logout' } });
  });

  it('keeps edge target presses from bubbling to app-level outside-click handlers', async () => {
    const { container } = renderLayout();
    const onWindowPointerDown = vi.fn();
    window.addEventListener('pointerdown', onWindowPointerDown);

    try {
      await tick();

      const edge = q(container, '[data-testid="mobile-sidebar-edge"]');
      expect(edge).not.toBeNull();
      if (!edge) return;

      edge.dispatchEvent(pointer('pointerdown', 2));

      expect(onWindowPointerDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('pointerdown', onWindowPointerDown);
    }
  });

  it('keeps the sidebar and backdrop mounted while the mobile close animation runs', async () => {
    const { container } = renderLayout();
    await tick();

    sidebarNav.toggle();
    await tick();

    const panel = q(container, '[data-testid="mobile-sidebar-panel"]');
    const backdrop = q(
      container,
      '[data-testid="mobile-sidebar-backdrop"]'
    ) as HTMLButtonElement | null;
    expect(panel).not.toBeNull();
    expect(backdrop).not.toBeNull();
    if (!panel || !backdrop) return;

    expect(panel.style.transform).toBe('translateX(0px)');
    expect(getComputedStyle(panel).visibility).toBe('visible');
    expect(backdrop.disabled).toBe(false);
    expect(backdrop.style.opacity).toBe('1');

    backdrop.click();
    await tick();

    expect(q(container, '[data-testid="mobile-sidebar-backdrop"]')).toBe(backdrop);
    expect(backdrop.disabled).toBe(true);
    expect(backdrop.style.opacity).toBe('0');
    expect(panel.style.transform).toBe('translateX(-324px)');
    expect(panel.classList.contains('sidebar-mobile-closed')).toBe(true);
  });

  it('keeps drag-to-close working for the mobile sidebar', async () => {
    const { container } = renderLayout();
    await tick();

    sidebarNav.toggle();
    await tick();

    const panel = q(container, '[data-testid="mobile-sidebar-panel"]');
    expect(panel).not.toBeNull();
    if (!panel) return;

    panel.dispatchEvent(pointer('pointerdown', 320));
    window.dispatchEvent(pointer('pointermove', 0));
    window.dispatchEvent(pointer('pointerup', 0));
    await tick();

    expect(sidebarNav.isOpen).toBe(false);
    expect(panel.style.transform).toBe('translateX(-324px)');
  });
});
