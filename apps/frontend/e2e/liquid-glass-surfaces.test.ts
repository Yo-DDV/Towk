import type { Locator } from '@playwright/test';
import { expect, test } from './setup';
import { createAndLoginTestUser } from './fixtures/testUser';
import { TIMEOUTS } from './constants';

type SurfaceStyle = {
  backgroundImage: string;
  backdropFilter: string;
  borderRadius: string;
  borderTopStyle: string;
  borderTopWidth: string;
  boxShadow: string;
  outlineStyle: string;
  outlineWidth: string;
};

async function readSurfaceStyle(locator: Locator): Promise<SurfaceStyle> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      backdropFilter:
        style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter') || 'none',
      borderRadius: style.borderRadius,
      borderTopStyle: style.borderTopStyle,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth
    };
  });
}

test.describe('Liquid glass application surfaces', () => {
  test('keeps the profile and composer readable, elevated, and responsive', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const profile = page.getByTestId('current-user-identity-card');
    const composer = page.getByTestId('message-composer-shell');

    await expect(profile).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(composer).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });

    const [profileStyle, composerStyle, supportsBackdropFilter] = await Promise.all([
      readSurfaceStyle(profile),
      readSurfaceStyle(composer),
      page.evaluate(
        () =>
          CSS.supports('backdrop-filter', 'blur(1px)') ||
          CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
      )
    ]);

    for (const style of [profileStyle, composerStyle]) {
      expect(style.backgroundImage).toContain('radial-gradient');
      expect(style.backgroundImage).toContain('linear-gradient');
      expect(style.borderTopStyle).toBe('solid');
      expect(style.borderTopWidth).toBe('1px');
      expect(style.borderRadius).not.toBe('0px');
      expect(style.boxShadow).not.toBe('none');
      if (supportsBackdropFilter) {
        expect(style.backdropFilter).toContain('blur(');
      }
    }

    const restingComposerShadow = composerStyle.boxShadow;
    await roomPage.messageInput.click();
    await expect
      .poll(async () => (await readSurfaceStyle(composer)).boxShadow)
      .not.toBe(restingComposerShadow);
    await expect
      .poll(async () => (await readSurfaceStyle(composer)).boxShadow)
      .toContain('232, 120, 59');

    await page.setViewportSize({ width: 375, height: 667 });
    await expect(composer).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });

    const composerBox = await composer.boundingBox();
    expect(composerBox).not.toBeNull();
    expect(composerBox!.x).toBeGreaterThanOrEqual(0);
    expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(375.5);
  });

  test('falls back to native high-contrast surfaces without decorative effects', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const profile = page.getByTestId('current-user-identity-card');
    const composer = page.getByTestId('message-composer-shell');

    await expect(profile).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(composer).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });

    for (const surface of [profile, composer]) {
      const style = await readSurfaceStyle(surface);
      expect(style.borderTopStyle).toBe('solid');
      expect(style.borderTopWidth).toBe('1px');
      expect(style.boxShadow).toBe('none');
      expect(style.backdropFilter).toBe('none');
    }

    await roomPage.messageInput.click();
    const focusedComposerStyle = await readSurfaceStyle(composer);
    expect(focusedComposerStyle.outlineStyle).toBe('solid');
    expect(focusedComposerStyle.outlineWidth).toBe('2px');
  });
});
