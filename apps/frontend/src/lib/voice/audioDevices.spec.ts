import { describe, expect, it } from 'vitest';
import { friendlyAudioDeviceNames } from './audioDevices';

const labels = {
  microphone: 'Microphone',
  speaker: 'Speaker',
  phoneMicrophone: 'Phone microphone',
  headsetMicrophone: 'Headset microphone',
  bluetoothMicrophone: 'Bluetooth microphone',
  phoneSpeaker: 'Phone speaker',
  headsetSpeaker: 'Headset speaker',
  bluetoothSpeaker: 'Bluetooth audio',
  systemDefault: 'System default',
  communicationsDefault: 'Default communication device'
};

function device(
  deviceId: string,
  label: string,
  kind: 'audioinput' | 'audiooutput' = 'audioinput'
): MediaDeviceInfo {
  return { deviceId, groupId: '', kind, label, toJSON: () => ({}) } as MediaDeviceInfo;
}

describe('friendlyAudioDeviceNames', () => {
  it('uses localized names for browser-generic routes', () => {
    const names = friendlyAudioDeviceNames(
      [
        device('default', 'Default - Pixel Bluetooth headset'),
        device('communications', 'Communications - Pixel Bluetooth headset')
      ],
      labels
    );

    expect(names.get('default')).toBe('System default — Pixel Bluetooth headset');
    expect(names.get('communications')).toBe(
      'Default communication device — Pixel Bluetooth headset'
    );
  });

  it('preserves useful hardware labels and replaces opaque names', () => {
    const names = friendlyAudioDeviceNames(
      [
        device('usb-1', 'Yeti Nano'),
        device('opaque-id', 'opaque-id'),
        device('empty-id', ''),
        device('speaker-1', 'Desk speakers', 'audiooutput')
      ],
      labels
    );

    expect(names.get('usb-1')).toBe('Yeti Nano');
    expect(names.get('opaque-id')).toBe('Microphone 2');
    expect(names.get('empty-id')).toBe('Microphone 3');
    expect(names.get('speaker-1')).toBe('Desk speakers');
  });

  it('disambiguates duplicate platform labels', () => {
    const names = friendlyAudioDeviceNames(
      [device('mic-1', 'Bluetooth headset'), device('mic-2', 'Bluetooth headset')],
      labels
    );

    expect(names.get('mic-1')).toBe('Bluetooth microphone');
    expect(names.get('mic-2')).toBe('Bluetooth microphone (2)');
  });

  it('localizes generic Android audio routes without rewriting named hardware', () => {
    const inputNames = friendlyAudioDeviceNames(
      [
        device('speakerphone', 'Speakerphone'),
        device('earpiece', 'Headset earpiece'),
        device('bluetooth', 'Bluetooth headset'),
        device('named', 'WF-1000XM5 Hands-Free')
      ],
      labels
    );
    const outputNames = friendlyAudioDeviceNames(
      [
        device('speakerphone-output', 'Speakerphone', 'audiooutput'),
        device('earpiece-output', 'Headset earpiece', 'audiooutput'),
        device('bluetooth-output', 'Bluetooth headset', 'audiooutput')
      ],
      labels
    );

    expect(inputNames.get('speakerphone')).toBe('Phone microphone');
    expect(inputNames.get('earpiece')).toBe('Headset microphone');
    expect(inputNames.get('bluetooth')).toBe('Bluetooth microphone');
    expect(inputNames.get('named')).toBe('WF-1000XM5 Hands-Free');
    expect(outputNames.get('speakerphone-output')).toBe('Phone speaker');
    expect(outputNames.get('earpiece-output')).toBe('Headset speaker');
    expect(outputNames.get('bluetooth-output')).toBe('Bluetooth audio');
  });
});
