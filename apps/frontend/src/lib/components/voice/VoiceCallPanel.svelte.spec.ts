import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../app.css';
import VoiceCallPanelStoryHarness from './VoiceCallPanelStoryHarness.svelte';

describe('VoiceCallPanel screen-share audio', () => {
  it('shows the audio indicator only on the screen-share tile', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'stage', scenario: 'screen' }
    });

    await vi.waitFor(() => {
      expect(
        container.querySelectorAll('[data-testid="call-screen-share-audio-indicator"]')
      ).toHaveLength(1);
    });

    const featuredCard = container.querySelector('[data-testid="call-featured-stage-card"]');
    expect(
      featuredCard?.querySelector('[data-testid="call-screen-share-audio-indicator"]')
    ).not.toBeNull();

    const screenShareControl = container.querySelector('[data-testid="call-screen-share-toggle"]');
    expect(screenShareControl?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});

describe('VoiceCallPanel screen-share diagnostics', () => {
  it('keeps viewer diagnostics opt-in and closes them without affecting the share', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'stage', scenario: 'screen' }
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="call-screen-share-stats-button"]')
      ).not.toBeNull();
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="call-screen-share-stats-button"]'
    )!;
    expect(button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })).toBe(true);
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="screen-share-diagnostics-panel"]')).toBeNull();

    button.click();

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="screen-share-diagnostics-panel"]')
      ).not.toBeNull();
    });
    const panel = container.querySelector<HTMLElement>(
      '[data-testid="screen-share-diagnostics-panel"]'
    )!;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-describedby')).toBe(`${panel.id}-privacy`);
    expect(container.textContent).toContain('Receiving');
    expect(container.textContent).toContain('1920 × 1080');
    expect(container.textContent).toContain('AV1');

    container
      .querySelector<HTMLButtonElement>('[data-testid="screen-share-diagnostics-close"]')!
      .click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="screen-share-diagnostics-panel"]')).toBeNull();
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('identifies presenter diagnostics and dismisses the panel with Escape', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'stage', scenario: 'screen-single-secondary' }
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="call-screen-share-stats-button"]')
      ).not.toBeNull();
    });
    container
      .querySelector<HTMLButtonElement>('[data-testid="call-screen-share-stats-button"]')!
      .click();

    await vi.waitFor(() => expect(container.textContent).toContain('Sending'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="screen-share-diagnostics-panel"]')).toBeNull();
    });
  });
});
