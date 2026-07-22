export type CameraDeviceLabels = {
  camera: string;
  front: string;
  rear: string;
  ultraWide: string;
  telephoto: string;
};

type CameraKind = 'front' | 'rear' | 'ultraWide' | 'telephoto' | 'generic' | 'named';

const ULTRA_WIDE_PATTERN = /(?:ultra[\s_-]*wide|ultrawide|0[.,]5\s*x)/iu;
const TELEPHOTO_PATTERN = /(?:tele(?:photo)?|\b(?:2|3|5)\s*x\b)/iu;
const FRONT_PATTERN =
  /(?:\bfront(?:al)?\b|\buser\b|facing[\s:_-]*front|cam[eé]ra\s+avant|c[aâ]mera\s+frontal|frontkamera|vorder(?:e|seite)|fotocamera\s+anteriore)/iu;
const REAR_PATTERN =
  /(?:\bback\b|\brear\b|\benvironment\b|facing[\s:_-]*(?:back|rear)|cam[eé]ra\s+arri[eè]re|c[aâ]mera\s+traseira|c[aá]mara\s+trasera|r[uü]ckkamera|hinten|fotocamera\s+posteriore)/iu;
const TECHNICAL_LABEL_PATTERN =
  /(?:^\s*$|\bcamera2\b|\bvideoinput\b|\bfacing\b|\bdevice[_\s-]*id\b|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b)/iu;
const GENERIC_CAMERA_PATTERN = /^(?:camera|webcam|cam[eé]ra|c[aâ]mera|kamera)(?:\s*\d+)?$/iu;

function classifyCamera(label: string): CameraKind {
  const normalized = label.trim();
  if (ULTRA_WIDE_PATTERN.test(normalized)) return 'ultraWide';
  if (TELEPHOTO_PATTERN.test(normalized)) return 'telephoto';
  if (FRONT_PATTERN.test(normalized)) return 'front';
  if (REAR_PATTERN.test(normalized)) return 'rear';
  if (TECHNICAL_LABEL_PATTERN.test(normalized) || GENERIC_CAMERA_PATTERN.test(normalized)) {
    return 'generic';
  }
  return 'named';
}

function labelForKind(kind: Exclude<CameraKind, 'named'>, labels: CameraDeviceLabels): string {
  switch (kind) {
    case 'front':
      return labels.front;
    case 'rear':
      return labels.rear;
    case 'ultraWide':
      return labels.ultraWide;
    case 'telephoto':
      return labels.telephoto;
    case 'generic':
      return labels.camera;
  }
}

/**
 * Converts browser/OS camera labels into stable lens names while preserving
 * useful desktop hardware names. Device IDs are never exposed as fallback UI.
 */
export function friendlyCameraDeviceNames(
  devices: readonly MediaDeviceInfo[],
  labels: CameraDeviceLabels
): Map<string, string> {
  const classified = devices.map((device) => ({
    device,
    kind: classifyCamera(device.label)
  }));
  const totals = new Map<CameraKind, number>();
  for (const { kind } of classified) {
    if (kind !== 'named') totals.set(kind, (totals.get(kind) ?? 0) + 1);
  }

  const indexes = new Map<CameraKind, number>();
  return new Map(
    classified.map(({ device, kind }) => {
      if (kind === 'named') return [device.deviceId, device.label.trim()];

      const index = (indexes.get(kind) ?? 0) + 1;
      indexes.set(kind, index);
      const base = labelForKind(kind, labels);
      const shouldNumber = kind === 'generic' || (totals.get(kind) ?? 0) > 1;
      return [device.deviceId, shouldNumber ? `${base} ${index}` : base];
    })
  );
}

/** Returns the next physical lens, wrapping around and recovering stale IDs. */
export function nextCameraDeviceId(
  devices: readonly MediaDeviceInfo[],
  selectedDeviceId: string | null
): string | null {
  if (devices.length === 0) return null;
  const selectedIndex = devices.findIndex((device) => device.deviceId === selectedDeviceId);
  if (selectedIndex < 0) return devices[0].deviceId;
  return devices[(selectedIndex + 1) % devices.length]?.deviceId ?? null;
}
