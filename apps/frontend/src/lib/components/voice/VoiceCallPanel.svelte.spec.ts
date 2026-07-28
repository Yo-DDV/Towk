import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../app.css';
import VoiceCallPanelStoryHarness from './VoiceCallPanelStoryHarness.svelte';

vi.mock('$lib/state/activeServer.svelte', () => ({
  getActiveServer: () => 'storybook-call-server'
}));

function mediaDevice(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return {
    deviceId,
    groupId: `${kind}-group`,
    kind,
    label,
    toJSON: () => ({ deviceId, groupId: `${kind}-group`, kind, label })
  } as MediaDeviceInfo;
}

function mediaQuery(matches: boolean, media: string): MediaQueryList {
  return {
    matches,
    media,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true
  };
}

describe('VoiceCallPanel screen-share audio', () => {
  it('shows an accessible central status while the local call is joining', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'stage', scenario: 'voice', joining: true }
    });

    const status = await vi.waitFor(() => {
      const value = container.querySelector('[data-testid="call-joining-status"]');
      expect(value).not.toBeNull();
      return value!;
    });

    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain('Connecting');
    expect(container.querySelector('[data-testid="call-participant-card"]')).toBeNull();
  });

  it('shows measured packet loss for a degraded remote participant', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'voice' }
    });

    await vi.waitFor(
      () => {
        expect(
          container.querySelector('[data-testid="call-packet-loss-indicator"]')
        ).not.toBeNull();
      },
      { timeout: 5_000 }
    );

    const indicator = container.querySelector('[data-testid="call-packet-loss-indicator"]');
    expect(indicator?.textContent).toContain('12.4%');
    expect(indicator?.getAttribute('aria-label')).toBe('Unstable network — 12.4% packet loss');
  });

  it('shows jitter rather than a misleading 0% packet-loss warning', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'voice', jitterWarning: true }
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="call-jitter-indicator"]')).not.toBeNull();
    });

    const indicator = container.querySelector('[data-testid="call-jitter-indicator"]');
    expect(indicator?.textContent).toContain('82 ms');
    expect(indicator?.getAttribute('aria-label')).toBe('Unstable network — 82 ms jitter');
    expect(container.querySelector('[data-testid="call-packet-loss-indicator"]')).toBeNull();
  });

  it('navigates the device menu and restores its trigger focus', async () => {
    const devices = [
      mediaDevice('audioinput', 'mic-1', 'Microphone 1'),
      mediaDevice('audiooutput', 'speaker-1', 'Speaker 1'),
      mediaDevice('videoinput', 'camera-1', 'Camera 1')
    ];
    const enumerateDevices = vi
      .spyOn(navigator.mediaDevices, 'enumerateDevices')
      .mockResolvedValue(devices);
    const originalSetSinkId = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'setSinkId'
    );
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      configurable: true,
      value: vi.fn(async () => undefined)
    });
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'voice' }
    });

    const trigger = await vi.waitFor(() => {
      const value = container.querySelector<HTMLButtonElement>(
        '[data-testid="global-call-dock-devices"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    trigger.focus();
    trigger.click();

    const { processingItems, deviceItems, menuItems } = await vi.waitFor(() => {
      const processingValues = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')
      );
      const deviceValues = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
      );
      const values = [...processingValues, ...deviceValues];
      expect(processingValues.map((item) => item.textContent?.trim())).toEqual([
        'Noise reduction Requested, unavailable on this route',
        'Automatic gain Requested, unavailable on this route',
        'Echo cancellation Requested, status not exposed by this browser',
        'Screen-share frame rate Stable · up to 30 FPS'
      ]);
      expect(deviceValues).toHaveLength(3);
      expect(document.activeElement).toBe(processingValues[0]);
      return { processingItems: processingValues, deviceItems: deviceValues, menuItems: values };
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(processingItems[0]?.getAttribute('aria-checked')).toBe('true');
    expect(deviceItems[0]?.getAttribute('aria-checked')).toBe('true');
    processingItems[0]?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    expect(document.activeElement).toBe(processingItems[1]);
    processingItems[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(menuItems.at(-1));
    menuItems.at(-1)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await vi.waitFor(() => {
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    if (originalSetSinkId) {
      Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', originalSetSinkId);
    } else {
      delete (HTMLMediaElement.prototype as Partial<HTMLMediaElement>).setSinkId;
    }
    enumerateDevices.mockRestore();
  });

  it('closes the device menu when pressing its trigger again', async () => {
    const devices = [
      mediaDevice('audioinput', 'mic-1', 'Microphone 1'),
      mediaDevice('audiooutput', 'speaker-1', 'Speaker 1'),
      mediaDevice('videoinput', 'camera-1', 'Camera 1')
    ];
    const enumerateDevices = vi
      .spyOn(navigator.mediaDevices, 'enumerateDevices')
      .mockResolvedValue(devices);
    const originalSetSinkId = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'setSinkId'
    );
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      configurable: true,
      value: vi.fn(async () => undefined)
    });
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'voice' }
    });

    const trigger = await vi.waitFor(() => {
      const value = container.querySelector<HTMLButtonElement>(
        '[data-testid="global-call-dock-devices"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    trigger.focus();
    trigger.click();

    await vi.waitFor(() => {
      expect(document.querySelector('#call-audio-device-menu[role="menu"]')).not.toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    trigger.click();

    await vi.waitFor(() => {
      expect(document.querySelector('#call-audio-device-menu[role="menu"]')).toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    });

    if (originalSetSinkId) {
      Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', originalSetSinkId);
    } else {
      delete (HTMLMediaElement.prototype as Partial<HTMLMediaElement>).setSinkId;
    }
    enumerateDevices.mockRestore();
  });

  it('exposes the standards speaker picker as a direct menu action', async () => {
    const devices = [mediaDevice('audioinput', 'mic-1', 'Microphone 1')];
    const enumerateDevices = vi
      .spyOn(navigator.mediaDevices, 'enumerateDevices')
      .mockResolvedValue(devices);
    const originalPicker = Object.getOwnPropertyDescriptor(
      navigator.mediaDevices,
      'selectAudioOutput'
    );
    Object.defineProperty(navigator.mediaDevices, 'selectAudioOutput', {
      configurable: true,
      value: vi.fn()
    });
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'voice' }
    });

    const trigger = await vi.waitFor(() => {
      const value = container.querySelector<HTMLButtonElement>(
        '[data-testid="global-call-dock-devices"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    trigger.click();

    await vi.waitFor(() => {
      const picker = Array.from(
        document.querySelectorAll<HTMLButtonElement>('#call-audio-device-menu [role="menuitem"]')
      ).find((item) => item.textContent?.trim() === 'Choose another speaker…');
      expect(picker).not.toBeUndefined();
      expect(picker!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    });

    if (originalPicker) {
      Object.defineProperty(navigator.mediaDevices, 'selectAudioOutput', originalPicker);
    } else {
      delete (
        navigator.mediaDevices as MediaDevices & {
          selectAudioOutput?: () => Promise<MediaDeviceInfo>;
        }
      ).selectAudioOutput;
    }
    enumerateDevices.mockRestore();
  });

  it('keeps menu semantics and focus in the touch bottom sheet', async () => {
    const devices = [mediaDevice('audioinput', 'mic-1', 'Microphone 1')];
    const enumerateDevices = vi
      .spyOn(navigator.mediaDevices, 'enumerateDevices')
      .mockResolvedValue(devices);
    const matchMedia = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation((query) => mediaQuery(query === '(pointer: coarse)', query));
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'voice' }
    });

    const trigger = await vi.waitFor(() => {
      const value = container.querySelector<HTMLButtonElement>(
        '[data-testid="global-call-dock-devices"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    trigger.focus();
    trigger.click();

    const item = await vi.waitFor(() => {
      expect(document.querySelector('dialog[open]')).not.toBeNull();
      const menu = document.querySelector<HTMLElement>('#call-audio-device-menu[role="menu"]');
      expect(menu).not.toBeNull();
      const value = menu!.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]');
      expect(value?.closest('[role="group"]')).not.toBeNull();
      expect(document.activeElement).toBe(value);
      return value!;
    });
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await vi.waitFor(() => {
      expect(document.querySelector('dialog[open]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
    enumerateDevices.mockRestore();
    matchMedia.mockRestore();
  });

  it('keeps mobile capture devices while explaining system-managed audio output', async () => {
    const devices = [
      mediaDevice('audioinput', 'default', 'Default - Phone microphone'),
      mediaDevice('videoinput', 'mobile-front', 'camera2 1, facing front'),
      mediaDevice('videoinput', 'mobile-ultra', 'camera2 2, facing back, ultra wide')
    ];
    const enumerateDevices = vi
      .spyOn(navigator.mediaDevices, 'enumerateDevices')
      .mockResolvedValueOnce(devices)
      .mockRejectedValueOnce(
        new DOMException('Audio output routing is system-managed', 'NotSupportedError')
      )
      .mockResolvedValueOnce(devices);
    const originalPicker = Object.getOwnPropertyDescriptor(
      navigator.mediaDevices,
      'selectAudioOutput'
    );
    Object.defineProperty(navigator.mediaDevices, 'selectAudioOutput', {
      configurable: true,
      value: undefined
    });
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: {
        layout: 'sidebar',
        scenario: 'voice',
        microphoneProcessing: {
          automaticGainControl: 'towk',
          echoCancellation: false,
          noiseSuppression: 'rnnoise'
        }
      }
    });

    const trigger = await vi.waitFor(() => {
      const value = container.querySelector<HTMLButtonElement>(
        '[data-testid="global-call-dock-devices"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    trigger.click();

    await vi.waitFor(() => {
      const menus = Array.from(document.querySelectorAll<HTMLElement>('#call-audio-device-menu'));
      const menu = menus.at(-1);
      expect(menu).not.toBeUndefined();
      const items = Array.from(menu!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
      expect(items.map((item) => item.textContent?.trim())).toEqual([
        'System default — Phone microphone',
        'Front camera',
        'Ultra-wide camera'
      ]);
      expect(menu!.textContent).toContain('Audio output is managed by your device');
      expect(menu!.textContent).toContain('Microphone processing is limited on this route.');
      expect(menu!.textContent).not.toContain('Unknown device');
    });

    if (originalPicker) {
      Object.defineProperty(navigator.mediaDevices, 'selectAudioOutput', originalPicker);
    } else {
      delete (
        navigator.mediaDevices as MediaDevices & {
          selectAudioOutput?: () => Promise<MediaDeviceInfo>;
        }
      ).selectAudioOutput;
    }
    enumerateDevices.mockRestore();
  });

  it('offers a one-touch camera switch when several phone lenses are available', async () => {
    const devices = [
      mediaDevice('audioinput', 'mobile-microphone', 'Phone microphone'),
      mediaDevice('videoinput', 'mobile-front', 'camera2 1, facing front'),
      mediaDevice('videoinput', 'mobile-rear', 'camera2 0, facing back')
    ];
    const enumerateDevices = vi
      .spyOn(navigator.mediaDevices, 'enumerateDevices')
      .mockResolvedValue(devices);
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'camera' }
    });

    const control = await vi.waitFor(() => {
      const value = container.querySelector<HTMLButtonElement>(
        '[data-testid="call-switch-camera-button"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    expect(control.getAttribute('aria-label')).toBe('Switch camera');
    expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);

    enumerateDevices.mockRestore();
  });

  it('keeps unavailable web screen sharing compact and explains it only on tap', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'getDisplayMedia');
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: undefined
    });

    try {
      const { container } = render(VoiceCallPanelStoryHarness, {
        props: { layout: 'sidebar', scenario: 'voice' }
      });

      const control = await vi.waitFor(() => {
        const value = container.querySelector<HTMLButtonElement>(
          '[data-testid="global-call-dock-screen-share"]'
        );
        expect(value).not.toBeNull();
        return value!;
      });
      expect(control.disabled).toBe(false);
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect(control.querySelector('.uil--desktop-slash')).not.toBeNull();
      expect(container.querySelector('[data-testid="call-screen-share-unsupported"]')).toBeNull();
    } finally {
      if (original) {
        Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', original);
      } else {
        Reflect.deleteProperty(navigator.mediaDevices, 'getDisplayMedia');
      }
    }
  });

  it('keeps an interrupted participant visible with an accessible reconnecting indicator', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'voice', interrupted: true }
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="call-reconnecting-indicator"]')).not.toBeNull();
    });

    const interruptedCard = container.querySelector(
      '[data-testid="call-participant-card"][data-connection-state="interrupted"]'
    );
    expect(interruptedCard).not.toBeNull();
    expect(interruptedCard?.textContent).toContain('Bob');
    expect(interruptedCard?.getAttribute('title')).toContain(
      'Connection interrupted — waiting for this participant to reconnect'
    );
    expect(
      interruptedCard
        ?.querySelector('[data-testid="call-reconnecting-indicator"]')
        ?.getAttribute('aria-label')
    ).toBe('Connection interrupted — waiting for this participant to reconnect');
  });

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

    const screenShareControl = container.querySelector(
      '[data-testid="global-call-dock-screen-share"]'
    );
    expect(screenShareControl?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it('requests the high receiver layer for a featured remote screen share', async () => {
    const setParticipantMediaExpanded = vi.fn();
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: {
        layout: 'stage',
        scenario: 'screen',
        onStoreSeeded: (store) => {
          vi.spyOn(store.voiceCall, 'setParticipantMediaExpanded').mockImplementation(
            setParticipantMediaExpanded
          );
        }
      }
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="call-featured-stage-card"]')).not.toBeNull();
      expect(setParticipantMediaExpanded).toHaveBeenCalledWith('dana', 'screen', true);
    });
  });

  it('uses a horizontal shared-media composition in a short landscape call surface', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: {
        layout: 'stage',
        scenario: 'screen',
        dockVariant: 'floating',
        viewportWidth: '844px',
        viewportHeight: '390px'
      }
    });

    const stage = await vi.waitFor(() => {
      const value = container.querySelector<HTMLElement>('[data-testid="call-stage-layout"]');
      expect(value?.dataset.stageOrientation).toBe('horizontal');
      return value!;
    });
    const featured = stage.querySelector<HTMLElement>('[data-testid="call-featured-stage"]')!;
    const secondary = stage.querySelector<HTMLElement>(
      '[data-testid="call-secondary-stage-list"]'
    )!;
    const secondaryRect = secondary.getBoundingClientRect();

    expect(featured.getBoundingClientRect().height).toBeGreaterThanOrEqual(144);
    expect(secondaryRect.right).toBeLessThanOrEqual(stage.getBoundingClientRect().right);
    for (const card of secondary.querySelectorAll<HTMLElement>(
      '[data-testid="call-participant-card"]'
    )) {
      const cardRect = card.getBoundingClientRect();
      expect(cardRect.top).toBeGreaterThanOrEqual(secondaryRect.top);
      expect(cardRect.bottom).toBeLessThanOrEqual(secondaryRect.bottom);
    }
  });

  it('keeps a secondary screen share usable in a short landscape rail', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: {
        layout: 'stage',
        scenario: 'dual-screen',
        dockVariant: 'floating',
        viewportWidth: '844px',
        viewportHeight: '390px'
      }
    });

    const secondary = await vi.waitFor(() => {
      const value = container.querySelector<HTMLElement>(
        '[data-testid="call-secondary-stage-list"]'
      );
      expect(value?.children).toHaveLength(1);
      return value!;
    });
    const card = secondary.firstElementChild as HTMLElement;
    const focus = secondary.querySelector<HTMLElement>('[data-testid="call-focus-stage-button"]')!;
    const secondaryRect = secondary.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const focusRect = focus.getBoundingClientRect();

    expect(cardRect.height).toBe(secondaryRect.height);
    expect(focusRect.left).toBeGreaterThanOrEqual(cardRect.left);
    expect(focusRect.bottom).toBeLessThanOrEqual(cardRect.bottom);
    expect(secondary.querySelector('[data-testid="call-media-actions"]')).toBeNull();
    expect(secondary.textContent).toContain("Dana's screen");
  });

  it('keeps the portrait filmstrip card fully visible above the call dock', async () => {
    document.documentElement.style.setProperty('--global-call-safe-area-bottom', '34px');
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: {
        layout: 'stage',
        scenario: 'screen',
        dockVariant: 'floating',
        viewportWidth: '320px',
        viewportHeight: '568px'
      }
    });
    window.dispatchEvent(new Event('resize'));

    const secondary = await vi.waitFor(() => {
      const value = container.querySelector<HTMLElement>(
        '[data-testid="call-secondary-stage-list"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    const secondaryRect = secondary.getBoundingClientRect();
    const cardRect = secondary
      .querySelector<HTMLElement>(
        '[data-testid="call-screen-share-card"],[data-testid="call-participant-card"]'
      )!
      .getBoundingClientRect();
    const featuredRect = container
      .querySelector<HTMLElement>('[data-testid="call-featured-stage"]')!
      .getBoundingClientRect();

    expect(cardRect.top).toBeGreaterThanOrEqual(secondaryRect.top - 1);
    expect(cardRect.bottom).toBeLessThanOrEqual(secondaryRect.bottom + 1);
    expect(featuredRect.height).toBeGreaterThanOrEqual(144);
    document.documentElement.style.removeProperty('--global-call-safe-area-bottom');
  });

  it('uses a balanced gallery instead of promoting a camera when nobody shares', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'stage', scenario: 'camera' }
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="call-gallery-layout"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="call-featured-stage-card"]')).toBeNull();
      const mountedCards = container.querySelectorAll(
        '[data-testid="call-participant-card"]'
      ).length;
      expect(mountedCards).toBeGreaterThan(0);
      expect(mountedCards).toBeLessThanOrEqual(3);
      if (mountedCards < 3) {
        expect(container.querySelector('[data-testid="call-gallery-pagination"]')).not.toBeNull();
      }
    });
  });

  it.each([1, 2, 3, 4, 6, 9, 12])(
    'renders %i voice participants as bounded adaptive gallery tiles',
    async (participantCount) => {
      const { container } = render(VoiceCallPanelStoryHarness, {
        props: { layout: 'stage', scenario: 'voice', participantCount }
      });
      container.style.width = '1000px';
      container.style.height = '700px';

      const pageCapacity = await vi.waitFor(() => {
        const list = container.querySelector<HTMLElement>('[data-testid="call-participants-list"]');
        expect(list).not.toBeNull();
        const capacity = Number(list!.dataset.pageCapacity);
        expect(capacity).toBeGreaterThan(0);
        expect(container.querySelectorAll('[data-testid="call-gallery-tile"]')).toHaveLength(
          Math.min(participantCount, capacity)
        );
        return capacity;
      });

      for (const tile of container.querySelectorAll<HTMLElement>(
        '[data-testid="call-gallery-tile"]'
      )) {
        const rect = tile.getBoundingClientRect();
        expect(Math.abs(rect.width - rect.height)).toBeLessThanOrEqual(1);
        expect(rect.width).toBeGreaterThanOrEqual(144);
      }
      expect(Boolean(container.querySelector('[data-testid="call-gallery-pagination"]'))).toBe(
        participantCount > pageCapacity
      );
    }
  );

  it('keeps a single voice participant centered in a square card with a prominent avatar', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'stage', scenario: 'voice', participantCount: 1 }
    });
    container.style.width = '1000px';
    container.style.height = '700px';

    const tile = await vi.waitFor(() => {
      const value = container.querySelector<HTMLElement>('[data-testid="call-gallery-tile"]');
      expect(value).not.toBeNull();
      return value!;
    });

    expect(tile.querySelector('[data-testid="call-gallery-voice-avatar"]')).not.toBeNull();
    const rect = tile.getBoundingClientRect();
    expect(Math.abs(rect.width - rect.height)).toBeLessThanOrEqual(1);
    expect(rect.width).toBeLessThanOrEqual(520);
  });

  it('lets the user select either concurrent screen share without nested controls', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'stage', scenario: 'dual-screen' }
    });

    const focusDana = await vi.waitFor(() => {
      const featured = container.querySelector('[data-testid="call-featured-stage-card"]');
      expect(featured?.textContent).toContain('Alice');
      const button = container.querySelector<HTMLButtonElement>(
        '[data-testid="call-focus-stage-button"]'
      );
      expect(button?.getAttribute('aria-label')).toContain('Dana');
      expect(button?.closest('[data-testid="call-screen-share-card"]')).toBeNull();
      return button!;
    });

    focusDana.click();

    await vi.waitFor(() => {
      const featured = container.querySelector('[data-testid="call-featured-stage-card"]');
      expect(featured?.textContent).toContain('Dana');
      expect(
        container
          .querySelector('[data-testid="call-focus-stage-button"]')
          ?.getAttribute('aria-label')
      ).toContain('Alice');
    });
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
      '[data-testid="global-call-dock-output"]'
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
      'global-call-dock-devices',
      'global-call-dock-camera',
      'global-call-dock-microphone',
      'global-call-dock-screen-share'
    ]) {
      expect(
        (container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).disabled
      ).toBe(true);
    }
    expect(
      (container.querySelector('[data-testid="global-call-dock-leave"]') as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it('explains an automatic microphone route recovery without hiding device controls', async () => {
    const { container } = render(VoiceCallPanelStoryHarness, {
      props: { layout: 'sidebar', scenario: 'voice', microphoneRouteRecovering: true }
    });

    const notice = await vi.waitFor(() => {
      const value = container.querySelector(
        '[data-testid="call-microphone-route-recovery-notice"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });

    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('Microphone disconnected.');
    expect(notice.textContent).toContain('Towk is automatically looking for another audio input.');
    expect(
      (container.querySelector('[data-testid="global-call-dock-devices"]') as HTMLButtonElement)
        .disabled
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
    const mediaActions = container.querySelector<HTMLElement>('[data-testid="call-media-actions"]');
    expect(mediaActions).not.toBeNull();
    expect(button.closest('[data-testid="call-media-actions"]')).toBe(mediaActions);
    const mediaCard = button.closest<HTMLElement>('[data-call-media-card]');
    expect(mediaCard).not.toBeNull();
    const actionButtons = Array.from(mediaActions!.querySelectorAll<HTMLButtonElement>('button'));
    expect(actionButtons.length).toBeGreaterThanOrEqual(3);

    for (const width of [180, 320]) {
      Object.assign(mediaCard!.style, {
        width: `${width}px`,
        maxWidth: `${width}px`,
        justifySelf: 'start'
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const cardRect = mediaCard!.getBoundingClientRect();
      const toolbarRect = mediaActions!.getBoundingClientRect();
      expect(toolbarRect.left).toBeGreaterThanOrEqual(cardRect.left);
      expect(toolbarRect.right).toBeLessThanOrEqual(cardRect.right);

      const buttonRects = actionButtons.map((actionButton) => actionButton.getBoundingClientRect());
      for (let leftIndex = 0; leftIndex < buttonRects.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < buttonRects.length; rightIndex += 1) {
          const leftRect = buttonRects[leftIndex];
          const rightRect = buttonRects[rightIndex];
          const overlaps =
            leftRect.left < rightRect.right &&
            leftRect.right > rightRect.left &&
            leftRect.top < rightRect.bottom &&
            leftRect.bottom > rightRect.top;
          expect(overlaps).toBe(false);
        }
      }
    }

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
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('aria-modal')).toBeNull();
    expect(panel.className).toContain('absolute');
    expect(panel.closest('[data-call-media-card]')).toBe(mediaCard);
    expect(panel.textContent).toContain('Receiving');
    expect(panel.textContent).toContain('1920 × 1080');
    expect(panel.textContent).not.toContain('Technical details');
    expect(panel.textContent).toContain('AV1');

    container
      .querySelector<HTMLButtonElement>('[data-testid="screen-share-diagnostics-close"]')!
      .click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="screen-share-diagnostics-panel"]')).toBeNull();
    });
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

    await vi.waitFor(() =>
      expect(
        container.querySelector('[data-testid="screen-share-diagnostics-panel"]')?.textContent
      ).toContain('Sending')
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="screen-share-diagnostics-panel"]')).toBeNull();
    });
  });
});
