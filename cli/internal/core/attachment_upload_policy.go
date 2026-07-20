package core

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"strings"
	"unicode/utf8"
)

const (
	maxAttachmentFilenameBytes    = 255
	maxAttachmentContentTypeBytes = 255
)

var blockedAttachmentExecutableExtensions = map[string]struct{}{
	"aab": {}, "action": {}, "ade": {}, "adp": {}, "apk": {}, "app": {},
	"application": {}, "appimage": {}, "applescript": {}, "appx": {}, "appxbundle": {},
	"asp": {}, "aspx": {}, "bash": {}, "bat": {}, "bundle": {}, "cgi": {},
	"chm": {}, "cjs": {}, "class": {}, "cmd": {}, "com": {}, "command": {},
	"cpl": {}, "csh": {}, "deb": {}, "desktop": {}, "dex": {}, "dll": {}, "dmg": {},
	"docm": {}, "dotm": {}, "dylib": {}, "ear": {}, "exe": {}, "fish": {}, "fxp": {},
	"gadget": {}, "hta": {}, "inf": {}, "ins": {}, "ipa": {}, "isp": {}, "its": {},
	"jar": {}, "jnlp": {}, "js": {}, "jse": {}, "jsp": {}, "kext": {}, "ko": {},
	"ksh": {}, "lnk": {}, "lua": {}, "mda": {}, "mde": {}, "mjs": {}, "msc": {},
	"msh": {}, "msh1": {}, "msh1xml": {}, "msh2": {}, "msh2xml": {}, "mshxml": {},
	"msi": {}, "msix": {}, "msixbundle": {}, "msp": {}, "mst": {}, "ocx": {},
	"osax": {}, "phar": {}, "php": {}, "pif": {}, "pkg": {}, "pl": {}, "plugin": {},
	"potm": {}, "ppam": {}, "ppsm": {}, "pptm": {}, "prf": {}, "prg": {},
	"ps1": {}, "ps1xml": {}, "ps2": {}, "ps2xml": {}, "psc1": {}, "psc2": {},
	"psd1": {}, "psm1": {}, "pssc": {}, "py": {}, "pyc": {}, "pyo": {}, "pyw": {},
	"rb": {}, "reg": {}, "rpm": {}, "run": {}, "scf": {}, "scpt": {}, "scptd": {},
	"scr": {}, "sct": {}, "sh": {}, "shb": {}, "shs": {}, "sldm": {}, "so": {},
	"swf": {}, "sys": {}, "tcl": {}, "tcsh": {}, "url": {}, "vb": {}, "vbe": {},
	"vbp": {}, "vbs": {}, "vsmacros": {}, "vsto": {}, "war": {}, "wasm": {},
	"workflow": {}, "ws": {}, "wsc": {}, "wsf": {}, "wsh": {}, "xlam": {},
	"xbap": {}, "xll": {}, "xlsm": {}, "xltm": {}, "xpc": {}, "zsh": {},
}

var blockedAttachmentExecutableMIMETypes = map[string]struct{}{
	"application/ecmascript":                        {},
	"application/javascript":                        {},
	"application/java-archive":                      {},
	"application/vnd.android.package-archive":       {},
	"application/vnd.microsoft.portable-executable": {},
	"application/vnd.microsoft.windows-executable":  {},
	"application/wasm":                              {},
	"application/vnd.apple.installer+xml":           {},
	"application/vnd.debian.binary-package":         {},
	"application/x-apple-diskimage":                 {},
	"application/x-bat":                             {},
	"application/x-bytecode.python":                 {},
	"application/x-csh":                             {},
	"application/x-deb":                             {},
	"application/x-desktop":                         {},
	"application/x-dosexec":                         {},
	"application/x-elf":                             {},
	"application/x-executable":                      {},
	"application/x-httpd-php":                       {},
	"application/x-java-archive":                    {},
	"application/x-java-jnlp-file":                  {},
	"application/x-lua":                             {},
	"application/x-mach-binary":                     {},
	"application/x-ms-application":                  {},
	"application/x-ms-shortcut":                     {},
	"application/x-msdownload":                      {},
	"application/x-msdos-program":                   {},
	"application/x-msi":                             {},
	"application/x-perl":                            {},
	"application/x-pie-executable":                  {},
	"application/x-powershell":                      {},
	"application/x-python":                          {},
	"application/x-python-code":                     {},
	"application/x-redhat-package-manager":          {},
	"application/x-rpm":                             {},
	"application/x-ruby":                            {},
	"application/x-sh":                              {},
	"application/x-sharedlib":                       {},
	"application/x-shellscript":                     {},
	"application/x-shockwave-flash":                 {},
	"text/ecmascript":                               {},
	"text/javascript":                               {},
	"text/x-applescript":                            {},
	"text/x-lua":                                    {},
	"text/x-perl":                                   {},
	"text/x-powershell":                             {},
	"text/x-python":                                 {},
	"text/x-ruby":                                   {},
	"text/x-shellscript":                            {},
}

