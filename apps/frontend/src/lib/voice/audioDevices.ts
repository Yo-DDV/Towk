export type FriendlyAudioDeviceLabels = {
  microphone: string;
  speaker: string;
  phoneMicrophone: string;
  headsetMicrophone: string;
  bluetoothMicrophone: string;
  phoneSpeaker: string;
  headsetSpeaker: string;
  bluetoothSpeaker: string;
  systemDefault: string;
  communicationsDefault: string;
};

export type AudioDeviceRouteKind =
  'bluetooth' | 'communications' | 'default' | 'earpiece' | 'speakerphone' | 'unknown';

export type AudioInputTrackRouteKind = 'bluetooth' | 'built-in' | 'wired' | 'unknown';

export type PreferredAudioDeviceSelection = {
  activeDeviceId?: string | null;
  explicitDeviceId?: string | null;
  selectedDeviceId?: string | null;
};

/**
 * Keep useful desktop hardware names while replacing opaque or browser-generic
 * mobile labels with stable, localized names.
 */
export function friendlyAudioDeviceNames(
  devices: MediaDeviceInfo[],
  labels: FriendlyAudioDeviceLabels
): Map<string, string> {
  const names = new Map<string, string>();
  const occurrences = new Map<string, number>();

  devices.forEach((device, index) => {
    const base = device.kind === 'audiooutput' ? labels.speaker : labels.microphone;
    const rawLabel = device.label.trim();
    let name: string;

    if (device.deviceId === 'default') {
      name = systemRouteName(labels.systemDefault, rawLabel, device.deviceId);
    } else if (device.deviceId === 'communications') {
      name = systemRouteName(labels.communicationsDefault, rawLabel, device.deviceId);
    } else if (!rawLabel || rawLabel === device.deviceId) {
      name = `${base} ${index + 1}`;
    } else {
      name = localizedGenericRouteName(device.kind, rawLabel, labels) ?? rawLabel;
    }

    const occurrence = (occurrences.get(name) ?? 0) + 1;
    occurrences.set(name, occurrence);
    names.set(device.deviceId, occurrence === 1 ? name : `${name} (${occurrence})`);
  });

  return names;
}

export function audioDeviceRouteKind(device: MediaDeviceInfo): AudioDeviceRouteKind {
  const normalized = normalizeAudioDeviceLabel(device.label);
  if (isBluetoothDeviceLabel(normalized)) return 'bluetooth';
  if (device.deviceId === 'default') return 'default';
  if (device.deviceId === 'communications') return 'communications';
  if (isEarpieceRouteLabel(normalized)) return 'earpiece';
  if (isSpeakerphoneRouteLabel(normalized)) return 'speakerphone';
  return 'unknown';
}

