<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import {
    CallAudioSessionController,
    CallMediaSessionController,
    CallWakeLockController,
    selectCallIntegrationCandidate,
    type CallAudioSessionLike,
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
  const audioSessionController =
    typeof navigator === 'undefined'
      ? null
      : new CallAudioSessionController(
          (navigator as Navigator & { audioSession?: CallAudioSessionLike }).audioSession
        );

  const activeCall = $derived.by(() => {
    const candidates = [];
    for (const server of serverRegistry.servers) {
      const store = serverRegistry.getStore(server.id);
      const call = store.voiceCall;
      if (!call.isInAnyCall) continue;
      const room = store.rooms.rooms.find((candidate) => candidate.id === call.roomId);
      candidates.push({
        call,
        roomName: room?.name || call.roomId || m['voice.active_call'](),
        serverName: store.serverInfo.name || server.name
      });
    }
    return selectCallIntegrationCandidate(candidates);
  });

  $effect(() => {
    const active = activeCall;
    wakeLockController?.sync(active !== null);
    audioSessionController?.sync(active !== null);
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

  onMount(() => {
    const handleVisibilityChange = () => {
      void activeCall?.call
        .handleDocumentVisibilityChange(document.visibilityState)
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  onDestroy(() => {
    void wakeLockController?.dispose();
    audioSessionController?.sync(false);
    mediaSessionController?.sync(null);
  });
</script>
