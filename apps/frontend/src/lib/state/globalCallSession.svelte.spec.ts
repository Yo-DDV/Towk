import { describe, expect, it } from 'vitest';
import {
  resolveCurrentGlobalCallStore,
  resolveGlobalCallSession
} from './globalCallSession.svelte';

type FakeVoiceCall = {
  isInAnyCall: boolean;
  targetRoomId: string | null;
  callId: string | null;
  connected: boolean;
  reconnecting: boolean;
};

function fakeStore(voiceCall: FakeVoiceCall) {
  return {
    voiceCall,
    rooms: {},
    serverInfo: {}
  };
}

function fakeRegistry(stores: Record<string, ReturnType<typeof fakeStore>>) {
  return {
    servers: Object.keys(stores).map((id) => ({ id })),
    tryGetStore: (serverId: string) => stores[serverId]
  };
}

describe('global call session projection', () => {
  it('finds the real call even when it belongs to a server outside the active route', () => {
    const source = fakeStore({
      isInAnyCall: true,
      targetRoomId: 'room-call',
      callId: 'call-1',
      connected: true,
      reconnecting: false
    });
    const registry = fakeRegistry({
      'server-viewed': fakeStore({
        isInAnyCall: false,
        targetRoomId: null,
        callId: null,
        connected: false,
        reconnecting: false
      }),
      'server-source': source
    });

    expect(resolveGlobalCallSession(registry as never)).toMatchObject({
      serverId: 'server-source',
      roomId: 'room-call',
      callId: 'call-1',
      phase: 'connected',
      store: source
    });
  });

  it('prefers a connected call over a transient queued join snapshot', () => {
    const registry = fakeRegistry({
      joining: fakeStore({
        isInAnyCall: true,
        targetRoomId: 'room-next',
        callId: null,
        connected: false,
        reconnecting: false
      }),
      connected: fakeStore({
        isInAnyCall: true,
        targetRoomId: 'room-current',
        callId: 'call-current',
        connected: true,
        reconnecting: false
      })
    });

    expect(resolveGlobalCallSession(registry as never)?.serverId).toBe('connected');
  });

  it('invalidates a control target when the registry replaces its store', () => {
    const original = fakeStore({
      isInAnyCall: true,
      targetRoomId: 'room-call',
      callId: 'call-1',
      connected: true,
      reconnecting: false
    });
    const stores = { source: original };
    const registry = fakeRegistry(stores);
    const session = resolveGlobalCallSession(registry as never);
    expect(session).not.toBeNull();

    stores.source = fakeStore({
      isInAnyCall: true,
      targetRoomId: 'room-call',
      callId: 'call-1',
      connected: true,
      reconnecting: false
    });

    expect(resolveCurrentGlobalCallStore(session!, registry as never)).toBeNull();
  });

  it('invalidates a stale call generation on the same live store', () => {
    const source = fakeStore({
      isInAnyCall: true,
      targetRoomId: 'room-call',
      callId: 'call-1',
      connected: true,
      reconnecting: false
    });
    const registry = fakeRegistry({ source });
    const session = resolveGlobalCallSession(registry as never);
    expect(session).not.toBeNull();

    source.voiceCall.callId = 'call-2';

    expect(resolveCurrentGlobalCallStore(session!, registry as never)).toBeNull();
  });
});
