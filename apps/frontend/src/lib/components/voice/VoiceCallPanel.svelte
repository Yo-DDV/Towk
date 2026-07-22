<!--
@component

Room sidebar panel for voice/video calls.

**Two modes:**
- **Observer mode**: Call is active but user hasn't joined. Shows participants
  from server state and a Join button.
- **Participant mode**: User is connected to LiveKit. Shows live audio levels,
  mute toggle, camera/screen-share controls, audio device selector, and hang-up button.

**Props:**
- `roomId` - The room ID
- `livekitUrl` - The LiveKit server WebSocket URL (needed for joining)
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { getServerPermissions } from '$lib/state/server/permissions.svelte';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import * as m from '$lib/i18n/messages';

  const stores = serverRegistry.getStore(getActiveServer());
  const voiceCallState = stores.voiceCall;
  const activeCallRooms = stores.activeCallRooms;
  const callParticipantsState = stores.callParticipants;
  import { useEvent } from '$lib/hooks';
  import { useRenderData } from '$lib/render/data';
  import { UserAvatarViewData } from '$lib/components/UserAvatar.svelte';
  import type { PresenceStatus } from '$lib/render/types';
  import type { EventEnvelope } from '$lib/eventBus.svelte';
  import { RoomEventKind, roomEventKind } from '$lib/render/eventKinds';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import VideoThumbnail from './VideoThumbnail.svelte';
  import AudioDeviceMenu from './AudioDeviceMenu.svelte';
  import CallTileActionButton from './CallTileActionButton.svelte';
  import CallTileActionToolbar from './CallTileActionToolbar.svelte';
  import CallDeviceJoinDialog from './CallDeviceJoinDialog.svelte';
  import ScreenShareDiagnostics from './ScreenShareDiagnostics.svelte';
  import UserContextMenu from '$lib/components/menus/UserContextMenu.svelte';
  import { getVoiceCallJoinErrorMessage } from '$lib/state/server/voiceCall.svelte';
  import type { Track } from 'livekit-client';
  import type { Attachment } from 'svelte/attachments';
  import { startDMWith } from '$lib/dm/startDM';
  import { toast } from '$lib/ui/toast';
  import { onDestroy } from 'svelte';
  import {
    callFullscreenMedia,
    type CallFullscreenMediaKind
  } from '$lib/state/callFullscreenMedia.svelte';
  import {
    supportsVideoPictureInPicture,
    toggleVideoPictureInPicture
  } from '$lib/pwa/pictureInPicture';

  let {
    roomId,
    livekitUrl,
    layout = 'sidebar'
  }: {
    roomId: string;
    livekitUrl: string;
    layout?: 'sidebar' | 'stage';
  } = $props();

  let isInThisCall = $derived(voiceCallState.isInCall(roomId));
  let isInAnotherCall = $derived(voiceCallState.isInAnyCall && !isInThisCall);
  let isConnecting = $derived(voiceCallState.isJoiningRoom(roomId));
  let isRecovering = $derived(voiceCallState.reconnecting && voiceCallState.roomId === roomId);
  let hasActiveCall = $derived(activeCallRooms.has(roomId));
  let isStageLayout = $derived(layout === 'stage');
  let deviceMenuAnchor = $state<{ top: number; bottom: number; left: number } | null>(null);
  let deviceMenuTrigger = $state<HTMLButtonElement | null>(null);
  let deviceChoiceVisible = $state(false);
  let companionAllowed = $state(false);
  let deviceChoiceBusy = $state(false);
  let diagnosticsParticipantKey = $state<string | null>(null);
  let pictureInPictureAvailable = $state(false);
  let pictureInPictureActive = $state(false);

  onMount(() => {
    pictureInPictureAvailable = supportsVideoPictureInPicture();
    const syncPictureInPictureState = () => {
      pictureInPictureActive = Boolean(document.pictureInPictureElement);
    };
    document.addEventListener('enterpictureinpicture', syncPictureInPictureState, true);
    document.addEventListener('leavepictureinpicture', syncPictureInPictureState, true);
    return () => {
      document.removeEventListener('enterpictureinpicture', syncPictureInPictureState, true);
      document.removeEventListener('leavepictureinpicture', syncPictureInPictureState, true);
    };
  });

  function callEventPayload(event: EventEnvelope['event']): {
    roomId: string;
    callId: string;
    participantId: string | null;
    deviceIndex: number;
    connectionState: 'connected' | 'interrupted';
    interruptionDeadline: string | null;
  } | null {
    if (
      !event ||
      !('roomId' in event) ||
      typeof event.roomId !== 'string' ||
      !('callId' in event) ||
      typeof event.callId !== 'string'
    ) {
      return null;
    }
    const participantId =
      'participantId' in event && typeof event.participantId === 'string' && event.participantId
        ? event.participantId
        : null;
    const deviceIndex =
      'deviceIndex' in event && typeof event.deviceIndex === 'number' ? event.deviceIndex : 0;
    const connectionState =
      'connectionState' in event && event.connectionState === 'interrupted'
        ? 'interrupted'
        : 'connected';
    const interruptionDeadline =
      'interruptionDeadline' in event && typeof event.interruptionDeadline === 'string'
        ? event.interruptionDeadline
        : null;
    return {
      roomId: event.roomId,
      callId: event.callId,
      participantId,
      deviceIndex,
      connectionState,
      interruptionDeadline
    };
  }

  // The call tab can be opened directly from a room even if the sidebar room
  // list has not refreshed its active-call snapshot yet. Refresh here so
  // observers see the active participants before deciding whether to join.
  $effect(() => {
    if (!isInThisCall) void activeCallRooms.load();
  });

  // Load server-side participants when there's an active call and we're not in it
  $effect(() => {
    if (!isInThisCall && hasActiveCall) {
      callParticipantsState.load(roomId);
    } else if (!hasActiveCall && !isInThisCall) {
      callParticipantsState.clear();
    }
  });

  // Handle call join/leave events to optimistically update the observer participant list
  useEvent((spaceEvent) => {
    const event = spaceEvent.event;
    if (!event) return;

    const call = callEventPayload(event);
    if (!call || call.roomId !== roomId) return;

    switch (roomEventKind(event)) {
      case RoomEventKind.CallParticipantJoined: {
        const actor = spaceEvent.actor ? useRenderData(UserAvatarViewData, spaceEvent.actor) : null;
        void callParticipantsState.handleJoin(
          call.roomId,
          call.callId,
          actor,
          call.participantId,
          call.deviceIndex
        );
        break;
      }
      case RoomEventKind.CallParticipantLeft:
        callParticipantsState.handleLeave(
          call.roomId,
          call.callId,
          spaceEvent.actorId ?? null,
          call.participantId
        );
        voiceCallState.handleParticipantLeftEvent(
          call.roomId,
          call.callId,
          call.participantId,
          spaceEvent.actorId ?? null,
          stores.rooms.currentUserId
        );
        break;
      case RoomEventKind.CallParticipantConnectionChanged:
        if (!call.callId || !call.participantId) break;
        callParticipantsState.handleConnectionState(
          call.roomId,
          call.callId,
          call.participantId,
          call.connectionState,
          call.interruptionDeadline
        );
        break;
      case RoomEventKind.CallEnded:
        callParticipantsState.handleEnd(call.roomId, call.callId);
        activeCallRooms.handleEnd(call.roomId, call.callId);
        voiceCallState.handleCallEndedEvent(call.roomId, call.callId);
        break;
    }
  });

  /** Unified participant shape for rendering (structural data only). */
  type DisplayParticipant = {
    key: string;
    userId: string;
    deviceIndex: number;
    displayName: string;
    avatarUser: {
      id: string;
      login: string;
      displayName: string;
      avatarUrl: string | null;
      presenceStatus: PresenceStatus;
    };
    isMuted: boolean;
    isLocal: boolean;
    isLocallyMuted: boolean;
    connectionQuality: string;
    networkHealth: 'excellent' | 'good' | 'degraded' | 'poor' | 'unknown';
    packetLossPercent: number | null;
    jitterMs: number | null;
    networkWarningMetric: 'packetLoss' | 'jitter' | null;
    connectionState: 'connected' | 'interrupted';
    interruptionDeadline: string | null;
    isCameraEnabled: boolean;
    videoTrack: Track | null;
    isScreenShareEnabled: boolean;
    isScreenShareAudioEnabled: boolean;
    screenShareTrack: Track | null;
    canControlAudio: boolean;
    siblingMicrophoneMuted: boolean | null;
    siblingOutputMuted: boolean | null;
    isSiblingMicrophoneControlPending: boolean;
    isSiblingOutputControlPending: boolean;
  };

  let participants: DisplayParticipant[] = $derived.by(() => {
    if (isInThisCall) {
      return voiceCallState.participants.map((p) => ({
        key: p.identity,
        userId: p.userId,
        deviceIndex: p.deviceIndex,
        displayName: p.name,
        avatarUser: {
          id: p.userId,
          login: p.login,
          displayName: p.name,
          avatarUrl: p.avatarUrl,
          presenceStatus: 'ONLINE' as PresenceStatus
        },
        isMuted: p.isMuted,
        isLocal: p.isLocal,
        isLocallyMuted: p.isLocallyMuted ?? false,
        connectionQuality: p.connectionQuality,
        networkHealth: p.networkHealth,
        packetLossPercent: p.packetLossPercent,
        jitterMs: p.jitterMs,
        networkWarningMetric: p.networkWarningMetric,
        connectionState: p.connectionState,
        interruptionDeadline: p.interruptionDeadline,
        isCameraEnabled: p.isCameraEnabled,
        videoTrack: p.videoTrack,
        isScreenShareEnabled: p.isScreenShareEnabled,
        isScreenShareAudioEnabled: p.isScreenShareAudioEnabled,
        screenShareTrack: p.screenShareTrack,
        canControlAudio: p.canControlAudio,
        siblingMicrophoneMuted: p.siblingMicrophoneMuted,
        siblingOutputMuted: p.siblingOutputMuted,
        isSiblingMicrophoneControlPending: p.isSiblingMicrophoneControlPending,
        isSiblingOutputControlPending: p.isSiblingOutputControlPending
      }));
    }

    return callParticipantsState.participants.map((p) => ({
      key: p.participantId,
      userId: p.userId,
      deviceIndex: p.deviceIndex,
      displayName: p.displayName,
      avatarUser: {
        id: p.userId,
        login: p.login,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        presenceStatus: 'ONLINE' as PresenceStatus
      },
      isMuted: false,
      isLocal: false,
      isLocallyMuted: false,
      connectionQuality: 'unknown',
      networkHealth: 'unknown',
      packetLossPercent: null,
      jitterMs: null,
      networkWarningMetric: null,
      connectionState: p.connectionState,
      interruptionDeadline: p.interruptionDeadline,
      isCameraEnabled: false,
      videoTrack: null,
      isScreenShareEnabled: false,
      isScreenShareAudioEnabled: false,
      screenShareTrack: null,
      canControlAudio: false,
      siblingMicrophoneMuted: null,
      siblingOutputMuted: null,
      isSiblingMicrophoneControlPending: false,
      isSiblingOutputControlPending: false
    }));
  });

  let sortedParticipants = $derived(
    [...participants].sort((a, b) => {
      if (a.isCameraEnabled && a.videoTrack && !(b.isCameraEnabled && b.videoTrack)) return -1;
      if (b.isCameraEnabled && b.videoTrack && !(a.isCameraEnabled && a.videoTrack)) return 1;
      return 0;
    })
  );
  let participantAccountCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const participant of participants) {
      counts[participant.userId] = (counts[participant.userId] ?? 0) + 1;
    }
    return counts;
  });
  let screenShareParticipants = $derived(
    sortedParticipants.filter((p) => p.isScreenShareEnabled && p.screenShareTrack)
  );
  let videoParticipants = $derived(
    sortedParticipants.filter((p) => p.isCameraEnabled && p.videoTrack)
  );
  let mediaTileCount = $derived(screenShareParticipants.length + videoParticipants.length);
  type StageTile = {
    key: string;
    kind: 'screen' | 'video' | 'voice';
    participant: DisplayParticipant;
  };
  let screenShareTiles = $derived(
    screenShareParticipants.map((participant) => ({
      key: `${participant.key}:screen`,
      kind: 'screen' as const,
      participant
    }))
  );
  let participantTiles = $derived(
    sortedParticipants.map((participant) => ({
      key: `${participant.key}:${hasVideo(participant) ? 'video' : 'voice'}`,
      kind: hasVideo(participant) ? ('video' as const) : ('voice' as const),
      participant
    }))
  );
  let stageTiles = $derived([...screenShareTiles, ...participantTiles]);
  let featuredStageTile = $derived(
    screenShareTiles[0] ??
      participantTiles.find((tile) => tile.kind === 'video') ??
      participantTiles[0]
  );
  let secondaryStageTiles = $derived(
    featuredStageTile ? stageTiles.filter((tile) => tile.key !== featuredStageTile.key) : []
  );

  $effect(() => {
    if (
      diagnosticsParticipantKey &&
      !screenShareParticipants.some(
        (participant) =>
          participant.key === diagnosticsParticipantKey && participant.screenShareTrack
      )
    ) {
      diagnosticsParticipantKey = null;
    }
  });
  let isIdle = $derived(!hasActiveCall && !isInThisCall);
  let joinLabel = $derived.by(() => {
    if (isConnecting) return hasActiveCall ? m['voice.joining']() : m['voice.starting']();
    return hasActiveCall ? m['voice.join_call']() : m['voice.start_call']();
  });
  const controlButtonClass = 'btn-secondary btn-sm h-12 w-full !px-0';
  const activeControlButtonClass = 'btn-success btn-sm h-12 w-full !px-0';
  const unavailableControlButtonClass =
    'btn-secondary btn-sm h-12 w-full !px-0 cursor-not-allowed opacity-60 saturate-50';
  const dangerControlButtonClass = 'btn-danger btn-sm h-12 w-full !px-0';
  const callTileCardClass =
    'call-speaking-card participant-card group/media relative flex w-full flex-col gap-2 overflow-hidden rounded-lg border border-text/10 bg-surface-100 p-1.5 text-left text-text shadow-sm transition-colors hover:bg-surface-200/70';
  const callTileHeaderClass = 'flex min-w-0 items-center gap-2';
  const callTileIdentityButtonClass =
    'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left text-text outline-none transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary';
  const callTileMediaButtonClass =
    'flex w-full flex-1 cursor-pointer flex-col overflow-hidden rounded-sm text-left text-text outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary';

  function hasVideo(participant: DisplayParticipant) {
    return participant.isCameraEnabled && participant.videoTrack;
  }

  function hasScreenShare(participant: DisplayParticipant) {
    return participant.isScreenShareEnabled && participant.screenShareTrack;
  }

  function hasConnectionWarning(participant: DisplayParticipant) {
    return (
      participant.connectionState === 'interrupted' ||
      participant.connectionQuality === 'poor' ||
      participant.connectionQuality === 'lost' ||
      participant.networkHealth === 'degraded' ||
      participant.networkHealth === 'poor'
    );
  }

  function formatNetworkMetric(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  }

  function participantNetworkWarning(participant: DisplayParticipant): string {
    if (
      participant.networkWarningMetric === 'packetLoss' &&
      participant.packetLossPercent !== null
    ) {
      return m['voice.participant_packet_loss']({
        percent: formatNetworkMetric(participant.packetLossPercent)
      });
    }
    if (participant.networkWarningMetric === 'jitter' && participant.jitterMs !== null) {
      return m['voice.participant_high_jitter']({
        milliseconds: formatNetworkMetric(participant.jitterMs)
      });
    }
    return m['voice.poor_connection']();
  }

  function participantTitle(participant: DisplayParticipant) {
    if (participant.connectionState === 'interrupted') {
      return `${participant.displayName} — ${m['voice.participant_reconnecting']()}`;
    }
    if (isInThisCall && hasConnectionWarning(participant)) {
      return `${participant.displayName} — ${participantNetworkWarning(participant)}`;
    }

    return participant.displayName;
  }

  const speakingCards: Array<{ identity: string; node: HTMLElement }> = [];
  let speakingIndicatorInterval: ReturnType<typeof setInterval> | null = null;

  function updateSpeakingIndicators() {
    for (const { identity, node } of speakingCards) {
      const { isSpeaking, audioLevel } = voiceCallState.getAudioLevel(identity);
      const opacity = audioLevel > 0.01 ? 0.35 + Math.pow(audioLevel, 0.35) * 0.65 : 0;
      const visible = isSpeaking || opacity > 0;

      node.style.setProperty(
        '--call-speaking-ring-opacity',
        visible ? String(opacity || 0.85) : '0'
      );
      node.style.setProperty('--call-speaking-ring-strength', visible ? String(audioLevel) : '0');
      node.dataset.callSpeaking = visible ? 'true' : 'false';
    }
  }

  function startSpeakingIndicatorLoop() {
    if (speakingIndicatorInterval) return;

    speakingIndicatorInterval = setInterval(updateSpeakingIndicators, 60);
  }

  function stopSpeakingIndicatorLoopIfIdle() {
    if (speakingCards.length > 0 || !speakingIndicatorInterval) return;

    clearInterval(speakingIndicatorInterval);
    speakingIndicatorInterval = null;
  }

  function speakingCard(identity: string): Attachment<HTMLElement> {
    return (node) => {
      const entry = { identity, node };
      speakingCards.push(entry);
      updateSpeakingIndicators();
      startSpeakingIndicatorLoop();

      return () => {
        const index = speakingCards.indexOf(entry);
        if (index !== -1) speakingCards.splice(index, 1);
        stopSpeakingIndicatorLoopIfIdle();
      };
    };
  }

  // DM start capability
  const serverPerms = getServerPermissions();
  const canStartDMs = $derived(serverPerms.current.canStartDMs);

  // User context menu popover
  let popoverParticipant = $state<DisplayParticipant | null>(null);
  let popoverAnchorRect = $state<{ top: number; bottom: number; left: number } | null>(null);

  function showUserMenu(participant: DisplayParticipant, e: MouseEvent) {
    const button = (e.target as HTMLElement).closest('button');
    const rect = button?.getBoundingClientRect();
    if (!rect) return;
    popoverParticipant = participant;
    popoverAnchorRect = { top: rect.top, bottom: rect.bottom, left: rect.left };
  }

  function closeUserMenu() {
    popoverParticipant = null;
    popoverAnchorRect = null;
  }

  function toggleDeviceMenu(e: MouseEvent) {
    if (deviceMenuAnchor) {
      closeDeviceMenu();
      return;
    }

    const button = e.currentTarget as HTMLButtonElement;
    const rect = button.getBoundingClientRect();
    // Chrome Android does not emit devicechange. Refresh once per explicit
    // opening so hot-plugged routes are current without racing the menu mount.
    voiceCallState.refreshDevices();
    deviceMenuTrigger = button;
    deviceMenuAnchor = { top: rect.top, bottom: rect.bottom, left: rect.left };
  }

  function keepDeviceMenuTriggerPointerDown(e: PointerEvent): void {
    if (deviceMenuAnchor) e.stopPropagation();
  }

  function closeDeviceMenu(): void {
    deviceMenuAnchor = null;
    const trigger = deviceMenuTrigger;
    deviceMenuTrigger = null;
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  }

  async function handleJoin() {
    await joinWithMode('ask');
  }

  async function joinWithMode(mode: 'ask' | 'companion' | 'transfer') {
    if (mode !== 'ask') deviceChoiceBusy = true;
    try {
      const result = await voiceCallState.join(livekitUrl, roomId, mode);
      if (result.status === 'selection-required') {
        companionAllowed = result.companionAllowed;
        deviceChoiceVisible = true;
        return;
      }
      deviceChoiceVisible = false;
    } catch (err) {
      stores.handleVoiceCallJoinFailed(roomId);
      toast.error(getVoiceCallJoinErrorMessage(err));
    } finally {
      deviceChoiceBusy = false;
    }
  }

  async function toggleFullscreenElement(
    element: HTMLElement | null,
    openFallback: () => void,
    setExpanded: (expanded: boolean) => void
  ): Promise<void> {
    if (!element || typeof document === 'undefined') return;

    if (typeof element.requestFullscreen !== 'function' || document.fullscreenEnabled === false) {
      setExpanded(true);
      openFallback();
      return;
    }

    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen();
        setExpanded(false);
      } else {
        await element.requestFullscreen();
        setExpanded(true);
        const restoreAdaptiveQuality = () => {
          if (document.fullscreenElement === element) return;
          document.removeEventListener('fullscreenchange', restoreAdaptiveQuality);
          setExpanded(false);
        };
        document.addEventListener('fullscreenchange', restoreAdaptiveQuality);
      }
    } catch {
      setExpanded(true);
      openFallback();
    }
  }

  function toggleClosestMediaFullscreen(participant: DisplayParticipant, event: MouseEvent): void {
    event.stopPropagation();
    const mediaCard = (event.currentTarget as HTMLElement).closest<HTMLElement>(
      '[data-call-media-card]'
    );
    const kind = mediaCard?.dataset.callMediaKind as CallFullscreenMediaKind | undefined;
    const track = kind === 'screen' ? participant.screenShareTrack : participant.videoTrack;
    if (!mediaCard || !kind || !track) return;

    const setExpanded = (expanded: boolean) => {
      if (isInThisCall) {
        voiceCallState.setParticipantMediaExpanded(participant.key, kind, expanded);
      }
    };

    void toggleFullscreenElement(
      mediaCard,
      () => {
        callFullscreenMedia.open({
          roomId,
          participantKey: participant.key,
          kind,
          track,
          name:
            kind === 'screen'
              ? m['voice.screen_title']({ name: participant.displayName })
              : participant.displayName,
          user: participant.avatarUser,
          onClose: () => setExpanded(false)
        });
      },
      setExpanded
    );
  }

  $effect(() => {
    const fullscreenMedia = callFullscreenMedia.current;
    if (!fullscreenMedia || fullscreenMedia.roomId !== roomId) return;

    const participant = participants.find((item) => item.key === fullscreenMedia.participantKey);
    const activeTrack =
      fullscreenMedia.kind === 'screen' ? participant?.screenShareTrack : participant?.videoTrack;
    if (activeTrack !== fullscreenMedia.track) callFullscreenMedia.close();
  });

  onDestroy(() => callFullscreenMedia.closeForRoom(roomId));

  async function toggleClosestMediaPictureInPicture(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const video = (event.currentTarget as HTMLElement)
      .closest<HTMLElement>('[data-call-media-card]')
      ?.querySelector<HTMLVideoElement>('video');
    if (!video) return;
    pictureInPictureActive = await toggleVideoPictureInPicture(video);
  }

  function toggleFeedMute(participant: DisplayParticipant, event: MouseEvent): void {
    event.stopPropagation();
    if (participant.isLocal) {
      void voiceCallState.toggleMute();
    } else {
      voiceCallState.toggleParticipantLocalMute(participant.key);
    }
  }

  function setSiblingAudioMuted(
    participant: DisplayParticipant,
    target: 'microphone' | 'output',
    muted: boolean,
    event: MouseEvent
  ): void {
    event.stopPropagation();
    void voiceCallState.setSiblingAudioMuted(participant.key, target, muted);
  }

  function diagnosticsPanelId(participant: DisplayParticipant): string {
    return `screen-share-diagnostics-${encodeURIComponent(participant.key)}`;
  }

  function diagnosticsButtonId(participant: DisplayParticipant): string {
    return `screen-share-diagnostics-button-${encodeURIComponent(participant.key)}`;
  }

  function closeScreenShareDiagnostics(participant: DisplayParticipant): void {
    diagnosticsParticipantKey = null;
    requestAnimationFrame(() => {
      document.getElementById(diagnosticsButtonId(participant))?.focus();
    });
  }

  function toggleScreenShareDiagnostics(participant: DisplayParticipant, event: MouseEvent): void {
    event.stopPropagation();
    diagnosticsParticipantKey =
      diagnosticsParticipantKey === participant.key ? null : participant.key;
  }
