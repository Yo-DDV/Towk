package http_server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"hmans.de/chatto/internal/config"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func auditMetadataForRequest(t *testing.T, trustedProxies []string, req *http.Request) *corev1.AuditRequestMetadata {
	t.Helper()
	router := gin.New()
	if err := router.SetTrustedProxies(trustedProxies); err != nil {
		t.Fatalf("SetTrustedProxies: %v", err)
	}
	s := &HTTPServer{config: config.ChattoConfig{
		Webserver: config.WebserverConfig{CookieSigningSecret: "test-cookie-secret"},
	}}
	var metadata *corev1.AuditRequestMetadata
	router.Any("/*path", func(c *gin.Context) {
		metadata = s.auditRequestMetadata(c)
		c.Status(http.StatusNoContent)
	})
	router.ServeHTTP(httptest.NewRecorder(), req)
	if metadata == nil {
		t.Fatal("audit metadata was not captured")
	}
	return metadata
}

func TestAuditRequestMetadataUsesForwardedIPAndCapsUserAgent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	req := httptest.NewRequest("POST", "/auth/forgot-password", nil)
	req.Header.Set("User-Agent", strings.Repeat("a", maxAuditUserAgentBytes+40)+"é")
	req.Header.Set("X-Forwarded-For", "203.0.113.4, 10.0.0.7")
	req.Header.Set("X-Real-IP", "198.51.100.9")
	req.RemoteAddr = "192.0.2.10:1234"
	metadata := auditMetadataForRequest(t, []string{"192.0.2.10", "10.0.0.7"}, req)

	if len(metadata.GetUserAgent()) > maxAuditUserAgentBytes {
		t.Fatalf("user agent length = %d, want <= %d", len(metadata.GetUserAgent()), maxAuditUserAgentBytes)
	}
	if !utf8.ValidString(metadata.GetUserAgent()) {
		t.Fatalf("user agent was truncated to invalid UTF-8")
	}
	wantHash := hmacSHA256Hex("test-cookie-secret", "203.0.113.4")
	if metadata.GetIpHash() != wantHash {
		t.Fatalf("ip hash = %q, want %q", metadata.GetIpHash(), wantHash)
	}
	if metadata.GetIpHash() == "203.0.113.4" || strings.Contains(metadata.GetIpHash(), "203.0.113.4") {
		t.Fatalf("raw IP leaked into metadata: %q", metadata.GetIpHash())
	}
}

func TestAuditRequestMetadataIgnoresForwardedIPFromUntrustedPeer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	req := httptest.NewRequest("POST", "/auth/login", nil)
	req.Header.Set("X-Forwarded-For", "203.0.113.4")
	req.Header.Set("X-Real-IP", "198.51.100.9")
	req.RemoteAddr = "192.0.2.10:1234"

	metadata := auditMetadataForRequest(t, nil, req)
	wantHash := hmacSHA256Hex("test-cookie-secret", "192.0.2.10")
	if metadata.GetIpHash() != wantHash {
		t.Fatalf("ip hash = %q, want untrusted peer hash %q", metadata.GetIpHash(), wantHash)
	}
}

func TestAuditRequestMetadataRemovesInvalidShortUserAgent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	req := httptest.NewRequest("POST", "/auth/login", nil)
	req.Header.Set("User-Agent", string([]byte{'o', 'k', 0xff}))
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req

	s := &HTTPServer{}
	metadata := s.auditRequestMetadata(c)

	if !utf8.ValidString(metadata.GetUserAgent()) {
		t.Fatalf("user agent contains invalid UTF-8: %q", metadata.GetUserAgent())
	}
	if metadata.GetUserAgent() != "ok" {
		t.Fatalf("user agent = %q, want %q", metadata.GetUserAgent(), "ok")
	}
}

func TestAuditSourceIPFallbacks(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("real ip", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("X-Real-IP", "198.51.100.9")
		req.RemoteAddr = "192.0.2.10:1234"
		var got string
		router := gin.New()
		if err := router.SetTrustedProxies([]string{"192.0.2.10"}); err != nil {
			t.Fatalf("SetTrustedProxies: %v", err)
		}
		router.GET("/", func(c *gin.Context) { got = auditSourceIP(c) })
		router.ServeHTTP(httptest.NewRecorder(), req)
		if got != "198.51.100.9" {
			t.Fatalf("auditSourceIP = %q", got)
		}
	})

	t.Run("remote addr", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = "192.0.2.10:1234"
		var got string
		router := gin.New()
		if err := router.SetTrustedProxies(nil); err != nil {
			t.Fatalf("SetTrustedProxies: %v", err)
		}
		router.GET("/", func(c *gin.Context) { got = auditSourceIP(c) })
		router.ServeHTTP(httptest.NewRecorder(), req)
		if got != "192.0.2.10" {
			t.Fatalf("auditSourceIP = %q", got)
		}
	})
}
