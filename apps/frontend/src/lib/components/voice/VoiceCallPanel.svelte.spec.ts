import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../app.css';
import VoiceCallPanelStoryHarness from './VoiceCallPanelStoryHarness.svelte';

describe('VoiceCallPanel screen-share audio', () => {
  it('shows the audio indicator only on the screen-share tile', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'stage', scenario: 'screen' }
    });

    await vi.waitFor(
      () => {
        expect(
          container.querySelectorAll('[data-testid="call-screen-share-audio-indicator"]')
        ).toHaveLength(1);
      },
      { timeout: 5_000 }
    );

    const featuredCard = container.querySelector('[data-testid="call-featured-stage-card"]');
    expect(
      featuredCard?.querySelector('[data-testid="call-screen-share-audio-indicator"]')
    ).not.toBeNull();

    const screenShareControl = container.querySelector('[data-testid="call-screen-share-toggle"]');
    expect(screenShareControl?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it('distinguishes two connections from the same account and exposes call audio control', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'devices' }
    });

    await vi.waitFor(
      () => {
        expect(container.querySelectorAll('[data-testid="call-device-badge"]')).toHaveLength(2);
      },
      { timeout: 5_000 }
    );

    expect(
      Array.from(container.querySelectorAll('[data-testid="call-device-badge"]')).map((element) =>
        element.textContent?.trim()
      )
    ).toEqual(['Device 1', 'Device 2']);

    const participantNames = Array.from(
      container.querySelectorAll('[data-testid="call-participant-name"]')
    );
    const deviceBadges = Array.from(
      container.querySelectorAll('[data-testid="call-device-badge"]')
    );
    expect(participantNames).toHaveLength(2);
    for (const [index, participantName] of participantNames.entries()) {
      const nameRect = participantName.getBoundingClientRect();
      const badgeRect = deviceBadges[index].getBoundingClientRect();
      expect(badgeRect.top).toBeGreaterThanOrEqual(nameRect.bottom - 1);
      expect(participantName.textContent?.trim()).toBe('Alexandria Montgomery');
    }

    expect(container.querySelector('[data-testid="call-device-microphone-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="call-device-output-toggle"]')).not.toBeNull();

    const outputControl = container.querySelector(
      '[data-testid="call-output-mute-toggle"]'
    ) as HTMLButtonElement | null;
    expect(outputControl).not.toBeNull();
    expect(outputControl?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(outputControl?.getAttribute('aria-label')).toBe('Mute call audio');
  });
});
