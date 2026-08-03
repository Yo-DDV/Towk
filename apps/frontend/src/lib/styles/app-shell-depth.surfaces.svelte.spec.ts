import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import './app-shell-depth.surfaces.css';

const desktopViewports = [
  [768, 1024],
  [844, 390],
  [1024, 768],
  [1440, 900],
  [2560, 1080]
] as const;

const mobileViewports = [
  [320, 568],
  [390, 844],
  [600, 720],
  [720, 600]
] as const;

const rootFontSizes = [16, 17, 20, 32] as const;
const sidebarWidths = [256, 360, 480] as const;
const directions = ['ltr', 'rtl'] as const;
const geometryTolerance = 0.55;

let fixture: HTMLElement | null = null;
const originalRootFontSize = document.documentElement.style.fontSize;
const originalDirection = document.documentElement.dir;

interface FixtureHandles {
  shell: HTMLElement;
  currentUserBar: HTMLElement;
  roomColumn: HTMLElement;
  eventList: HTMLElement;
  scrollRoot: HTMLElement;
  composer: HTMLElement;
  lockedNotice: HTMLElement;
  primaryCue: HTMLElement;
  nestedCue: HTMLElement;
  externalCue: HTMLElement;
}

function expectNear(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(geometryTolerance);
}

function createLayoutFixture(): FixtureHandles {
  fixture = document.createElement('div');
  fixture.dataset.testid = 'footer-alignment-fixture';
  fixture.innerHTML = `
    <style>
      [data-testid='footer-alignment-fixture'],
      [data-testid='footer-alignment-fixture'] * {
        box-sizing: border-box;
      }

      [data-testid='footer-alignment-fixture'] {
        --sidebar-width: 22.5rem;
        position: fixed;
        inset: 0;
        overflow: hidden;
      }

      [data-testid='footer-alignment-shell'] {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: 4.5rem var(--sidebar-width) minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) auto;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }

      [data-testid='footer-alignment-server-rail'] {
        grid-column: 1;
        grid-row: 1 / 3;
        min-width: 0;
      }

      [data-testid='footer-alignment-sidebar'] {
        grid-column: 2;
        grid-row: 1;
        min-width: 0;
        min-height: 0;
      }

      [data-testid='footer-alignment-user-bar'] {
        grid-column: 2;
        grid-row: 2;
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 0.5rem;
        border-top: 1px solid transparent;
        padding: 0.5rem;
      }

      [data-testid='footer-alignment-user-identity'] {
        min-height: 3.75rem;
        height: 3.75rem;
        flex: none;
      }

      [data-testid='footer-alignment-call-card'] {
        display: none;
        height: 2.5rem;
        flex: none;
      }

      [data-testid='footer-alignment-fixture'][data-call-expanded='true']
        [data-testid='footer-alignment-call-card'] {
        display: block;
      }

      [data-testid='footer-alignment-room-column'] {
        grid-column: 3;
        grid-row: 1 / 3;
        display: flex;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }

      #room-messages-surface {
        display: flex;
        min-width: 0;
        min-height: 0;
        flex: 1;
        flex-direction: column;
        overflow: visible;
      }

      [data-testid='footer-alignment-event-list'] {
        position: relative;
        display: flex;
        min-width: 0;
        min-height: 0;
        flex: 1;
        flex-direction: column;
        padding-bottom: 0.5rem;
      }

      [data-testid='footer-alignment-scroll-root'] {
        position: relative;
        min-width: 0;
        min-height: 0;
        flex: 1;
      }

      [data-testid='messages-container'] {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: auto;
      }

      [data-ui='scroll-edge-cue'][data-edge='bottom'] {
        position: absolute;
        inset-inline: 0;
        bottom: 0;
        height: 2rem;
      }

      [data-testid='footer-alignment-composer'] {
        display: flex;
        width: 100%;
        min-width: 0;
        flex: none;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.5rem;
      }

      [data-testid='footer-alignment-composer-shell'] {
        min-height: 3.75rem;
      }

      [data-testid='footer-alignment-composer-aux'] {
        display: none;
        height: 2.5rem;
        flex: none;
      }

      [data-testid='footer-alignment-fixture'][data-composer-expanded='true']
        [data-testid='footer-alignment-composer-aux'] {
        display: block;
      }

      [data-testid='footer-alignment-locked-notice'] {
        display: none;
        height: 2.5rem;
        flex: none;
      }

      [data-testid='footer-alignment-fixture'][data-room-locked='true']
        [data-testid='footer-alignment-locked-notice'] {
        display: block;
      }

      [data-testid='footer-alignment-nested-root'],
      [data-testid='footer-alignment-external-root'] {
        position: relative;
        width: 6rem;
        height: 4rem;
      }

      [data-testid='footer-alignment-external-root'] {
        position: fixed;
        inset: 0 auto auto 0;
      }

      @media (max-width: 767px) {
        [data-testid='footer-alignment-shell'] {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: minmax(0, 1fr);
        }

        [data-testid='footer-alignment-server-rail'],
        [data-testid='footer-alignment-sidebar'],
        [data-testid='footer-alignment-user-bar'] {
          display: none;
        }

        [data-testid='footer-alignment-room-column'] {
          grid-column: 1;
          grid-row: 1;
        }
      }
    </style>
    <div data-testid="footer-alignment-shell">
      <div data-testid="footer-alignment-server-rail"></div>
      <div data-testid="footer-alignment-sidebar"></div>
      <div class="current-user-bar" data-testid="footer-alignment-user-bar">
        <div data-testid="footer-alignment-call-card"></div>
        <div data-testid="footer-alignment-user-identity"></div>
      </div>
      <main data-testid="footer-alignment-room-column">
        <section id="room-messages-surface">
          <div data-testid="footer-alignment-event-list">
            <div data-testid="footer-alignment-scroll-root">
              <div data-testid="messages-container">
                <div data-testid="footer-alignment-nested-root">
                  <div data-testid="footer-alignment-nested-content"></div>
                  <div
                    class="scroll-edge-cue"
                    data-ui="scroll-edge-cue"
                    data-edge="bottom"
                    data-testid="footer-alignment-nested-cue"
                  ></div>
                </div>
              </div>
              <div
                class="scroll-edge-cue"
                data-ui="scroll-edge-cue"
                data-edge="bottom"
                data-testid="footer-alignment-primary-cue"
              ></div>
            </div>
          </div>
          <div data-testid="footer-alignment-locked-notice"></div>
          <div data-testid="footer-alignment-composer">
            <div data-testid="footer-alignment-composer-aux"></div>
            <div data-testid="footer-alignment-composer-shell"></div>
          </div>
        </section>
      </main>
    </div>
    <div data-testid="footer-alignment-external-root">
      <div data-testid="footer-alignment-external-content"></div>
      <div
        class="scroll-edge-cue"
        data-ui="scroll-edge-cue"
        data-edge="bottom"
        data-testid="footer-alignment-external-cue"
      ></div>
    </div>
  `;
  document.body.append(fixture);

  return {
    shell: fixture.querySelector<HTMLElement>('[data-testid="footer-alignment-shell"]')!,
    currentUserBar: fixture.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-user-bar"]'
    )!,
    roomColumn: fixture.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-room-column"]'
    )!,
    eventList: fixture.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-event-list"]'
    )!,
    scrollRoot: fixture.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-scroll-root"]'
    )!,
    composer: fixture.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-composer"]'
    )!,
    lockedNotice: fixture.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-locked-notice"]'
    )!,
    primaryCue: fixture.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-primary-cue"]'
    )!,
    nestedCue: fixture.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-nested-cue"]'
    )!,
    externalCue: fixture.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-external-cue"]'
    )!
  };
}

