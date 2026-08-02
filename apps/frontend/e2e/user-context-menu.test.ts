import { expect } from '@playwright/test';
import { createAndLoginTestUser } from './fixtures/testUser';
import { withServerUser } from './fixtures/serverUser';
import { waitForRoomReady } from './fixtures/realtimeSync';
import { connectPost } from './fixtures/connectHelpers';
import { test } from './setup';
import { TIMEOUTS } from './constants';

test.describe('User context menu', () => {
  test.describe('from message avatar', () => {
    test('right-clicking a message avatar shows user profile dialog', async ({
      page,
      chatPage,
      roomPage,
      browser,
      serverURL
    }) => {
      // User A: Create account and send a message
      await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');
      await roomPage.sendMessage('Hello from User A');

      // User B: Join and send a message
      await withServerUser(
        browser!,
        serverURL,
        async ({ page: page2, user: userB, chatPage: chatPage2, roomPage: roomPage2 }) => {
          await chatPage2.enterRoom('general');
          await waitForRoomReady(page2, 'general');
          await connectPost(page2, 'chatto.api.v1.MyAccountService/UpdateProfile', {
            biographyMarkdown: '**Hello** from the detailed profile.'
          });

          await roomPage2.sendMessage('Hello from User B');

          // Wait for User A to see User B's message
          await roomPage.expectMessageVisible('Hello from User B', {
            timeout: TIMEOUTS.REALTIME_EVENT
          });

          // Right-click on User B's avatar in User A's view
          const messageArticle = page.locator('[role="article"]', {
            hasText: 'Hello from User B'
          });
          const avatarButton = messageArticle.locator('button').first();
          await avatarButton.click({ button: 'right' });

          // Verify user profile dialog appears with correct content
          const profileDialog = page.getByRole('dialog', { name: 'User profile' });
          await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
          await expect(profileDialog.getByText(userB.displayName)).toBeVisible();
          await expect(profileDialog.getByText(`@${userB.login}`)).toBeVisible();
          await expect(profileDialog.getByText('Member')).toBeVisible();
          await expect(profileDialog.getByText('Hello from the detailed profile.')).toBeVisible();
          await expect(profileDialog.getByText('Last activity')).toBeVisible();
          await expect(profileDialog.getByRole('button', { name: 'Send Message' })).toBeVisible();
          await expect(profileDialog.getByRole('button', { name: 'Call' })).not.toBeVisible();
        }
      );
    });

    test('right-clicking avatar does not open message context menu', async ({
      page,
      chatPage,
      roomPage
    }) => {
      // Create account and send a message
      await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');
      await roomPage.sendMessage('Test message');

      // Right-click on own avatar
      const messageArticle = page.locator('[role="article"]', {
        hasText: 'Test message'
      });
      const avatarButton = messageArticle.locator('button').first();
      await avatarButton.click({ button: 'right' });

      // Should see user profile dialog, NOT the message context menu
      const profileDialog = page.getByRole('dialog', { name: 'User profile' });
      await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });

      // The message context menu (role="menu") should NOT be visible
      await expect(page.locator('[role="menu"]')).not.toBeVisible();
    });

    test('clicking display name shows user profile dialog', async ({
      page,
      chatPage,
      roomPage
    }) => {
      const user = await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');
      await roomPage.sendMessage('Test message');

      // Click on the display name button in the message header
      const messageArticle = page.locator('[role="article"]', {
        hasText: 'Test message'
      });
      const nameButton = messageArticle.getByRole('button', { name: user.displayName });
      await nameButton.click();

      // Verify user profile dialog appears
      const profileDialog = page.getByRole('dialog', { name: 'User profile' });
      await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(profileDialog.getByText(user.displayName)).toBeVisible();
      await expect(profileDialog.getByText(`@${user.login}`)).toBeVisible();
    });
  });

  test.describe('from member list', () => {
    test('right-clicking a member shows user profile dialog', async ({
      page,
      chatPage,
      roomPage
    }) => {
      const user = await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');

      // Wait for the member to be visible in the member list
      await roomPage.expectMemberVisible(user.login, { timeout: TIMEOUTS.UI_STANDARD });

      // Right-click on the member in the member list
      const memberButton = roomPage.memberList.getByRole('button', {
        name: new RegExp(user.displayName)
      });
      await memberButton.click({ button: 'right' });

      // Verify user profile dialog appears
      const profileDialog = page.getByRole('dialog', { name: 'User profile' });
      await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(profileDialog.getByText(user.displayName)).toBeVisible();
      await expect(profileDialog.getByText(`@${user.login}`)).toBeVisible();
    });

    test('left-clicking a member also shows user profile dialog', async ({
      page,
      chatPage,
      roomPage
    }) => {
      const user = await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');

      await roomPage.expectMemberVisible(user.login, { timeout: TIMEOUTS.UI_STANDARD });

      // Left-click on the member
      const memberButton = roomPage.memberList.getByRole('button', {
        name: new RegExp(user.displayName)
      });
      await memberButton.click();

      // Verify user profile dialog appears
      const profileDialog = page.getByRole('dialog', { name: 'User profile' });
      await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(profileDialog.getByText(user.displayName)).toBeVisible();
    });
  });

  test.describe('dismiss behavior', () => {
    test('pressing Escape closes the user profile dialog', async ({ page, chatPage, roomPage }) => {
      const user = await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');
      await roomPage.sendMessage('Test message');

      // Open user profile by clicking display name
      const messageArticle = page.locator('[role="article"]', {
        hasText: 'Test message'
      });
      const nameButton = messageArticle.getByRole('button', { name: user.displayName });
      await nameButton.click();

      const profileDialog = page.getByRole('dialog', { name: 'User profile' });
      await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });

      // Press Escape to dismiss
      await page.keyboard.press('Escape');
      await expect(profileDialog).not.toBeVisible({ timeout: TIMEOUTS.UI_FAST });
    });

    test('browser Back closes the user profile dialog without leaving the room', async ({
      page,
      chatPage,
      roomPage
    }) => {
      const user = await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');
      await roomPage.sendMessage('Back navigation profile');

      const messageArticle = page.locator('[role="article"]', {
        hasText: 'Back navigation profile'
      });
      await messageArticle.getByRole('button', { name: user.displayName }).click();

      const profileDialog = page.getByRole('dialog', { name: 'User profile' });
      await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      const roomURL = page.url();

      await page.goBack();

      await expect(profileDialog).not.toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(page).toHaveURL(roomURL);
    });

    test('clicking outside closes the user profile dialog', async ({
      page,
      chatPage,
      roomPage
    }) => {
      const user = await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');
      await roomPage.sendMessage('Test message');

      // Open user profile by clicking display name
      const messageArticle = page.locator('[role="article"]', {
        hasText: 'Test message'
      });
      const nameButton = messageArticle.getByRole('button', { name: user.displayName });
      await nameButton.click();

      const profileDialog = page.getByRole('dialog', { name: 'User profile' });
      await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });

      // Click outside the dialog (on the message area)
      await page.locator('body').click({ position: { x: 10, y: 10 } });
      await expect(profileDialog).not.toBeVisible({ timeout: TIMEOUTS.UI_FAST });
    });
  });

  test.describe('self profile actions and mobile dismissal', () => {
    test('own profile exposes editing and hides self-message/self-call actions', async ({
      page,
      chatPage,
      roomPage
    }) => {
      const user = await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');
      await roomPage.sendMessage('Own profile actions');

      const messageArticle = page.locator('[role="article"]', {
        hasText: 'Own profile actions'
      });
      await messageArticle.getByRole('button', { name: user.displayName }).click();

      const profileDialog = page.getByRole('dialog', { name: 'User profile' });
      await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(profileDialog.getByRole('button', { name: 'Edit profile' })).toBeVisible();
      await expect(profileDialog.getByRole('button', { name: 'Send Message' })).not.toBeVisible();
      await expect(profileDialog.getByRole('button', { name: 'Call' })).not.toBeVisible();
    });

    test('narrow viewport uses a full-screen safe-area surface and supports swipe-to-close', async ({
      page,
      chatPage,
      roomPage
    }) => {
      const user = await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');
      await roomPage.sendMessage('Mobile profile');
      await page.setViewportSize({ width: 390, height: 844 });

      const messageArticle = page.locator('[role="article"]', { hasText: 'Mobile profile' });
      await messageArticle.getByRole('button', { name: user.displayName }).click();

      const profileDialog = page.getByRole('dialog', { name: 'User profile' });
      await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      const box = await profileDialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeLessThanOrEqual(1);
      expect(box!.y).toBeLessThanOrEqual(1);
      expect(box!.width).toBeGreaterThanOrEqual(389);
      expect(box!.height).toBeGreaterThanOrEqual(843);

      const handle = profileDialog.locator('.dialog-swipe-handle');
      await expect(handle).toBeVisible();
      const handleBox = await handle.boundingBox();
      expect(handleBox).not.toBeNull();
      expect(handleBox!.height).toBeGreaterThanOrEqual(44);
      expect(handleBox!.x).toBeGreaterThanOrEqual(0);
      expect(handleBox!.x + handleBox!.width).toBeLessThanOrEqual(390);
      const x = handleBox!.x + handleBox!.width / 2;
      const y = handleBox!.y + handleBox!.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 220, { steps: 8 });
      await page.mouse.up();

      await expect(profileDialog).not.toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    });
  });

  test.describe('when voice calls are configured', () => {
    test.use({
      serverOptions: {
        env: {
          CHATTO_LIVEKIT_ENABLED: 'true',
          CHATTO_LIVEKIT_URL: 'ws://localhost:7880',
          CHATTO_LIVEKIT_API_KEY: 'devkey',
          CHATTO_LIVEKIT_API_SECRET: 'secret'
        }
      }
    });

    test('another user profile exposes the Call action', async ({
      page,
      chatPage,
      roomPage,
      browser,
      serverURL
    }) => {
      await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');

      await withServerUser(
        browser!,
        serverURL,
        async ({ page: page2, user: userB, chatPage: chatPage2, roomPage: roomPage2 }) => {
          await chatPage2.enterRoom('general');
          await waitForRoomReady(page2, 'general');
          await roomPage2.sendMessage('Call-capable profile');
          await roomPage.expectMessageVisible('Call-capable profile', {
            timeout: TIMEOUTS.REALTIME_EVENT
          });

          const messageArticle = page.locator('[role="article"]', {
            hasText: 'Call-capable profile'
          });
          await messageArticle.getByRole('button', { name: userB.displayName }).click();

          const profileDialog = page.getByRole('dialog', { name: 'User profile' });
          await expect(profileDialog).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
          await expect(profileDialog.getByRole('button', { name: 'Call' })).toBeVisible();
        }
      );
    });
  });
});
