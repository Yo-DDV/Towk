package http_server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/assets"
)

func TestProfileBannerRoutesExposeCapabilityWithoutLeakingLimits(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := &HTTPServer{router: gin.New()}
	server.setupProfileBannerRoutes()

	request := httptest.NewRequest(http.MethodGet, profileBannerCapabilityPath, nil)
	response := httptest.NewRecorder()
	server.router.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected unavailable without a core, got %d", response.Code)
	}
	var body profileBannerErrorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "temporarily_unavailable" {
		t.Fatalf("unexpected error code: %q", body.Code)
	}
	if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("missing nosniff header: %q", got)
	}
}

func TestProfileBannerCapabilityContractMatchesProcessorLimits(t *testing.T) {
	response := profileBannerCapabilityResponse{
		Supported:         true,
		MaxUploadBytes:    assets.MaxProfileBannerUploadSize,
		RecommendedWidth:  assets.ProfileBannerWidth,
		RecommendedHeight: assets.ProfileBannerHeight,
		MinimumWidth:      assets.MinProfileBannerSourceWidth,
		MinimumHeight:     assets.MinProfileBannerSourceHeight,
	}
	if !response.Supported ||
		response.MaxUploadBytes != 8*1024*1024 ||
		response.RecommendedWidth != 1536 ||
		response.RecommendedHeight != 512 ||
		response.MinimumWidth != 600 ||
		response.MinimumHeight != 200 {
		t.Fatalf("unexpected capability contract: %#v", response)
	}
}

func TestProfileBannerPrivateHeadersPreventSharedCaching(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)

	setProfileBannerPrivateHeaders(context)

	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("unexpected cache control: %q", got)
	}
	if got := response.Header().Get("Vary"); got != "Authorization, Cookie" {
		t.Fatalf("unexpected vary header: %q", got)
	}
	if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("unexpected content type protection: %q", got)
	}
}
