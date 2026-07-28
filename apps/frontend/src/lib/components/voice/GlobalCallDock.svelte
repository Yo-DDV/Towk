<!--
@component

Global command host for the one real local call session. Every action
re-resolves the session store immediately before it runs, so route changes,
server switches, sign-out and store replacement cannot redirect media
commands to the currently viewed server by mistake.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { getAppUiState } from '$lib/state/appUi.svelte';
  import {
    resolveCurrentGlobalCallStore,
    resolveGlobalCallSession
  } from '$lib/state/globalCallSession.svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { serverIdToSegment } from '$lib/navigation';
  import { getLiveDisplayName } from '$lib/state/userProfiles.svelte';
  import { RoomType } from '$lib/render/types';
  import * as m from '$lib/i18n/messages';
  import AudioDeviceMenu from './AudioDeviceMenu.svelte';

  let { variant = 'sidebar' }: { variant?: 'sidebar' | 'floating' } = $props();

  const appUi = getAppUiState();
  const session = $derived(resolveGlobalCallSession());
  const voiceCall = $derived(session?.store.voiceCall ?? null);
  const sourceRoom = $derived(
    session ? (session.store.rooms.rooms.find((room) => room.id === session.roomId) ?? null) : null
  );
  const roomName = $derived.by(() => {
    if (!session || !sourceRoom) return m['common.current_call']();
    if (sourceRoom.type !== RoomType.Dm) return `# ${sourceRoom.name}`;

    const currentUserId = session.store.rooms.currentUserId;
    const others = sourceRoom.members.filter((member) => member.id !== currentUserId);
    if (others.length === 0) return m['common.you']();
    return others
      .map((member) => getLiveDisplayName(member.id, member.displayName || member.login))
      .join(', ');
  });
  const serverName = $derived(
    session ? (serverRegistry.getServer(session.serverId)?.name ?? session.serverId) : ''
  );
  const showServerName = $derived(
    Boolean(session) && (variant === 'floating' || session?.serverId !== getActiveServer())
  );
  const phaseLabel = $derived.by(() => {
    if (!session) return '';
    if (voiceCall?.audioPlaybackBlocked) return m['voice.dock.audio_blocked']();
    switch (session.phase) {
      case 'reconnecting':
        return m['voice.dock.reconnecting']();
      case 'joining':
        return m['voice.dock.joining']();
      default:
        return m['voice.dock.connected']();
    }
  });

  const controlClass =
    'grid h-12 min-h-12 w-full min-w-10 cursor-pointer place-items-center rounded-lg border border-border bg-surface-100 text-muted transition-[background-color,border-color,color,scale] hover:bg-surface-200 hover:text-text active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-55';
  const activeControlClass =
    'grid h-12 min-h-12 w-full min-w-10 cursor-pointer place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary transition-[background-color,border-color,color,scale] hover:bg-primary/15 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-55';
  const warningControlClass =
    'grid h-12 min-h-12 w-full min-w-10 cursor-pointer place-items-center rounded-lg border border-warning/50 bg-warning/10 text-warning transition-[background-color,border-color,color,scale] hover:bg-warning/15 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-warning';
  const dangerControlClass =
    'grid h-12 min-h-12 w-full min-w-10 cursor-pointer place-items-center rounded-lg border border-danger/50 bg-danger/10 text-danger transition-[background-color,border-color,color,scale] hover:bg-danger/20 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-danger disabled:cursor-wait disabled:opacity-55';

  let deviceMenuAnchor = $state<{ top: number; bottom: number; left: number } | null>(null);
  let deviceMenuStore = $state<object | null>(null);
  let deviceMenuTrigger = $state<HTMLButtonElement | null>(null);
  let leaving = $state(false);

  function reserveFloatingDockSpace(node: HTMLElement) {
    if (variant !== 'floating') return;

    const appRegion = node.closest<HTMLElement>('.mobile-navigation-swipe-region');
    if (!appRegion) return;

    let animationFrame = 0;
    const updateReservation = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const computedBottom = Number.parseFloat(window.getComputedStyle(node).bottom);
        const bottomGap = Number.isFinite(computedBottom) ? Math.max(0, computedBottom) : 0;
        appRegion.style.setProperty(
          '--global-call-dock-reserved-height',
          `${Math.ceil(rect.height + bottomGap)}px`
        );
        appRegion.dataset.callDockReserved = 'true';
      });
    };

    const resizeObserver = new ResizeObserver(updateReservation);
    resizeObserver.observe(node);
    window.addEventListener('resize', updateReservation);
    window.visualViewport?.addEventListener('resize', updateReservation);
    updateReservation();

    return {
      destroy() {
        cancelAnimationFrame(animationFrame);
        resizeObserver.disconnect();
        window.removeEventListener('resize', updateReservation);
        window.visualViewport?.removeEventListener('resize', updateReservation);
        delete appRegion.dataset.callDockReserved;
        appRegion.style.removeProperty('--global-call-dock-reserved-height');
      }
    };
  }

  $effect(() => {
    if (deviceMenuAnchor && session?.store !== deviceMenuStore) {
      deviceMenuAnchor = null;
      deviceMenuStore = null;
      deviceMenuTrigger = null;
    }
  });

  function currentVoiceCall() {
    const snapshot = session;
    if (!snapshot) return null;
    return resolveCurrentGlobalCallStore(snapshot)?.voiceCall ?? null;
  }

  function openCall(): void {
    const snapshot = session;
    if (!snapshot || !resolveCurrentGlobalCallStore(snapshot)) return;
    appUi.selectRoomPrimarySurface(snapshot.serverId, snapshot.roomId, 'call');
    void goto(
      resolve('/chat/[serverId]/[roomId]', {
        serverId: serverIdToSegment(snapshot.serverId),
        roomId: snapshot.roomId
      })
    );
  }

  function toggleOutput(): void {
    void currentVoiceCall()?.toggleOutputMuteFromGesture();
  }

  function toggleMicrophone(): void {
    void currentVoiceCall()?.toggleMute();
  }

  function toggleCamera(): void {
    void currentVoiceCall()?.toggleCamera();
  }

  function toggleScreenShare(): void {
    void currentVoiceCall()?.toggleScreenShare();
  }

  function openDeviceMenu(event: MouseEvent): void {
    if (deviceMenuAnchor) {
      closeDeviceMenu();
      return;
    }
    const snapshot = session;
    const store = snapshot ? resolveCurrentGlobalCallStore(snapshot) : null;
    if (!snapshot || !store) return;
    const trigger = event.currentTarget as HTMLButtonElement;
    const rect = trigger.getBoundingClientRect();
    void store.voiceCall.refreshDevices();
    deviceMenuStore = snapshot.store;
    deviceMenuTrigger = trigger;
    deviceMenuAnchor = { top: rect.top, bottom: rect.bottom, left: rect.left };
  }

  function keepDeviceMenuTriggerPointerDown(event: PointerEvent): void {
    if (deviceMenuAnchor) event.stopPropagation();
  }

  function closeDeviceMenu(): void {
    deviceMenuAnchor = null;
    deviceMenuStore = null;
    const trigger = deviceMenuTrigger;
    deviceMenuTrigger = null;
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  }

  async function leaveCall(): Promise<void> {
    if (leaving) return;
    const current = currentVoiceCall();
    if (!current) return;
    leaving = true;
    try {
      await current.leave();
    } finally {
      leaving = false;
    }
  }
