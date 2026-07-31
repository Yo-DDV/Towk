import type { Locator } from '@playwright/test';
import { expect, test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { TIMEOUTS } from './constants';

type SurfaceStyle = {
  backgroundColor: string;
  backgroundImage: string;
  backdropFilter: string;
  borderRadius: string;
  boxShadow: string;
  outlineStyle: string;
  outlineWidth: string;
  transform: string;
};

async function readSurfaceStyle(locator: Locator): Promise<SurfaceStyle> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backdropFilter:
        style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter') || 'none',
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      transform: style.transform
    };
  });
}

function rgbChannels(value: string): [number, number, number] {
  const match = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!match) throw new Error(`Expected computed rgb() value, received ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function expectAchromatic(value: string) {
  const [red, green, blue] = rgbChannels(value);
  expect(red).toBe(green);
  expect(green).toBe(blue);
}

function relativeLuminance(value: string): number {
  const channels = rgbChannels(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function expectNoGradient(style: SurfaceStyle) {
  expect(style.backgroundImage).toBe('none');
}

async function expectContained(locator: Locator, width: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
}

test.describe('Achromatic dark application surfaces', () => {
  test('renders a complete neutral-gray hierarchy with stable compact glass', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const root = page.locator('html');
    const body = page.locator('body');
    const envelope = page.getByTestId('app-envelope');
    const frame = page.getByTestId('app-content-frame');
    const appHeader = page.locator('.app-header');
    const serverGutter = page.locator('.server-gutter');
    const serverSidebar = page.getByTestId('server-sidebar');
    const paneHeader = page.locator('[data-ui="pane-header"]').first();
    const roomView = page.getByTestId('room-view-region');
    const profile = page.getByTestId('current-user-identity-card');
    const composer = page.getByTestId('message-composer-shell');
    const sendButton = page.getByTestId('message-send-button');
    const activeSidebarItem = page.locator('.sidebar-item[aria-current="page"]').first();
    const activeServer = page.locator('.server-gutter-item-active').first();

    await expect(root).toHaveAttribute('data-theme', 'dark');
    for (const surface of [
      envelope,
      frame,
      appHeader,
      serverGutter,
      serverSidebar,
      paneHeader,
      roomView,
      profile,
      composer,
      sendButton,
      activeSidebarItem,
      activeServer
    ]) {
      await expect(surface).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    }

    const supportsBackdropFilter = await page.evaluate(
      () =>
        CSS.supports('backdrop-filter', 'blur(1px)') ||
        CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
    );

    const [
      bodyStyle,
      envelopeStyle,
      frameStyle,
      appHeaderStyle,
      serverGutterStyle,
      serverSidebarStyle,
      paneHeaderStyle,
      roomViewStyle,
      profileStyle,
      composerStyle
    ] = await Promise.all([
      readSurfaceStyle(body),
      readSurfaceStyle(envelope),
      readSurfaceStyle(frame),
      readSurfaceStyle(appHeader),
      readSurfaceStyle(serverGutter),
      readSurfaceStyle(serverSidebar),
      readSurfaceStyle(paneHeader),
      readSurfaceStyle(roomView),
      readSurfaceStyle(profile),
      readSurfaceStyle(composer)
    ]);

    for (const style of [
      bodyStyle,
      envelopeStyle,
      frameStyle,
      appHeaderStyle,
      serverGutterStyle,
      serverSidebarStyle,
      paneHeaderStyle,
      roomViewStyle,
      profileStyle,
      composerStyle
    ]) {
      expectNoGradient(style);
      expectAchromatic(style.backgroundColor);
    }

    expect(bodyStyle.backgroundColor).toBe(envelopeStyle.backgroundColor);
    expect(appHeaderStyle.backgroundColor).toBe(envelopeStyle.backgroundColor);

    const envelopeLuminance = relativeLuminance(envelopeStyle.backgroundColor);
    const navigationLuminance = relativeLuminance(serverSidebarStyle.backgroundColor);
    const canvasLuminance = relativeLuminance(roomViewStyle.backgroundColor);
    const envelopeChannel = rgbChannels(envelopeStyle.backgroundColor)[0];
    const canvasChannel = rgbChannels(roomViewStyle.backgroundColor)[0];

    expect(envelopeLuminance).toBeGreaterThan(navigationLuminance);
    expect(navigationLuminance).toBeGreaterThan(canvasLuminance);
    expect(canvasLuminance).toBeGreaterThan(0.008);
    expect(canvasLuminance).toBeLessThan(0.02);
    expect(envelopeChannel - canvasChannel).toBeGreaterThanOrEqual(10);
    expect(canvasChannel).toBeGreaterThanOrEqual(24);

    expect(frameStyle.boxShadow).not.toBe('none');
    expect(frameStyle.borderRadius).not.toBe('0px');
    expect(serverGutterStyle.boxShadow).not.toBe('none');
    expect(serverSidebarStyle.boxShadow).not.toBe('none');
    expect(paneHeaderStyle.boxShadow).not.toBe('none');

    for (const style of [
      frameStyle,
      appHeaderStyle,
      serverGutterStyle,
      serverSidebarStyle,
      paneHeaderStyle,
      roomViewStyle
    ]) {
      expect(style.backdropFilter).toBe('none');
    }

    if (supportsBackdropFilter) {
      expect(profileStyle.backdropFilter).toContain('blur(16px)');
      expect(composerStyle.backdropFilter).toContain('blur(16px)');
      expect(profileStyle.backdropFilter).toContain('saturate(1)');
      expect(composerStyle.backdropFilter).toContain('saturate(1)');
    }

    expect(profileStyle.backgroundColor).toBe(composerStyle.backgroundColor);
    expect(profileStyle.borderRadius).toBe(composerStyle.borderRadius);
    expect(profileStyle.boxShadow).not.toBe('none');
    expect(composerStyle.boxShadow).not.toBe('none');

    const activeSidebarBefore = await readSurfaceStyle(activeSidebarItem);
    await activeSidebarItem.hover();
    const activeSidebarAfter = await readSurfaceStyle(activeSidebarItem);
    expectNoGradient(activeSidebarAfter);
    expectAchromatic(activeSidebarAfter.backgroundColor);
    expect(activeSidebarAfter.transform).toBe('none');
    expect(activeSidebarAfter.boxShadow).not.toBe('none');
    expect(activeSidebarBefore.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');

    const activeServerBefore = await readSurfaceStyle(activeServer);
    await activeServer.hover();
    const activeServerAfter = await readSurfaceStyle(activeServer);
    expectNoGradient(activeServerAfter);
    expectAchromatic(activeServerAfter.backgroundColor);
    expect(activeServerAfter.transform).toBe('none');
    expect(activeServerAfter.boxShadow).not.toBe('none');
    expect(activeServerBefore.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');

    const restingComposerBox = await composer.boundingBox();
    const restingShadow = composerStyle.boxShadow;
    await roomPage.messageInput.click();
    await expect.poll(async () => (await readSurfaceStyle(composer)).boxShadow).not.toBe(restingShadow);
    await expect.poll(async () => (await readSurfaceStyle(composer)).boxShadow).toContain('232, 120, 59');
    const focusedComposerBox = await composer.boundingBox();
    expect(restingComposerBox).not.toBeNull();
    expect(focusedComposerBox).not.toBeNull();
    expect(Math.abs(focusedComposerBox!.height - restingComposerBox!.height)).toBeLessThanOrEqual(0.5);

    await roomPage.messageInput.fill('Achromatic hierarchy check');
    await expect(sendButton).toHaveAttribute('data-ready', 'true');
    const readySendStyle = await readSurfaceStyle(sendButton);
    expectNoGradient(readySendStyle);
    expect(readySendStyle.transform).toBe('none');

    for (const viewport of [
      { width: 375, height: 667, desktopInset: false },
      { width: 884, height: 1104, desktopInset: true },
      { width: 1024, height: 768, desktopInset: true },
      { width: 1440, height: 900, desktopInset: true }
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(frame).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(composer).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expectContained(frame, viewport.width);
      await expectContained(composer, viewport.width);

      const [caseFrameStyle, caseComposerStyle, caseHeaderStyle, caseEnvelopeStyle, frameBox] =
        await Promise.all([
          readSurfaceStyle(frame),
          readSurfaceStyle(composer),
          readSurfaceStyle(appHeader),
          readSurfaceStyle(envelope),
          frame.boundingBox()
        ]);

      expect(frameBox).not.toBeNull();
      expectNoGradient(caseFrameStyle);
      expectNoGradient(caseComposerStyle);
      expect(caseHeaderStyle.backgroundColor).toBe(caseEnvelopeStyle.backgroundColor);
      expectAchromatic(caseHeaderStyle.backgroundColor);
      expectAchromatic(caseComposerStyle.backgroundColor);

      if (viewport.desktopInset) {
        expect(frameBox!.x).toBeGreaterThanOrEqual(11.5);
        expect(frameBox!.x + frameBox!.width).toBeLessThanOrEqual(viewport.width - 11.5);
        expect(caseFrameStyle.borderRadius).not.toBe('0px');
      } else {
        expect(frameBox!.x).toBeCloseTo(0, 1);
        expect(frameBox!.width).toBeCloseTo(viewport.width, 0);
        expect(caseFrameStyle.borderRadius).toBe('0px');
        if (supportsBackdropFilter) {
          expect(caseComposerStyle.backdropFilter).toContain('blur(12px)');
        }
      }
    }
  });

  test('keeps light mode coherent', async ({ page, chatPage }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const root = page.locator('html');
    const body = page.locator('body');
    const envelope = page.getByTestId('app-envelope');
    const appHeader = page.locator('.app-header');
    const navigation = page.getByTestId('server-sidebar');
    const roomView = page.getByTestId('room-view-region');
    const profile = page.getByTestId('current-user-identity-card');
    const composer = page.getByTestId('message-composer-shell');

    await expect(root).toHaveAttribute('data-theme', 'light');
    const [bodyStyle, envelopeStyle, headerStyle, navigationStyle, roomStyle, profileStyle, composerStyle] =
      await Promise.all([
        readSurfaceStyle(body),
        readSurfaceStyle(envelope),
        readSurfaceStyle(appHeader),
        readSurfaceStyle(navigation),
        readSurfaceStyle(roomView),
        readSurfaceStyle(profile),
        readSurfaceStyle(composer)
      ]);

    for (const style of [bodyStyle, envelopeStyle, headerStyle, navigationStyle, roomStyle, profileStyle, composerStyle]) {
      expectNoGradient(style);
    }

    expect(bodyStyle.backgroundColor).toBe(envelopeStyle.backgroundColor);
    expect(headerStyle.backgroundColor).toBe(envelopeStyle.backgroundColor);
    expect(relativeLuminance(roomStyle.backgroundColor)).toBeGreaterThan(
      relativeLuminance(navigationStyle.backgroundColor)
    );
    expect(relativeLuminance(navigationStyle.backgroundColor)).toBeGreaterThan(
      relativeLuminance(envelopeStyle.backgroundColor)
    );
    expect(profileStyle.backgroundColor).toBe(composerStyle.backgroundColor);
    expect(profileStyle.borderRadius).toBe(composerStyle.borderRadius);
  });

  test('keeps forced-color and reduced-motion fallbacks legible', async ({ page, chatPage, roomPage }) => {
    await page.emulateMedia({
      colorScheme: 'dark',
      forcedColors: 'active',
      reducedMotion: 'reduce'
    });
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const surfaces = [
      page.getByTestId('app-envelope'),
      page.getByTestId('app-content-frame'),
      page.locator('.server-gutter'),
      page.getByTestId('server-sidebar'),
      page.locator('[data-ui="pane-header"]').first(),
      page.getByTestId('current-user-identity-card'),
      page.getByTestId('message-composer-shell')
    ];

    for (const surface of surfaces) {
      await expect(surface).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      const style = await readSurfaceStyle(surface);
      expect(style.boxShadow).toBe('none');
      expect(style.backdropFilter).toBe('none');
      expectNoGradient(style);
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('1px');
    }

    const composer = page.getByTestId('message-composer-shell');
    await roomPage.messageInput.click();
    const focusedComposer = await readSurfaceStyle(composer);
    expect(focusedComposer.outlineStyle).toBe('solid');
    expect(focusedComposer.outlineWidth).toBe('2px');
  });
});
