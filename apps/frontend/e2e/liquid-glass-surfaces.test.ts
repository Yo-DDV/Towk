import type { Locator } from '@playwright/test';
import { expect, test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { TIMEOUTS } from './constants';

type SurfaceStyle = {
  backgroundColor: string;
  backgroundImage: string;
  backdropFilter: string;
  borderColor: string;
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
      borderColor: style.borderColor,
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

function relativeLuminance(value: string): number {
  const channels = rgbChannels(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function expectNoDecorativeGradient(style: SurfaceStyle) {
  expect(style.backgroundImage).toBe('none');
}

async function expectContained(locator: Locator, width: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
}

test.describe('Depth-aware application surfaces', () => {
  test('renders a dark, gradient-free hierarchy with bounded glass and stable geometry', async ({
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
    const sidebarToggle = page.getByRole('button', { name: 'Toggle sidebar' });

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
      sidebarToggle
    ]) {
      await expect(surface).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    }

    const supportsBackdropFilter = await page.evaluate(
      () =>
        CSS.supports('backdrop-filter', 'blur(1px)') ||
        CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
    );

    const [
      envelopeStyle,
      frameStyle,
      appHeaderStyle,
      serverGutterStyle,
      serverSidebarStyle,
      paneHeaderStyle,
      roomViewStyle,
      profileStyle,
      composerStyle,
      sendButtonStyle
    ] = await Promise.all([
      readSurfaceStyle(envelope),
      readSurfaceStyle(frame),
      readSurfaceStyle(appHeader),
      readSurfaceStyle(serverGutter),
      readSurfaceStyle(serverSidebar),
      readSurfaceStyle(paneHeader),
      readSurfaceStyle(roomView),
      readSurfaceStyle(profile),
      readSurfaceStyle(composer),
      readSurfaceStyle(sendButton)
    ]);

    for (const style of [
      envelopeStyle,
      frameStyle,
      appHeaderStyle,
      serverGutterStyle,
      serverSidebarStyle,
      paneHeaderStyle,
      roomViewStyle,
      profileStyle,
      composerStyle,
      sendButtonStyle
    ]) {
      expectNoDecorativeGradient(style);
    }

    const envelopeLuminance = relativeLuminance(envelopeStyle.backgroundColor);
    const navigationLuminance = relativeLuminance(appHeaderStyle.backgroundColor);
    const canvasLuminance = relativeLuminance(roomViewStyle.backgroundColor);
    expect(envelopeLuminance).toBeGreaterThan(navigationLuminance);
    expect(navigationLuminance).toBeGreaterThan(canvasLuminance);
    expect(canvasLuminance).toBeLessThan(0.005);

    expect(frameStyle.boxShadow).not.toBe('none');
    expect(frameStyle.borderRadius).not.toBe('0px');
    expect(serverGutterStyle.boxShadow).not.toBe('none');
    expect(serverSidebarStyle.boxShadow).not.toBe('none');
    expect(paneHeaderStyle.boxShadow).not.toBe('none');

    // Persistent full-height surfaces stay crisp and cheap to render. Live blur
    // is reserved for the two compact glass anchors and transient overlays.
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
    }

    expect(profileStyle.backgroundColor).toBe(composerStyle.backgroundColor);
    expect(profileStyle.borderRadius).toBe(composerStyle.borderRadius);
    expect(profileStyle.boxShadow).not.toBe('none');
    expect(composerStyle.boxShadow).not.toBe('none');

    const activeSidebarStyle = await readSurfaceStyle(activeSidebarItem);
    expectNoDecorativeGradient(activeSidebarStyle);
    expect(activeSidebarStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(activeSidebarStyle.boxShadow).not.toBe('none');
    await activeSidebarItem.hover();
    const activeSidebarHoverStyle = await readSurfaceStyle(activeSidebarItem);
    expectNoDecorativeGradient(activeSidebarHoverStyle);
    expect(activeSidebarHoverStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(activeSidebarHoverStyle.boxShadow).not.toBe('none');
    expect(activeSidebarHoverStyle.transform).toBe('none');

    const activeServer = page.locator('.server-gutter-item-active').first();
    await expect(activeServer).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    const activeServerStyle = await readSurfaceStyle(activeServer);
    expectNoDecorativeGradient(activeServerStyle);
    expect(activeServerStyle.boxShadow).not.toBe('none');

    // A transient popover gets bounded acrylic, while the content section
    // inside it remains opaque. This avoids layering glass over glass.
    await page.getByTestId('version-info-trigger').click();
    const versionPopover = page.getByTestId('version-info-popover');
    const transientMenu = page.locator('.menu').filter({ has: versionPopover });
    await expect(versionPopover).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    const [transientStyle, transientContentStyle] = await Promise.all([
      readSurfaceStyle(transientMenu),
      readSurfaceStyle(versionPopover)
    ]);
    expectNoDecorativeGradient(transientStyle);
    expectNoDecorativeGradient(transientContentStyle);
    if (supportsBackdropFilter) {
      expect(transientStyle.backdropFilter).toContain('blur(16px)');
    }
    expect(transientContentStyle.backdropFilter).toBe('none');
    await page.keyboard.press('Escape');
    await expect(versionPopover).toBeHidden({ timeout: TIMEOUTS.UI_STANDARD });

    const [envelopeBox, frameBox, profileBox, restingComposerBox, toggleBox, sendBox] =
      await Promise.all([
        envelope.boundingBox(),
        frame.boundingBox(),
        profile.boundingBox(),
        composer.boundingBox(),
        sidebarToggle.boundingBox(),
        sendButton.boundingBox()
      ]);
    expect(envelopeBox).not.toBeNull();
    expect(frameBox).not.toBeNull();
    expect(profileBox).not.toBeNull();
    expect(restingComposerBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    expect(sendBox).not.toBeNull();
    expect(frameBox!.x).toBeGreaterThanOrEqual(envelopeBox!.x + 11.5);
    expect(frameBox!.x + frameBox!.width).toBeLessThanOrEqual(
      envelopeBox!.x + envelopeBox!.width - 11.5
    );
    expect(Math.abs(profileBox!.height - restingComposerBox!.height)).toBeLessThanOrEqual(0.5);
    expect(toggleBox!.width).toBeGreaterThanOrEqual(40);
    expect(toggleBox!.height).toBeGreaterThanOrEqual(40);
    expect(sendBox!.width).toBeGreaterThanOrEqual(40);
    expect(sendBox!.height).toBeGreaterThanOrEqual(40);

    const restingComposerShadow = composerStyle.boxShadow;
    await roomPage.messageInput.click();
    await expect
      .poll(async () => (await readSurfaceStyle(composer)).boxShadow)
      .not.toBe(restingComposerShadow);
    await expect
      .poll(async () => (await readSurfaceStyle(composer)).boxShadow)
      .toContain('232, 120, 59');

    const focusedComposerBox = await composer.boundingBox();
    expect(focusedComposerBox).not.toBeNull();
    expect(Math.abs(focusedComposerBox!.height - restingComposerBox!.height)).toBeLessThanOrEqual(
      0.5
    );

    await roomPage.messageInput.fill('Material hierarchy check');
    await expect(sendButton).toHaveAttribute('data-ready', 'true');
    const readySendStyle = await readSurfaceStyle(sendButton);
    expectNoDecorativeGradient(readySendStyle);
    expect(readySendStyle.transform).toBe('none');

    const responsiveCases = [
      { width: 375, height: 667, desktopInset: false },
      { width: 884, height: 1104, desktopInset: true },
      { width: 1024, height: 768, desktopInset: true },
      { width: 1440, height: 900, desktopInset: true }
    ];

    for (const viewport of responsiveCases) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(frame).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expect(composer).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      await expectContained(frame, viewport.width);
      await expectContained(composer, viewport.width);

      const [caseFrameStyle, caseComposerStyle, caseFrameBox] = await Promise.all([
        readSurfaceStyle(frame),
        readSurfaceStyle(composer),
        frame.boundingBox()
      ]);
      expect(caseFrameBox).not.toBeNull();
      expectNoDecorativeGradient(caseFrameStyle);
      expectNoDecorativeGradient(caseComposerStyle);

      if (viewport.desktopInset) {
        expect(caseFrameBox!.x).toBeGreaterThanOrEqual(11.5);
        expect(caseFrameBox!.x + caseFrameBox!.width).toBeLessThanOrEqual(viewport.width - 11.5);
        expect(caseFrameStyle.borderRadius).not.toBe('0px');
      } else {
        expect(caseFrameBox!.x).toBeCloseTo(0, 1);
        expect(caseFrameBox!.width).toBeCloseTo(viewport.width, 0);
        expect(caseFrameStyle.borderRadius).toBe('0px');
        if (supportsBackdropFilter) {
          expect(caseComposerStyle.backdropFilter).toContain('blur(12px)');
        }
      }
    }
  });

  test('keeps interaction motion optional and surfaces legible in forced colors', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await page.emulateMedia({
      colorScheme: 'dark',
      forcedColors: 'active',
      reducedMotion: 'reduce'
    });
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const envelope = page.getByTestId('app-envelope');
    const frame = page.getByTestId('app-content-frame');
    const gutter = page.locator('.server-gutter');
    const sidebar = page.getByTestId('server-sidebar');
    const paneHeader = page.locator('[data-ui="pane-header"]').first();
    const profile = page.getByTestId('current-user-identity-card');
    const composer = page.getByTestId('message-composer-shell');

    for (const surface of [envelope, frame, gutter, sidebar, paneHeader, profile, composer]) {
      await expect(surface).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
      const style = await readSurfaceStyle(surface);
      expect(style.boxShadow).toBe('none');
      expect(style.backdropFilter).toBe('none');
      expectNoDecorativeGradient(style);
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('1px');
    }

    await roomPage.messageInput.click();
    const focusedComposerStyle = await readSurfaceStyle(composer);
    expect(focusedComposerStyle.outlineStyle).toBe('solid');
    expect(focusedComposerStyle.outlineWidth).toBe('2px');

    const sidebarToggle = page.getByRole('button', { name: 'Toggle sidebar' });
    await sidebarToggle.focus();
    const toggleStyle = await readSurfaceStyle(sidebarToggle);
    expect(toggleStyle.outlineStyle).toBe('solid');
    expect(toggleStyle.outlineWidth).toBe('2px');
    expect(toggleStyle.transform).toBe('none');
  });
});