</script>

{#if session && voiceCall}
  <section
    class={[
      '@container min-w-0 border border-border bg-background/95 shadow-lg backdrop-blur',
      variant === 'sidebar'
        ? 'rounded-xl p-2'
        : 'fixed right-2 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] left-2 z-[70] mx-auto max-w-xl rounded-2xl p-2 sm:right-4 sm:bottom-[calc(env(safe-area-inset-bottom)+1rem)] sm:left-auto sm:w-[min(36rem,calc(100vw-2rem))]'
    ]}
    aria-label={m['voice.dock.session_label']({ room: roomName })}
    data-testid="global-call-dock"
    data-call-dock-host={variant}
    use:reserveFloatingDockSpace
  >
    <button
      type="button"
      class="flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-100 focus-visible:outline-2 focus-visible:outline-primary"
      title={m['voice.dock.return_to_call']({ room: roomName })}
      aria-label={m['voice.dock.return_to_call']({ room: roomName })}
      data-testid="global-call-dock-return"
      onclick={openCall}
    >
      <span
        class={[
          'iconify shrink-0 text-lg',
          session.phase === 'reconnecting'
            ? 'animate-pulse text-warning uil--wifi-slash motion-reduce:animate-none'
            : 'text-primary uil--phone'
        ]}
        aria-hidden="true"
      ></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold">{roomName}</span>
        <span class="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <span class="truncate">{phaseLabel}</span>
          {#if showServerName}
            <span aria-hidden="true">·</span>
            <span class="truncate">{serverName}</span>
          {/if}
        </span>
      </span>
      <span class="iconify shrink-0 text-muted uil--arrow-up-right" aria-hidden="true"></span>
    </button>

    <div class="mt-1 grid grid-cols-3 gap-1.5 @min-[300px]:grid-cols-6">
      <button
        type="button"
        class={voiceCall.audioPlaybackBlocked
          ? warningControlClass
          : voiceCall.isOutputMuted
            ? controlClass
            : activeControlClass}
        title={voiceCall.audioPlaybackBlocked
          ? m['voice.dock.audio_blocked']()
          : voiceCall.isOutputMuted
            ? m['voice.unmute_call_audio']()
            : m['voice.mute_call_audio']()}
        aria-label={voiceCall.audioPlaybackBlocked
          ? m['voice.dock.audio_blocked']()
          : voiceCall.isOutputMuted
            ? m['voice.unmute_call_audio']()
            : m['voice.mute_call_audio']()}
        data-testid="global-call-dock-output"
        onclick={toggleOutput}
      >
        <span
          class={[
            'iconify text-lg',
            voiceCall.audioPlaybackBlocked || voiceCall.isOutputMuted
              ? 'uil--volume-mute'
              : 'uil--volume-up'
          ]}
          aria-hidden="true"
        ></span>
      </button>

      <button
        type="button"
        class={voiceCall.isMuted ? controlClass : activeControlClass}
        title={voiceCall.isMuted ? m['voice.unmute']() : m['voice.mute']()}
        aria-label={voiceCall.isMuted ? m['voice.unmute']() : m['voice.mute']()}
        data-testid="global-call-dock-microphone"
        onclick={toggleMicrophone}
        disabled={voiceCall.isMicrophonePending || voiceCall.reconnecting}
        aria-busy={voiceCall.isMicrophonePending || undefined}
      >
        <span
          class={[
            'iconify text-lg',
            voiceCall.isMicrophonePending
              ? 'animate-spin uil--spinner'
              : voiceCall.isMuted
                ? 'uil--microphone-slash'
                : 'uil--microphone'
          ]}
          aria-hidden="true"
        ></span>
      </button>

      <button
        type="button"
        class={voiceCall.isCameraEnabled ? activeControlClass : controlClass}
        title={voiceCall.isCameraEnabled
          ? m['voice.turn_off_camera']()
          : m['voice.turn_on_camera']()}
        aria-label={voiceCall.isCameraEnabled
          ? m['voice.turn_off_camera']()
          : m['voice.turn_on_camera']()}
        data-testid="global-call-dock-camera"
        onclick={toggleCamera}
        disabled={voiceCall.isCameraPending || voiceCall.reconnecting}
        aria-busy={voiceCall.isCameraPending || undefined}
      >
        <span
          class={[
            'iconify text-lg',
            voiceCall.isCameraPending
              ? 'animate-spin uil--spinner'
              : voiceCall.isCameraEnabled
                ? 'uil--video'
                : 'uil--video-slash'
          ]}
          aria-hidden="true"
        ></span>
      </button>

      <button
        type="button"
        class={voiceCall.isScreenShareEnabled
          ? activeControlClass
          : voiceCall.canShareScreen
            ? controlClass
            : `${controlClass} cursor-not-allowed opacity-60`}
        title={voiceCall.isScreenShareEnabled
          ? m['voice.stop_share_screen']()
          : voiceCall.canShareScreen
            ? m['voice.share_screen_with_audio']()
            : m['voice.screen_share_capability_unavailable']()}
        aria-label={voiceCall.isScreenShareEnabled
          ? m['voice.stop_share_screen']()
          : voiceCall.canShareScreen
            ? m['voice.share_screen_with_audio']()
            : m['voice.screen_share_capability_unavailable']()}
        data-testid="global-call-dock-screen-share"
        onclick={toggleScreenShare}
        disabled={voiceCall.isScreenSharePending || voiceCall.reconnecting}
        aria-disabled={!voiceCall.isScreenShareEnabled && !voiceCall.canShareScreen}
        aria-busy={voiceCall.isScreenSharePending || undefined}
      >
        <span
          class={[
            'iconify text-lg',
            voiceCall.isScreenSharePending
              ? 'animate-spin uil--spinner'
              : voiceCall.canShareScreen || voiceCall.isScreenShareEnabled
                ? 'uil--desktop'
                : 'uil--desktop-slash'
          ]}
          aria-hidden="true"
        ></span>
      </button>

      <button
        type="button"
        class={controlClass}
        title={m['voice.devices']()}
        aria-label={m['voice.devices']()}
        aria-haspopup="menu"
        aria-expanded={deviceMenuAnchor !== null}
        data-testid="global-call-dock-devices"
        onpointerdown={keepDeviceMenuTriggerPointerDown}
        onclick={openDeviceMenu}
        disabled={voiceCall.reconnecting}
      >
        <span class="iconify text-lg uil--setting" aria-hidden="true"></span>
      </button>

      <button
        type="button"
        class={dangerControlClass}
        title={m['voice.leave']()}
        aria-label={m['voice.leave']()}
        data-testid="global-call-dock-leave"
        onclick={leaveCall}
        disabled={leaving}
        aria-busy={leaving || undefined}
      >
        <span
          class={['iconify text-lg', leaving ? 'animate-spin uil--spinner' : 'uil--phone-slash']}
          aria-hidden="true"
        ></span>
      </button>
    </div>
  </section>

  {#if deviceMenuAnchor}
    <AudioDeviceMenu
      anchor={deviceMenuAnchor}
      serverId={session.serverId}
      onclose={closeDeviceMenu}
    />
  {/if}
{/if}
