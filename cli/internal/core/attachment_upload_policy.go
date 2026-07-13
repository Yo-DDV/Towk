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
	"aab": {}, "apk": {}, "appimage": {}, "appx": {}, "appxbundle": {},
	"bash": {}, "bat": {}, "class": {}, "cmd": {}, "com": {}, "command": {},
	"cpl": {}, "deb": {}, "desktop": {}, "dex": {}, "dll": {}, "dmg": {},
	"docm": {}, "dotm": {}, "ear": {}, "exe": {}, "fish": {}, "gadget": {},
	"hta": {}, "ipa": {}, "jar": {}, "jnlp": {},
	"lnk": {}, "msi": {}, "msix": {}, "msixbundle": {}, "msp": {}, "ocx": {},
	"pif": {}, "pkg": {}, "potm": {}, "ppam": {}, "ppsm": {},
	"pptm": {}, "ps1": {}, "psm1": {}, "reg": {}, "rpm": {}, "run": {},
	"scf": {}, "scr": {}, "sh": {}, "sldm": {}, "swf": {}, "sys": {}, "vbe": {},
	"vbs": {}, "vsto": {}, "war": {}, "wasm": {}, "wsf": {}, "wsh": {},
	"xlam": {}, "xll": {}, "xlsm": {}, "xltm": {}, "zsh": {},
}

var blockedAttachmentExecutableMIMETypes = map[string]struct{}{
	"application/java-archive":                      {},
	"application/vnd.android.package-archive":       {},
	"application/vnd.microsoft.portable-executable": {},
	"application/vnd.microsoft.windows-executable":  {},
	"application/wasm":                              {},
	"application/x-bat":                             {},
	"application/x-dosexec":                         {},
	"application/x-elf":                             {},
	"application/x-executable":                      {},
	"application/x-java-archive":                    {},
	"application/x-mach-binary":                     {},
	"application/x-ms-application":                  {},
	"application/x-ms-shortcut":                     {},
	"application/x-msdownload":                      {},
	"application/x-msdos-program":                   {},
	"application/x-msi":                             {},
	"application/x-powershell":                      {},
	"application/x-sh":                              {},
	"application/x-sharedlib":                       {},
	"application/x-shellscript":                     {},
	"application/x-shockwave-flash":                 {},
	"text/x-powershell":                             {},
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
	if filename == "." || filename == ".." || strings.ContainsAny(filename, `/\`) || containsAttachmentControlCharacter(filename) {
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

	if _, blocked := blockedAttachmentExecutableExtensions[attachmentFilenameExtension(filename)]; blocked {
		return "", "", invalidArgument("executable attachments are not allowed")
	}
	if _, blocked := blockedAttachmentExecutableMIMETypes[contentType]; blocked {
		return "", "", invalidArgument("executable attachments are not allowed")
	}
	return filename, contentType, nil
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