/**
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
  device: MediaDeviceInfo,
  availableDevices: MediaDeviceInfo[]
): boolean {
  const routeKind = audioDeviceRouteKind(device);
  return (
    routeKind === 'bluetooth' ||
    ((routeKind === 'default' || routeKind === 'communications') &&
      availableDevices.some((candidate) => audioDeviceRouteKind(candidate) === 'bluetooth'))
  );
}

export function preferredAudioDeviceId(
  devices: MediaDeviceInfo[],
  selection: PreferredAudioDeviceSelection = {}
): string | null {
  if (selection.explicitDeviceId && hasDevice(devices, selection.explicitDeviceId)) {
    return selection.explicitDeviceId;
  }

  const bluetoothDevice = devices.find((device) => audioDeviceRouteKind(device) === 'bluetooth');
  if (bluetoothDevice) return bluetoothDevice.deviceId;

  if (selection.activeDeviceId && hasDevice(devices, selection.activeDeviceId)) {
    return selection.activeDeviceId;
  }

  if (selection.selectedDeviceId && hasDevice(devices, selection.selectedDeviceId)) {
    return selection.selectedDeviceId;
  }

  return devices[0]?.deviceId ?? null;
}

function systemRouteName(base: string, rawLabel: string, deviceId: string): string {
  if (!rawLabel || rawLabel === deviceId || rawLabel.toLocaleLowerCase() === deviceId) return base;
  const separator = rawLabel.indexOf(' - ');
  const hardwareName = separator >= 0 ? rawLabel.slice(separator + 3).trim() : rawLabel;
  return hardwareName && hardwareName.toLocaleLowerCase() !== deviceId
    ? `${base} — ${hardwareName}`
    : base;
}

function localizedGenericRouteName(
  kind: MediaDeviceKind,
  rawLabel: string,
  labels: FriendlyAudioDeviceLabels
): string | null {
  const normalized = normalizeAudioDeviceLabel(rawLabel);
  const isOutput = kind === 'audiooutput';

  if (isSpeakerphoneRouteLabel(normalized)) {
    return isOutput ? labels.phoneSpeaker : labels.phoneMicrophone;
  }

  if (isEarpieceRouteLabel(normalized)) {
    return isOutput ? labels.headsetSpeaker : labels.headsetMicrophone;
  }

  if (isGenericBluetoothRouteLabel(normalized)) {
    return isOutput ? labels.bluetoothSpeaker : labels.bluetoothMicrophone;
  }

  return null;
}

function hasDevice(devices: MediaDeviceInfo[], deviceId: string): boolean {
  return devices.some((device) => device.deviceId === deviceId);
}

function normalizeAudioDeviceLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

function isBluetoothDeviceLabel(normalized: string): boolean {
  return (
    isGenericBluetoothRouteLabel(normalized) ||
    /\bbluetooth\b/.test(normalized) ||
    isKnownWirelessCallRouteLabel(normalized)
  );
}

function isKnownWirelessCallRouteLabel(normalized: string): boolean {
  return (
    /\bhands[- ]?free\b/.test(normalized) ||
    /\b(?:airpods?|freebuds)\b/.test(normalized) ||
    /\b(?:galaxy|pixel|oneplus) buds/.test(normalized) ||
    /\bwireless (?:earbuds?|earphones?|headphones?|headset)\b/.test(normalized) ||
    /\b(?:casque|ecouteurs?|auriculares?|kopfhorer|fones?) (?:sans fil|inalambricos?|sem fio|drahtlos)\b/.test(
      normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    ) ||
    /\b(?:powerbeats|beats fit|quietcomfort|linkbuds|soundcore)\b/.test(normalized) ||
    /\b(?:wh|wf)-\d{3,4}[a-z0-9-]*\b/.test(normalized)
  );
}

function isKnownBuiltInMicrophoneLabel(normalized: string): boolean {
  const folded = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const mentionsMicrophone = /\b(?:microphone|mic|micro|mikrofon|microfono|microfone)\b/.test(
    folded
  );
  const mentionsBuiltInDevice =
    /\b(?:iphone|ipad|macbook(?: pro| air)?|imac(?: pro)?|mac (?:mini|studio))\b/.test(folded);
  return (
    (mentionsMicrophone && mentionsBuiltInDevice) ||
    /\b(?:built[- ]?in|internal|integre|integriert|integrado) (?:array )?(?:microphone|mic|mikrofon|microfono|microfone)\b/.test(
      folded
    ) ||
    /\b(?:phone|handset|telephone) (?:microphone|mic|micro)\b/.test(folded)
  );
}

function isKnownWiredMicrophoneLabel(normalized: string): boolean {
  return (
    /\b(?:usb|wired)\b/.test(normalized) ||
    /\b(?:external microphone|headset microphone|headset mic)\b/.test(normalized)
  );
}

function isGenericBluetoothRouteLabel(normalized: string): boolean {
  return (
    normalized === 'bluetooth' ||
    normalized === 'bluetooth headset' ||
    normalized === 'bluetooth microphone' ||
    normalized === 'bluetooth audio'
  );
}

function isEarpieceRouteLabel(normalized: string): boolean {
  return (
    normalized === 'earpiece' ||
    normalized === 'headset' ||
    normalized === 'headset earpiece' ||
    normalized === 'headset microphone' ||
    normalized === 'phone earpiece' ||
    normalized === 'receiver' ||
    normalized === 'wired headset'
  );
}

function isSpeakerphoneRouteLabel(normalized: string): boolean {
  return (
    normalized === 'speakerphone' ||
    normalized === 'phone speaker' ||
    normalized === 'built-in speaker'
  );
}
