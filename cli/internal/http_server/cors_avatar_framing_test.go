package http_server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"hmans.de/chatto/internal/config"
)

func TestCORSMiddlewareAllowsAvatarFramingMetadata(t *testing.T) {
	s := setupCORSServer(t, config.WebserverConfig{URL: "https://chat.example.com"})
	req := httptest.NewRequest(http.MethodOptions, "/api/connect/test", nil)
	req.Header.Set("Origin", "https://chat.example.com")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "authorization, x-towk-avatar-framing")
	response := httptest.NewRecorder()

	s.router.ServeHTTP(response, req)

	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", response.Code)
	}
	if allowed := response.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(allowed, "X-Towk-Avatar-Framing") {
		t.Fatalf("Access-Control-Allow-Headers = %q, missing avatar framing metadata", allowed)
	}
}