function assertPrimaryCueGeometry(handles: FixtureHandles, alignWithUserBar: boolean) {
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const eventListBounds = handles.eventList.getBoundingClientRect();
  const scrollRootBounds = handles.scrollRoot.getBoundingClientRect();
  const composerBounds = handles.composer.getBoundingClientRect();
  const cueBounds = handles.primaryCue.getBoundingClientRect();
  const cueStyle = getComputedStyle(handles.primaryCue);

  expectNear(Number.parseFloat(cueStyle.bottom), -0.5 * rootFontSize);
  expectNear(Number.parseFloat(cueStyle.height), 2.5 * rootFontSize);
  expectNear(cueBounds.top, scrollRootBounds.bottom - 2 * rootFontSize);
  expectNear(cueBounds.bottom, eventListBounds.bottom);
  expectNear(cueBounds.bottom, composerBounds.top);
  expectNear(cueBounds.left, scrollRootBounds.left);
  expectNear(cueBounds.right, scrollRootBounds.right);

  if (alignWithUserBar) {
    const userBarBounds = handles.currentUserBar.getBoundingClientRect();
    const userBarStyle = getComputedStyle(handles.currentUserBar);
    const userBarStrokeEnd = userBarBounds.top + Number.parseFloat(userBarStyle.borderTopWidth);

    expectNear(cueBounds.bottom, userBarStrokeEnd);
  }

  const shellBounds = handles.shell.getBoundingClientRect();
  const roomBounds = handles.roomColumn.getBoundingClientRect();
  expect(roomBounds.left).toBeGreaterThanOrEqual(shellBounds.left - geometryTolerance);
  expect(roomBounds.right).toBeLessThanOrEqual(shellBounds.right + geometryTolerance);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
}

