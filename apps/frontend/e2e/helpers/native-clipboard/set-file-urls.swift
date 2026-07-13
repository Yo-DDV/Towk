import AppKit
import Foundation

let paths = Array(CommandLine.arguments.dropFirst())
guard !paths.isEmpty else {
    fputs("At least one file path is required.\n", stderr)
    exit(2)
}

for path in paths where !FileManager.default.fileExists(atPath: path) {
    fputs("Clipboard source file does not exist: \(path)\n", stderr)
    exit(3)
}

let urls = paths.map { URL(fileURLWithPath: $0).standardizedFileURL as NSURL }
let pasteboard = NSPasteboard.general
pasteboard.clearContents()
guard pasteboard.writeObjects(urls) else {
    fputs("NSPasteboard rejected the file URLs.\n", stderr)
    exit(4)
}

let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
guard let readBack = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [NSURL],
      readBack.count == urls.count else {
    fputs("NSPasteboard file URL read-back did not match the write.\n", stderr)
    exit(5)
}

let data = try JSONSerialization.data(withJSONObject: readBack.compactMap(\.path))
FileHandle.standardOutput.write(data)
