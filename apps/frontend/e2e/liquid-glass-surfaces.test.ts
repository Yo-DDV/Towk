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
      outlineWidth: style.outlineWidth
    };
  });
}

test.describe('Liquid glass application surfaces', () => {
  test('keeps the profile and composer uniformly edge-lit, themed, and responsive', async ({
    page,
    chatPage,
    roomPage
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await createAndLoginTestUser(page);
    await chatPage.goto();
    await chatPage.enterRoom('general');

    const root = page.locator('html');
    const profile = page.getByTestId('current-user-identity-card');
    const composer = page.getByTestId('message-composer-shell');

    await expect(profile).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(composer).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });

    await expect(root).toHaveAttribute('data-theme', 'light');

    const [lightProfileStyle, lightComposerStyle, supportsBackdropFilter] = await Promise.all([
      readSurfaceStyle(profile),
      readSurfaceStyle(composer),
      page.evaluate(
        () =>
          CSS.supports('backdrop-filter', 'blur(1px)') ||
          CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
      )
    ]);

    for (const style of [lightProfileStyle, lightComposerStyle]) {
      expect(style.backgroundColor).toMatch(/rgba?\(248,\s*250,\s*252/);
      expect(style.backgroundImage).toContain('linear-gradient');
      expect(style.backgroundImage).not.toContain('radial-gradient');
      expect(style.borderRadius).not.toBe('0px');
      expect(style.boxShadow).not.toBe('none');
      if (supportsBackdropFilter) {
        expect(style.backdropFilter).toContain('blur(');
      }
    }
    expect(lightProfileStyle.backgroundImage).toBe(lightComposerStyle.backgroundImage);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(profile).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect(composer).toBeVisible({ timeout: TIMEOUTS.UI_STANDARD });
    await expect
      .poll(async () => (await readSurfaceStyle(profile)).backgroundColor)
      .toMatch(/rgba?\(38,\s*38,\s*42/);

    const sidebarToggle = page.getByRole('button', { name: 'Toggle sidebar' });
    await composer.evaluate((element) => element.setAttribute('inert', ''));
    await sidebarToggle.focus();
    await expect(sidebarToggle).toBeFocused();
    await expect
      .poll(() => composer.evaluate((element) => element.matches(':focus-within')))
      .toBe(false);

    const [darkProfileStyle, darkComposerStyle] = await Promise.all([
      readSurfaceStyle(profile),
      readSurfaceStyle(composer)
    ]);

    for (const style of [darkProfileStyle, darkComposerStyle]) {
      expect(style.backgroundColor).toMatch(/rgba?\(38,\s*38,\s*42/);
      expect(style.backgroundImage).toContain('linear-gradient');
      expect(style.backgroundImage).not.toContain('radial-gradient');
      expect(style.boxShadow).not.toBe('none');
    }
    expect(darkProfileStyle.backgroundImage).toBe(darkComposerStyle.backgroundImage);
    expect(darkProfileStyle.backgroundColor).not.toBe(lightProfileStyle.backgroundColor);
    expect(darkComposerStyle.backgroundColor).not.toBe(lightComposerStyle.backgroundColor);

    const [profileBox, restingComposerBox] = await Promise.all([
      profile.boundingBox(),
      composer.boundingBox()
    ]);
    expect(profileBox).not.toBeNull();
    expect(restingComposerBox).not.toBeNull();
    expect(Math.abs(profileBox!.height - restingComposerBox!.height)).toBeLessThanOrEqual(0.5);

    const restingComposerShadow = darkComposerStyle.boxShadow;
    await composer.evaluate((element) => element.removeAttribute('inert'));
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

    const sidebarToggle = page.getByRole('button', { name: 'Toggle sidebar' });
    await composer.evaluate((element) => element.setAttribute('inert', ''));
    await sidebarToggle.focus();
    await expect(sidebarToggle).toBeFocused();
    await expect
      .poll(() => composer.evaluate((element) => element.matches(':focus-within')))
      .toBe(false);

    for (const surface of [profile, composer]) {
      const style = await readSurfaceStyle(surface);
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('1px');
      expect(style.boxShadow).toBe('none');
      expect(style.backdropFilter).toBe('none');
    }

    await composer.evaluate((element) => element.removeAttribute('inert'));
    await roomPage.messageInput.click();
    const focusedComposerStyle = await readSurfaceStyle(composer);
    expect(focusedComposerStyle.outlineStyle).toBe('solid');
    expect(focusedComposerStyle.outlineWidth).toBe('2px');
  });
});
