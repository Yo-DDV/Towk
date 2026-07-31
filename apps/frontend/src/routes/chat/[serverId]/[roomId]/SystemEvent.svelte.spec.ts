import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { RoomEventView } from '$lib/render/types';
import { RoomEventKind } from '$lib/render/eventKinds';
import SystemEvent from './SystemEvent.svelte';

vi.mock('$lib/state/userProfiles.svelte', () => ({
  getLiveDisplayName: (_userId: string, fallback: string) => fallback,
  getLiveAvatarUrl: (_userId: string, fallback: string | null) => fallback,
  getLiveCustomStatus: (_userId: string, fallback: unknown) => fallback
}));

vi.mock('$lib/state/presenceCache.svelte', () => ({
  getPresenceCache: () => ({
    get: (_scope: { serverId: string; userId: string }, fallback: unknown) => fallback
  })
}));

function systemEvent(
  kind:
    | typeof RoomEventKind.UserJoinedRoom
    | typeof RoomEventKind.UserLeftRoom
    | typeof RoomEventKind.CallStarted
    | typeof RoomEventKind.CallParticipantJoined
    | typeof RoomEventKind.CallParticipantLeft
    | typeof RoomEventKind.CallEnded,
  actorName = 'Alice'
): RoomEventView {
  return {
    id: `evt-${kind}`,
    createdAt: '2026-06-15T12:00:00Z',
    actorId: 'user-1',
    actor: {
      id: 'user-1',
      login: 'alice',
      displayName: actorName,
      avatarUrl: null,
      presenceStatus: null
    },
    event: {
      kind,
      roomId: 'room-1'
    }
  } as unknown as RoomEventView;
}

describe('SystemEvent', () => {
  it('renders member join copy with the actor name', () => {
    const { container } = render(SystemEvent, {
      props: { event: systemEvent(RoomEventKind.UserJoinedRoom, 'Alice') }
    });

    expect(container.textContent).toContain('Alice joined the room');
  });

  it('renders member leave copy with the actor name', () => {
    const { container } = render(SystemEvent, {
      props: { event: systemEvent(RoomEventKind.UserLeftRoom, 'Alice') }
    });

    expect(container.textContent).toContain('Alice left the room');
  });

  it.each([
    [RoomEventKind.CallParticipantJoined, 'Alice joined the call'],
    [RoomEventKind.CallParticipantLeft, 'Alice left the call']
  ] as const)('renders %s as a quiet channel event', (kind, copy) => {
    const { container } = render(SystemEvent, {
      props: { event: systemEvent(kind, 'Alice') }
    });

    expect(container.textContent).toContain(copy);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it.each([RoomEventKind.CallStarted, RoomEventKind.CallEnded])(
    'does not render redundant %s lifecycle state',
    (kind) => {
      const { container } = render(SystemEvent, {
        props: { event: systemEvent(kind, 'Alice') }
      });

      expect(container.textContent).toBe('');
      expect(container.querySelector('[data-event-id]')).toBeNull();
    }
  );
});
