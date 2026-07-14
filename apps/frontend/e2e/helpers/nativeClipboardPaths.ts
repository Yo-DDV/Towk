import { realpathSync } from 'node:fs';
import path from 'node:path';

export function verifyExactNativeClipboardPaths(
  expected: string[],
  actual: string[],
  provider: string
): string[] {
  const normalized = (filePath: string) => {
    const value = path.normalize(realpathSync.native(path.resolve(filePath)));
    return process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
  };
  if (
    actual.length !== expected.length ||
    actual.some((filePath, index) => normalized(filePath) !== normalized(expected[index]))
  ) {
    throw new Error(`${provider} native clipboard read-back did not match the requested files`);
  }
  return actual;
}
