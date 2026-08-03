#!/usr/bin/env python3
"""Deterministically reconcile PR #290 with the current call implementation.

This script is copied outside the worktree by the one-shot integration job. The
resulting branch tree deliberately excludes this file and its workflow.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def ensure_replace(path: str, old: str, new: str, marker: str) -> None:
    text = read(path)
    if marker in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor for {marker!r}, found {count}")
    write(path, text.replace(old, new, 1))


def ensure_audio_devices() -> None:
    path = "apps/frontend/src/lib/voice/audioDevices.ts"
    ensure_replace(
        path,
        "export type AudioDeviceRouteKind =\n  'bluetooth' | 'communications' | 'default' | 'earpiece' | 'speakerphone' | 'unknown';\n\n",
        "export type AudioDeviceRouteKind =\n  'bluetooth' | 'communications' | 'default' | 'earpiece' | 'speakerphone' | 'unknown';\n\nexport type AudioInputTrackRouteKind = 'bluetooth' | 'built-in' | 'wired' | 'unknown';\n\n",
        "export type AudioInputTrackRouteKind"
    )
    ensure_replace(
        path,
        "export function audioDeviceMayUseBluetooth(\n",
        """/**
 * Classify the label on the captured source track itself.
 *
 * WebKit can return a valid microphone track whose deviceId does not correlate
 * with enumerateDevices(). The source label is then the only browser-exposed
 * evidence that distinguishes a built-in microphone from a Bluetooth route.
 * Generic and processor-generated labels deliberately remain unknown.
 */
export function audioInputTrackRouteKind(label: string): AudioInputTrackRouteKind {
  const normalized = normalizeAudioDeviceLabel(label);
  if (!normalized || normalized === 'microphone') return 'unknown';
  if (normalized === 'mediastreamaudiodestinationnode') return 'unknown';
  if (isBluetoothDeviceLabel(normalized)) return 'bluetooth';
  if (isKnownBuiltInMicrophoneLabel(normalized)) return 'built-in';
  if (isKnownWiredMicrophoneLabel(normalized)) return 'wired';
  return 'unknown';
}