</script>

{#snippet participantAudioActions(
  participant: DisplayParticipant,
  buttonSize: 'default' | 'compact' = 'default'
)}
  {#if participant.isLocal}
    <CallTileActionButton
      icon={voiceCallState.isMuted ? 'uil--microphone-slash' : 'uil--microphone'}
      active={voiceCallState.isMuted}
      label={voiceCallState.isMuted ? m['voice.unmute']() : m['voice.mute']()}
      testId="call-feed-local-mute-button"
      size={buttonSize}
      pending={voiceCallState.isMicrophonePending}
      disabled={voiceCallState.isMicrophonePending || isRecovering}
      onclick={(event) => toggleFeedMute(participant, event)}
    />
  {:else if participant.canControlAudio}
    <CallTileActionButton
      icon={participant.siblingMicrophoneMuted === false
        ? 'uil--microphone'
        : 'uil--microphone-slash'}
      active={participant.siblingMicrophoneMuted === true}
      label={participant.siblingMicrophoneMuted === true
        ? m['voice.unmute_device_microphone']({ index: participant.deviceIndex })
        : m['voice.mute_device_microphone']({ index: participant.deviceIndex })}
      testId="call-device-microphone-toggle"
      size={buttonSize}
      pending={participant.isSiblingMicrophoneControlPending}
      disabled={participant.siblingMicrophoneMuted === null ||
        participant.isSiblingMicrophoneControlPending ||
        isRecovering}
      onclick={(event) =>
        setSiblingAudioMuted(participant, 'microphone', !participant.siblingMicrophoneMuted, event)}
    />
    <CallTileActionButton
      icon={participant.siblingOutputMuted === false ? 'uil--volume-up' : 'uil--volume-mute'}
      active={participant.siblingOutputMuted === true}
      label={participant.siblingOutputMuted === true
        ? m['voice.unmute_device_audio']({ index: participant.deviceIndex })
        : m['voice.mute_device_audio']({ index: participant.deviceIndex })}
      testId="call-device-output-toggle"
      size={buttonSize}
      pending={participant.isSiblingOutputControlPending}
      disabled={participant.siblingOutputMuted === null ||
        participant.isSiblingOutputControlPending ||
        isRecovering}
      onclick={(event) =>
        setSiblingAudioMuted(participant, 'output', !participant.siblingOutputMuted, event)}
    />
  {:else}
    <CallTileActionButton
      icon={participant.isLocallyMuted ? 'uil--volume-mute' : 'uil--volume-up'}
      active={participant.isLocallyMuted}
      label={participant.isLocallyMuted
        ? m['voice.locally_unmute_participant']()
        : m['voice.locally_mute_participant']()}
      testId="call-feed-local-mute-button"
      size={buttonSize}
      onclick={(event) => toggleFeedMute(participant, event)}
    />
  {/if}
{/snippet}

{#snippet mediaTileActions(participant: DisplayParticipant, isScreenShare = false)}
  <CallTileActionToolbar testId="call-media-actions" forceVisible={isScreenShare}>
    {#if isScreenShare}
      <CallTileActionButton
        icon="uil--chart-line"
        label={m['voice.screen_stats_open']()}
        active={diagnosticsParticipantKey === participant.key}
        testId="call-screen-share-stats-button"
        buttonId={diagnosticsButtonId(participant)}
        ariaExpanded={diagnosticsParticipantKey === participant.key}
        ariaControls={diagnosticsPanelId(participant)}
        onclick={(event) => toggleScreenShareDiagnostics(participant, event)}
      />
    {/if}
    {#if participant.isLocal && !isScreenShare && voiceCallState.isCameraEnabled && voiceCallState.videoDevices.length > 1}
      <CallTileActionButton
        icon="uil--exchange"
        label={m['voice.switch_camera']()}
        testId="call-switch-camera-button"
        pending={voiceCallState.isCameraPending}
        disabled={voiceCallState.isCameraPending || isRecovering}
        onclick={(event) => {
          event.stopPropagation();
          void voiceCallState.switchToNextVideoDevice();
        }}
      />
    {/if}
    {#if pictureInPictureAvailable}
      <CallTileActionButton
        icon="uil--window"
        label={pictureInPictureActive
          ? m['voice.exit_picture_in_picture']()
          : m['voice.picture_in_picture']()}
        testId="call-feed-pip-button"
        onclick={toggleClosestMediaPictureInPicture}
      />
    {/if}
    <CallTileActionButton
      icon="mdi--fullscreen"
      label={m['voice.fullscreen_feed']()}
      testId="call-feed-fullscreen-button"
      onclick={(event) => toggleClosestMediaFullscreen(participant, event)}
    />
    {#if isInThisCall}
      {@render participantAudioActions(participant)}
    {/if}
  </CallTileActionToolbar>
{/snippet}

{#snippet voiceTileActions(participant: DisplayParticipant)}
  {#if isInThisCall}
    <CallTileActionToolbar testId="call-voice-actions" placement="inline">
      {@render participantAudioActions(participant, 'compact')}
    </CallTileActionToolbar>
  {/if}
{/snippet}

{#snippet participantIndicators(participant: DisplayParticipant)}
  <span class="inline-flex h-5 min-w-5 shrink-0 items-center justify-end gap-1.5 text-sm">
    {#if participant.isMuted}
      <span
        class="iconify text-danger uil--microphone-slash"
        aria-label={m['voice.muted']()}
        data-testid="call-muted-indicator"
      ></span>
    {/if}
    {#if participant.isLocallyMuted}
      <span
        class="iconify text-muted uil--volume-mute"
        aria-label={m['voice.locally_muted']()}
        data-testid="call-locally-muted-indicator"
      ></span>
    {/if}
    {#if participant.connectionState === 'interrupted'}
      <span
        class="iconify text-warning uil--sync motion-safe:animate-spin"
        aria-label={m['voice.participant_reconnecting']()}
        data-testid="call-reconnecting-indicator"
      ></span>
    {:else if hasConnectionWarning(participant)}
      <span
        class={[
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums',
          participant.connectionQuality === 'lost' || participant.networkHealth === 'poor'
            ? 'bg-danger/10 text-danger'
            : 'bg-warning/10 text-warning'
        ]}
        aria-label={participantNetworkWarning(participant)}
        data-testid={participant.networkWarningMetric === 'packetLoss'
          ? 'call-packet-loss-indicator'
          : participant.networkWarningMetric === 'jitter'
            ? 'call-jitter-indicator'
            : 'call-connection-warning-indicator'}
      >
        <span class="iconify uil--exclamation-triangle" aria-hidden="true"></span>
        {#if participant.networkWarningMetric === 'packetLoss' && participant.packetLossPercent !== null}
          <span>{formatNetworkMetric(participant.packetLossPercent)}%</span>
        {:else if participant.networkWarningMetric === 'jitter' && participant.jitterMs !== null}
          <span>{formatNetworkMetric(participant.jitterMs)} ms</span>
        {/if}
      </span>
    {/if}
  </span>
{/snippet}

{#snippet participantHeader(
  participant: DisplayParticipant,
  label: string,
  actions: 'media' | 'voice' | 'none',
  showIndicators = true,
  showScreenShareAudio = false,
  isScreenShare = false
)}
  <div class={callTileHeaderClass}>
    <button
      type="button"
      class={callTileIdentityButtonClass}
      onclick={(e) => showUserMenu(participant, e)}
    >
      <UserAvatar user={participant.avatarUser} size="sm" />
      <span class="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span class="block w-full truncate text-sm font-medium" data-testid="call-participant-name"
          >{label}</span
        >
        {#if (participantAccountCounts[participant.userId] ?? 0) > 1}
          <span
            class="max-w-full truncate rounded-full bg-surface-300 px-1.5 py-px text-[10px] leading-4 font-medium text-muted"
            data-testid="call-device-badge"
          >
            {m['voice.device_badge']({ index: participant.deviceIndex })}
          </span>
        {/if}
      </span>
      {#if showScreenShareAudio && participant.isScreenShareAudioEnabled}
        <span
          class="iconify text-muted uil--volume"
          aria-label={m['voice.screen_share_audio_active']()}
          data-testid="call-screen-share-audio-indicator"
        ></span>
      {/if}
      {#if showIndicators}
        {@render participantIndicators(participant)}
      {/if}
    </button>

    {#if actions === 'media'}
      {@render mediaTileActions(participant, isScreenShare)}
    {:else if actions === 'voice'}
      {@render voiceTileActions(participant)}
    {/if}
  </div>
{/snippet}

{#snippet participantCard(participant: DisplayParticipant, mode: 'compact' | 'video')}
  {@const showVideo = mode === 'video' && hasVideo(participant)}
  {@const showVoiceActions = isInThisCall && !showVideo}
  {@const actions = showVideo ? 'media' : showVoiceActions ? 'voice' : 'none'}
  {#if isInThisCall}
    <div
      class={[
        callTileCardClass,
        mode === 'video' ? 'participant-card-video' : 'participant-card-compact'
      ]}
      {@attach speakingCard(participant.key)}
      title={participantTitle(participant)}
      data-testid="call-participant-card"
      data-speaking-ring
      data-call-media-card={showVideo ? true : undefined}
      data-call-media-kind={showVideo ? 'camera' : undefined}
      data-connection-state={participant.connectionState}
    >
      {@render participantHeader(participant, participant.displayName, actions)}

      {#if showVideo}
        <button
          type="button"
          class={callTileMediaButtonClass}
          onclick={(e) => showUserMenu(participant, e)}
        >
          <VideoThumbnail
            track={participant.videoTrack!}
            name={participant.displayName}
            user={participant.avatarUser}
            showIdentityOverlay={false}
          />
        </button>
      {/if}
    </div>
  {:else}
    <div
      class={[
        callTileCardClass,
        mode === 'video' ? 'participant-card-video' : 'participant-card-compact'
      ]}
      title={participantTitle(participant)}
      data-testid="call-participant-card"
      data-call-media-card={showVideo ? true : undefined}
      data-connection-state={participant.connectionState}
    >
      {@render participantHeader(participant, participant.displayName, 'none', false)}

      {#if showVideo}
        <button
          type="button"
          class={callTileMediaButtonClass}
          onclick={(e) => showUserMenu(participant, e)}
        >
          <VideoThumbnail
            track={participant.videoTrack!}
            name={participant.displayName}
            user={participant.avatarUser}
            showIdentityOverlay={false}
          />
        </button>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet screenShareCard(participant: DisplayParticipant)}
  <div
    class={[callTileCardClass, 'participant-card-video @container @min-[368px]:col-span-2']}
    {@attach isInThisCall && speakingCard(participant.key)}
    title={m['voice.screen_title']({ name: participant.displayName })}
    data-testid="call-screen-share-card"
    data-speaking-ring={isInThisCall ? true : undefined}
    data-call-media-card
    data-call-media-kind="screen"
  >
    {@render participantHeader(
      participant,
      m['voice.screen_title']({ name: participant.displayName }),
      'media',
      false,
      true,
      true
    )}
    <button
      type="button"
      class={callTileMediaButtonClass}
      onclick={(e) => showUserMenu(participant, e)}
    >
      <VideoThumbnail
        track={participant.screenShareTrack!}
        name={m['voice.screen_title']({ name: participant.displayName })}
        user={participant.avatarUser}
        showIdentityOverlay={false}
      />
    </button>
    {#if diagnosticsParticipantKey === participant.key}
      <ScreenShareDiagnostics
        track={participant.screenShareTrack!}
        direction={participant.isLocal ? 'outbound' : 'inbound'}
        panelId={diagnosticsPanelId(participant)}
        onclose={() => closeScreenShareDiagnostics(participant)}
      />
    {/if}
  </div>
{/snippet}

{#snippet featuredStageCard(tile: StageTile)}
  {@const participant = tile.participant}
  {@const isScreen = tile.kind === 'screen'}
  {@const isVideo = tile.kind === 'video'}
  <div
    class={[callTileCardClass, 'participant-card-video @container h-full min-h-0']}
    {@attach isInThisCall && speakingCard(participant.key)}
    title={isScreen
      ? m['voice.screen_title']({ name: participant.displayName })
      : participantTitle(participant)}
    data-testid="call-featured-stage-card"
    data-speaking-ring={isInThisCall ? true : undefined}
    data-call-media-card={isScreen || isVideo ? true : undefined}
    data-call-media-kind={isScreen ? 'screen' : isVideo ? 'camera' : undefined}
  >
    {@render participantHeader(
      participant,
      isScreen
        ? m['voice.screen_title']({ name: participant.displayName })
        : participant.displayName,
      isScreen || isVideo ? 'media' : 'voice',
      true,
      isScreen,
      isScreen
    )}
    <button
      type="button"
      class={[
        callTileMediaButtonClass,
        'min-h-0 items-center justify-center',
        !isScreen && !isVideo && 'p-6'
      ]}
      onclick={(e) => showUserMenu(participant, e)}
    >
      {#if isScreen}
        <VideoThumbnail
          track={participant.screenShareTrack!}
          name={m['voice.screen_title']({ name: participant.displayName })}
          user={participant.avatarUser}
          showIdentityOverlay={false}
          fill
        />
      {:else if isVideo}
        <VideoThumbnail
          track={participant.videoTrack!}
          name={participant.displayName}
          user={participant.avatarUser}
          showIdentityOverlay={false}
          fill
        />
      {:else}
        <div class="flex min-w-0 flex-col items-center gap-4">
          <UserAvatar user={participant.avatarUser} size="xl" showPresence={false} />
          <span class="max-w-full truncate text-lg font-semibold">{participant.displayName}</span>
        </div>
      {/if}
    </button>
    {#if isScreen && diagnosticsParticipantKey === participant.key}
      <ScreenShareDiagnostics
        track={participant.screenShareTrack!}
        direction={participant.isLocal ? 'outbound' : 'inbound'}
        panelId={diagnosticsPanelId(participant)}
        onclose={() => closeScreenShareDiagnostics(participant)}
      />
    {/if}
  </div>
{/snippet}

{#snippet stageTile(tile: StageTile)}
  {#if tile.kind === 'screen'}
    {@render screenShareCard(tile.participant)}
  {:else}
    {@render participantCard(tile.participant, tile.kind === 'video' ? 'video' : 'compact')}
  {/if}
{/snippet}

{#snippet callControls()}
  {#if isInThisCall}
    <div class={isStageLayout ? 'mx-auto max-w-2xl' : ''}>
      <div class={['grid gap-2', isStageLayout ? 'grid-cols-6' : 'grid-cols-3']}>
        <button
          type="button"
          class={controlButtonClass}
          title={m['voice.devices']()}
          aria-label={m['voice.devices']()}
          aria-haspopup="menu"
          aria-expanded={deviceMenuAnchor !== null}
          aria-controls={deviceMenuAnchor ? 'call-audio-device-menu' : undefined}
          data-testid="call-device-menu-button"
          onpointerdown={keepDeviceMenuTriggerPointerDown}
          onclick={toggleDeviceMenu}
          disabled={isRecovering}
        >
          <span class="iconify text-lg uil--setting" aria-hidden="true"></span>
        </button>

        <button
          type="button"
          class={voiceCallState.isOutputMuted ? controlButtonClass : activeControlButtonClass}
          title={voiceCallState.isOutputMuted
            ? m['voice.unmute_call_audio']()
            : m['voice.mute_call_audio']()}
          aria-label={voiceCallState.isOutputMuted
            ? m['voice.unmute_call_audio']()
            : m['voice.mute_call_audio']()}
          data-testid="call-output-mute-toggle"
          onclick={() => voiceCallState.toggleOutputMute()}
        >
          <span
            class={[
              'iconify text-lg',
              voiceCallState.isOutputMuted ? 'uil--volume-mute' : 'uil--volume-up'
            ]}
            aria-hidden="true"
          ></span>
        </button>

        <button
          type="button"
          class={voiceCallState.isCameraEnabled ? activeControlButtonClass : controlButtonClass}
          title={voiceCallState.isCameraEnabled
            ? m['voice.turn_off_camera']()
            : m['voice.turn_on_camera']()}
          aria-label={voiceCallState.isCameraEnabled
            ? m['voice.turn_off_camera']()
            : m['voice.turn_on_camera']()}
          data-testid="call-camera-toggle"
          onclick={() => voiceCallState.toggleCamera()}
          disabled={voiceCallState.isCameraPending || isRecovering}
          aria-busy={voiceCallState.isCameraPending || undefined}
        >
          {#if voiceCallState.isCameraPending}
            <span class="iconify animate-spin text-lg uil--spinner" aria-hidden="true"></span>
          {:else}
            <span
              class={[
                'iconify text-lg',
                voiceCallState.isCameraEnabled ? 'uil--video' : 'uil--video-slash'
              ]}
              aria-hidden="true"
            ></span>
          {/if}
        </button>

        <button
          type="button"
          class={voiceCallState.isMuted ? controlButtonClass : activeControlButtonClass}
          title={voiceCallState.isMuted ? m['voice.unmute']() : m['voice.mute']()}
          aria-label={voiceCallState.isMuted ? m['voice.unmute']() : m['voice.mute']()}
          data-testid="call-mute-toggle"
          onclick={() => voiceCallState.toggleMute()}
          disabled={voiceCallState.isMicrophonePending || isRecovering}
          aria-busy={voiceCallState.isMicrophonePending || undefined}
        >
          {#if voiceCallState.isMicrophonePending}
            <span class="iconify animate-spin text-lg uil--spinner" aria-hidden="true"></span>
          {:else}
            <span
              class={[
                'iconify text-lg',
                voiceCallState.isMuted ? 'uil--microphone-slash' : 'uil--microphone'
              ]}
              aria-hidden="true"
            ></span>
          {/if}
        </button>

        <button
          type="button"
          class={voiceCallState.isScreenShareEnabled
            ? activeControlButtonClass
            : voiceCallState.canShareScreen
              ? controlButtonClass
              : unavailableControlButtonClass}
          title={voiceCallState.isScreenShareEnabled
            ? m['voice.stop_share_screen']()
            : voiceCallState.canShareScreen
              ? m['voice.share_screen_with_audio']()
              : m['voice.screen_share_capability_unavailable']()}
          aria-label={voiceCallState.isScreenShareEnabled
            ? m['voice.stop_share_screen']()
            : voiceCallState.canShareScreen
              ? m['voice.share_screen_with_audio']()
              : m['voice.screen_share_capability_unavailable']()}
          data-testid="call-screen-share-toggle"
          onclick={() => voiceCallState.toggleScreenShare()}
          disabled={voiceCallState.isScreenSharePending || isRecovering}
          aria-disabled={!voiceCallState.isScreenShareEnabled && !voiceCallState.canShareScreen}
          aria-busy={voiceCallState.isScreenSharePending || undefined}
        >
          {#if voiceCallState.isScreenSharePending}
            <span class="iconify animate-spin text-lg uil--spinner" aria-hidden="true"></span>
          {:else if !voiceCallState.isScreenShareEnabled && !voiceCallState.canShareScreen}
            <span class="iconify text-lg uil--desktop-slash" aria-hidden="true"></span>
          {:else}
            <span class="iconify text-lg uil--desktop" aria-hidden="true"></span>
          {/if}
        </button>

        <button
          type="button"
          class={dangerControlButtonClass}
          onclick={() => voiceCallState.leave()}
          title={m['voice.leave']()}
          aria-label={m['voice.leave']()}
          data-testid="call-leave-button"
        >
          <span class="iconify text-lg uil--phone-slash" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  {:else}
    <div class={isStageLayout ? 'mx-auto max-w-sm' : ''}>
      <button
        type="button"
        class="btn-accent w-full btn-sm"
        data-testid="call-join-button"
        onclick={handleJoin}
        disabled={isInAnotherCall || isConnecting}
        title={isInAnotherCall ? m['voice.already_in_another_call']() : joinLabel}
      >
        {joinLabel}
      </button>
    </div>
  {/if}
{/snippet}

<div
  class="flex min-h-0 flex-1 flex-col"
  data-testid={isInThisCall ? 'call-participant-panel' : 'call-observer-panel'}
>
  {#if !isStageLayout}
    <div class="border-b border-border bg-background p-3" data-testid="call-controls-bar">
      {@render callControls()}
    </div>
  {/if}

  {#if isRecovering}
    <div
      class={[
        'mx-3 mt-3 flex shrink-0 items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-text shadow-sm',
        isStageLayout && 'mx-4 mt-4'
      ]}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="call-network-recovery-notice"
    >
      <span
        class="mt-0.5 iconify shrink-0 animate-pulse text-xl text-warning uil--wifi-slash motion-reduce:animate-none"
        aria-hidden="true"
      ></span>
      <div class="min-w-0">
        <p class="text-sm font-semibold">{m['voice.network_problem_title']()}</p>
        <p class="mt-0.5 text-xs leading-relaxed text-muted">
          {m['voice.network_problem_reconnecting']()}
        </p>
      </div>
    </div>
  {/if}

  {#if voiceCallState.microphoneRouteRecovering && !isRecovering}
    <div
      class={[
        'mx-3 mt-3 flex shrink-0 items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-text shadow-sm',
        isStageLayout && 'mx-4 mt-4'
      ]}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="call-microphone-route-recovery-notice"
    >
      <span
        class="mt-0.5 iconify shrink-0 animate-pulse text-xl text-warning uil--microphone-slash motion-reduce:animate-none"
        aria-hidden="true"
      ></span>
      <div class="min-w-0">
        <p class="text-sm font-semibold">{m['voice.microphone_route_problem_title']()}</p>
        <p class="mt-0.5 text-xs leading-relaxed text-muted">
          {m['voice.microphone_route_reconnecting']()}
        </p>
      </div>
    </div>
  {/if}

  <div
    class={[
      'flex min-h-0 flex-1 flex-col gap-5',
      isStageLayout ? 'p-4' : 'p-3',
      isStageLayout ? 'overflow-hidden' : 'overflow-y-auto'
    ]}
  >
    {#if !isIdle}
      {#if isStageLayout && featuredStageTile}
        <section
          class="flex min-h-0 flex-1 flex-col gap-3"
          aria-label={m['voice.participants']()}
          data-testid="call-stage-layout"
        >
          <div class="flex min-h-0 flex-1" data-testid="call-featured-stage">
            {@render featuredStageCard(featuredStageTile)}
          </div>

          {#if secondaryStageTiles.length > 0}
            <div
              class="flex max-h-[190px] shrink-0 flex-wrap content-start justify-center gap-3 overflow-y-auto"
              data-testid="call-secondary-stage-list"
            >
              {#each secondaryStageTiles as tile (tile.key)}
                <div class="w-[clamp(180px,22vw,240px)] max-w-full min-w-0">
                  {@render stageTile(tile)}
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {:else}
        <section class="@container flex flex-col gap-2" aria-label={m['voice.participants']()}>
          <div
            class={[
              'grid grid-cols-1 gap-3',
              isInThisCall && mediaTileCount > 1 && '@min-[368px]:grid-cols-2'
            ]}
            data-testid="call-participants-list"
          >
            {#each screenShareParticipants as participant (`${participant.key}:screen`)}
              {#if hasScreenShare(participant)}
                {@render screenShareCard(participant)}
              {/if}
            {/each}
            {#each sortedParticipants as participant (participant.key)}
              {@render participantCard(
                participant,
                isInThisCall && hasVideo(participant) ? 'video' : 'compact'
              )}
            {/each}
          </div>
        </section>
      {/if}
    {/if}
  </div>

  {#if isStageLayout}
    <div class="border-t border-border bg-background p-3" data-testid="call-controls-bar">
      {@render callControls()}
    </div>
  {/if}
</div>

{#if deviceMenuAnchor}
  <AudioDeviceMenu anchor={deviceMenuAnchor} onclose={closeDeviceMenu} />
{/if}

<CallDeviceJoinDialog
  bind:visible={deviceChoiceVisible}
  {companionAllowed}
  canShareScreen={voiceCallState.canShareScreen}
  busy={deviceChoiceBusy}
  oncompanion={() => void joinWithMode('companion')}
  ontransfer={() => void joinWithMode('transfer')}
/>

{#if popoverParticipant && popoverAnchorRect}
  <UserContextMenu
    user={popoverParticipant.avatarUser}
    anchorRect={popoverAnchorRect}
    canSendMessage={canStartDMs}
    onSendMessage={() => startDMWith(getActiveServer(), popoverParticipant!.avatarUser.id)}
    onClose={closeUserMenu}
  />
{/if}

<style>
  :global(.call-speaking-card) {
    --call-speaking-ring-opacity: 0;
    --call-speaking-ring-strength: 0;
  }

  :global(.call-speaking-card)::after {
    position: absolute;
    inset: 0;
    border: 2px solid var(--color-accent);
    border-radius: inherit;
    box-shadow: 0 0 0.75rem color-mix(in srgb, var(--color-accent) 30%, transparent);
    content: '';
    opacity: var(--call-speaking-ring-opacity);
    pointer-events: none;
    transition: opacity 80ms linear;
    animation: call-speaking-ring-pulse 1.25s ease-in-out infinite;
  }

  @keyframes call-speaking-ring-pulse {
    0%,
    100% {
      transform: scale(1);
    }

    50% {
      transform: scale(1.012);
    }
  }
</style>
