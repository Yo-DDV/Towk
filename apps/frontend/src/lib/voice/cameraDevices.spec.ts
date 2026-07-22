import { describe, expect, it } from 'vitest';
import {
  friendlyCameraDeviceNames,
  nextCameraDeviceId,
  type CameraDeviceLabels
} from './cameraDevices';

const labels: CameraDeviceLabels = {
  camera: 'Camera',
  front: 'Front camera',
  rear: 'Rear camera',
  ultraWide: 'Ultra-wide camera',
  telephoto: 'Telephoto camera'
};

function camera(deviceId: string, label: string): MediaDeviceInfo {
  return {
    deviceId,
    groupId: 'mobile-cameras',
    kind: 'videoinput',
    label,
    toJSON: () => ({})
  } as MediaDeviceInfo;
}

describe('friendlyCameraDeviceNames', () => {
  it('turns Android Camera2 labels into stable user-facing lens names', () => {
    const devices = [
      camera('front', 'camera2 1, facing front'),
      camera('wide', 'camera2 0, facing back'),
      camera('ultra', 'camera2 2, facing back, ultra wide'),
      camera('tele', 'camera2 3, facing back, telephoto')
    ];

    expect([...friendlyCameraDeviceNames(devices, labels).values()]).toEqual([
      'Front camera',
      'Rear camera',
      'Ultra-wide camera',
      'Telephoto camera'
    ]);
  });

  it('numbers duplicate mobile lenses and anonymous cameras without exposing opaque IDs', () => {
    const devices = [
      camera('rear-wide', 'Back Camera'),
      camera('rear-main', 'Rear Camera'),
      camera('opaque', 'videoinput 7b3f4a72-0c98-4f4b-83aa-96a5f013e316'),
      camera('anonymous', '')
    ];

    expect([...friendlyCameraDeviceNames(devices, labels).values()]).toEqual([
      'Rear camera 1',
      'Rear camera 2',
      'Camera 1',
      'Camera 2'
    ]);
  });

  it('preserves useful desktop hardware names', () => {
    const devices = [camera('brio', 'Logitech BRIO 4K Stream Edition')];

    expect(friendlyCameraDeviceNames(devices, labels).get('brio')).toBe(
      'Logitech BRIO 4K Stream Edition'
    );
  });
});

describe('nextCameraDeviceId', () => {
  it('cycles through available lenses and recovers from a stale selection', () => {
    const devices = [camera('front', 'Front camera'), camera('rear', 'Rear camera')];

    expect(nextCameraDeviceId(devices, 'front')).toBe('rear');
    expect(nextCameraDeviceId(devices, 'rear')).toBe('front');
    expect(nextCameraDeviceId(devices, 'missing')).toBe('front');
    expect(nextCameraDeviceId([], 'front')).toBeNull();
  });
});
