package connectapi

import (
	"slices"
	"testing"
)

func TestServerCapabilitiesAdvertiseAvatarFraming(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		coreReady          bool
		externalGIFEnabled bool
		wantExternalGIF    bool
		wantAvatarFraming  bool
	}{
		{
			name:               "initialized server advertises enabled features",
			coreReady:          true,
			externalGIFEnabled: true,
			wantExternalGIF:    true,
			wantAvatarFraming:  true,
		},
		{
			name:               "operator can disable external GIF without hiding avatar framing",
			coreReady:          true,
			externalGIFEnabled: false,
			wantExternalGIF:    false,
			wantAvatarFraming:  true,
		},
		{
			name:               "incomplete server advertises neither core-backed feature",
			coreReady:          false,
			externalGIFEnabled: true,
			wantExternalGIF:    false,
			wantAvatarFraming:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			capabilities := serverCapabilities(tt.coreReady, tt.externalGIFEnabled)
			if !slices.Contains(capabilities, serverCapabilityMessageCreateIdempotency) {
				t.Fatal("message create idempotency capability is missing")
			}
			if got := slices.Contains(capabilities, serverCapabilityExternalGIFEmbeds); got != tt.wantExternalGIF {
				t.Fatalf("external GIF capability = %v, want %v", got, tt.wantExternalGIF)
			}
			if got := slices.Contains(capabilities, serverCapabilityAvatarFraming); got != tt.wantAvatarFraming {
				t.Fatalf("avatar framing capability = %v, want %v", got, tt.wantAvatarFraming)
			}
		})
	}
}
