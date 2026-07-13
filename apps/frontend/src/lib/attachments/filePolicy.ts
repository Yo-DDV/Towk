export const MAX_MESSAGE_ATTACHMENTS = 10;

const blockedExecutableExtensions = new Set([
  'aab',
  'apk',
  'appimage',
  'appx',
  'appxbundle',
  'bat',
  'bash',
  'class',
  'cmd',
  'com',
  'command',
  'cpl',
  'deb',
  'dex',
  'desktop',
  'dll',
  'dmg',
  'docm',
  'dotm',
  'ear',
  'exe',
  'fish',
  'gadget',
  'hta',
  'ipa',
  'jar',
  'jnlp',
  'lnk',
  'msi',
  'msix',
  'msixbundle',
  'msp',
  'ocx',
  'pif',
  'pkg',
  'potm',
  'ppam',
  'ppsm',
  'pptm',
  'ps1',
  'psm1',
  'reg',
  'rpm',
  'run',
  'scf',
  'scr',
  'sh',
  'sldm',
  'swf',
  'sys',
  'vbe',
  'vbs',
  'vsto',
  'war',
  'wasm',
  'wsf',
  'wsh',
  'xlam',
  'xll',
  'xlsm',
  'xltm',
  'zsh'
]);

const blockedExecutableMimeTypes = new Set([
  'application/java-archive',
  'application/vnd.android.package-archive',
  'application/vnd.microsoft.portable-executable',
  'application/vnd.microsoft.windows-executable',
  'application/wasm',
  'application/x-bat',
  'application/x-dosexec',
  'application/x-elf',
  'application/x-executable',
  'application/x-java-archive',
  'application/x-mach-binary',
  'application/x-ms-application',
  'application/x-ms-shortcut',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-msi',
  'application/x-powershell',
  'application/x-sh',
  'application/x-sharedlib',
  'application/x-shellscript',
  'application/x-shockwave-flash',
  'text/x-powershell',
  'text/x-shellscript'
]);

const blockedExecutableSignatures: readonly (readonly number[])[] = [
  [0x4d, 0x5a],
  [0x7f, 0x45, 0x4c, 0x46],
  [0xfe, 0xed, 0xfa, 0xce],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
  [0xbe, 0xba, 0xfe, 0xca],
  [0xca, 0xfe, 0xba, 0xbf],
  [0xbf, 0xba, 0xfe, 0xca],
  [0x00, 0x61, 0x73, 0x6d],
  [0x64, 0x65, 0x78, 0x0a],
  [0x23, 0x21]
];

function fileExtension(filename: string): string {
  const normalized = filename
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[. ]+$/u, '');
  const dot = normalized.lastIndexOf('.');
  return dot >= 0 ? normalized.slice(dot + 1) : '';
}

function normalizedMimeType(contentType: string): string {
  return contentType.split(';', 1)[0].trim().toLocaleLowerCase('en-US');
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.length <= bytes.length && prefix.every((value, index) => bytes[index] === value);
}

export function hasBlockedExecutableMetadata(file: Pick<File, 'name' | 'type'>): boolean {
  return (
    blockedExecutableExtensions.has(fileExtension(file.name)) ||
    blockedExecutableMimeTypes.has(normalizedMimeType(file.type))
  );
}

export async function isBlockedExecutableFile(file: File): Promise<boolean> {
  if (hasBlockedExecutableMetadata(file)) return true;

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return blockedExecutableSignatures.some((signature) => startsWithBytes(header, signature));
}
