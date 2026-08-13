package linkpreview

import (
	"bytes"
	"context"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"hmans.de/chatto/internal/assets"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestRenderDomainFallbackPNGIsDeterministicAndCardShaped(t *testing.T) {
	first, err := renderDomainFallbackPNG("https://www.example.com/article")
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	second, err := renderDomainFallbackPNG("https://example.com/other")
	if err != nil {
		t.Fatalf("render second: %v", err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("same domain produced different fallback visuals")
	}
	decoded, err := png.Decode(bytes.NewReader(first))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := decoded.Bounds().Size(); got.X != fallbackImageWidth || got.Y != fallbackImageHeight {
		t.Fatalf("fallback dimensions = %v", got)
	}
}

func TestFetcherStoresGeneratedImageWhenSiteHasNoUsableMetadata(t *testing.T) {
	restoreLocalhost := AllowLocalhostForTesting()
	defer restoreLocalhost()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	defer server.Close()

	config := assets.DefaultConfig()
	stored := false
	fetcher := NewFetcher(&config, func() string { return "LPfallback" }, func(_ context.Context, assetID string, data []byte, contentType string) (*corev1.AssetRecord, error) {
		stored = assetID == "LPfallback" && len(data) > 0 && contentType == "image/webp"
		return &corev1.AssetRecord{Id: assetID}, nil
	})
	result, err := fetcher.Fetch(context.Background(), server.URL+"/private")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if !stored || result.ImageAsset == nil || result.ImageAsset.GetId() != "LPfallback" {
		t.Fatalf("fallback image was not stored: stored=%v result=%#v", stored, result)
	}
}
