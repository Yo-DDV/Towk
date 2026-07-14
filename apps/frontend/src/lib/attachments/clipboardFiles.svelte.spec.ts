import { describe, expect, it } from 'vitest';
import { readClipboardFiles } from './clipboardFiles';

function clipboardWith(type: string, value: string): DataTransfer {
  const transfer = new DataTransfer();
  transfer.setData(type, value);
  return transfer;
}

describe('readClipboardFiles', () => {
  it('returns every File exposed by the clipboard', () => {
    const transfer = new DataTransfer();
    const first = new File(['first'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['second'], 'second.zip', { type: 'application/zip' });
    transfer.items.add(first);
    transfer.items.add(second);

    expect(readClipboardFiles(transfer)).toEqual({
      files: [first, second],
      hasLocalFileReference: true
    });
  });

  it('falls back to file-kind items when FileList is empty', () => {
    const file = new File(['report'], 'report.pdf', { type: 'application/pdf' });
    const transfer = {
      files: [] as unknown as FileList,
      items: [
        {
          kind: 'file',
          getAsFile: () => file
        }
      ],
      types: ['Files'],
      getData: () => ''
    } as unknown as DataTransfer;

    expect(readClipboardFiles(transfer)).toEqual({
      files: [file],
      hasLocalFileReference: true
    });
  });

  it.each([
    ['text/uri-list', '# copied file\r\nfile:///home/user/report.pdf\r\n'],
    ['x-special/gnome-copied-files', 'copy\nfile:///home/user/report.pdf\n']
  ])('detects an inaccessible native file reference in %s', (type, value) => {
    expect(readClipboardFiles(clipboardWith(type, value))).toEqual({
      files: [],
      hasLocalFileReference: true
    });
  });

  it('does not treat an HTTP URI list as a local file reference', () => {
    expect(
      readClipboardFiles(clipboardWith('text/uri-list', 'https://example.com/report.pdf'))
    ).toEqual({ files: [], hasLocalFileReference: false });
  });

  it('does not reinterpret a plain-text file URL as a file clipboard', () => {
    expect(readClipboardFiles(clipboardWith('text/plain', 'file:///home/user/report.pdf'))).toEqual(
      {
        files: [],
        hasLocalFileReference: false
      }
    );
  });
});
