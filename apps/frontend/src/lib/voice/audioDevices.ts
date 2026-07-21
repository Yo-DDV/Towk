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
  const normalized = rawLabel.trim().toLocaleLowerCase();
  const isOutput = kind === 'audiooutput';

  if (
    normalized === 'speakerphone' ||
    normalized === 'phone speaker' ||
    normalized === 'built-in speaker'
  ) {
    return isOutput ? labels.phoneSpeaker : labels.phoneMicrophone;
  }

  if (
    normalized === 'headset earpiece' ||
    normalized === 'wired headset' ||
    normalized === 'headset microphone' ||
    normalized === 'headset'
  ) {
    return isOutput ? labels.headsetSpeaker : labels.headsetMicrophone;
  }

  if (
    normalized === 'bluetooth headset' ||
    normalized === 'bluetooth microphone' ||
    normalized === 'bluetooth'
  ) {
    return isOutput ? labels.bluetoothSpeaker : labels.bluetoothMicrophone;
  }

  return null;
}
