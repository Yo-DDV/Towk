import { describe, expect, it } from 'vitest';
import {
  audioDeviceRouteKind,
  friendlyAudioDeviceNames,
  preferredAudioDeviceId
} from './audioDevices';

const labels = {
  microphone: 'Microphone',
  speaker: 'Speaker',
  phoneMicrophone: 'Speakerphone microphone',
  headsetMicrophone: 'Earpiece microphone',
  bluetoothMicrophone: 'Bluetooth microphone',
  phoneSpeaker: 'Speakerphone',
  headsetSpeaker: 'Phone earpiece',
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
        device('named', 'WF-1000XM5 Hands-Free'),
        device('named-bluetooth', 'Jabra Bluetooth Hands-Free')
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

    expect(inputNames.get('speakerphone')).toBe('Speakerphone microphone');
    expect(inputNames.get('earpiece')).toBe('Earpiece microphone');
    expect(inputNames.get('bluetooth')).toBe('Bluetooth microphone');
    expect(inputNames.get('named')).toBe('WF-1000XM5 Hands-Free');
    expect(inputNames.get('named-bluetooth')).toBe('Jabra Bluetooth Hands-Free');
    expect(outputNames.get('speakerphone-output')).toBe('Speakerphone');
    expect(outputNames.get('earpiece-output')).toBe('Phone earpiece');
    expect(outputNames.get('bluetooth-output')).toBe('Bluetooth audio');
  });

  it('classifies mobile routes and Bluetooth hardware without rewriting named labels', () => {
    expect(audioDeviceRouteKind(device('speakerphone', 'Speakerphone'))).toBe('speakerphone');
    expect(audioDeviceRouteKind(device('earpiece', 'Headset earpiece'))).toBe('earpiece');
    expect(audioDeviceRouteKind(device('bluetooth', 'Bluetooth headset'))).toBe('bluetooth');
    expect(audioDeviceRouteKind(device('sony', 'WF-1000XM5 Hands-Free'))).toBe('unknown');
    expect(audioDeviceRouteKind(device('jabra', 'Jabra Bluetooth Hands-Free'))).toBe('bluetooth');
  });

  it('prefers Bluetooth automatically unless the user explicitly selected another route', () => {
    const devices = [
      device('speakerphone', 'Speakerphone'),
      device('earpiece', 'Headset earpiece'),
      device('bluetooth', 'Bluetooth headset')
    ];

    expect(
      preferredAudioDeviceId(devices, {
        activeDeviceId: 'speakerphone',
        selectedDeviceId: 'speakerphone'
      })
    ).toBe('bluetooth');
    expect(
      preferredAudioDeviceId(devices, {
        activeDeviceId: 'bluetooth',
        explicitDeviceId: 'speakerphone',
        selectedDeviceId: 'bluetooth'
      })
    ).toBe('speakerphone');
    expect(
      preferredAudioDeviceId(devices.slice(0, 2), {
        activeDeviceId: 'earpiece',
        selectedDeviceId: 'speakerphone'
      })
    ).toBe('earpiece');
  });
});
