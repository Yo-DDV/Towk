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
    container.style.width = '260px';
    container.style.maxWidth = '260px';

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
    const deviceControls = Array.from(
      container.querySelectorAll(
        '[data-testid="call-device-microphone-toggle"], [data-testid="call-device-output-toggle"]'
      )
    ) as HTMLButtonElement[];
    const siblingCard = deviceControls[0].closest(
      '[data-testid="call-participant-card"]'
    ) as HTMLElement | null;
    expect(siblingCard).not.toBeNull();
    const cardRect = siblingCard!.getBoundingClientRect();
    const firstActionRect = deviceControls[0].getBoundingClientRect();
    const siblingName = siblingCard!.querySelector(
      '[data-testid="call-participant-name"]'
    ) as HTMLElement | null;
    expect(siblingName).not.toBeNull();
    expect(siblingName!.getBoundingClientRect().right).toBeLessThanOrEqual(
      firstActionRect.left - 2
    );
    for (const control of deviceControls) {
      const controlRect = control.getBoundingClientRect();
      expect(controlRect.right).toBeLessThanOrEqual(cardRect.right);
      expect(controlRect.bottom).toBeLessThanOrEqual(cardRect.bottom);
    }

    const outputControl = container.querySelector(
      '[data-testid="call-output-mute-toggle"]'
    ) as HTMLButtonElement | null;
    expect(outputControl).not.toBeNull();
    expect(outputControl?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(outputControl?.getAttribute('aria-label')).toBe('Mute call audio');
  });

  it('shows an accessible recovery notice and keeps only hang-up available', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'voice', reconnecting: true }
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="call-network-recovery-notice"]')
      ).not.toBeNull();
    });

    const notice = container.querySelector('[data-testid="call-network-recovery-notice"]');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toContain('Oops, there’s a network problem.');
    expect(notice?.textContent).toContain('Towk is trying to reconnect you automatically.');

    for (const testId of [
      'call-device-menu-button',
      'call-camera-toggle',
      'call-mute-toggle',
      'call-screen-share-toggle'
    ]) {
      expect(
        (container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).disabled
      ).toBe(true);
    }
    expect(
      (container.querySelector('[data-testid="call-leave-button"]') as HTMLButtonElement).disabled
    ).toBe(false);
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
