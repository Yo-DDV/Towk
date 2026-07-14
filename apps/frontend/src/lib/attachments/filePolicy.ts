export const MAX_MESSAGE_ATTACHMENTS = 10;

const blockedExecutableExtensions = new Set([
  'aab',
  'action',
  'ade',
  'adp',
  'apk',
  'app',
  'application',
  'appimage',
  'applescript',
  'appx',
  'appxbundle',
  'asp',
  'aspx',
  'bat',
  'bash',
  'bundle',
  'cgi',
  'class',
  'chm',
  'cjs',
  'cmd',
  'com',
  'command',
  'cpl',
  'csh',
  'deb',
  'dex',
  'desktop',
  'dll',
  'dmg',
  'docm',
  'dotm',
  'dylib',
  'ear',
  'exe',
  'fish',
  'fxp',
  'gadget',
  'hta',
  'inf',
  'ins',
  'ipa',
  'isp',
  'its',
  'jar',
  'jnlp',
  'js',
  'jse',
  'jsp',
  'kext',
  'ko',
  'ksh',
  'lnk',
  'lua',
  'mda',
  'mde',
  'mjs',
  'msc',
  'msh',
  'msh1',
  'msh1xml',
  'msh2',
  'msh2xml',
  'mshxml',
  'msi',
  'msix',
  'msixbundle',
  'msp',
  'mst',
  'ocx',
  'osax',
  'phar',
  'php',
  'pif',
  'pkg',
  'pl',
  'plugin',
  'potm',
  'ppam',
  'ppsm',
  'pptm',
  'prf',
  'prg',
  'ps1',
  'ps1xml',
  'ps2',
  'ps2xml',
  'psc1',
  'psc2',
  'psd1',
  'psm1',
  'pssc',
  'py',
  'pyc',
  'pyo',
  'pyw',
  'rb',
  'reg',
  'rpm',
  'run',
  'scf',
  'scpt',
  'scptd',
  'scr',
  'sct',
  'sh',
  'shb',
  'shs',
  'sldm',
  'so',
  'swf',
  'sys',
  'tcl',
  'tcsh',
  'url',
  'vb',
  'vbe',
  'vbp',
  'vbs',
  'vsmacros',
  'vsto',
  'war',
  'wasm',
  'workflow',
  'ws',
  'wsc',
  'wsf',
  'wsh',
  'xlam',
  'xbap',
  'xll',
  'xlsm',
  'xltm',
  'xpc',
  'zsh'
]);

const blockedExecutableMimeTypes = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/java-archive',
  'application/vnd.android.package-archive',
  'application/vnd.microsoft.portable-executable',
  'application/vnd.microsoft.windows-executable',
  'application/wasm',
  'application/vnd.apple.installer+xml',
  'application/vnd.debian.binary-package',
  'application/x-apple-diskimage',
  'application/x-bat',
  'application/x-bytecode.python',
  'application/x-csh',
  'application/x-deb',
  'application/x-desktop',
  'application/x-dosexec',
  'application/x-elf',
  'application/x-executable',
  'application/x-httpd-php',
  'application/x-java-archive',
  'application/x-java-jnlp-file',
  'application/x-lua',
  'application/x-mach-binary',
  'application/x-ms-application',
  'application/x-ms-shortcut',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-msi',
  'application/x-perl',
  'application/x-pie-executable',
  'application/x-powershell',
  'application/x-python',
  'application/x-python-code',
  'application/x-redhat-package-manager',
  'application/x-rpm',
  'application/x-ruby',
  'application/x-sh',
  'application/x-sharedlib',
  'application/x-shellscript',
  'application/x-shockwave-flash',
  'text/ecmascript',
  'text/javascript',
  'text/x-applescript',
  'text/x-lua',
  'text/x-perl',
  'text/x-powershell',
  'text/x-python',
  'text/x-ruby',
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

export function hasUnsafeAttachmentFilename(filename: string): boolean {
  return /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(filename);
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
