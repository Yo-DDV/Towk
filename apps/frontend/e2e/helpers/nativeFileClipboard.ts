import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyExactNativeClipboardPaths } from './nativeClipboardPaths';

const helpersDirectory = fileURLToPath(new URL('./native-clipboard/', import.meta.url));

export type NativeClipboardLease = {
  paths: string[];
  release: () => Promise<void>;
};

const noRelease = async () => undefined;
const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function checkedPaths(filePaths: string[]): string[] {
  if (filePaths.length === 0) throw new Error('At least one native clipboard file is required');
  return filePaths.map((filePath) => path.resolve(filePath));
}

function parseVerifiedPaths(output: string, provider: string): string[] {
  try {
    const value: unknown = JSON.parse(output.trim());
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new Error('expected a JSON string array');
    }
    return value;
  } catch (error) {
    throw new Error(`${provider} did not verify the native file clipboard: ${String(error)}`);
  }
}

function setWindowsFileDropList(filePaths: string[]): string[] {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(helpersDirectory, 'set-file-drop-list.ps1'),
      ...filePaths
    ],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true }
  );
  return parseVerifiedPaths(output, 'Windows CF_HDROP');
}

function setMacOSFileURLs(filePaths: string[]): string[] {
  const output = execFileSync(
    'xcrun',
    ['swift', path.join(helpersDirectory, 'set-file-urls.swift'), ...filePaths],
    { encoding: 'utf8', timeout: 30_000 }
  );
  return parseVerifiedPaths(output, 'macOS NSPasteboard');
}

async function stopClipboardOwner(owner: ReturnType<typeof spawn>): Promise<void> {
  if (owner.exitCode !== null) return;
  const exited = once(owner, 'exit');
  owner.kill('SIGTERM');
  await Promise.race([exited, delay(1_000)]);
  if (owner.exitCode === null) owner.kill('SIGKILL');
}

async function setLinuxURIList(filePaths: string[]): Promise<NativeClipboardLease> {
  const uriList = `${filePaths.map((filePath) => pathToFileURL(filePath).href).join('\r\n')}\r\n`;
  const owner = spawn('xclip', ['-selection', 'clipboard', '-t', 'text/uri-list', '-quiet', '-i'], {
    stdio: ['pipe', 'ignore', 'pipe']
  });
  let spawnError: Error | null = null;
  let stderr = '';
  owner.on('error', (error) => {
    spawnError = error;
  });
  owner.stderr?.setEncoding('utf8');
  owner.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  owner.stdin?.on('error', (error) => {
    spawnError = error;
  });
  owner.stdin?.end(uriList);

  let lastReadError: unknown;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (spawnError) break;
    if (owner.exitCode !== null) break;
    try {
      const readBack = execFileSync(
        'xclip',
        ['-selection', 'clipboard', '-t', 'text/uri-list', '-o'],
        { encoding: 'utf8', timeout: 1_000, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      const verified = readBack
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => /^file:/iu.test(line))
        .map((uri) => fileURLToPath(uri));
      return {
        paths: verifyExactNativeClipboardPaths(filePaths, verified, 'Linux text/uri-list'),
        release: () => stopClipboardOwner(owner)
      };
    } catch (error) {
      lastReadError = error;
      await delay(50);
    }
  }

  await stopClipboardOwner(owner);
  const failureReason = spawnError?.message || stderr.trim() || String(lastReadError);
  throw new Error(`Linux text/uri-list clipboard owner failed: ${failureReason}`);
}

/** Writes native file references and reads them back before browser paste. */
export async function setNativeFileClipboard(filePaths: string[]): Promise<NativeClipboardLease> {
  const files = checkedPaths(filePaths);
  let verified: string[];
  let provider: string;
  switch (process.platform) {
    case 'win32':
      provider = 'Windows CF_HDROP';
      verified = setWindowsFileDropList(files);
      break;
    case 'darwin':
      provider = 'macOS NSPasteboard';
      verified = setMacOSFileURLs(files);
      break;
    case 'linux':
      return setLinuxURIList(files);
    default:
      throw new Error(`Native file clipboard tests do not support ${process.platform}`);
  }
  return {
    paths: verifyExactNativeClipboardPaths(files, verified, provider),
    release: noRelease
  };
}
