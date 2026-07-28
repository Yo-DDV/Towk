import { describe, expect, it } from 'vitest';
import { VoiceCaptureCoordinator } from './captureCoordinator';

describe('VoiceCaptureCoordinator', () => {
  it('blocks call join only while capture ownership cannot be abandoned safely', () => {
    const coordinator = new VoiceCaptureCoordinator();
    const registration = coordinator.register();

    for (const phase of ['requesting', 'recording', 'stopping', 'sending'] as const) {
      registration.update(phase);
      expect(coordinator.blocksCallJoin).toBe(true);
    }
    registration.update('review');
    expect(coordinator.blocksCallJoin).toBe(false);
    registration.unregister();
    expect(coordinator.blocksCallJoin).toBe(false);
  });

  it('hands a review draft to the next composer instance exactly once', () => {
    const coordinator = new VoiceCaptureCoordinator();
    const draft = {
      file: new File(['voice'], 'voice.webm', { type: 'audio/webm' }),
      durationMs: 1_000,
      waveformPeaks: [0.2, 0.5],
      objectUrl: 'blob:voice'
    };

    coordinator.stashReviewDraft('server:room:main', draft);

    expect(coordinator.takeReviewDraft('server:room:main')).toBe(draft);
    expect(coordinator.takeReviewDraft('server:room:main')).toBeNull();
  });
});
