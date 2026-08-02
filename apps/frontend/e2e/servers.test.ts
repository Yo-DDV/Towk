import { test, expect } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import {
  startSecondServer,
  stopSecondServer,
  createUserOnRemote,
  connectRemoteInstance
} from './fixtures/multiServer';
import type { ServerInfo } from './fixtures/server';
import { TIMEOUTS } from './constants';
import { escapeRegExp } from './fixtures/regex';

test.describe('Add Server (sidebar entry point)', () => {
  test('sidebar "+" opens the Add Server dialog', async ({ page, chatPage }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();

    await page.getByTitle('Add Server').click();
    await expect(page.getByRole('heading', { name: 'Add Server' })).toBeVisible({
      timeout: TIMEOUTS.UI_FAST
    });
    await expect(page.getByLabel('Server URL')).toBeVisible();
  });

  test('keeps the server rail above a full-width user panel across layouts', async ({
    page,
    chatPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 2560, height: 1080 }
    ]) {
      await page.setViewportSize(viewport);

      const sidebarToggle = page.getByRole('button', { name: 'Toggle sidebar' });
      if ((await sidebarToggle.getAttribute('aria-expanded')) !== 'true') {
        await sidebarToggle.click();
      }

      const gutter = page.locator('.server-gutter');
      const sidebar = page.getByTestId('server-sidebar');
      const userBar = page.getByTestId('current-user-bar');
      const profile = page.getByTestId('current-user-identity-card');
      const addServer = page.getByTestId('add-server');
      const firstServer = page.getByTestId('server-icon').first();

      await expect(gutter).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(sidebar).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(userBar).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(profile).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(addServer).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });

      await expect
        .poll(
          async () => {
            const box = await userBar.boundingBox();
            return box ? box.x >= -0.5 : false;
          },
          { timeout: TIMEOUTS.UI_STANDARD }
        )
        .toBe(true);

      const [gutterBox, sidebarBox, userBarBox, profileBox, addBox, serverBox] = await Promise.all([
        gutter.boundingBox(),
        sidebar.boundingBox(),
        userBar.boundingBox(),
        profile.boundingBox(),
        addServer.boundingBox(),
        firstServer.boundingBox()
      ]);

      for (const box of [gutterBox, sidebarBox, userBarBox, profileBox, addBox, serverBox]) {
        expect(box).not.toBeNull();
      }

      expect(userBarBox!.x).toBeCloseTo(gutterBox!.x, 0);
      expect(userBarBox!.x + userBarBox!.width).toBeCloseTo(sidebarBox!.x + sidebarBox!.width, 0);
      expect(gutterBox!.y + gutterBox!.height).toBeLessThanOrEqual(userBarBox!.y + 0.5);
      expect(sidebarBox!.y + sidebarBox!.height).toBeLessThanOrEqual(userBarBox!.y + 0.5);
      expect(profileBox!.x).toBeGreaterThanOrEqual(userBarBox!.x);
      expect(profileBox!.x + profileBox!.width).toBeLessThanOrEqual(
        userBarBox!.x + userBarBox!.width + 0.5
      );
      expect(addBox!.y).toBeGreaterThanOrEqual(serverBox!.y + serverBox!.height);
      expect(userBarBox!.x).toBeGreaterThanOrEqual(-0.5);
      expect(userBarBox!.x + userBarBox!.width).toBeLessThanOrEqual(viewport.width + 0.5);
    }
  });
});

test.describe('Leave Server', () => {
  let remoteServer: ServerInfo | undefined;

  test.beforeEach(async ({}, testInfo) => {
    remoteServer = await startSecondServer(testInfo);
  });

  test.afterEach(async ({}, testInfo) => {
    if (remoteServer) {
      await stopSecondServer(remoteServer, testInfo);
    }
  });

  function remoteBaseURL(server: ServerInfo): string {
    return server.baseURL.replace('localhost', '127.0.0.1');
  }

  test('Leave Server icon is hidden on remote instances', async ({ page, chatPage }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();

    const baseURL = remoteBaseURL(remoteServer!);
    const remoteHost = new URL(baseURL).host;
    const remoteUser = await createUserOnRemote(baseURL, 'remoteuser-hidden', 'password123');
    await connectRemoteInstance(page, { ...remoteServer, baseURL }, remoteUser.userId);

    // The remote should have been added to the sidebar.
    const remoteSidebarIcon = page
      .locator(`[data-testid="server-icon"][href*="${remoteHost}"]`)
      .first();
    await expect(remoteSidebarIcon).toBeVisible({ timeout: TIMEOUTS.REALTIME_EVENT });

    // Navigate into the remote server.
    await remoteSidebarIcon.click();
    await page.waitForURL(new RegExp(`/chat/${escapeRegExp(remoteHost)}`));

    // The leave-server affordance was removed from the server header.
    await expect(page.getByTitle('Leave server')).not.toBeVisible();
  });

  test('can sign out of only the selected remote server', async ({ page, chatPage }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();

    const baseURL = remoteBaseURL(remoteServer!);
    const remoteHost = new URL(baseURL).host;
    const remoteUser = await createUserOnRemote(baseURL, 'remoteuser-signout', 'password123');
    await connectRemoteInstance(page, { ...remoteServer!, baseURL }, remoteUser.userId);

    await page.waitForURL(new RegExp(`/chat/${escapeRegExp(remoteHost)}`));
    await page.getByTitle('Sign out').click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await page.getByRole('button', { name: 'Sign Out of This Server' }).click();

    await expect(page).toHaveURL(/\/chat\/-/);
    await expect(
      page.locator(`[data-testid="server-icon"][href*="${remoteHost}"]`)
    ).not.toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(page.getByTitle('Sign out')).toBeVisible();
  });

  test('can remove the selected remote server when it is unreachable', async ({
    page,
    chatPage
  }, testInfo) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();

    const baseURL = remoteBaseURL(remoteServer!);
    const remoteHost = new URL(baseURL).host;
    const remoteUser = await createUserOnRemote(baseURL, 'remoteuser-dead', 'password123');
    await connectRemoteInstance(page, { ...remoteServer!, baseURL }, remoteUser.userId);

    await page.waitForURL(new RegExp(`/chat/${escapeRegExp(remoteHost)}`));
    await stopSecondServer(remoteServer!, testInfo);
    remoteServer = undefined;

    await page.getByTitle('Sign out').click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await page.getByRole('button', { name: 'Sign Out of This Server' }).click();

    await expect(page).toHaveURL(/\/chat\/-/);
    await expect(
      page.locator(`[data-testid="server-icon"][href*="${remoteHost}"]`)
    ).not.toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(page.getByTitle('Sign out')).toBeVisible();
  });
});

test.describe('Origin Server', () => {
  test('Leave Server icon is hidden on the origin instance', async ({ page, chatPage }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();

    // On origin: the leave-server affordance should not be present.
    await expect(page.getByTitle('Leave server')).not.toBeVisible();
  });
});
