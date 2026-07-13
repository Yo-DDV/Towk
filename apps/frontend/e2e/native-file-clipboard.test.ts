import { expect } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { setNativeFileClipboard, type NativeClipboardLease } from './helpers/nativeFileClipboard';

test.describe('native desktop file clipboard', () => {
  test('pastes an OS clipboard file into Towk and sends it', async ({
    page,
    chatPage,
    roomPage
  }) => {
    const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'towk-native-clipboard-'));
    const filename = 'Rapport été 2026.pdf';
    const filePath = path.join(fixtureDirectory, filename);
    let clipboard: NativeClipboardLease | null = null;

    try {
      await writeFile(filePath, '%PDF-1.7\nTowk native clipboard fixture\n', 'utf8');
      await createAndLoginTestUser(page);
      await chatPage.goto();
      await chatPage.enterRoom('general');
      await roomPage.waitForInputEditable();

      clipboard = await setNativeFileClipboard([filePath]);
      expect(clipboard.paths).toHaveLength(1);

      await roomPage.messageInput.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
      await expect(roomPage.fileAttachmentPreview).toHaveText('pdf');

      const body = `Native clipboard ${process.platform} ${Date.now()}`;
      await roomPage.messageInput.fill(body);
      await roomPage.messageInput.press('Enter');

      const message = roomPage.getMessage(body);
      await expect(message.locator).toBeVisible();
      await expect(
        message.locator.getByRole('button', { name: `Download ${filename}` })
      ).toBeVisible();
    } finally {
      await clipboard?.release();
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });
});
