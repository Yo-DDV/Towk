import { describe, expect, it } from 'vitest';
import { NotificationLevel } from '$lib/render/types';
import { NotificationLevelStore } from './notificationLevel.svelte';

describe('NotificationLevelStore', () => {
  it('recomputes inherited room levels when the server preference changes', () => {
    const store = new NotificationLevelStore();
    store.setRoomPreference('inherited', NotificationLevel.Default, NotificationLevel.AllMessages);
    store.setRoomPreference('override', NotificationLevel.Normal, NotificationLevel.Normal);

    store.setServerPreference(NotificationLevel.Muted, NotificationLevel.Muted);

    expect(store.getRoomPreference('inherited')).toEqual({
      level: NotificationLevel.Default,
      effectiveLevel: NotificationLevel.Muted
    });
    expect(store.getRoomPreference('override')).toEqual({
      level: NotificationLevel.Normal,
      effectiveLevel: NotificationLevel.Normal
    });
  });

  it('reports a fully muted server only when no room override remains audible', () => {
    const store = new NotificationLevelStore();
    store.setServerPreference(NotificationLevel.Muted, NotificationLevel.Muted);
    store.setRoomPreference('inherited', NotificationLevel.Default, NotificationLevel.Muted);
    expect(store.isServerMuted()).toBe(true);

    store.setRoomPreference(
      'override',
      NotificationLevel.AllMessages,
      NotificationLevel.AllMessages
    );
    expect(store.isServerMuted()).toBe(false);
  });

  it('prunes stale room overrides when a fresh viewer snapshot arrives', () => {
    const store = new NotificationLevelStore();
    store.setRoomPreference('left-room', NotificationLevel.AllMessages, NotificationLevel.AllMessages);

    store.replacePreferences(NotificationLevel.Muted, NotificationLevel.Muted, [
      {
        roomId: 'joined-room',
        level: NotificationLevel.Default,
        effectiveLevel: NotificationLevel.Muted
      }
    ]);

    expect(store.getRoomPreference('left-room')).toEqual({
      level: NotificationLevel.Default,
      effectiveLevel: NotificationLevel.Muted
    });
    expect(store.isServerMuted()).toBe(true);
  });
});
