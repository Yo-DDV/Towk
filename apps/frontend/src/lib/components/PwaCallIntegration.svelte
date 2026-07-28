<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    resolveCurrentGlobalCallStore,
    resolveGlobalCallSession
  } from '$lib/state/globalCallSession.svelte';
  import {
    CallAudioSessionController,
    CallMediaSessionController,
    CallWakeLockController,
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

  const activeCall = $derived(resolveGlobalCallSession());

  $effect(() => {
    const active = activeCall;
    const call = active?.store.voiceCall;
    const room = active?.store.rooms.rooms.find((candidate) => candidate.id === active.roomId);
    const runCurrent = (command: (current: NonNullable<typeof call>) => void | Promise<void>) => {
      if (!active) return;
      const store = resolveCurrentGlobalCallStore(active);
      if (store) void Promise.resolve(command(store.voiceCall)).catch(() => undefined);
    };
    wakeLockController?.sync(active !== null);
    audioSessionController?.sync(active !== null);
    mediaSessionController?.sync(
      active && call
        ? {
            title: m['voice.call_in']({
              room: room?.name || active.roomId || m['voice.active_call']()
            }),
            artist: active.store.serverInfo.name || active.serverId,
            cameraActive: call.isCameraEnabled,
            microphoneActive: !call.isMuted,
            onHangup: () => runCurrent((current) => current.leave()),
            onToggleCamera: () => runCurrent((current) => current.toggleCamera()),
            onToggleMicrophone: () => runCurrent((current) => current.toggleMute())
          }
        : null
    );
  });

  onMount(() => {
    const handleVisibilityChange = () => {
      const session = resolveGlobalCallSession();
      if (!session) return;
      void resolveCurrentGlobalCallStore(session)
        ?.voiceCall.handleDocumentVisibilityChange(document.visibilityState)
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
