export const MAX_PROFILE_BIOGRAPHY_CHARACTERS = 1024;
export const MAX_PROFILE_BIOGRAPHY_BYTES = 4 * 1024;

const encoder = new TextEncoder();

export function profileBiographyCharacterLength(value: string): number {
  return Array.from(value).length;
}

export function profileBiographyByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function isProfileBiographyWithinLimit(value: string): boolean {
  return (
    profileBiographyCharacterLength(value) <= MAX_PROFILE_BIOGRAPHY_CHARACTERS &&
    profileBiographyByteLength(value) <= MAX_PROFILE_BIOGRAPHY_BYTES
  );
}
