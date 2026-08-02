import { flushSync } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomHistoryPurgeStatus, RoomPostingPolicy } from '@towk/api-types/api/v1/rooms_pb';
import RoomGovernanceActions from './RoomGovernanceActions.svelte';
import '../../../app.css';

const mocks = vi.hoisted(() => ({
  lockRoom: vi.fn(),
  unlockRoom: vi.fn(),
  purgeRoomHistory: vi.fn(),
  getRoomHistoryPurgeOperation: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    serverId: 'server-1',
    connectBaseUrl: 'https://towk.example.test/api/connect',
    bearerToken: 'token-1'
  })
}));

vi.mock('$lib/api-client/rooms', () => ({
  createRoomCommandAPI: () => ({
    lockRoom: mocks.lockRoom,
    unlockRoom: mocks.unlockRoom,
    purgeRoomHistory: mocks.purgeRoomHistory,
    getRoomHistoryPurgeOperation: mocks.getRoomHistoryPurgeOperation
  })
}));

vi.mock('$lib/ui/toast', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError
  }
}));

const room = {
  id: 'room-1',
  name: 'general',
  isLocked: false,
  revision: 7n,
  canLockRoom: true,
  canPurgeMessages: true
};

function buttonByText(container: Element, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text)
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`);
  return button;
}

function fill(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('RoomGovernanceActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the menu within the viewport and applies a revision-fenced lock', async () => {
    mocks.lockRoom.mockResolvedValue({
      ...room,
      postingPolicy: RoomPostingPolicy.LOCKED,
      historyEpoch: 0n,
      revision: 8n
    });
    const onrefresh = vi.fn();
    const { container } = render(RoomGovernanceActions, {
      props: { room, onrefresh }
    });

    const trigger = container.querySelector('[data-testid="room-governance-menu-button"]');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('governance trigger not found');
    const roomViewRegion = document.createElement('div');
    const paneHeader = document.createElement('div');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 260, y: 12, width: 44, height: 44 })
    );
    vi.spyOn(roomViewRegion, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 40, y: 0, width: 360, height: 640 })
    );
    vi.spyOn(paneHeader, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 40, y: 0, width: 360, height: 60 })
    );
    vi.spyOn(trigger, 'closest').mockImplementation((selector) => {
      if (selector === '[data-ui="room-view-region"]') return roomViewRegion;
      if (selector === '[data-ui="pane-header"]') return paneHeader;
      return null;
    });
    expect(trigger.classList).toContain('!h-[44px]');
    expect(trigger.classList).toContain('!w-[44px]');
    trigger.click();
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="room-policy-action"]')).not.toBeNull()
    );
    expect(trigger.closest).toHaveBeenCalledWith('[data-ui="room-view-region"]');
    expect(roomViewRegion.getBoundingClientRect).toHaveBeenCalled();

    const menu = container.querySelector('[role="menu"]');
    if (!(menu instanceof HTMLElement)) throw new Error('governance menu not found');
    const popover = menu.closest('[popover="manual"]');
    if (!(popover instanceof HTMLElement)) throw new Error('governance popover not found');
    const bounds = popover.getBoundingClientRect();
    expect(bounds.right).toBeCloseTo(400, 0);
    expect(bounds.top).toBeCloseTo(60, 0);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth + 1);

    vi.mocked(roomViewRegion.getBoundingClientRect).mockReturnValue(
      DOMRect.fromRect({ x: 40, y: 0, width: 344, height: 640 })
    );
    window.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => expect(popover.getBoundingClientRect().right).toBeCloseTo(384, 0));

    const lockAction = buttonByText(container, 'Lock room');
    lockAction.focus();
    lockAction.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(container.querySelector('[role="menu"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    trigger.click();
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="room-policy-action"]')).not.toBeNull()
    );

    buttonByText(container, 'Lock room').click();
    await vi.waitFor(() =>
      expect(mocks.lockRoom).toHaveBeenCalledWith({
        roomId: 'room-1',
        expectedRevision: 7n
      })
    );
    expect(onrefresh).toHaveBeenCalledOnce();
  });

  it('requires only the exact room name before starting an authorized purge', async () => {
    mocks.purgeRoomHistory.mockResolvedValue({
      room: {
        ...room,
        postingPolicy: RoomPostingPolicy.OPEN,
        historyEpoch: 1n,
        revision: 8n
      },
      operation: {
        id: 'purge-1',
        roomId: room.id,
        historyEpoch: 1n,
        status: RoomHistoryPurgeStatus.COMPLETED,
        failureCode: ''
      }
    });
    const onhistorypurged = vi.fn();
    const { container } = render(RoomGovernanceActions, {
      props: { room, onhistorypurged }
    });

    const trigger = container.querySelector('[data-testid="room-governance-menu-button"]');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('governance trigger not found');
    trigger.click();
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="room-history-purge-action"]')).not.toBeNull()
    );
    buttonByText(container, 'Purge message history').click();

    const dialogContent = await vi.waitFor(() => {
      const content = container.querySelector('.dialog-content');
      if (!(content instanceof HTMLElement)) throw new Error('purge dialog content not found');
      return content;
    });
    expect(dialogContent.classList).toContain('max-h-[calc(100dvh-1rem)]');

    const confirmation = await vi.waitFor(() => {
      const input = [...container.querySelectorAll('input')].find(
        (candidate) => candidate.placeholder === room.name
      );
      if (!(input instanceof HTMLInputElement)) throw new Error('confirmation input not found');
      return input;
    });
    const submit = buttonByText(container, 'Purge history');
    expect(submit.disabled).toBe(true);

    fill(confirmation, 'General');
    expect(submit.disabled).toBe(true);
    fill(confirmation, room.name);
    expect(submit.disabled).toBe(false);
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true
    });
    confirmation.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(mocks.purgeRoomHistory).not.toHaveBeenCalled();

    expect(container.querySelector('input[type="password"]')).toBeNull();
    submit.click();

    await vi.waitFor(() =>
      expect(mocks.purgeRoomHistory).toHaveBeenCalledWith({
        roomId: room.id,
        expectedRevision: room.revision,
        confirmationName: room.name
      })
    );
    expect(onhistorypurged).toHaveBeenCalledWith(1n);
  });
});
