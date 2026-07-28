import { describe, expect, it, vi } from 'vitest';
import { AppUiState } from './appUi.svelte';
import { CallJoinController } from './callJoinController.svelte';
import { voiceCaptureCoordinator } from '$lib/voiceMessages/captureCoordinator';

function joinedResult(callId = 'call-1') {
  return {
    status: 'joined' as const,
    callId,
    participantId: 'participant-1',
    deviceIndex: 1
  };
}

function createHarness() {
  const appUi = new AppUiState();
  const join = vi.fn(async () => joinedResult());
  const voiceCall = {
    join,
    isInCall: vi.fn(() => false),
    callId: null as string | null,
    participantId: null as string | null,
    deviceIndex: null as number | null,
    canShareScreen: true
  };
  const store = {
    serverInfo: { livekitUrl: 'wss://livekit.example.test' },
    voiceCall,
    handleVoiceCallJoinFailed: vi.fn()
  };
  const navigate = vi.fn(async () => undefined);
  const notifyError = vi.fn();
  const controller = new CallJoinController({
    registry: { tryGetStore: () => store as never },
    appUi,
    navigate,
    notifyError
  });
  return { appUi, controller, join, navigate, notifyError, store, voiceCall };
}

describe('CallJoinController', () => {
  it('selects the central call surface and coalesces duplicate entry points', async () => {
    let resolveJoin!: (value: ReturnType<typeof joinedResult>) => void;
    const joinResult = new Promise<ReturnType<typeof joinedResult>>((resolve) => {
      resolveJoin = resolve;
    });
    const harness = createHarness();
    harness.join.mockReturnValue(joinResult);
    const intent = {
      serverId: 'server-1',
      roomId: 'room-1',
      source: 'room-header' as const
    };

    const first = harness.controller.request(intent);
    const second = harness.controller.request({ ...intent, source: 'room-list' });

    expect(harness.appUi.roomPrimarySurfaceFor('server-1', 'room-1')).toBe('call');
    expect(first).toBe(second);
    await vi.waitFor(() => expect(harness.join).toHaveBeenCalledOnce());

    resolveJoin(joinedResult());
    await expect(first).resolves.toMatchObject({ status: 'joined' });
  });

  it('keeps coalescing the same in-flight intent if capture ownership changes meanwhile', async () => {
    let resolveJoin!: (value: ReturnType<typeof joinedResult>) => void;
    const joinResult = new Promise<ReturnType<typeof joinedResult>>((resolve) => {
      resolveJoin = resolve;
    });
    const harness = createHarness();
    harness.join.mockReturnValue(joinResult);
    const intent = {
      serverId: 'server-1',
      roomId: 'room-1',
      source: 'room-header' as const
    };

    const first = harness.controller.request(intent);
    await vi.waitFor(() => expect(harness.join).toHaveBeenCalledOnce());
    const capture = voiceCaptureCoordinator.register('recording');
    try {
      const duplicate = harness.controller.request({ ...intent, source: 'room-list' });
      expect(duplicate).toBe(first);
      expect(harness.notifyError).not.toHaveBeenCalled();

      resolveJoin(joinedResult());
      await expect(duplicate).resolves.toMatchObject({ status: 'joined' });
    } finally {
      capture.unregister();
    }
  });

  it('returns to messages and reports a failed current intent', async () => {
    const harness = createHarness();
    const error = new Error('admission failed');
    harness.join.mockRejectedValue(error);

    await expect(
      harness.controller.request({
        serverId: 'server-1',
        roomId: 'room-1',
        source: 'room-header'
      })
    ).resolves.toEqual({ status: 'failed', error });

    expect(harness.appUi.roomPrimarySurfaceFor('server-1', 'room-1')).toBe('messages');
    expect(harness.store.handleVoiceCallJoinFailed).toHaveBeenCalledWith('room-1');
    expect(harness.notifyError).toHaveBeenCalledWith(error);
  });

  it('owns companion selection and cancels without leaving an engaged surface', async () => {
    const harness = createHarness();
    harness.join.mockResolvedValueOnce({
      status: 'selection-required',
      companionAllowed: true
    } as never);

    await harness.controller.request({
      serverId: 'server-1',
      roomId: 'room-1',
      source: 'room-header'
    });

    expect(harness.controller.deviceSelection).toMatchObject({
      companionAllowed: true,
      canShareScreen: true
    });
    harness.controller.cancelDeviceSelection();

    expect(harness.controller.deviceSelection).toBeNull();
    expect(harness.appUi.roomPrimarySurfaceFor('server-1', 'room-1')).toBe('messages');
  });

  it('re-resolves the target store for every new intent', async () => {
    const appUi = new AppUiState();
    const firstJoin = vi.fn(async () => joinedResult('call-1'));
    const secondJoin = vi.fn(async () => joinedResult('call-2'));
    let currentStore = {
      serverInfo: { livekitUrl: 'wss://livekit.example.test' },
      voiceCall: {
        join: firstJoin,
        isInCall: () => false,
        callId: null,
        participantId: null,
        deviceIndex: null,
        canShareScreen: true
      },
      handleVoiceCallJoinFailed: vi.fn()
    };
    const controller = new CallJoinController({
      registry: { tryGetStore: () => currentStore as never },
      appUi,
      navigate: async () => undefined,
      notifyError: vi.fn()
    });

    await controller.request({
      serverId: 'server-1',
      roomId: 'room-1',
      source: 'room-header'
    });
    currentStore = {
      ...currentStore,
      voiceCall: { ...currentStore.voiceCall, join: secondJoin }
    };
    await controller.request({
      serverId: 'server-1',
      roomId: 'room-2',
      source: 'room-list'
    });

    expect(firstJoin).toHaveBeenCalledOnce();
    expect(secondJoin).toHaveBeenCalledOnce();
  });

  it('does not admit a call when route navigation fails', async () => {
    const harness = createHarness();
    const error = new Error('navigation failed');
    harness.navigate.mockRejectedValueOnce(error);

    await expect(
      harness.controller.request({
        serverId: 'server-1',
        roomId: 'room-1',
        source: 'room-list'
      })
    ).resolves.toEqual({ status: 'failed', error });

    expect(harness.join).not.toHaveBeenCalled();
    expect(harness.appUi.roomPrimarySurfaceFor('server-1', 'room-1')).toBe('messages');
    expect(harness.notifyError).toHaveBeenCalledWith(error);
  });

  it('keeps an active voice-message capture intact and rejects the call intent', async () => {
    const capture = voiceCaptureCoordinator.register('recording');
    const harness = createHarness();
    try {
      const outcome = await harness.controller.request({
        serverId: 'server-1',
        roomId: 'room-1',
        source: 'room-header'
      });

      expect(outcome).toMatchObject({ status: 'failed' });
      expect(harness.navigate).not.toHaveBeenCalled();
      expect(harness.join).not.toHaveBeenCalled();
      expect(harness.appUi.roomPrimarySurfaceFor('server-1', 'room-1')).toBe('messages');
      expect(harness.notifyError).toHaveBeenCalledOnce();
    } finally {
      capture.unregister();
    }
  });

  it('requires explicit confirmation before switching away from another local call', async () => {
    const harness = createHarness();
    let resolveJoin!: (value: ReturnType<typeof joinedResult>) => void;
    harness.join.mockReturnValue(
      new Promise<ReturnType<typeof joinedResult>>((resolve) => {
        resolveJoin = resolve;
      })
    );
    const controller = new CallJoinController({
      registry: { tryGetStore: () => harness.store as never },
      appUi: harness.appUi,
      navigate: harness.navigate,
      notifyError: harness.notifyError,
      currentCall: () => ({ serverId: 'server-1', roomId: 'room-current' })
    });

    await expect(
      controller.request({
        serverId: 'server-1',
        roomId: 'room-next',
        source: 'room-list'
      })
    ).resolves.toEqual({ status: 'switch-confirmation-required' });

    expect(controller.callSwitchConfirmation?.intent.roomId).toBe('room-next');
    expect(harness.appUi.roomPrimarySurfaceFor('server-1', 'room-next')).toBe('messages');
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.join).not.toHaveBeenCalled();

    const confirmed = controller.confirmCallSwitch();
    await vi.waitFor(() => expect(harness.join).toHaveBeenCalledOnce());
    expect(
      controller.request({
        serverId: 'server-1',
        roomId: 'room-next',
        source: 'room-header'
      })
    ).toBe(confirmed);
    resolveJoin(joinedResult());
    await expect(confirmed).resolves.toMatchObject({ status: 'joined' });

    expect(harness.appUi.roomPrimarySurfaceFor('server-1', 'room-next')).toBe('call');
    expect(harness.navigate).toHaveBeenCalledWith('server-1', 'room-next');
    expect(harness.join).toHaveBeenCalledOnce();
    expect(controller.callSwitchConfirmation).toBeNull();
  });

  it('cancels a call switch without navigating, joining or changing the target surface', async () => {
    const harness = createHarness();
    const controller = new CallJoinController({
      registry: { tryGetStore: () => harness.store as never },
      appUi: harness.appUi,
      navigate: harness.navigate,
      notifyError: harness.notifyError,
      currentCall: () => ({ serverId: 'server-current', roomId: 'room-current' })
    });

    await controller.request({
      serverId: 'server-next',
      roomId: 'room-next',
      source: 'room-list'
    });
    controller.cancelCallSwitch();

    expect(controller.callSwitchConfirmation).toBeNull();
    expect(harness.appUi.roomPrimarySurfaceFor('server-next', 'room-next')).toBe('messages');
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.join).not.toHaveBeenCalled();
  });

  it('returns to the already joined call without asking to switch', async () => {
    const harness = createHarness();
    harness.voiceCall.isInCall.mockReturnValue(true);
    harness.voiceCall.callId = 'call-1';
    harness.voiceCall.participantId = 'participant-1';
    harness.voiceCall.deviceIndex = 1;
    const controller = new CallJoinController({
      registry: { tryGetStore: () => harness.store as never },
      appUi: harness.appUi,
      navigate: harness.navigate,
      notifyError: harness.notifyError,
      currentCall: () => ({ serverId: 'server-1', roomId: 'room-1' })
    });

    await expect(
      controller.request({
        serverId: 'server-1',
        roomId: 'room-1',
        source: 'call-dock'
      })
    ).resolves.toMatchObject({ status: 'joined' });

    expect(controller.callSwitchConfirmation).toBeNull();
    expect(harness.join).not.toHaveBeenCalled();
    expect(harness.appUi.roomPrimarySurfaceFor('server-1', 'room-1')).toBe('call');
  });
});
