package http_server

import (
	"strings"
	"testing"
)

func TestExternalGIFFrameCSP(t *testing.T) {
	t.Parallel()

	want := "frame-src https://www.youtube-nocookie.com https://giphy.com"
	if !strings.Contains(contentSecurityPolicy, want) {
		t.Fatalf("contentSecurityPolicy does not contain %q", want)
	}
}
