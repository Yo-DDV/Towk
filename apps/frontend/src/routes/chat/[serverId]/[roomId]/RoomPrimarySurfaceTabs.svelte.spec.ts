import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../../app.css';
import RoomPrimarySurfaceTabs from './RoomPrimarySurfaceTabs.svelte';

const mocks = vi.hoisted(() => ({
  surface: 'messages' as 'messages' | 'call',
  selectRoomPrimarySurface: vi.fn(),
  requestCall: vi.fn(),
  onmessages: vi.fn()
}));

vi.mock('$lib/state/appUi.svelte', () => ({
  getAppUiState: () => ({
    roomPrimarySurfaceFor: () => mocks.surface,
    selectRoomPrimarySurface: mocks.selectRoomPrimarySurface
  })
}));

vi.mock('$lib/state/callJoinController.svelte', () => ({
  getCallJoinController: () => ({
    request: mocks.requestCall
  })
}));

vi.mock('$lib/state/server/registry.svelte', () => ({
  serverRegistry: {
    tryGetStore: () => undefined
  }
}));

async function settleLayout(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function renderTabs(containerWidth: number, hasActiveCall = false) {
  const result = render(RoomPrimarySurfaceTabs, {
    props: {
      serverId: 'server-1',
      roomId: 'room-1',
      hasActiveCall,
      onmessages: mocks.onmessages
    }
  });
  result.container.classList.add('@container');
  result.container.style.width = `${containerWidth}px`;
  return result;
}

describe('RoomPrimarySurfaceTabs', () => {
  beforeEach(() => {
    mocks.surface = 'messages';
    mocks.selectRoomPrimarySurface.mockReset();
    mocks.requestCall.mockReset();
    mocks.onmessages.mockReset();
  });

  it('keeps compact tabs within two 44px touch targets in a narrow room pane', async () => {
    const { container } = renderTabs(390);
    await settleLayout();

    const tablist = container.querySelector(
      '[data-testid="room-primary-surface-tabs"]'
    ) as HTMLElement;
    const messages = container.querySelector('[data-testid="room-messages-tab"]') as HTMLElement;
    const call = container.querySelector('[data-testid="room-call-tab"]') as HTMLElement;
    const messagesLabel = container.querySelector(
      '[data-testid="room-messages-tab-label"]'
    ) as HTMLElement;
    const callLabel = container.querySelector('[data-testid="room-call-tab-label"]') as HTMLElement;

    expect(Math.round(messages.getBoundingClientRect().width)).toBe(44);
    expect(Math.round(messages.getBoundingClientRect().height)).toBe(44);
    expect(Math.round(call.getBoundingClientRect().width)).toBe(44);
    expect(Math.round(call.getBoundingClientRect().height)).toBe(44);
    expect(Math.round(tablist.getBoundingClientRect().height)).toBe(48);
    expect(tablist.getBoundingClientRect().width).toBeLessThanOrEqual(96);
    expect(messagesLabel.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    expect(callLabel.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it('reveals both labels only when the room pane is wide enough', async () => {
    const { container } = renderTabs(800);
    await settleLayout();

    const messages = container.querySelector('[data-testid="room-messages-tab"]') as HTMLElement;
    const call = container.querySelector('[data-testid="room-call-tab"]') as HTMLElement;
    const messagesLabel = container.querySelector(
      '[data-testid="room-messages-tab-label"]'
    ) as HTMLElement;
    const callLabel = container.querySelector('[data-testid="room-call-tab-label"]') as HTMLElement;

    expect(messages.getBoundingClientRect().width).toBeGreaterThan(70);
    expect(call.getBoundingClientRect().width).toBeGreaterThan(52);
    expect(messagesLabel.getBoundingClientRect().width).toBeGreaterThan(20);
    expect(callLabel.getBoundingClientRect().width).toBeGreaterThan(20);
  });

  it('keeps the active-call pulse anchored to its compact indicator on wide panes', async () => {
    const { container } = renderTabs(800, true);
    await settleLayout();

    const pulse = container.querySelector('.animate-ping') as HTMLElement;
    const indicator = pulse.parentElement as HTMLElement;
    const call = container.querySelector('[data-testid="room-call-tab"]') as HTMLElement;
    const callLabel = container.querySelector('[data-testid="room-call-tab-label"]') as HTMLElement;
    const indicatorStyle = getComputedStyle(indicator);
    const pulseStyle = getComputedStyle(pulse);
    const callRect = call.getBoundingClientRect();
    const callLabelRect = callLabel.getBoundingClientRect();
    const indicatorRect = indicator.getBoundingClientRect();
    const callCenterY = callRect.y + callRect.height / 2;
    const indicatorCenterY = indicatorRect.y + indicatorRect.height / 2;

    expect(indicatorStyle.position).toBe('relative');
    expect(Number.parseFloat(indicatorStyle.top)).toBe(0);
    expect(Number.parseFloat(indicatorStyle.right)).toBe(0);
    expect(Math.round(indicatorRect.width)).toBe(8);
    expect(Math.round(indicatorRect.height)).toBe(8);
    expect(Math.abs(indicatorCenterY - callCenterY)).toBeLessThan(1);
    expect(indicatorRect.left).toBeGreaterThanOrEqual(callLabelRect.right);
    expect(pulseStyle.width).toBe(indicatorStyle.width);
    expect(pulseStyle.height).toBe(indicatorStyle.height);
    expect(Number.parseFloat(pulseStyle.width)).toBeLessThan(9);
    expect(Number.parseFloat(pulseStyle.height)).toBeLessThan(9);
  });

  it('keeps the active-call indicator inside the compact call button on narrow panes', async () => {
    const { container } = renderTabs(390, true);
    await settleLayout();

    const call = container.querySelector('[data-testid="room-call-tab"]') as HTMLElement;
    const pulse = container.querySelector('.animate-ping') as HTMLElement;
    const indicator = pulse.parentElement as HTMLElement;
    const indicatorStyle = getComputedStyle(indicator);
    const callRect = call.getBoundingClientRect();
    const indicatorRect = indicator.getBoundingClientRect();

    expect(indicatorStyle.position).toBe('absolute');
    expect(Number.parseFloat(indicatorStyle.top)).toBeGreaterThan(4);
    expect(Number.parseFloat(indicatorStyle.top)).toBeLessThan(8);
    expect(Number.parseFloat(indicatorStyle.right)).toBeGreaterThan(4);
    expect(Number.parseFloat(indicatorStyle.right)).toBeLessThan(8);
    expect(indicatorRect.top).toBeGreaterThan(callRect.top);
    expect(indicatorRect.right).toBeLessThan(callRect.right);
  });

  it('preserves message selection and call-join behavior', () => {
    const { container } = renderTabs(390);
    const messages = container.querySelector(
      '[data-testid="room-messages-tab"]'
    ) as HTMLButtonElement;
    const call = container.querySelector('[data-testid="room-call-tab"]') as HTMLButtonElement;

    messages.click();
    call.click();

    expect(messages.getAttribute('aria-label')).toBe('Messages');
    expect(call.getAttribute('aria-label')).toBe('Call');
    expect(mocks.selectRoomPrimarySurface).toHaveBeenCalledWith('server-1', 'room-1', 'messages');
    expect(mocks.onmessages).toHaveBeenCalledOnce();
    expect(mocks.requestCall).toHaveBeenCalledWith({
      serverId: 'server-1',
      roomId: 'room-1',
      expectedCallId: undefined,
      source: 'room-header'
    });
  });
});
