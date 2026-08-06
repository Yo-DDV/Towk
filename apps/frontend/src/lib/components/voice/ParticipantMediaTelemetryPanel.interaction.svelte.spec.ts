import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../app.css';
import ParticipantMediaTelemetryPanel from './ParticipantMediaTelemetryPanel.svelte';

function mediaQueryList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true)
  };
}

function useTouchFirstInput() {
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    mediaQueryList(query, query === '(hover: none) and (pointer: coarse)')
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

const baseProps = {
  participantName: 'Alice',
  sourceMetrics: [],
  sourceAggregate: {
    health: 'good' as const,
    latencyMs: 37.8,
    jitterMs: 11.3,
    packetLossPercent: 0
  },
  receptionAggregate: null,
  diagnosis: 'unknown' as const,
  history: [],
  sourceTelemetryReceived: true,
  receptionTelemetrySupported: false
};

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('[data-telemetry-test-fixture]').forEach((element) => element.remove());
});

describe('ParticipantMediaTelemetryPanel touch disclosure', () => {
  it('blocks the follow-up touch click from reaching content behind the dismissed backdrop', () => {
    useTouchFirstInput();
    const underlying = document.createElement('button');
    underlying.dataset.telemetryTestFixture = 'underlying';
    document.body.append(underlying);
    const underlyingClick = vi.fn();
    underlying.addEventListener('click', underlyingClick);

    let unmount: () => void = () => undefined;
    const onclose = vi.fn(() => unmount());
    const rendered = render(ParticipantMediaTelemetryPanel, {
      props: { ...baseProps, panelId: 'telemetry-click-shield', onclose }
    });
    unmount = () => rendered.unmount();

    const backdrop = document.querySelector<HTMLElement>(
      '[data-testid="participant-media-telemetry-backdrop"]'
    )!;
    backdrop.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        clientX: 24,
        clientY: 24
      })
    );
    underlying.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        clientX: 24,
        clientY: 24
      })
    );

    expect(onclose).toHaveBeenCalledOnce();
    expect(underlyingClick).not.toHaveBeenCalled();

    underlying.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 1,
        clientX: 80,
        clientY: 80
      })
    );
    expect(underlyingClick).toHaveBeenCalledOnce();
  });

  it('restores touch focus without reopening the trigger preview', async () => {
    useTouchFirstInput();
    const panelId = 'telemetry-touch-focus';
    const trigger = document.createElement('button');
    trigger.dataset.telemetryTestFixture = 'trigger';
    trigger.setAttribute('aria-controls', panelId);
    document.body.append(trigger);
    const previewFocus = vi.fn();
    trigger.addEventListener('focus', previewFocus);

    let unmount: () => void = () => undefined;
    const onclose = vi.fn(() => {
      unmount();
      requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
    });
    const rendered = render(ParticipantMediaTelemetryPanel, {
      props: { ...baseProps, panelId, onclose }
    });
    unmount = () => rendered.unmount();
    await nextFrame();

    const close = document.querySelector<HTMLButtonElement>(
      '[data-testid="participant-media-telemetry-compact-close"]'
    )!;
    close.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch'
      })
    );
    close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    await nextFrame();

    expect(onclose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    expect(previewFocus).not.toHaveBeenCalled();
  });

  it('keeps ordinary keyboard focus restoration intact', async () => {
    useTouchFirstInput();
    const panelId = 'telemetry-keyboard-focus';
    const trigger = document.createElement('button');
    trigger.dataset.telemetryTestFixture = 'trigger';
    trigger.setAttribute('aria-controls', panelId);
    document.body.append(trigger);
    const previewFocus = vi.fn();
    trigger.addEventListener('focus', previewFocus);

    let unmount: () => void = () => undefined;
    const onclose = vi.fn(() => {
      unmount();
      requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
    });
    const rendered = render(ParticipantMediaTelemetryPanel, {
      props: { ...baseProps, panelId, onclose }
    });
    unmount = () => rendered.unmount();
    await nextFrame();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await nextFrame();

    expect(onclose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    expect(previewFocus).toHaveBeenCalledOnce();
  });

  it('contains the compact table and touch actions at a 280 px viewport', async () => {
    useTouchFirstInput();
    await page.viewport(280, 653);
    const rendered = render(ParticipantMediaTelemetryPanel, {
      props: {
        ...baseProps,
        panelId: 'telemetry-narrow-touch',
        participantName: 'Participant avec un nom volontairement très long',
        onclose: vi.fn()
      }
    });

    try {
      await nextFrame();
      const compact = document.getElementById('telemetry-narrow-touch')!;
      const rect = compact.getBoundingClientRect();
      expect(compact.dataset.testid).toBe('participant-media-telemetry-compact');
      expect(rect.left).toBeGreaterThanOrEqual(-1);
      expect(rect.right).toBeLessThanOrEqual(281);
      expect(compact.scrollWidth).toBeLessThanOrEqual(compact.clientWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(280);

      const table = compact.querySelector<HTMLElement>(
        '[data-testid="participant-media-telemetry-compact-table"]'
      )!;
      expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth);
      for (const selector of [
        '[data-testid="participant-media-telemetry-compact-close"]',
        '[data-testid="participant-media-telemetry-expand"]'
      ]) {
        const action = compact.querySelector<HTMLElement>(selector)!;
        const actionRect = action.getBoundingClientRect();
        expect(actionRect.height).toBeGreaterThanOrEqual(44);
        expect(actionRect.width).toBeGreaterThanOrEqual(44);
      }
    } finally {
      rendered.unmount();
      await page.viewport(1280, 720);
    }
  });
});
