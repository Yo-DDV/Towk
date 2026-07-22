<!--
@component

Floating context menu for selecting audio input (microphone), output (speaker),
and video input (camera) devices.
Reads available devices and current selection from `voiceCallState`.

**Props:**
- `anchor` - Position rect for the ContextMenu
- `onclose` - Called when the menu should dismiss
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { serverRegistry } from '$lib/state/server/registry.svelte';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import * as m from '$lib/i18n/messages';
  import { friendlyCameraDeviceNames } from '$lib/voice/cameraDevices';
  import { friendlyAudioDeviceNames } from '$lib/voice/audioDevices';

  const voiceCallState = serverRegistry.getStore(getActiveServer()).voiceCall;
  import ContextMenu from '$lib/ui/ContextMenu.svelte';

  let {
    anchor,
    onclose
  }: {
    anchor: { top: number; bottom: number; left: number };
    onclose: () => void;
  } = $props();

  type DeviceSection = {
    kind: MediaDeviceKind;
    icon: string;
    label: string;
    devices: MediaDeviceInfo[];
    emptyMessage: string;
    selectedId: string | null;
    select: (deviceId: string) => Promise<void>;
  };
  type MicrophoneProcessingPreferenceKey =
    'noiseSuppression' | 'automaticGainControl' | 'echoCancellation';
  type MicrophoneProcessingControl = {
    key: MicrophoneProcessingPreferenceKey;
    icon: string;
    label: string;
    enabled: boolean;
    status: string;
  };

  const sections = $derived<DeviceSection[]>([
    {
      kind: 'audioinput',
      icon: 'uil--microphone',
      label: m['voice.microphone'](),
      devices: voiceCallState.audioDevices,
      emptyMessage: m['voice.no_devices'](),
      selectedId: voiceCallState.selectedDeviceId,
      select: (id) => voiceCallState.setAudioDevice(id)
    },
    {
      kind: 'audiooutput',
      icon: 'uil--volume-up',
      label: m['voice.speaker'](),
      devices: voiceCallState.isAudioOutputSelectionSupported
        ? voiceCallState.audioOutputDevices
        : [],
      emptyMessage: voiceCallState.isAudioOutputSelectionSupported
        ? m['voice.no_devices']()
        : m['voice.system_managed_audio_output'](),
      selectedId: voiceCallState.selectedOutputDeviceId,
      select: (id) => voiceCallState.setAudioOutputDevice(id)
    },
    {
      kind: 'videoinput',
      icon: 'uil--video',
      label: m['voice.camera'](),
      devices: voiceCallState.videoDevices,
      emptyMessage: m['voice.no_devices'](),
      selectedId: voiceCallState.selectedVideoDeviceId,
      select: (id) => voiceCallState.setVideoDevice(id)
    }
  ]);

  const cameraDeviceNames = $derived(
    friendlyCameraDeviceNames(voiceCallState.videoDevices, {
      camera: m['voice.camera'](),
      front: m['voice.camera_front'](),
      rear: m['voice.camera_rear'](),
      ultraWide: m['voice.camera_ultra_wide'](),
      telephoto: m['voice.camera_telephoto']()
    })
  );

  const audioInputDeviceNames = $derived(
    friendlyAudioDeviceNames(voiceCallState.audioDevices, {
      microphone: m['voice.microphone'](),
      speaker: m['voice.speaker'](),
      phoneMicrophone: m['voice.phone_microphone'](),
      headsetMicrophone: m['voice.headset_microphone'](),
      bluetoothMicrophone: m['voice.bluetooth_microphone'](),
      phoneSpeaker: m['voice.phone_speaker'](),
      headsetSpeaker: m['voice.headset_speaker'](),
      bluetoothSpeaker: m['voice.bluetooth_speaker'](),
      systemDefault: m['voice.system_default_device'](),
      communicationsDefault: m['voice.default_communications_device']()
    })
  );

  const audioOutputDeviceNames = $derived(
    friendlyAudioDeviceNames(voiceCallState.audioOutputDevices, {
      microphone: m['voice.microphone'](),
      speaker: m['voice.speaker'](),
      phoneMicrophone: m['voice.phone_microphone'](),
      headsetMicrophone: m['voice.headset_microphone'](),
      bluetoothMicrophone: m['voice.bluetooth_microphone'](),
      phoneSpeaker: m['voice.phone_speaker'](),
      headsetSpeaker: m['voice.headset_speaker'](),
      bluetoothSpeaker: m['voice.bluetooth_speaker'](),
      systemDefault: m['voice.system_default_device'](),
      communicationsDefault: m['voice.default_communications_device']()
    })
  );

  const microphoneProcessingMessage = $derived(
    voiceCallState.microphoneProcessing.noiseSuppression === 'unknown' ||
      voiceCallState.microphoneProcessing.automaticGainControl === 'unknown' ||
      voiceCallState.microphoneProcessing.echoCancellation === null
      ? m['voice.microphone_processing_system']()
      : voiceCallState.microphoneProcessing.noiseSuppression !== 'unavailable' &&
          voiceCallState.microphoneProcessing.automaticGainControl !== 'unavailable' &&
          voiceCallState.microphoneProcessing.echoCancellation
        ? m['voice.microphone_processing_active']()
        : m['voice.microphone_processing_limited']()
  );

  const microphoneProcessingControls = $derived<MicrophoneProcessingControl[]>([
    {
      key: 'noiseSuppression',
      icon: 'uil--wind',
      label: m['voice.microphone_noise_reduction'](),
      enabled: voiceCallState.microphoneProcessingPreferences.noiseSuppression,
      status: microphoneProcessingStatusLabel('noiseSuppression')
    },
    {
      key: 'automaticGainControl',
      icon: 'uil--chart-line',
      label: m['voice.microphone_auto_gain'](),
      enabled: voiceCallState.microphoneProcessingPreferences.automaticGainControl,
      status: microphoneProcessingStatusLabel('automaticGainControl')
    },
    {
      key: 'echoCancellation',
      icon: 'uil--volume-mute',
      label: m['voice.microphone_echo_cancellation'](),
      enabled: voiceCallState.microphoneProcessingPreferences.echoCancellation,
      status: microphoneProcessingStatusLabel('echoCancellation')
    }
  ]);

  function microphoneProcessingStatusLabel(key: MicrophoneProcessingPreferenceKey): string {
    if (!voiceCallState.microphoneProcessingPreferences[key]) {
      return m['voice.microphone_processing_status_off']();
    }

    if (key === 'noiseSuppression') {
      switch (voiceCallState.microphoneProcessing.noiseSuppression) {
        case 'rnnoise':
        case 'speex':
          return m['voice.microphone_processing_status_towk']();
        case 'native':
          return m['voice.microphone_processing_status_native']();
        case 'unknown':
          return m['voice.microphone_processing_status_requested']();
        case 'unavailable':
          return m['voice.microphone_processing_status_unavailable']();
      }
    }

    if (key === 'automaticGainControl') {
      switch (voiceCallState.microphoneProcessing.automaticGainControl) {
        case 'towk':
          return m['voice.microphone_processing_status_towk']();
        case 'native':
          return m['voice.microphone_processing_status_native']();
        case 'unknown':
          return m['voice.microphone_processing_status_requested']();
        case 'unavailable':
          return m['voice.microphone_processing_status_unavailable']();
      }
    }

    if (voiceCallState.microphoneProcessing.echoCancellation === true) {
      return m['voice.microphone_processing_status_native']();
    }
    if (voiceCallState.microphoneProcessing.echoCancellation === false) {
      return m['voice.microphone_processing_status_unavailable']();
    }
    return m['voice.microphone_processing_status_requested']();
  }

  async function toggleMicrophoneProcessing(control: MicrophoneProcessingControl): Promise<void> {
    await voiceCallState.setMicrophoneProcessingPreference(control.key, !control.enabled);
  }

  function toggleHighFrameRateScreenShare(): void {
    voiceCallState.setScreenShareHighFrameRate(!voiceCallState.screenShareHighFrameRate);
  }

  function deviceName(section: DeviceSection, device: MediaDeviceInfo): string {
    if (section.kind === 'videoinput') {
      return cameraDeviceNames.get(device.deviceId) ?? m['voice.camera']();
    }
    const names = section.kind === 'audiooutput' ? audioOutputDeviceNames : audioInputDeviceNames;
    return names.get(device.deviceId) ?? m['voice.unknown_device']();
  }

  let menuElement: HTMLElement | null = null;
  let typeahead = '';
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;
  let initialFocusFrame: number | null = null;
  let initialFocusApplied = false;

  function menuItems(): HTMLButtonElement[] {
    return menuElement
      ? Array.from(
          menuElement.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemcheckbox"], [role="menuitemradio"], [role="menuitem"]'
          )
        )
      : [];
  }

  function focusItem(index: number): void {
    const items = menuItems();
    if (!items.length) return;
    items[(index + items.length) % items.length]?.focus();
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    const items = menuItems();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(currentIndex + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(currentIndex <= 0 ? items.length - 1 : currentIndex - 1);
        return;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        return;
      case 'End':
        event.preventDefault();
        focusItem(items.length - 1);
        return;
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        event.stopPropagation();
        onclose();
        return;
    }

    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    typeahead += event.key.toLocaleLowerCase();
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => {
      typeahead = '';
      typeaheadTimer = null;
    }, 500);
    const start = Math.max(currentIndex, -1) + 1;
    const ordered = [...items.slice(start), ...items.slice(0, start)];
    const match = ordered.find((item) =>
      item.textContent?.trim().toLocaleLowerCase().startsWith(typeahead)
    );
    if (match) {
      event.preventDefault();
      match.focus();
    }
  }

  $effect(() => {
    const deviceCount =
      microphoneProcessingControls.length +
      (voiceCallState.canShareScreen ? 1 : 0) +
      sections.reduce((total, section) => total + section.devices.length, 0) +
      (voiceCallState.canRequestAudioOutputDevice ? 1 : 0);
    if (initialFocusApplied || deviceCount === 0) return;
    initialFocusApplied = true;
    initialFocusFrame = requestAnimationFrame(() => {
      initialFocusFrame = null;
      focusItem(0);
    });
  });

  onDestroy(() => {
    if (initialFocusFrame !== null) cancelAnimationFrame(initialFocusFrame);
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
  });
