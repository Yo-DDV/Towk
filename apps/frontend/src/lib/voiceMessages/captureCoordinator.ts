import type { VoiceMessageDraft } from './policy';

export type VoiceCapturePhase =
  'idle' | 'requesting' | 'recording' | 'stopping' | 'review' | 'sending';

type VoiceCaptureRegistration = {
  update: (phase: VoiceCapturePhase) => void;
  unregister: () => void;
};

/**
 * Coordinates the app's short-lived microphone owners without moving call
 * authority or persisted message state into a second store.
 */
export class VoiceCaptureCoordinator {
  #phases = new Map<symbol, VoiceCapturePhase>();
  #reviewDrafts = new Map<string, VoiceMessageDraft>();

  register(initial: VoiceCapturePhase = 'idle'): VoiceCaptureRegistration {
    const id = Symbol('voice-capture');
    this.#phases.set(id, initial);
    return {
      update: (phase) => {
        if (this.#phases.has(id)) this.#phases.set(id, phase);
      },
      unregister: () => {
        this.#phases.delete(id);
      }
    };
  }

  get blocksCallJoin(): boolean {
    for (const phase of this.#phases.values()) {
      if (
        phase === 'requesting' ||
        phase === 'recording' ||
        phase === 'stopping' ||
        phase === 'sending'
      ) {
        return true;
      }
    }
    return false;
  }

  stashReviewDraft(scope: string, draft: VoiceMessageDraft): void {
    if (scope) this.#reviewDrafts.set(scope, draft);
  }

  takeReviewDraft(scope: string): VoiceMessageDraft | null {
    if (!scope) return null;
    const draft = this.#reviewDrafts.get(scope) ?? null;
    this.#reviewDrafts.delete(scope);
    return draft;
  }
}

export const voiceCaptureCoordinator = new VoiceCaptureCoordinator();