function assertControlCue(cue: HTMLElement, containingRoot: HTMLElement) {
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const cueBounds = cue.getBoundingClientRect();
  const rootBounds = containingRoot.getBoundingClientRect();
  const cueStyle = getComputedStyle(cue);

  expectNear(Number.parseFloat(cueStyle.bottom), 0);
  expectNear(Number.parseFloat(cueStyle.height), 2 * rootFontSize);
  expectNear(cueBounds.bottom, rootBounds.bottom);
}

afterEach(async () => {
  fixture?.remove();
  fixture = null;
  document.documentElement.style.fontSize = originalRootFontSize;
  document.documentElement.dir = originalDirection;
  await page.viewport(414, 896);
});

describe('room footer boundary alignment', () => {
  it(
    'keeps the desktop footer strokes aligned across viewport, sidebar, direction, and text scales',
    async () => {
      const handles = createLayoutFixture();

      for (const [width, height] of desktopViewports) {
        await page.viewport(width, height);

        for (const rootFontSize of rootFontSizes) {
          document.documentElement.style.fontSize = `${rootFontSize}px`;

          for (const direction of directions) {
            document.documentElement.dir = direction;

            for (const sidebarWidth of sidebarWidths) {
              handles.shell.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
              assertPrimaryCueGeometry(handles, true);
            }
          }
        }
      }
    },
    30_000
  );

  it('keeps the room cue bounded on phone layouts where the desktop user bar is hidden', async () => {
    const handles = createLayoutFixture();

    for (const [width, height] of mobileViewports) {
      await page.viewport(width, height);

      for (const rootFontSize of rootFontSizes) {
        document.documentElement.style.fontSize = `${rootFontSize}px`;

        for (const direction of directions) {
          document.documentElement.dir = direction;
          expect(getComputedStyle(handles.currentUserBar).display).toBe('none');
          assertPrimaryCueGeometry(handles, false);
        }
      }
    }
  });

  it('does not leak the room correction into nested, thread-like, or external bottom cues', () => {
    const handles = createLayoutFixture();
    const nestedRoot = fixture!.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-nested-root"]'
    )!;
    const externalRoot = fixture!.querySelector<HTMLElement>(
      '[data-testid="footer-alignment-external-root"]'
    )!;

    for (const rootFontSize of rootFontSizes) {
      document.documentElement.style.fontSize = `${rootFontSize}px`;
      assertControlCue(handles.nestedCue, nestedRoot);
      assertControlCue(handles.externalCue, externalRoot);
    }
  });

  it('tracks expanded composer and locked-room surfaces without overlap or document overflow', async () => {
    const handles = createLayoutFixture();
    await page.viewport(1440, 900);

    fixture!.dataset.composerExpanded = 'true';
    assertPrimaryCueGeometry(handles, false);

    const expandedCueBottom = handles.primaryCue.getBoundingClientRect().bottom;
    const userBarBounds = handles.currentUserBar.getBoundingClientRect();
    const userBarBorder = Number.parseFloat(getComputedStyle(handles.currentUserBar).borderTopWidth);
    expect(userBarBounds.top + userBarBorder - expandedCueBottom).toBeGreaterThan(1);

    fixture!.dataset.composerExpanded = 'false';
    fixture!.dataset.roomLocked = 'true';

    const eventListBounds = handles.eventList.getBoundingClientRect();
    const cueBounds = handles.primaryCue.getBoundingClientRect();
    const noticeBounds = handles.lockedNotice.getBoundingClientRect();
    const composerBounds = handles.composer.getBoundingClientRect();

    expectNear(cueBounds.bottom, eventListBounds.bottom);
    expectNear(cueBounds.bottom, noticeBounds.top);
    expectNear(noticeBounds.bottom, composerBounds.top);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
  });

  it('keeps the room stable when the current-user call surface expands independently', async () => {
    const handles = createLayoutFixture();
    await page.viewport(1440, 900);

    const roomBefore = handles.roomColumn.getBoundingClientRect();
    const composerBefore = handles.composer.getBoundingClientRect();

    fixture!.dataset.callExpanded = 'true';

    const roomAfter = handles.roomColumn.getBoundingClientRect();
    const composerAfter = handles.composer.getBoundingClientRect();
    assertPrimaryCueGeometry(handles, false);

    expectNear(roomAfter.top, roomBefore.top);
    expectNear(roomAfter.bottom, roomBefore.bottom);
    expectNear(composerAfter.top, composerBefore.top);
    expectNear(composerAfter.bottom, composerBefore.bottom);
  });
});
