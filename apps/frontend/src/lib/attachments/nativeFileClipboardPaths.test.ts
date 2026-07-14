import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyExactNativeClipboardPaths } from '../../../e2e/helpers/nativeClipboardPaths';

describe('native file clipboard path verification', () => {
  it('accepts canonical and symlinked paths to the same file', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'towk-native-clipboard-paths-'));
    try {
      const sourceDirectory = path.join(directory, 'source');
      const aliasDirectory = path.join(directory, 'alias');
      mkdirSync(sourceDirectory);
      symlinkSync(
        sourceDirectory,
        aliasDirectory,
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      const canonicalPath = path.join(sourceDirectory, 'Rapport été 2026.pdf');
      const aliasedPath = path.join(aliasDirectory, 'Rapport été 2026.pdf');
      writeFileSync(canonicalPath, '%PDF-1.7\n');

      expect(
        verifyExactNativeClipboardPaths([aliasedPath], [canonicalPath], 'test clipboard')
      ).toEqual([canonicalPath]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
