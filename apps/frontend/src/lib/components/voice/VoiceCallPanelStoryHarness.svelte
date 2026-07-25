<script lang="ts">
  import { onMount } from 'svelte';
  import type { Component } from 'svelte';
  import type { Track } from 'livekit-client';
  import type { CallParticipantInfo } from '$lib/state/server/voiceCall.svelte';
  import type { MicrophoneProcessingStatus } from '$lib/audio/backgroundNoiseSuppression';
  import type { ServerPermissions } from '$lib/state/server/permissions.svelte';
  import { createPresenceCache } from '$lib/state/presenceCache.svelte';
  import { createUserProfileCache } from '$lib/state/userProfiles.svelte';
  import { serverRegistry, type RegisteredServer } from '$lib/state/server/registry.svelte';
  import type { ServerStateStore } from '$lib/state/server/store.svelte';

  type VoiceCallPanelProps = {
    roomId: string;
    livekitUrl: string;
    layout?: 'sidebar' | 'stage';
  };

  let {
    layout = 'stage',
    scenario = 'screen',
    reconnecting = false,
    microphoneRouteRecovering = false,
    interrupted = false,
    jitterWarning = false,
    simulateMobileCapabilities = false,
    microphoneProcessing = null,
    onStoreSeeded = null
  }: {
    layout?: 'sidebar' | 'stage';
    scenario?:
      'screen' | 'screen-single-secondary' | 'camera' | 'mobile-camera' | 'voice' | 'devices';
    reconnecting?: boolean;
    microphoneRouteRecovering?: boolean;
    interrupted?: boolean;
    jitterWarning?: boolean;
    simulateMobileCapabilities?: boolean;
    microphoneProcessing?: MicrophoneProcessingStatus | null;
    onStoreSeeded?: ((store: ServerStateStore) => void) | null;
  } = $props();

  const roomId = 'storybook-call-room';
  const storybookServerId = 'storybook-call-server';
  createPresenceCache();
  createUserProfileCache();
  let Panel = $state<Component<VoiceCallPanelProps> | null>(null);

  const permissions: ServerPermissions = {
    loaded: true,
    canViewAdmin: false,
    canStartDMs: false,
    canAdminViewUsers: false,
    canAdminManageAccounts: false,
    canAssignRoles: false,
    canAdminViewRoles: false,
    canAdminManageRoles: false,
    canAdminViewSystem: false,
    canAdminViewAudit: false
  };

  function statsReport(...stats: Array<{ id: string; type: string } & Record<string, unknown>>) {
    const items = new Map(stats.map((stat) => [stat.id, stat]));
    return {
      get: (id: string) => items.get(id),
      forEach(callback: (value: RTCStats, key: string, parent: RTCStatsReport) => void) {
        for (const [id, stat] of items) {
          callback(stat as unknown as RTCStats, id, items as unknown as RTCStatsReport);
        }
      }
    } as RTCStatsReport;
  }

  function posterTrack(svg: string, direction: 'inbound' | 'outbound' = 'inbound'): Track {
    const poster = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const report = statsReport(
      {
        id: 'video',
        type: direction === 'inbound' ? 'inbound-rtp' : 'outbound-rtp',
        kind: 'video',
        timestamp: 2_000,
        codecId: 'codec',
        frameWidth: 1920,
        frameHeight: 1080,
        framesPerSecond: 30,
        bytesReceived: direction === 'inbound' ? 1_000_000 : undefined,
        packetsReceived: direction === 'inbound' ? 1_000 : undefined,
        packetsLost: 2,
        framesDecoded: direction === 'inbound' ? 900 : undefined,
        framesDropped: direction === 'inbound' ? 2 : undefined,
        bytesSent: direction === 'outbound' ? 1_000_000 : undefined,
        packetsSent: direction === 'outbound' ? 1_000 : undefined,
        framesSent: direction === 'outbound' ? 900 : undefined,
        targetBitrate: direction === 'outbound' ? 5_000_000 : undefined,
        qualityLimitationReason: 'none'
      },
      { id: 'codec', type: 'codec', mimeType: 'video/AV1' }
    );
    const track = {
      attach(element: HTMLVideoElement) {
        element.poster = poster;
        return element;
      },
      detach(element: HTMLVideoElement) {
        element.removeAttribute('poster');
        return element;
      }
    } as Record<string, unknown>;
    if (direction === 'inbound') {
      track.getRTCStatsReport = async () => report;
    } else {
      track.sender = { getStats: async () => report };
    }
    return track as unknown as Track;
  }

  const screenTrack = posterTrack(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000">
			<rect width="1600" height="1000" fill="#b86600"/>
			<path d="M-20 720C420 630 760 400 1120-20" stroke="#ffbe2e" stroke-width="110" fill="none"/>
			<path d="M1010-40c-80 390-40 720 180 1080" stroke="#f9a915" stroke-width="70" fill="none"/>
			<rect x="16" y="14" width="1568" height="34" fill="#5a2a00" opacity=".75"/>
			<rect x="120" y="160" width="520" height="300" rx="18" fill="#fff" opacity=".76"/>
			<rect x="730" y="160" width="740" height="680" rx="18" fill="#fff" opacity=".42"/>
		</svg>
  `);

  const localScreenTrack = posterTrack(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#b86600"/></svg>`,
    'outbound'
  );

  const cameraTrack = posterTrack(`
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
			<defs>
				<linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
					<stop stop-color="#dbc8ac"/>
					<stop offset="1" stop-color="#5b625c"/>
				</linearGradient>
			</defs>
			<rect width="1600" height="900" fill="url(#g)"/>
			<circle cx="760" cy="385" r="145" fill="#292929"/>
			<rect x="580" y="540" width="460" height="220" rx="70" fill="#343434"/>
			<path d="M0 0h460L210 520H0z" fill="#fff" opacity=".32"/>
		</svg>
	`);

  function participant(
    identity: string,
    name: string,
    overrides: Partial<CallParticipantInfo> = {}
  ): CallParticipantInfo {
    return {
      identity,
      participantId: identity,
      userId: identity,
      deviceIndex: 1,
      name,
      login: identity,
      avatarUrl: null,
      isMuted: false,
      isLocal: false,
      connectionQuality: 'excellent',
      networkHealth: 'unknown',
      packetLossPercent: null,
      jitterMs: null,
      networkWarningMetric: null,
      connectionState: 'connected',
      interruptionDeadline: null,
      isCameraEnabled: false,
      videoTrack: null,
      isScreenShareEnabled: false,
      isScreenShareAudioEnabled: false,
      screenShareTrack: null,
      isLocallyMuted: false,
      canControlAudio: false,
      siblingMicrophoneMuted: null,
      siblingOutputMuted: null,
      isSiblingMicrophoneControlPending: false,
      isSiblingOutputControlPending: false,
      ...overrides
    };
  }

  function mediaDevice(deviceId: string, kind: MediaDeviceKind, label: string): MediaDeviceInfo {
    return {
      deviceId,
      groupId: 'storybook-mobile-devices',
      kind,
      label,
      toJSON: () => ({})
    } as MediaDeviceInfo;
  }

  function participantsForScenario(): CallParticipantInfo[] {
    const viewer = participant('viewer', 'Alice', {
      isLocal: true,
      isCameraEnabled: scenario !== 'voice',
      videoTrack: scenario !== 'voice' ? cameraTrack : null
    });
    const bob = participant('bob', 'Bob', {
      isCameraEnabled: scenario === 'screen',
      videoTrack: scenario === 'screen' ? cameraTrack : null,
      isLocallyMuted: true,
      connectionState: interrupted ? 'interrupted' : 'connected',
      interruptionDeadline: interrupted ? new Date(Date.now() + 60_000).toISOString() : null,
      connectionQuality: interrupted ? 'lost' : 'excellent'
    });
    const chloe = participant('chloe', 'Chloe', {
      isMuted: true,
      connectionQuality: 'poor',
      networkHealth: 'poor',
      packetLossPercent: jitterWarning ? 0 : 12.4,
      jitterMs: 82,
      networkWarningMetric: jitterWarning ? 'jitter' : 'packetLoss'
    });

    if (scenario === 'devices') {
      return [
        participant('viewer-device-1', 'Alexandria Montgomery', {
          participantId: 'viewer-device-1',
          userId: 'viewer',
          deviceIndex: 1,
          isLocal: true
        }),
        participant('viewer-device-2', 'Alexandria Montgomery', {
          participantId: 'viewer-device-2',
          userId: 'viewer',
          deviceIndex: 2,
          isMuted: true,
          canControlAudio: true,
          siblingMicrophoneMuted: true,
          siblingOutputMuted: true
        })
      ];
    }

    if (scenario === 'screen-single-secondary') {
      return [
        participant('viewer', 'Alice', {
          isLocal: true,
          isCameraEnabled: true,
          videoTrack: cameraTrack,
          isScreenShareEnabled: true,
          isScreenShareAudioEnabled: true,
          screenShareTrack: localScreenTrack
        })
      ];
    }

    if (scenario === 'screen') {
      return [
        participant('dana', 'Dana', {
          isScreenShareEnabled: true,
          isScreenShareAudioEnabled: true,
          screenShareTrack: screenTrack
        }),
        viewer,
        bob,
        chloe
      ];
    }

    if (scenario === 'camera' || scenario === 'mobile-camera') {
      return [viewer, bob, chloe];
    }

    return [participant('viewer', 'Alice', { isLocal: true }), bob, chloe];
  }

  function ensureStorybookServer(): RegisteredServer {
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const existingStorybookServer = serverRegistry.getServer(storybookServerId);
    if (existingStorybookServer) {
      serverRegistry.init();
      return existingStorybookServer;
    }
    const existingOrigin = serverRegistry.originServer;
    if (existingOrigin && import.meta.env.MODE !== 'test') return existingOrigin;

    const server: RegisteredServer = {
      id: storybookServerId,
      url: origin,
      name: 'Storybook',
      iconUrl: null,
      token: null,
      userId: 'viewer',
      userLogin: 'alice',
      userDisplayName: 'Alice',
      userAvatarUrl: null,
      reauthRequiredAt: null,
      addedAt: Date.now()
    };
    serverRegistry.addServer(server);
    return server;
  }

  function seedStore() {
    const server = ensureStorybookServer();
    const store = serverRegistry.getStore(server.id);

    store.permissions = permissions;
    store.rooms.currentUserId = 'viewer';
    store.voiceCall.roomId = roomId;
    store.voiceCall.connected = true;
    store.voiceCall.connecting = false;
    store.voiceCall.reconnecting = reconnecting;
    store.voiceCall.isMuted = false;
    store.voiceCall.microphoneRouteRecovering = microphoneRouteRecovering;
    store.voiceCall.microphoneProcessing = microphoneProcessing ?? {
      automaticGainControl: 'unavailable',
      echoCancellation: null,
      noiseSuppression: 'unavailable'
    };
    store.voiceCall.isCameraEnabled = scenario !== 'voice';
    store.voiceCall.isScreenShareEnabled = scenario === 'screen';
    if (scenario === 'mobile-camera') {
      store.voiceCall.videoDevices = [
        mediaDevice('front', 'videoinput', 'camera2 1, facing front'),
        mediaDevice('rear', 'videoinput', 'camera2 0, facing back'),
        mediaDevice('ultra', 'videoinput', 'camera2 2, facing back, ultra wide')
      ];
      store.voiceCall.selectedVideoDeviceId = 'front';
    }
    store.voiceCall.participants = participantsForScenario();
    onStoreSeeded?.(store);
  }

  function suppressScreenShareForStory(): () => void {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return () => undefined;
    const ownDescriptor = Object.getOwnPropertyDescriptor(
      navigator.mediaDevices,
      'getDisplayMedia'
    );
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: undefined
    });
    return () => {
      if (ownDescriptor) {
        Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', ownDescriptor);
      } else {
        delete (
          navigator.mediaDevices as Omit<MediaDevices, 'getDisplayMedia'> & {
            getDisplayMedia?: MediaDevices['getDisplayMedia'];
          }
        ).getDisplayMedia;
      }
    };
  }

  onMount(() => {
    const restoreScreenShare = simulateMobileCapabilities
      ? suppressScreenShareForStory()
      : () => undefined;
    seedStore();
    void import('./VoiceCallPanel.svelte').then((module) => {
      Panel = module.default as Component<VoiceCallPanelProps>;
    });
    return restoreScreenShare;
  });
</script>

{#if Panel}
  <Panel {roomId} livekitUrl="wss://livekit.invalid" {layout} />
{/if}
