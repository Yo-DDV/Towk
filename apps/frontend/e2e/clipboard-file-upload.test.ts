import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';

test.describe('desktop file clipboard and generic drop uploads', () => {
  test('pastes a PDF File into the composer and sends it', async ({ page, chatPage, roomPage }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    await roomPage.simulateClipboardFile(
      'clipboard-report.pdf',
      'application/pdf',
      Array.from(new TextEncoder().encode('%PDF-1.7\nTowk clipboard fixture'))
    );
    await expect(roomPage.fileAttachmentPreview).toHaveText('pdf');

    const text = `Clipboard PDF ${Date.now()}`;
    await roomPage.messageInput.fill(text);
    await roomPage.messageInput.press('Enter');

    await expect(roomPage.fileAttachmentPreview).toHaveCount(0);
    const message = roomPage.getMessage(text);
    await expect(message.locator).toBeVisible();
    await expect(
      message.locator.getByRole('button', { name: 'Download clipboard-report.pdf' })
    ).toBeVisible();
  });

  test('pastes a photo File into the composer and sends it', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const photo = await readFile(new URL('./fixtures/brighton.jpg', import.meta.url));
    await roomPage.simulateClipboardFile('clipboard-photo.jpg', 'image/jpeg', Array.from(photo));
    await expect(roomPage.attachmentPreview).toBeVisible();

    const text = `Clipboard photo ${Date.now()}`;
    await roomPage.messageInput.fill(text);
    await roomPage.messageInput.press('Enter');

    await expect(roomPage.attachmentPreview).toHaveCount(0);
    await expect(roomPage.getMessage(text).locator.getByRole('img')).toBeVisible();
  });

  test('pastes an audio File into the composer and sends it', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const audio = await readFile(new URL('./fixtures/test-audio.mp3', import.meta.url));
    await roomPage.simulateClipboardFile('clipboard-audio.mp3', 'audio/mpeg', Array.from(audio));
    await expect(roomPage.audioAttachmentPreview).toBeVisible();

    const text = `Clipboard audio ${Date.now()}`;
    await roomPage.messageInput.fill(text);
    await roomPage.messageInput.press('Enter');

    await expect(roomPage.audioAttachmentPreview).toHaveCount(0);
    await expect(roomPage.getMessage(text).locator.getByTestId('audio-player')).toBeVisible();
  });

  test('pastes and sends a File without browser MIME metadata', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    await roomPage.simulateClipboardFile(
      'clipboard-without-mime.txt',
      '',
      Array.from(new TextEncoder().encode('Towk clipboard fixture without MIME metadata'))
    );
    await expect(roomPage.fileAttachmentPreview).toHaveText('txt');

    const text = `Clipboard empty MIME ${Date.now()}`;
    await roomPage.messageInput.fill(text);
    await roomPage.messageInput.press('Enter');

    await expect(roomPage.fileAttachmentPreview).toHaveCount(0);
    await expect(
      roomPage
        .getMessage(text)
        .locator.getByRole('button', { name: 'Download clipboard-without-mime.txt' })
    ).toBeVisible();
  });

  test('drops an opaque archive into the room and sends it', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    await roomPage.simulateVirtualFileDrop('bundle.zip', 'application/zip', [0x50, 0x4b, 3, 4]);
    await expect(roomPage.fileAttachmentPreview).toHaveText('zip');

    const text = `Archive drop ${Date.now()}`;
    await roomPage.messageInput.fill(text);
    await roomPage.messageInput.press('Enter');

    await expect(roomPage.fileAttachmentPreview).toHaveCount(0);
    const message = roomPage.getMessage(text);
    await expect(message.locator).toBeVisible();
    await expect(
      message.locator.getByRole('button', { name: 'Download bundle.zip' })
    ).toBeVisible();
  });

  test('rejects named and renamed executable clipboard files before upload', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    await roomPage.simulateClipboardFile('setup.exe', 'application/octet-stream', [1, 2, 3]);
    await expect(page.getByText('Executable files are not allowed: setup.exe.')).toBeVisible();
    await expect(roomPage.fileAttachmentPreview).toHaveCount(0);

    await roomPage.simulateClipboardFile('renamed.txt', 'text/plain', [0x4d, 0x5a, 0x90, 0]);
    await expect(page.getByText('Executable files are not allowed: renamed.txt.')).toBeVisible();
    await expect(roomPage.fileAttachmentPreview).toHaveCount(0);
  });
});
