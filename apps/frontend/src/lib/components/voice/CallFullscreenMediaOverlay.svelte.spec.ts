import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Track } from 'livekit-client';
import { PresenceStatus } from '$lib/render/types';
import '../../../app.css';
import { callFullscreenMedia } from '$lib/state/callFullscreenMedia.svelte';
import CallFullscreenMediaOverlayHarness from './CallFullscreenMediaOverlayHarness.svelte';

function openScreenShare(onClose?: () => void) {
  const track = {
    attach: vi.fn((element: HTMLVideoElement) => element),
    detach: vi.fn((element: HTMLVideoElement) => element)
  } as unknown as Track;

  callFullscreenMedia.open({
    roomId: 'room-1',
    participantKey: 'user-2',
    kind: 'screen',
    track,
    name: "Bob's screen",
    user: {
      id: 'user-2',
      login: 'bob',
      displayName: 'Bob',
      avatarUrl: null,
      presenceStatus: PresenceStatus.Online
    },
    diagnosticsDirection: 'inbound',
    onClose
  });

  return track;
}

describe('CallFullscreenMediaOverlay', () => {
  beforeEach(() => callFullscreenMedia.close());

  it('renders a safe-area-aware full-viewport screen-share dialog with a touch-sized close action', async () => {
    const track = openScreenShare();
    const { container } = render(CallFullscreenMediaOverlayHarness);

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="call-fullscreen-media-overlay"]')
      ).not.toBeNull();
    });

    const dialog = container.querySelector(
      '[data-testid="call-fullscreen-media-overlay"]'
    ) as HTMLElement;
    const video = dialog.querySelector('video') as HTMLVideoElement;
    const closeButton = dialog.querySelector(
      '[data-testid="call-fullscreen-media-close"]'
    ) as HTMLButtonElement;
    const header = dialog.querySelector('header') as HTMLElement;

    dialog.style.setProperty('--call-safe-area-top', '20px');
    dialog.style.setProperty('--call-safe-area-right', '7px');
    dialog.style.setProperty('--call-safe-area-left', '9px');
    const toolbarPadding = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75;

    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('inset-0');
    expect(Math.round(dialog.getBoundingClientRect().width)).toBe(window.innerWidth);
    expect(Math.round(dialog.getBoundingClientRect().height)).toBe(window.innerHeight);
    expect(header.className).toContain('absolute');
    expect(parseFloat(getComputedStyle(header).paddingTop)).toBeCloseTo(20 + toolbarPadding);
    expect(parseFloat(getComputedStyle(header).paddingRight)).toBeCloseTo(7 + toolbarPadding);
    expect(parseFloat(getComputedStyle(header).paddingLeft)).toBeCloseTo(9 + toolbarPadding);
    expect(dialog.querySelector('main')?.className).toContain('h-full');
    expect(video.className).toContain('object-contain');
    expect(track.attach as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(video);
    expect(closeButton.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(
      dialog.querySelector('[data-testid="call-fullscreen-screen-share-stats-button"]')
    ).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');

    closeButton.click();
    await tick();

    expect(callFullscreenMedia.isOpen).toBe(false);
    expect(container.querySelector('[data-testid="call-fullscreen-media-overlay"]')).toBeNull();
    expect(track.detach as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(video);
    expect(document.body.style.overflow).toBe('');
  });

  it('opens screen-share diagnostics from the fullscreen fallback overlay', async () => {
    openScreenShare();
    render(CallFullscreenMediaOverlayHarness);

    const statsButton = await vi.waitFor(() => {
      const value = document.querySelector<HTMLButtonElement>(
        '[data-testid="call-fullscreen-screen-share-stats-button"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });

    statsButton.click();

    const panel = await vi.waitFor(() => {
      const value = document.body.querySelector<HTMLElement>(
        '[data-testid="screen-share-diagnostics-panel"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    expect(statsButton.getAttribute('aria-expanded')).toBe('true');
    expect(panel.parentElement).toBe(document.body);

    document
      .querySelector<HTMLButtonElement>('[data-testid="screen-share-diagnostics-close"]')!
      .click();
    await vi.waitFor(() =>
      expect(
        document.body.querySelector('[data-testid="screen-share-diagnostics-panel"]')
      ).toBeNull()
    );
  });

  it('closes with Escape and keeps Tab focus inside the dialog', async () => {
    openScreenShare();
    const { container } = render(CallFullscreenMediaOverlayHarness);

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="call-fullscreen-media-close"]')).not.toBeNull();
    });

    const closeButton = container.querySelector(
      '[data-testid="call-fullscreen-media-close"]'
    ) as HTMLButtonElement;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(closeButton);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();

    expect(callFullscreenMedia.isOpen).toBe(false);
  });

  it('restores adaptive media quality when the fallback overlay closes', async () => {
    const onClose = vi.fn();
    openScreenShare(onClose);
    const { container } = render(CallFullscreenMediaOverlayHarness);

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="call-fullscreen-media-close"]')).not.toBeNull();
    });
    (
      container.querySelector('[data-testid="call-fullscreen-media-close"]') as HTMLButtonElement
    ).click();
    await tick();

    expect(onClose).toHaveBeenCalledOnce();
  });
});