</script>

<ContextMenu {anchor} role="presentation" {onclose}>
  <div
    bind:this={menuElement}
    id="call-audio-device-menu"
    class="max-h-[72vh] w-full overflow-y-auto pb-1 sm:max-h-[42rem]"
    role="menu"
    tabindex="-1"
    aria-label={m['voice.devices']()}
    onkeydown={handleMenuKeydown}
  >
    <div class="menu-section" role="group" aria-labelledby="call-microphone-processing-title">
      <div
        id="call-microphone-processing-title"
        class="flex items-center gap-2 px-3 pt-1.5 pb-2 text-sm font-semibold text-text"
      >
        <span class="iconify text-base text-muted uil--shield-check" aria-hidden="true"></span>
        {m['voice.microphone_processing_title']()}
      </div>
      <div class="sidebar-nav">
        <div
          class="mx-3 mb-1 flex items-start gap-2 rounded-md bg-surface-200 px-2.5 py-2 text-xs text-muted"
          role="status"
        >
          <span class="mt-0.5 iconify shrink-0 text-sm uil--info-circle" aria-hidden="true"></span>
          <span>{microphoneProcessingMessage}</span>
        </div>
        {#each microphoneProcessingControls as control (control.key)}
          <button
            class="sidebar-item min-h-[64px] gap-3 rounded-lg px-3"
            role="menuitemcheckbox"
            aria-checked={control.enabled}
            tabindex="-1"
            disabled={voiceCallState.isMicrophonePending}
            onclick={() => toggleMicrophoneProcessing(control)}
          >
            <span class={['sidebar-icon iconify text-muted', control.icon]} aria-hidden="true"
            ></span>
            <span class="min-w-0 flex-1 text-left">
              <span class="block truncate">{control.label}</span>
              <span class="block truncate text-xs text-muted">{control.status}</span>
            </span>
            <span
              class={[
                'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors',
                control.enabled ? 'border-accent/50 bg-accent/25' : 'border-text/10 bg-surface-300'
              ]}
              aria-hidden="true"
            >
              <span
                class={[
                  'h-6 w-6 rounded-full shadow-sm transition-transform',
                  control.enabled ? 'translate-x-7 bg-accent' : 'translate-x-1 bg-muted'
                ]}
              ></span>
            </span>
          </button>
        {/each}
      </div>
    </div>
    {#if voiceCallState.canShareScreen}
      <div class="menu-section" role="group" aria-labelledby="call-video-quality-title">
        <div
          id="call-video-quality-title"
          class="flex items-center gap-2 px-3 pt-4 pb-2 text-sm font-semibold text-text"
        >
          <span class="iconify text-base text-muted uil--film" aria-hidden="true"></span>
          {m['voice.video_quality_title']()}
        </div>
        <div class="sidebar-nav">
          <button
            class="sidebar-item min-h-[64px] gap-3 rounded-lg px-3"
            role="menuitemcheckbox"
            aria-checked={voiceCallState.screenShareHighFrameRate}
            tabindex="-1"
            disabled={!voiceCallState.canUseHighFrameRateScreenShare ||
              voiceCallState.isScreenSharePending ||
              voiceCallState.isScreenShareEnabled}
            onclick={toggleHighFrameRateScreenShare}
          >
            <span class="sidebar-icon iconify text-muted uil--monitor" aria-hidden="true"></span>
            <span class="min-w-0 flex-1 text-left">
              <span class="block truncate">{m['voice.screen_share_frame_rate']()}</span>
              <span class="block text-xs text-muted">
                {voiceCallState.canUseHighFrameRateScreenShare
                  ? voiceCallState.screenShareHighFrameRate
                    ? m['voice.screen_share_frame_rate_high']()
                    : m['voice.screen_share_frame_rate_standard']()
                  : m['voice.screen_share_frame_rate_unavailable']()}
              </span>
            </span>
            <span
              class={[
                'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors',
                voiceCallState.screenShareHighFrameRate
                  ? 'border-accent/50 bg-accent/25'
                  : 'border-text/10 bg-surface-300'
              ]}
              aria-hidden="true"
            >
              <span
                class={[
                  'h-6 w-6 rounded-full shadow-sm transition-transform',
                  voiceCallState.screenShareHighFrameRate
                    ? 'translate-x-7 bg-accent'
                    : 'translate-x-1 bg-muted'
                ]}
              ></span>
            </span>
          </button>
        </div>
      </div>
    {/if}
    {#each sections as section, sectionIndex (section.label)}
      <div
        class="menu-section"
        role="group"
        aria-labelledby={`call-device-section-${sectionIndex}`}
      >
        <div
          id={`call-device-section-${sectionIndex}`}
          class="flex items-center gap-2 px-3 pt-4 pb-2 text-sm font-semibold text-text first:pt-2"
        >
          <span class={['iconify text-base text-muted', section.icon]} aria-hidden="true"></span>
          {section.label}
        </div>
        <div class="sidebar-nav">
          {#each section.devices as device (device.deviceId)}
            <button
              class="sidebar-item min-h-[52px] gap-3 rounded-lg px-3"
              role="menuitemradio"
              aria-checked={device.deviceId === section.selectedId}
              tabindex="-1"
              onclick={async () => {
                await section.select(device.deviceId);
                onclose();
              }}
            >
              <span class={['sidebar-icon iconify text-muted', section.icon]} aria-hidden="true"
              ></span>
              <span class="min-w-0 flex-1 truncate text-left">{deviceName(section, device)}</span>
              {#if device.deviceId === section.selectedId}
                <span class="iconify shrink-0 text-base text-accent uil--check" aria-hidden="true"
                ></span>
              {/if}
            </button>
          {/each}

          {#if section.kind === 'audiooutput' && voiceCallState.canRequestAudioOutputDevice}
            <button
              class="sidebar-item min-h-[52px] gap-3 rounded-lg px-3"
              role="menuitem"
              tabindex="-1"
              onclick={async () => {
                if (await voiceCallState.requestAudioOutputDevice()) onclose();
              }}
            >
              <span class="sidebar-icon iconify text-muted uil--plus-circle" aria-hidden="true"
              ></span>
              <span class="min-w-0 flex-1 text-left">{m['voice.choose_speaker']()}</span>
            </button>
          {/if}

          {#if section.devices.length === 0 && !(section.kind === 'audiooutput' && voiceCallState.canRequestAudioOutputDevice)}
            <div class="px-3 py-2 text-sm text-muted">{section.emptyMessage}</div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</ContextMenu>
