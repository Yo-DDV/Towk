import { describe, expect, it } from 'vitest';
import { isBlockedExecutableFile } from './filePolicy';

function file(bytes: number[], name: string, type = 'application/octet-stream'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('attachment executable policy', () => {
  it.each([
    ['program.exe', 'application/octet-stream'],
    ['installer.MSI', 'application/octet-stream'],
    ['start.ps1', 'text/plain'],
    ['start.sh', 'text/plain'],
    ['launch.command', 'text/plain'],
    ['Main.class', 'application/octet-stream'],
    ['mobile.apk', 'application/zip'],
    ['module.wasm', 'application/octet-stream']
  ])('blocks executable metadata for %s', async (name, type) => {
    await expect(isBlockedExecutableFile(file([1, 2, 3], name, type))).resolves.toBe(true);
  });

  it.each([
    [[0x4d, 0x5a, 0x90, 0x00], 'renamed.txt'],
    [[0x7f, 0x45, 0x4c, 0x46], 'renamed.dat'],
    [[0xcf, 0xfa, 0xed, 0xfe], 'renamed.bin'],
    [[0x00, 0x61, 0x73, 0x6d], 'renamed.bin'],
    [[0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73, 0x68], 'renamed.txt']
  ])('blocks executable content even when %s is renamed', async (bytes, name) => {
    await expect(isBlockedExecutableFile(file(bytes, name))).resolves.toBe(true);
  });

  it.each([
    [[0x50, 0x4b, 0x03, 0x04], 'bundle.zip', 'application/zip'],
    [[0x1f, 0x8b, 0x08], 'bundle.tar.gz', 'application/gzip'],
    [[0x25, 0x50, 0x44, 0x46], 'report.pdf', 'application/pdf'],
    [[0x89, 0x50, 0x4e, 0x47], 'photo.png', 'image/png']
  ])('allows ordinary and archive file %s', async (bytes, name, type) => {
    await expect(isBlockedExecutableFile(file(bytes, name, type))).resolves.toBe(false);
  });
});
