import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { createContext } from 'svelte';
import { serverIdToSegment } from '$lib/navigation';
import type { VoiceCallJoinMode, VoiceCallJoinResult } from '$lib/api-client/voiceCalls';
import type { AppUiState } from '$lib/state/appUi.svelte';
import { resolveGlobalCallSession } from '$lib/state/globalCallSession.svelte';
import { serverRegistry } from '$lib/state/server/registry.svelte';
import {
  getVoiceCallJoinErrorMessage,
  VoiceCallJoinError,
  VoiceCallJoinSupersededError,
  type VoiceCallState
} from '$lib/state/server/voiceCall.svelte';
import { toast } from '$lib/ui/toast';
import * as m from '$lib/i18n/messages';
import { voiceCaptureCoordinator } from '$lib/voiceMessages/captureCoordinator';

export type CallJoinSource =
  'room-header' | 'room-list' | 'direct-message' | 'notification' | 'call-dock';

export type CallJoinIntent = {
  serverId: string;
  roomId: string;
  expectedCallId?: string;
  source: CallJoinSource;
};

export type CallJoinOutcome =
  | { status: 'joined'; result: Extract<VoiceCallJoinResult, { status: 'joined' }> }
  | { status: 'selection-required' }
  | { status: 'switch-confirmation-required' }
  | { status: 'superseded' }
  | { status: 'failed'; error: unknown };

type CallJoinStore = {
  serverInfo: { livekitUrl: string | null };
  voiceCall: VoiceCallState;
  handleVoiceCallJoinFailed: (roomId: string) => void;
};

type CallJoinRegistry = {
  tryGetStore: (serverId: string) => CallJoinStore | undefined;
};

type CallJoinControllerDependencies = {
  registry: CallJoinRegistry;
  appUi: AppUiState;
  navigate: (serverId: string, roomId: string) => Promise<void>;
  notifyError: (error: unknown) => void;
  currentCall?: () => { serverId: string; roomId: string } | null;
};

type DeviceSelection = {
  intent: CallJoinIntent;
  generation: number;
  companionAllowed: boolean;
  canShareScreen: boolean;
};

type CallSwitchConfirmation = {
  intent: CallJoinIntent;
  generation: number;
};

export class CallJoinController {
  #registry: CallJoinRegistry;
  #appUi: AppUiState;
  #navigate: CallJoinControllerDependencies['navigate'];
  #notifyError: CallJoinControllerDependencies['notifyError'];
  #currentCall: NonNullable<CallJoinControllerDependencies['currentCall']>;
  #generation = 0;
  #inFlight: { key: string; promise: Promise<CallJoinOutcome> } | null = null;
  #deviceSelection = $state<DeviceSelection | null>(null);
  #deviceSelectionBusy = $state(false);
  #callSwitchConfirmation = $state<CallSwitchConfirmation | null>(null);
  #callSwitchBusyGeneration = $state<number | null>(null);

  constructor({
    registry,
    appUi,
    navigate,
    notifyError,
    currentCall = () => null
  }: CallJoinControllerDependencies) {
    this.#registry = registry;
    this.#appUi = appUi;
    this.#navigate = navigate;
    this.#notifyError = notifyError;
    this.#currentCall = currentCall;
  }

  get deviceSelection(): DeviceSelection | null {
    return this.#deviceSelection;
  }

  get deviceSelectionBusy(): boolean {
    return this.#deviceSelectionBusy;
  }

  get callSwitchConfirmation(): CallSwitchConfirmation | null {
    return this.#callSwitchConfirmation;
  }

  get callSwitchBusy(): boolean {
    return (
      this.#callSwitchConfirmation !== null &&
      this.#callSwitchBusyGeneration === this.#callSwitchConfirmation.generation
    );
  }

