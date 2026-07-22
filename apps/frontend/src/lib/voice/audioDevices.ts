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
    /\bwireless (?:earbuds?|earphones?|headphones?|headset)\b/.test(normalized)
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