export function audioDeviceMayUseBluetooth(
""",
        "export function audioInputTrackRouteKind"
    )
    ensure_replace(
        path,
        """function isKnownWirelessCallRouteLabel(normalized: string): boolean {
  return (
    /\\bhands[- ]?free\\b/.test(normalized) ||
    /\\b(?:airpods?|freebuds)\\b/.test(normalized) ||
    /\\b(?:galaxy|pixel|oneplus) buds/.test(normalized) ||
    /\\bwireless (?:earbuds?|earphones?|headphones?|headset)\\b/.test(normalized)
  );
}

function isGenericBluetoothRouteLabel(normalized: string): boolean {
""",
        """function isKnownWirelessCallRouteLabel(normalized: string): boolean {
  return (
    /\\bhands[- ]?free\\b/.test(normalized) ||
    /\\b(?:airpods?|freebuds)\\b/.test(normalized) ||
    /\\b(?:galaxy|pixel|oneplus) buds/.test(normalized) ||
    /\\bwireless (?:earbuds?|earphones?|headphones?|headset)\\b/.test(normalized) ||
    /\\b(?:casque|ecouteurs?|auriculares?|kopfhorer|fones?) (?:sans fil|inalambricos?|sem fio|drahtlos)\\b/.test(
      normalized.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    ) ||
    /\\b(?:powerbeats|beats fit|quietcomfort|linkbuds|soundcore)\\b/.test(normalized) ||
    /\\b(?:wh|wf)-\\d{3,4}[a-z0-9-]*\\b/.test(normalized)
  );
}

function isKnownBuiltInMicrophoneLabel(normalized: string): boolean {
  const folded = normalized.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  const mentionsMicrophone = /\\b(?:microphone|mic|micro|mikrofon|microfono|microfone)\\b/.test(
    folded
  );
  const mentionsBuiltInDevice =
    /\\b(?:iphone|ipad|macbook(?: pro| air)?|imac(?: pro)?|mac (?:mini|studio))\\b/.test(folded);
  return (
    (mentionsMicrophone && mentionsBuiltInDevice) ||
    /\\b(?:built[- ]?in|internal|integre|integriert|integrado) (?:array )?(?:microphone|mic|mikrofon|microfono|microfone)\\b/.test(
      folded
    ) ||
    /\\b(?:phone|handset|telephone) (?:microphone|mic|micro)\\b/.test(folded)
  );
}

function isKnownWiredMicrophoneLabel(normalized: string): boolean {
  return (
    /\\b(?:usb|wired)\\b/.test(normalized) ||
    /\\b(?:external microphone|headset microphone|headset mic)\\b/.test(normalized)
  );
}

function isGenericBluetoothRouteLabel(normalized: string): boolean {
""",
        "function isKnownBuiltInMicrophoneLabel"
    )


def ensure_audio_device_tests() -> None:
    path = "apps/frontend/src/lib/voice/audioDevices.spec.ts"
    ensure_replace(
        path,
        "  audioDeviceRouteKind,\n  friendlyAudioDeviceNames,",
        "  audioDeviceRouteKind,\n  audioInputTrackRouteKind,\n  friendlyAudioDeviceNames,",
        "  audioInputTrackRouteKind,"
    )
    text = read(path)
    marker = "describe('audioInputTrackRouteKind'"
    if marker not in text:
        block = """

describe('audioInputTrackRouteKind', () => {
  it('uses the captured source label when WebKit does not expose a correlatable device id', () => {
    expect(audioInputTrackRouteKind('iPhone Microphone')).toBe('built-in');
    expect(audioInputTrackRouteKind('MacBook Pro Microphone')).toBe('built-in');
    expect(audioInputTrackRouteKind('Built-in Microphone')).toBe('built-in');
    expect(audioInputTrackRouteKind('Microphone de l’iPhone')).toBe('built-in');
    expect(audioInputTrackRouteKind('Microphone du MacBook Pro')).toBe('built-in');
    expect(audioInputTrackRouteKind('MacBook Pro Mikrofon')).toBe('built-in');
    expect(audioInputTrackRouteKind('Micrófono del iPhone')).toBe('built-in');
    expect(audioInputTrackRouteKind('Microfone do iPhone')).toBe('built-in');
    expect(audioInputTrackRouteKind('USB Headset')).toBe('wired');
    expect(audioInputTrackRouteKind('AirPods Pro')).toBe('bluetooth');
    expect(audioInputTrackRouteKind('WH-1000XM5')).toBe('bluetooth');
    expect(audioInputTrackRouteKind('Casque sans fil')).toBe('bluetooth');
    expect(audioInputTrackRouteKind('Microphone')).toBe('unknown');
    expect(audioInputTrackRouteKind('MediaStreamAudioDestinationNode')).toBe('unknown');
  });
});
"""
        write(path, text.rstrip() + block + "\n")


def ensure_voice_call() -> None:
    path = "apps/frontend/src/lib/state/server/voiceCall.svelte.ts"
    ensure_replace(
        path,
        "  audioDeviceRouteKind,\n  preferredAudioDeviceId\n} from '$lib/voice/audioDevices';",
        "  audioDeviceRouteKind,\n  audioInputTrackRouteKind,\n  preferredAudioDeviceId,\n  type AudioInputTrackRouteKind\n} from '$lib/voice/audioDevices';",
        "  type AudioInputTrackRouteKind"
    )
    ensure_replace(
        path,
        "  private microphoneRouteFingerprint: string | null = null;\n",
        "  private microphoneRouteFingerprint: string | null = null;\n  private microphoneSourceRouteKind: AudioInputTrackRouteKind = 'unknown';\n",
        "private microphoneSourceRouteKind"
    )
    ensure_replace(
        path,
        """  private async updateMicrophoneProcessing(
    track: LocalAudioTrack,
    environment: MicrophoneProcessingEnvironment = this.microphoneProcessingEnvironment(track)
  ): Promise<void> {
    this.microphoneRouteFingerprint = microphoneTrackSettingsFingerprint(
      track.getSourceTrackSettings()
    );
    try {
      this.microphoneProcessing = await ensureBackgroundNoiseSuppression(
""",
        """  private async updateMicrophoneProcessing(
    track: LocalAudioTrack,
    environment: MicrophoneProcessingEnvironment = this.microphoneProcessingEnvironment(track),
    probeSourceRoute = false
  ): Promise<void> {
    this.microphoneRouteFingerprint = microphoneTrackSettingsFingerprint(
      track.getSourceTrackSettings()
    );
    try {
      if (probeSourceRoute && track.getProcessor()) {
        // A processed LocalAudioTrack exposes the AudioWorklet destination,
        // not the newly captured source label. Detach on the stable serialized
        // path, then classify the real source before deciding whether to
        // restore enhanced processing. This is also the required clock reset
        // when the OS coupled an output change to a Bluetooth microphone.
        const resetStatus = await ensureBackgroundNoiseSuppression(
          track,
          this.microphoneProcessingPreferences,
          {
            ...environment,
            routeIdentityKnown: false
          }
        );
        if (track.getProcessor()) {
          // A failed LiveKit detach can reacquire native capture while keeping
          // the old processor reference until its lifecycle settles. Do not
          // reinterpret that stale destination as a safe source or re-enable
          // the graph during the same route transition.
          this.microphoneProcessing = resetStatus;
          return;
        }
        environment = this.microphoneProcessingEnvironment(track);
      }
      this.microphoneProcessing = await ensureBackgroundNoiseSuppression(
""",
        "probeSourceRoute = false"
    )
    ensure_replace(
        path,
        """  private async reconcileMicrophoneProcessing(room: Room): Promise<void> {
    if (this.room !== room || this.isMuted) return;
    const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = publication?.track as LocalAudioTrack | undefined;
    if (!track) return;
    await this.updateMicrophoneProcessing(track);
  }
""",
        """  private async reconcileMicrophoneProcessing(room: Room, probeSourceRoute = false): Promise<void> {
    if (this.room !== room || this.isMuted) return;
    const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = publication?.track as LocalAudioTrack | undefined;
    if (!track) return;
    await this.updateMicrophoneProcessing(
      track,
      this.microphoneProcessingEnvironment(track),
      probeSourceRoute
    );
  }
""",
        "reconcileMicrophoneProcessing(room: Room, probeSourceRoute = false)"
    )
    ensure_replace(
        path,
        "    const availableRouteKinds = this.audioDevices.map((device) => audioDeviceRouteKind(device));\n    const usesLogicalRoute = routeKinds.some(\n",
        """    const availableRouteKinds = this.audioDevices.map((device) => audioDeviceRouteKind(device));
    const sourceRouteKind = track.getProcessor()
      ? this.microphoneSourceRouteKind
      : audioInputTrackRouteKind(track.mediaStreamTrack.label);
    if (!track.getProcessor()) this.microphoneSourceRouteKind = sourceRouteKind;
    const usesLogicalRoute = routeKinds.some(
""",
        "const sourceRouteKind = track.getProcessor()"
    )
    ensure_replace(
        path,
        """      bluetoothRoute: routeDevices.some((device) =>
        audioDeviceMayUseBluetooth(device, this.audioDevices)
      ),
""",
        """      bluetoothRoute:
        sourceRouteKind === 'bluetooth' ||
        routeDevices.some((device) => audioDeviceMayUseBluetooth(device, this.audioDevices)),
""",
        "sourceRouteKind === 'bluetooth'"
    )
    ensure_replace(
        path,
        """      routeIdentityKnown:
        routeKinds.some((kind) => kind !== 'default' && kind !== 'communications') ||
""",
        """      routeIdentityKnown:
        sourceRouteKind !== 'unknown' ||
        routeKinds.some((kind) => kind !== 'default' && kind !== 'communications') ||
""",
        "routeIdentityKnown:\n        sourceRouteKind !== 'unknown'"
    )
    ensure_replace(
        path,
        """      if (kind === 'audioinput') {
        this.selectedDeviceId = deviceId;
        void this.synchronizeAndroidPlaybackForAudioInput(room, deviceId).catch(() => undefined);
        if (this.explicitMediaDeviceOperationDepth === 0) {
          void this.serializeAudioInputOperation(() => this.reconcileMicrophoneProcessing(room));
        }
      } else if (kind === 'audiooutput') {
        this.selectedOutputDeviceId = deviceId;
      } else if (kind === 'videoinput') {
""",
        """      if (kind === 'audioinput') {
        this.selectedDeviceId = deviceId;
        void this.synchronizeAndroidPlaybackForAudioInput(room, deviceId).catch(() => undefined);
        if (this.explicitMediaDeviceOperationDepth === 0) {
          void this.serializeAudioInputOperation(() =>
            this.reconcileMicrophoneProcessing(room, true)
          );
        }
      } else if (kind === 'audiooutput') {
        this.selectedOutputDeviceId = deviceId;
        // An OS route change can couple the output to a different microphone
        // or communication profile even when this engine also exposes
        // setSinkId(). Explicit Towk changes are already handled by their
        // serialized operation; every external output change gets one probe.
        if (this.explicitMediaDeviceOperationDepth === 0) {
          void this.serializeAudioInputOperation(() =>
            this.reconcileMicrophoneProcessing(room, true)
          );
        }
      } else if (kind === 'videoinput') {
""",
        "An OS route change can couple the output"
    )
    ensure_replace(
        path,
        """  private async handleMediaDevicesChanged(room: Room): Promise<void> {
    if (this.room !== room) return;
    await this.refreshDevices();
    if (this.room !== room) return;
    if (this.microphoneRouteRecovering) {
      await this.attemptAutomaticMicrophoneRouteRecovery(room, true);
      return;
    }
    await this.serializeAudioInputOperation(() => this.reconcileMicrophoneProcessing(room));
  }
""",
        """  private async handleMediaDevicesChanged(room: Room): Promise<void> {
    if (this.room !== room) return;
    const previousAudioInputFingerprint = audioDeviceInventoryFingerprint(this.audioDevices);
    await this.refreshDevices();
    if (this.room !== room) return;
    if (this.microphoneRouteRecovering) {
      await this.attemptAutomaticMicrophoneRouteRecovery(room, true);
      return;
    }
    const audioInputChanged =
      previousAudioInputFingerprint !== audioDeviceInventoryFingerprint(this.audioDevices);
    await this.serializeAudioInputOperation(() =>
      this.reconcileMicrophoneProcessing(room, audioInputChanged)
    );
  }
""",
        "const previousAudioInputFingerprint"
    )
    ensure_replace(
        path,
        """    await this.serializeAudioInputOperation(() => this.reconcileMicrophoneProcessing(room));
  }

  private beginMicrophoneRouteRecovery(): void {
""",
        """    await this.serializeAudioInputOperation(() => this.reconcileMicrophoneProcessing(room, true));
  }

  private beginMicrophoneRouteRecovery(): void {
""",
        "reconcileMicrophoneProcessing(room, true));\n  }\n\n  private beginMicrophoneRouteRecovery"
    )
    ensure_replace(
        path,
        "    this.microphoneRouteFingerprint = null;\n    this.audioLevelCache.clear();\n",
        "    this.microphoneRouteFingerprint = null;\n    this.microphoneSourceRouteKind = 'unknown';\n    this.audioLevelCache.clear();\n",
        "this.microphoneSourceRouteKind = 'unknown';\n    this.audioLevelCache.clear()"
    )
    ensure_replace(
        path,
        """function microphoneProcessingConstraints(
""",
        """function audioDeviceInventoryFingerprint(devices: MediaDeviceInfo[]): string {
  return JSON.stringify(
    devices
      .map((device) => [device.deviceId, device.groupId, device.kind, device.label])
      .sort(([leftDeviceId], [rightDeviceId]) => leftDeviceId.localeCompare(rightDeviceId))
  );
}

function microphoneProcessingConstraints(
""",
        "function audioDeviceInventoryFingerprint"
    )


def ensure_voice_call_test_harness() -> None:
    path = "apps/frontend/src/lib/state/server/voiceCall.svelte.spec.ts"
    ensure_replace(
        path,
        "let microphoneTrackSettings: MediaTrackSettings;\n",
        "let microphoneTrackSettings: MediaTrackSettings;\nlet microphoneSourceTrackLabel = 'Microphone';\nlet microphoneProcessedTrackLabel = 'MediaStreamAudioDestinationNode';\n",
        "let microphoneSourceTrackLabel"
    )
    ensure_replace(
        path,
        "    mediaStreamTrack: { getSettings: () => MediaTrackSettings };\n",
        "    mediaStreamTrack: { readonly label: string; getSettings: () => MediaTrackSettings };\n",
        "mediaStreamTrack: { readonly label: string"
    )
    ensure_replace(
        path,
        """              mediaStreamTrack: {
                getSettings: () => microphoneTrackSettings
              },
""",
        """              mediaStreamTrack: {
                get label() {
                  return microphoneProcessor
                    ? microphoneProcessedTrackLabel
                    : microphoneSourceTrackLabel;
                },
                getSettings: () => microphoneTrackSettings
              },
""",
        "return microphoneProcessor\n                    ? microphoneProcessedTrackLabel"
    )
    ensure_replace(
        path,
        """    microphoneTrackSettings = {
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48_000
    };
    microphoneSetProcessor = vi.fn(async (processor: { name: string }) => {
""",
        """    microphoneTrackSettings = {
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48_000
    };
    microphoneSourceTrackLabel = 'Microphone';
    microphoneProcessedTrackLabel = 'MediaStreamAudioDestinationNode';
    microphoneSetProcessor = vi.fn(async (processor: { name: string }) => {
""",
        "microphoneSourceTrackLabel = 'Microphone';\n    microphoneProcessedTrackLabel"
    )


def ensure_fdr() -> None:
    path = "docs/fdr/FDR-016-voice-calls.md"
    text = read(path)
    marker = "#### Source-label-assisted WebKit route probes"
    if marker in text:
        return
    anchor = "### 12. Call participation separates account identity from connection identity"
    if anchor not in text:
        raise RuntimeError(f"{path}: section 12 anchor missing")
    addition = """#### Source-label-assisted WebKit route probes

When WebKit exposes an opaque or non-correlatable device ID, Towk may use a positively identified source-track label for an iPhone, iPad, Mac built-in, USB, wired, or known Bluetooth microphone as additional route evidence. Generic labels such as `Microphone` and processor-generated labels remain unknown. After an external input or system-managed output route change, Towk serializes one probe: it removes the processed destination, inspects the real capture source, then restores RNNoise/Speex only for a compatible matching-clock route. A failed detach cannot re-enable the stale processor during the same transition, and inventory reordering alone does not rebuild the graph.

| Engine and platform | Suppression path | Output and Bluetooth boundary |
| --- | --- | --- |
| Chromium desktop | Native constraints plus RNNoise/Speex on compatible non-Bluetooth routes | Standards sink selection where available; input remains separate |
| Chromium Android | Enhanced processing on compatible built-in routes; Bluetooth and narrowband stay native | Native communication pairs and the OS own physical routing |
| Firefox desktop | Native constraints plus RNNoise/Speex on compatible routes | Standards sink selection where available |
| Firefox Android | Enhanced processing only when the route and clock are positively compatible | Mobile output remains OS-controlled |
| WebKit on macOS, iOS and iPadOS | Source-label-assisted RNNoise/Speex on compatible routes; confirmed Bluetooth stays native | System-managed input or output changes trigger one serialized source probe |

The web client never calls Android `AudioManager` or Apple `AVAudioSession`; those native APIs remain outside an ordinary browser/PWA boundary. Physical-device acceptance remains required for acoustic quality and Bluetooth-profile behavior.

"""
    write(path, text.replace(anchor, addition + anchor, 1))


def verify_feature_tests() -> None:
    text = read("apps/frontend/src/lib/state/server/voiceCall.svelte.spec.ts")
    expected = [
        "uses the WebKit source label to restore suppression across opaque route changes",
        "reprobes the microphone after an opaque system output change even when setSinkId exists",
        "reprobes the microphone when a named Bluetooth output becomes active",
        "does not duplicate the microphone probe inside an explicit output switch",
        "stays native when a route probe reacquires capture but the old processor is still referenced",
        "does not rebuild enhanced processing when device enumeration only changes order",
    ]
    missing = [title for title in expected if title not in text]
    if missing:
        raise RuntimeError("voice-call integration tests missing after cherry-pick: " + ", ".join(missing))


def main() -> None:
    ensure_audio_devices()
    ensure_audio_device_tests()
    ensure_voice_call()
    ensure_voice_call_test_harness()
    ensure_fdr()
    verify_feature_tests()
    subprocess.run(["git", "diff", "--check"], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
