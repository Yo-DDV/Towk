package core

import (
	"strings"
	"testing"
)

func TestProfileBannerAssetIDIsDeterministicAndStorageSafe(t *testing.T) {
	first := ProfileBannerAssetID("user/with spaces?and=query")
	second := ProfileBannerAssetID("user/with spaces?and=query")
	other := ProfileBannerAssetID("another-user")

	if first != second {
		t.Fatalf("asset ID is not deterministic: %q != %q", first, second)
	}
	if first == other {
		t.Fatal("distinct users must not share a banner asset ID")
	}
	if !strings.HasPrefix(first, profileBannerAssetPrefix) {
		t.Fatalf("missing versioned prefix: %q", first)
	}
	if strings.ContainsAny(first, "/ ?#") {
		t.Fatalf("asset ID contains path-unsafe characters: %q", first)
	}
}