var blockedAttachmentExecutableSignatures = [][]byte{
	{0x4d, 0x5a},
	{0x7f, 0x45, 0x4c, 0x46},
	{0xfe, 0xed, 0xfa, 0xce},
	{0xce, 0xfa, 0xed, 0xfe},
	{0xfe, 0xed, 0xfa, 0xcf},
	{0xcf, 0xfa, 0xed, 0xfe},
	{0xca, 0xfe, 0xba, 0xbe},
	{0xbe, 0xba, 0xfe, 0xca},
	{0xca, 0xfe, 0xba, 0xbf},
	{0xbf, 0xba, 0xfe, 0xca},
	{0x00, 0x61, 0x73, 0x6d},
	{0x64, 0x65, 0x78, 0x0a},
	{0x23, 0x21},
}

func normalizeAttachmentUploadMetadata(filename, contentType string) (string, string, error) {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return "", "", invalidArgument("filename is required")
	}
	if !utf8.ValidString(filename) || len(filename) > maxAttachmentFilenameBytes {
		return "", "", invalidArgument(fmt.Sprintf("filename exceeds maximum length of %d bytes", maxAttachmentFilenameBytes))
	}
	if filename == "." || filename == ".." || strings.ContainsAny(filename, `/\`) || containsAttachmentControlCharacter(filename) || containsAttachmentFilenameSpoofingCharacter(filename) {
		return "", "", invalidArgument("filename contains unsupported characters")
	}

	contentType = strings.TrimSpace(contentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if !utf8.ValidString(contentType) || len(contentType) > maxAttachmentContentTypeBytes || containsAttachmentControlCharacter(contentType) {
		return "", "", invalidArgument(fmt.Sprintf("content type exceeds maximum length of %d bytes", maxAttachmentContentTypeBytes))
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || !strings.Contains(mediaType, "/") {
		return "", "", invalidArgument("content type is invalid")
	}
	contentType = strings.ToLower(mediaType)
	if inferred, ok := inferVideoAttachmentContentType(filename, contentType); ok {
		contentType = inferred
	}

	if _, blocked := blockedAttachmentExecutableExtensions[attachmentFilenameExtension(filename)]; blocked {
		return "", "", invalidArgument("executable attachments are not allowed")
	}
	if _, blocked := blockedAttachmentExecutableMIMETypes[contentType]; blocked {
		return "", "", invalidArgument("executable attachments are not allowed")
	}
	return filename, contentType, nil
}

func inferVideoAttachmentContentType(filename, contentType string) (string, bool) {
	if contentType != "application/octet-stream" {
		return "", false
	}
	switch attachmentFilenameExtension(filename) {
	case "mov", "qt":
		return "video/quicktime", true
	case "m4v", "mp4":
		return "video/mp4", true
	case "webm":
		return "video/webm", true
	default:
		return "", false
	}
}

func attachmentFilenameExtension(filename string) string {
	normalized := strings.TrimRight(strings.ToLower(strings.TrimSpace(filename)), ". ")
	dot := strings.LastIndexByte(normalized, '.')
	if dot < 0 {
		return ""
	}
	return normalized[dot+1:]
}

func containsAttachmentControlCharacter(value string) bool {
	return strings.ContainsFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f })
}

func containsAttachmentFilenameSpoofingCharacter(value string) bool {
	return strings.ContainsFunc(value, func(r rune) bool {
		return r == '\u061c' ||
			(r >= '\u200b' && r <= '\u200f') ||
			(r >= '\u202a' && r <= '\u202e') ||
			(r >= '\u2060' && r <= '\u206f') ||
			r == '\ufeff'
	})
}

func validateAttachmentExecutableContent(reader io.ReadSeeker) error {
	header := make([]byte, 16)
	n, readErr := reader.Read(header)
	if readErr != nil && readErr != io.EOF {
		return fmt.Errorf("inspect attachment header: %w", readErr)
	}
	if _, err := reader.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("rewind attachment after header inspection: %w", err)
	}
	header = header[:n]
	for _, signature := range blockedAttachmentExecutableSignatures {
		if bytes.HasPrefix(header, signature) {
			return invalidArgument("executable attachments are not allowed")
		}
	}
	return nil
}
