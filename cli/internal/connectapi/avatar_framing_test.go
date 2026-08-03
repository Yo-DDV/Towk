package connectapi

import (
	"net/http"
	"strings"
	"testing"

	"hmans.de/chatto/internal/assets"
)

func TestParseAvatarFramingHeader(t *testing.T) {
	t.Run("crop", func(t *testing.T) {
		framing, err := parseAvatarFramingHeader("v1:crop:1200:800:200:0:800")
		if err != nil {
			t.Fatalf("parseAvatarFramingHeader: %v", err)
		}
		want := &assets.AvatarFraming{
			Mode: assets.AvatarFramingModeCrop, SourceWidth: 1200, SourceHeight: 800, X: 200, Size: 800,
		}
		if *framing != *want {
			t.Fatalf("framing = %+v, want %+v", framing, want)
		}
	})

	t.Run("contain", func(t *testing.T) {
		framing, err := parseAvatarFramingHeader("v1:contain:1200:800")
		if err != nil {
			t.Fatalf("parseAvatarFramingHeader: %v", err)
		}
		want := &assets.AvatarFraming{
			Mode: assets.AvatarFramingModeContain, SourceWidth: 1200, SourceHeight: 800,
		}
		if *framing != *want {
			t.Fatalf("framing = %+v, want %+v", framing, want)
		}
	})
}

func TestParseAvatarFramingHeaderRejectsMalformedOrUnsafeValues(t *testing.T) {
	invalid := []string{
		"",
		"v2:crop:1200:800:200:0:800",
		"v1:stretch:1200:800",
		"v1:contain:1200",
		"v1:contain:4097:1",
		"v1:crop:1200:800:200:0",
		"v1:crop:1200:800:-1:0:800",
		"v1:crop:1200:800:401:0:800",
		"v1:crop:4097:1:0:0:1",
		"v1:crop:4294967296:800:0:0:1",
		"v1:crop:1200:800:0:0:0",
		"v1:crop:12 00:800:0:0:1",
		strings.Repeat("1", maxAvatarFramingHeader+1),
	}
	for _, value := range invalid {
		t.Run(value, func(t *testing.T) {
			if _, err := parseAvatarFramingHeader(value); err == nil {
				t.Fatalf("parseAvatarFramingHeader(%q) succeeded", value)
			}
		})
	}
}

func TestAvatarFramingHeaderIsOptionalAndMustBeSingular(t *testing.T) {
	if framing, err := avatarFramingFromRequestHeader(http.Header{}); err != nil || framing != nil {
		t.Fatalf("absent framing = %+v, %v; want nil, nil", framing, err)
	}

	header := http.Header{}
	header.Add(AvatarFramingHeader, "v1:contain:10:10")
	header.Add(AvatarFramingHeader, "v1:contain:10:10")
	if _, err := avatarFramingFromRequestHeader(header); err == nil {
		t.Fatal("duplicate framing metadata was accepted")
	}
}
