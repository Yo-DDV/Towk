export const MAX_PROFILE_BIOGRAPHY_BYTES = 16 * 1024;

const encoder = new TextEncoder();

export function profileBiographyByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function isProfileBiographyWithinLimit(value: string): boolean {
  return profileBiographyByteLength(value) <= MAX_PROFILE_BIOGRAPHY_BYTES;
}
