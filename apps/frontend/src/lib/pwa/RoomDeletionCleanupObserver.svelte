<script lang="ts">
  import type { EventHandler } from '$lib/eventBus.svelte';
  import { RoomEventKind, roomEventKind } from '$lib/render/eventKinds';
  import { eventBusManager } from '$lib/state/server/eventBus.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { purgeDeletedRoomForServer } from './roomDeletionCleanup';

  $effect(() => {
    const registrations: Array<{ handler: EventHandler; serverId: string }> = [];

    for (const server of serverRegistry.servers) {
      const bus = eventBusManager.getBus(server.id);
      if (!bus) continue;

      const handler: EventHandler = (event) => {
        if (roomEventKind(event.event) !== RoomEventKind.RoomDeleted) return;
        const payload = event.event;
        const roomId =
          payload && typeof payload === 'object' && 'roomId' in payload ? payload.roomId : null;
        if (typeof roomId !== 'string' || !roomId) return;

        void purgeDeletedRoomForServer(server, roomId).catch((error) => {
          console.error('Failed to purge encrypted offline data for a deleted room', error);
        });
      };

      bus.handlers.add(handler);
      registrations.push({ handler, serverId: server.id });
    }

    return () => {
      for (const registration of registrations) {
        eventBusManager.getBus(registration.serverId)?.handlers.delete(registration.handler);
      }
    };
  });
</script>