  request(intent: CallJoinIntent): Promise<CallJoinOutcome> {
    const key = callJoinIntentKey(intent);

    if (this.#inFlight?.key === key) return this.#inFlight.promise;
    if (
      this.#callSwitchConfirmation &&
      callJoinIntentKey(this.#callSwitchConfirmation.intent) === key
    ) {
      return Promise.resolve({ status: 'switch-confirmation-required' });
    }
    if (this.#deviceSelection && callJoinIntentKey(this.#deviceSelection.intent) === key) {
      return Promise.resolve({ status: 'selection-required' });
    }

    if (voiceCaptureCoordinator.blocksCallJoin) {
      const error = new VoiceCallJoinError(
        'voice message capture owns the microphone',
        m['voice.recording_conflict']()
      );
      this.#notifyError(error);
      return Promise.resolve({ status: 'failed', error });
    }

    this.#deviceSelection = null;
    const currentCall = this.#currentCall();
    if (
      currentCall &&
      (currentCall.serverId !== intent.serverId || currentCall.roomId !== intent.roomId)
    ) {
      const generation = ++this.#generation;
      this.#callSwitchConfirmation = { intent, generation };
      return Promise.resolve({ status: 'switch-confirmation-required' });
    }

    this.#callSwitchConfirmation = null;
    const generation = ++this.#generation;
    return this.startIntent(intent, generation);
  }

  confirmCallSwitch(): Promise<CallJoinOutcome> {
    const confirmation = this.#callSwitchConfirmation;
    if (!confirmation || this.callSwitchBusy) {
      return Promise.resolve({ status: 'superseded' });
    }

    this.#callSwitchBusyGeneration = confirmation.generation;
    const promise = this.startIntent(confirmation.intent, confirmation.generation);
    void promise.finally(() => {
      if (this.#callSwitchConfirmation?.generation === confirmation.generation) {
        this.#callSwitchConfirmation = null;
      }
      if (this.#callSwitchBusyGeneration === confirmation.generation) {
        this.#callSwitchBusyGeneration = null;
      }
    });
    return promise;
  }

  cancelCallSwitch(): void {
    const confirmation = this.#callSwitchConfirmation;
    if (!confirmation || this.callSwitchBusy) return;

    this.#generation += 1;
    this.#callSwitchConfirmation = null;
  }

  private startIntent(intent: CallJoinIntent, generation: number): Promise<CallJoinOutcome> {
    const key = callJoinIntentKey(intent);
    this.#appUi.selectRoomPrimarySurface(intent.serverId, intent.roomId, 'call');
    const promise = this.openTargetAndPerform(intent, 'ask', generation);
    this.#inFlight = { key, promise };
    void promise.finally(() => {
      if (this.#inFlight?.promise === promise) this.#inFlight = null;
    });
    return promise;
  }

  chooseDeviceMode(mode: Exclude<VoiceCallJoinMode, 'ask'>): Promise<CallJoinOutcome> {
    const selection = this.#deviceSelection;
    if (!selection || this.#deviceSelectionBusy) {
      return Promise.resolve({ status: 'superseded' });
    }

    this.#deviceSelectionBusy = true;
    const promise = this.perform(selection.intent, mode, selection.generation);
    void promise.finally(() => {
      this.#deviceSelectionBusy = false;
    });
    return promise;
  }

  cancelDeviceSelection(): void {
    const selection = this.#deviceSelection;
    if (!selection || this.#deviceSelectionBusy) return;

    this.#generation += 1;
    this.#deviceSelection = null;
    this.#appUi.resetRoomPrimarySurface(selection.intent.serverId, selection.intent.roomId);
  }

  private async openTargetAndPerform(
    intent: CallJoinIntent,
    mode: VoiceCallJoinMode,
    generation: number
  ): Promise<CallJoinOutcome> {
    const active = this.#appUi.activeRoomScope;
    if (active?.serverId !== intent.serverId || active.roomId !== intent.roomId) {
      try {
        await this.#navigate(intent.serverId, intent.roomId);
      } catch (error) {
        this.failCurrentIntent(intent, error, generation);
        return { status: 'failed', error };
      }
    }
    if (generation !== this.#generation) return { status: 'superseded' };
    return this.perform(intent, mode, generation);
  }

  private async perform(
    intent: CallJoinIntent,
    mode: VoiceCallJoinMode,
    generation: number
  ): Promise<CallJoinOutcome> {
    const store = this.#registry.tryGetStore(intent.serverId);
    const livekitUrl = store?.serverInfo.livekitUrl;
    if (!store || !livekitUrl) {
      const error = new Error('voice calls are unavailable on the target server');
      this.failCurrentIntent(intent, error, generation);
      return { status: 'failed', error };
    }

    if (
      store.voiceCall.isInCall(intent.roomId) &&
      (!intent.expectedCallId || store.voiceCall.callId === intent.expectedCallId)
    ) {
      return {
        status: 'joined',
        result: {
          status: 'joined',
          callId: store.voiceCall.callId!,
          participantId: store.voiceCall.participantId!,
          deviceIndex: store.voiceCall.deviceIndex!
        }
      };
    }

    try {
      const result = await store.voiceCall.join(
        livekitUrl,
        intent.roomId,
        mode,
        intent.expectedCallId,
        () => generation === this.#generation
      );
      if (generation !== this.#generation) return { status: 'superseded' };

      if (result.status === 'selection-required') {
        this.#deviceSelection = {
          intent,
          generation,
          companionAllowed: result.companionAllowed,
          canShareScreen: store.voiceCall.canShareScreen
        };
        return { status: 'selection-required' };
      }

      this.#deviceSelection = null;
      this.#appUi.selectRoomPrimarySurface(intent.serverId, intent.roomId, 'call');
      return { status: 'joined', result };
    } catch (error) {
      if (error instanceof VoiceCallJoinSupersededError || generation !== this.#generation) {
        return { status: 'superseded' };
      }
      store.handleVoiceCallJoinFailed(intent.roomId);
      this.failCurrentIntent(intent, error, generation);
      return { status: 'failed', error };
    }
  }

  private failCurrentIntent(intent: CallJoinIntent, error: unknown, generation = this.#generation) {
    if (generation !== this.#generation) return;
    this.#deviceSelection = null;
    this.#appUi.resetRoomPrimarySurface(intent.serverId, intent.roomId);
    this.#notifyError(error);
  }
}

function callJoinIntentKey(intent: CallJoinIntent): string {
  return `${intent.serverId}:${intent.roomId}:${intent.expectedCallId ?? ''}`;
}

const [getCallJoinControllerContext, setCallJoinControllerContext] =
  createContext<CallJoinController>();

export function provideCallJoinController(appUi: AppUiState): CallJoinController {
  const controller = new CallJoinController({
    registry: serverRegistry,
    appUi,
    navigate: async (serverId, roomId) => {
      await goto(
        resolve('/chat/[serverId]/[roomId]', {
          serverId: serverIdToSegment(serverId),
          roomId
        })
      );
    },
    notifyError: (error) => toast.error(getVoiceCallJoinErrorMessage(error)),
    currentCall: () => {
      const session = resolveGlobalCallSession();
      return session ? { serverId: session.serverId, roomId: session.roomId } : null;
    }
  });
  setCallJoinControllerContext(controller);
  return controller;
}

export function getCallJoinController(): CallJoinController {
  return getCallJoinControllerContext();
}
