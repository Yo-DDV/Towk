<script lang="ts">
  import { onDestroy } from 'svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import {
    CallMediaSessionController,
    CallWakeLockController,
    type CallMediaSessionLike,
    type VisibilityDocumentLike,
    type WakeLockNavigatorLike
  } from '$lib/pwa/callIntegrations';
  import * as m from '$lib/i18n/messages';

  const wakeLockController =
    typeof document === 'undefined'
      ? null
      : new CallWakeLockController(
          document as unknown as VisibilityDocumentLike,
          navigator as unknown as WakeLockNavigatorLike
        );
  const mediaSessionController =
    typeof navigator === 'undefined'
      ? null
      : new CallMediaSessionController(
          navigator.mediaSession as unknown as CallMediaSessionLike | undefined
        );

  const activeCall = $derived.by(() => {
    for (const server of serverRegistry.servers) {
      const store = serverRegistry.getStore(server.id);
      const call = store.voiceCall;
      if (!call.connected) continue;
      const room = store.rooms.rooms.find((candidate) => candidate.id === call.roomId);
      return {
        call,
        roomName: room?.name || call.roomId || m['voice.active_call'](),
        serverName: store.serverInfo.name || server.name
      };
    }
    return null;
  });

  $effect(() => {
    const active = activeCall;
    wakeLockController?.sync(active !== null);
    mediaSessionController?.sync(
      active
        ? {
            title: m['voice.call_in']({ room: active.roomName }),
            artist: active.serverName,
            cameraActive: active.call.isCameraEnabled,
            microphoneActive: !active.call.isMuted,
            onHangup: () => active.call.leave(),
            onToggleCamera: () => active.call.toggleCamera(),
            onToggleMicrophone: () => active.call.toggleMute()
          }
        : null
    );
  });

  onDestroy(() => {
    void wakeLockController?.dispose();
    mediaSessionController?.sync(null);
  });
</script>
