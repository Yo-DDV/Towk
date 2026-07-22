export type CoordinatedVoiceCall = {
  serverId: string;
  isInAnyCall: () => boolean;
  leave: () => Promise<void>;
};

export type LeaveOtherVoiceCalls = () => Promise<void>;

export type CoordinateVoiceCallJoin = <T>(
  join: (leaveOtherVoiceCalls: LeaveOtherVoiceCalls) => Promise<T>
) => Promise<T>;

/**
 * Serializes complete join attempts across every registered server.
 *
 * The caller decides when admission is sufficiently validated to invoke
 * `leaveOtherVoiceCalls`, so cancelling a device-choice dialog never tears
 * down a healthy call. Once invoked, every previous local media session is
 * stopped before the new media connection is allowed to start.
 */
export class VoiceCallJoinCoordinator {
  #tail: Promise<void> = Promise.resolve();

  run<T>(
    requestingServerId: string,
    getCalls: () => CoordinatedVoiceCall[],
    join: (leaveOtherVoiceCalls: LeaveOtherVoiceCalls) => Promise<T>
  ): Promise<T> {
    const execute = async (): Promise<T> => {
      return join(async () => {
        for (const candidate of getCalls()) {
          if (candidate.serverId === requestingServerId || !candidate.isInAnyCall()) continue;

          // VoiceCallState releases local media synchronously before its
          // backend leave request settles. Switching to a healthy server must
          // not wait for an unreachable previous server.
          const leave = candidate.leave();
          if (candidate.isInAnyCall()) {
            await leave;
          } else {
            void leave.catch((error) => {
              console.warn('Could not confirm the previous server call leave:', error);
            });
          }
        }
      });
    };

    const result = this.#tail.then(execute, execute);
    this.#tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
