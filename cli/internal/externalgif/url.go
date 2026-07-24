package externalgif

import (
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

var (
	giphyPageHosts = map[string]bool{
		"giphy.com":     true,
		"www.giphy.com": true,
	}
	giphyMediaHosts = map[string]bool{
		"i.giphy.com":      true,
		"media.giphy.com":  true,
		"media0.giphy.com": true,
		"media1.giphy.com": true,
		"media2.giphy.com": true,
		"media3.giphy.com": true,
		"media4.giphy.com": true,
	}
	tenorMediaHosts = map[string]bool{
		"media.tenor.com":  true,
		"media1.tenor.com": true,
		"c.tenor.com":      true,
	}
	safeID            = regexp.MustCompile(`^[A-Za-z0-9_-]{6,128}$`)
	safeTenorVariant  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)
	safePathSegment   = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)
	safeMediaBasename = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,178}[A-Za-z0-9])?$`)
	safeGiphySlug     = regexp.MustCompile(`^[A-Za-z0-9_-]{6,256}$`)
	giphyPageID       = regexp.MustCompile(`^[A-Za-z0-9]{6,128}$`)
	mediaFile         = regexp.MustCompile(`(?i)\.(gif|webp|mp4|webm)$`)
)

const EnabledEnvironmentVariable = "CHATTO_WEBSERVER_EXTERNAL_GIF_EMBEDS"

// Enabled reports whether the operator allows external GIF embeds. The feature
// is enabled by default. Invalid explicit values fail closed instead of silently
// advertising a browser-to-provider privacy boundary the operator did not intend.
func Enabled() bool {
	raw, ok := os.LookupEnv(EnabledEnvironmentVariable)
	if !ok || strings.TrimSpace(raw) == "" {
		return true
	}
	enabled, err := strconv.ParseBool(strings.TrimSpace(raw))
	return err == nil && enabled
}

// IsTrustedURL reports whether rawURL matches one of the provider URL shapes
// that Towk renders directly in the reader's browser. It performs no network
// request and intentionally rejects generic GIF URLs.
func IsTrustedURL(rawURL string) bool {
	if rawURL == "" || !strings.HasPrefix(rawURL, "https://") || rawURL != strings.TrimSpace(rawURL) || strings.Contains(rawURL, `\`) || hasUnsafeURLByte(rawURL) {
		return false
	}

	authority := strings.SplitN(strings.TrimPrefix(rawURL, "https://"), "/", 2)[0]
	authority = strings.SplitN(authority, "?", 2)[0]
	authority = strings.SplitN(authority, "#", 2)[0]
	if authority == "" || strings.ContainsAny(authority, "@:") {
		return false
	}

	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	// Provider path contracts are ASCII and exact. Reject every escaped path
	// variant instead of trying to reason about equivalent decoded spellings.
	if strings.Contains(u.EscapedPath(), "%") {
		return false
	}

	host := strings.ToLower(u.Hostname())
	segments := strictPathSegments(u.Path)
	if segments == nil {
		return false
	}

	if giphyPageHosts[host] {
		return isGiphyPagePath(segments)
	}
	if giphyMediaHosts[host] {
		return isGiphyMediaPath(host, segments)
	}
	if tenorMediaHosts[host] {
		return isTenorMediaPath(segments)
	}
	return false
}

func isGiphyPagePath(segments []string) bool {
	if len(segments) != 2 {
		return false
	}

	var id string
	switch segments[0] {
	case "embed":
		id = segments[1]
	case "gifs", "stickers":
		if !safeGiphySlug.MatchString(segments[1]) {
			return false
		}
		parts := strings.Split(segments[1], "-")
		id = parts[len(parts)-1]
	default:
		return false
	}
	return giphyPageID.MatchString(id)
}

func isGiphyMediaPath(host string, segments []string) bool {
	if host == "i.giphy.com" {
		if len(segments) != 1 || mediaRenderMode(segments[0]) == "" {
			return false
		}
		id := mediaFile.ReplaceAllString(segments[0], "")
		return giphyPageID.MatchString(id)
	}

	var id, filename string
	switch {
	case len(segments) == 3 && segments[0] == "media":
		id, filename = segments[1], segments[2]
	case len(segments) == 4 && segments[0] == "media" && isSafePathSegment(segments[1]):
		id, filename = segments[2], segments[3]
	default:
		return false
	}
	return mediaRenderMode(filename) != "" && giphyPageID.MatchString(id)
}

func isTenorMediaPath(segments []string) bool {
	if len(segments) == 1 && safeID.MatchString(segments[0]) {
		return true
	}

	var id, filename string
	switch len(segments) {
	case 2:
		id, filename = segments[0], segments[1]
	case 3:
		if segments[0] != "m" {
			return false
		}
		id, filename = segments[1], segments[2]
	case 4:
		if segments[0] != "m" || !safeTenorVariant.MatchString(segments[2]) {
			return false
		}
		id, filename = segments[1], segments[3]
	default:
		return false
	}
	return mediaRenderMode(filename) != "" && safeID.MatchString(id)
}

func mediaRenderMode(filename string) string {
	match := mediaFile.FindStringSubmatch(filename)
	if len(match) != 2 {
		return ""
	}
	basename := filename[:len(filename)-len(match[0])]
	if !safeMediaBasename.MatchString(basename) || strings.Contains(basename, "..") {
		return ""
	}
	return strings.ToLower(match[1])
}

func isSafePathSegment(segment string) bool {
	return safePathSegment.MatchString(segment) && !strings.Contains(segment, "..")
}

func hasUnsafeURLByte(rawURL string) bool {
	for _, r := range rawURL {
		if r <= 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}

func strictPathSegments(path string) []string {
	if !strings.HasPrefix(path, "/") || path == "/" || strings.HasSuffix(path, "/") || strings.Contains(path, "//") {
		return nil
	}
	segments := strings.Split(strings.TrimPrefix(path, "/"), "/")
	for _, segment := range segments {
		if segment == "" {
			return nil
		}
	}
	return segments
}
