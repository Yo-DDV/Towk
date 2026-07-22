import { describe, expect, it, vi } from 'vitest';
import { VoiceCallJoinCoordinator, type CoordinatedVoiceCall } from './voiceCallCoordinator';

function deferredVoid(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('VoiceCallJoinCoordinator', () => {
  it('does not leave another call until the admitted join explicitly requests it', async () => {
    let active = true;
    const leave = vi.fn(async () => {
      active = false;
    });
    const coordinator = new VoiceCallJoinCoordinator();

    await expect(
      coordinator.run(
        'target',
        () => [{ serverId: 'healthy', isInAnyCall: () => active, leave }],
        async () => 'selection-required'
      )
    ).resolves.toBe('selection-required');

    expect(active).toBe(true);
    expect(leave).not.toHaveBeenCalled();
  });

  it('releases every active other server before connecting and preserves inactive calls', async () => {
    let active = true;
    const order: string[] = [];
    const calls: CoordinatedVoiceCall[] = [
      {
        serverId: 'old',
        isInAnyCall: () => active,
        leave: async () => {
          order.push('leave-old');
          active = false;
        }
      },
      {
        serverId: 'inactive',
        isInAnyCall: () => false,
        leave: vi.fn()
      },
      {
        serverId: 'target',
        isInAnyCall: () => true,
        leave: vi.fn()
      }
    ];
    const coordinator = new VoiceCallJoinCoordinator();

    await coordinator.run(
      'target',
      () => calls,
      async (leaveOtherVoiceCalls) => {
        await leaveOtherVoiceCalls();
        order.push('connect-target');
      }
    );

    expect(order).toEqual(['leave-old', 'connect-target']);
    expect(calls[1]?.leave).not.toHaveBeenCalled();
    expect(calls[2]?.leave).not.toHaveBeenCalled();
  });

  it('serializes by request order so the last concurrent request owns the final call', async () => {
    const firstAdmission = deferredVoid();
    let firstActive = false;
    let secondActive = false;
    let inFlightConnections = 0;
    let maxInFlightConnections = 0;
    const order: string[] = [];
    const coordinator = new VoiceCallJoinCoordinator();
    const calls = (): CoordinatedVoiceCall[] => [
      {
        serverId: 'first',
        isInAnyCall: () => firstActive,
        leave: async () => {
          order.push('leave-first');
          firstActive = false;
        }
      },
      {
        serverId: 'second',
        isInAnyCall: () => secondActive,
        leave: async () => {
          order.push('leave-second');
          secondActive = false;
        }
      }
    ];

    const first = coordinator.run('first', calls, async (leaveOtherVoiceCalls) => {
      order.push('admit-first');
      await firstAdmission.promise;
      await leaveOtherVoiceCalls();
      inFlightConnections += 1;
      maxInFlightConnections = Math.max(maxInFlightConnections, inFlightConnections);
      order.push('connect-first');
      firstActive = true;
      inFlightConnections -= 1;
    });
    const second = coordinator.run('second', calls, async (leaveOtherVoiceCalls) => {
      order.push('admit-second');
      await leaveOtherVoiceCalls();
      inFlightConnections += 1;
      maxInFlightConnections = Math.max(maxInFlightConnections, inFlightConnections);
      order.push('connect-second');
      secondActive = true;
      inFlightConnections -= 1;
    });

    await Promise.resolve();
    expect(order).toEqual(['admit-first']);
    firstAdmission.resolve();
    await Promise.all([first, second]);

    expect(order).toEqual([
      'admit-first',
      'connect-first',
      'admit-second',
      'leave-first',
      'connect-second'
    ]);
    expect(maxInFlightConnections).toBe(1);
    expect(firstActive).toBe(false);
    expect(secondActive).toBe(true);
  });

  it('continues the queue after a failed join', async () => {
    const coordinator = new VoiceCallJoinCoordinator();

    await expect(
      coordinator.run(
        'first',
        () => [],
        async () => {
          throw new Error('connect failed');
        }
      )
    ).rejects.toThrow('connect failed');

    await expect(
      coordinator.run(
        'second',
        () => [],
        async () => 'connected'
      )
    ).resolves.toBe('connected');
  });

  it('does not wait for an unreachable old backend after local media is released', async () => {
    let active = true;
    const neverSettles = new Promise<void>(() => undefined);
    const coordinator = new VoiceCallJoinCoordinator();

    await expect(
      coordinator.run(
        'target',
        () => [
          {
            serverId: 'offline',
            isInAnyCall: () => active,
            leave: () => {
              active = false;
              return neverSettles;
            }
          }
        ],
        async (leaveOtherVoiceCalls) => {
          await leaveOtherVoiceCalls();
          return 'connected';
        }
      )
    ).resolves.toBe('connected');
  });
});
