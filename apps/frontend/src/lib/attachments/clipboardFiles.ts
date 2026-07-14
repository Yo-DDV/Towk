export type ClipboardFileRead = {
  files: File[];
  hasLocalFileReference: boolean;
};

const nativeFileTypes = new Set(['files', 'application/x-moz-file']);
const localURIListTypes = new Set(['text/uri-list', 'x-special/gnome-copied-files']);

function localFileURIIn(value: string): boolean {
  return value.split(/\r?\n/u).some((line) => {
    const candidate = line.trim();
    return candidate !== '' && !candidate.startsWith('#') && /^file:/iu.test(candidate);
  });
}

/**
 * Read browser-exposed files synchronously during a paste event.
 *
 * Native file managers use OS clipboard formats that browsers translate into
 * DataTransfer files. Some browser/desktop combinations expose only a local
 * URI reference; callers must consume that paste rather than insert a local
 * path into message text.
 */
export function readClipboardFiles(data: DataTransfer | null): ClipboardFileRead {
  if (!data) return { files: [], hasLocalFileReference: false };

  let files: File[] = [];
  try {
    files = Array.from(data.files);
  } catch {
    // Continue with DataTransferItem fallback for browser-specific payloads.
  }

  let hasFileItem = false;
  if (files.length === 0) {
    try {
      files = Array.from(data.items)
        .filter((item) => {
          if (item.kind !== 'file') return false;
          hasFileItem = true;
          return true;
        })
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
    } catch {
      // A protected clipboard may expose types without readable items.
    }
  }

  let types: string[] = [];
  try {
    types = Array.from(data.types, (type) => type.toLocaleLowerCase('en-US'));
  } catch {
    // The file/item checks above are still authoritative when types are absent.
  }

  let hasLocalFileReference = files.length > 0 || hasFileItem;
  for (const type of types) {
    if (nativeFileTypes.has(type)) {
      hasLocalFileReference = true;
      continue;
    }
    if (!localURIListTypes.has(type)) continue;
    try {
      if (localFileURIIn(data.getData(type))) hasLocalFileReference = true;
    } catch {
      // If a protected payload advertises Files, the branch above already
      // preserves the safe fallback. An unreadable generic URI is not enough.
    }
  }

  return { files, hasLocalFileReference };
}
