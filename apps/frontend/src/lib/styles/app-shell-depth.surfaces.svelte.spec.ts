import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import './app-shell-depth.surfaces.css';

const representativeViewports = [
  [320, 568],
  [390, 844],
  [844, 390],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [2560, 1080]
] as const;

let fixture: HTMLElement | null = null;

function createCueFixture(roomScoped: boolean) {
  fixture = document.createElement('div');
  fixture.dataset.testid = 'footer-alignment-fixture';
  fixture.innerHTML = `
    <style>
      [data-testid='footer-alignment-surface'] {
        position: fixed;
        inset: 1rem auto auto 1rem;
        width: calc(100vw - 2rem);
        height: min(12rem, calc(100vh - 2rem));
      }

      [data-testid='footer-alignment-timeline'] {
        position: relative;
        width: 100%;
        height: calc(100% - 0.5rem);
      }

      [data-testid='footer-alignment-cue'] {
        position: absolute;
        inset-inline: 0;
        bottom: 0;
        height: 2rem;
      }
    </style>
    <div
      ${roomScoped ? 'id="room-messages-surface"' : ''}
      data-testid="footer-alignment-surface"
    >
      <div data-testid="footer-alignment-timeline">
        <div
          class="scroll-edge-cue"
          data-ui="scroll-edge-cue"
          data-edge="bottom"
          data-testid="footer-alignment-cue"
        ></div>
      </div>
    </div>
  `;
  document.body.append(fixture);

  return {
    surface: fixture.querySelector<HTMLElement>('[data-testid="footer-alignment-surface"]')!,
    timeline: fixture.querySelector<HTMLElement>('[data-testid="footer-alignment-timeline"]')!,
    cue: fixture.querySelector<HTMLElement>('[data-testid="footer-alignment-cue"]')!
  };
}

afterEach(async () => {
  fixture?.remove();
  fixture = null;
  await page.viewport(414, 896);
});

describe('room footer boundary alignment', () => {
  it('extends the room bottom cue through the reserved composer spacing at every target viewport', async () => {
    const { surface, timeline, cue } = createCueFixture(true);

    for (const [width, height] of representativeViewports) {
      await page.viewport(width, height);

      const surfaceBounds = surface.getBoundingClientRect();
      const timelineBounds = timeline.getBoundingClientRect();
      const cueBounds = cue.getBoundingClientRect();
      const cueStyle = getComputedStyle(cue);

      expect(cueStyle.bottom).toBe('-8px');
      expect(cueStyle.height).toBe('40px');
      expect(Math.abs(cueBounds.top - (timelineBounds.bottom - 32))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(cueBounds.bottom - surfaceBounds.bottom)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(cueBounds.left - surfaceBounds.left)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(cueBounds.right - surfaceBounds.right)).toBeLessThanOrEqual(0.5);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    }
  });

  it('leaves bottom cues outside the main room surface unchanged', () => {
    const { timeline, cue } = createCueFixture(false);
    const timelineBounds = timeline.getBoundingClientRect();
    const cueBounds = cue.getBoundingClientRect();
    const cueStyle = getComputedStyle(cue);

    expect(cueStyle.bottom).toBe('0px');
    expect(cueStyle.height).toBe('32px');
    expect(Math.abs(cueBounds.bottom - timelineBounds.bottom)).toBeLessThanOrEqual(0.5);
  });
});
