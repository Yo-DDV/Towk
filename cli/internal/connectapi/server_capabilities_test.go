package connectapi

import (
	"slices"
	"testing"
)

func TestServerCapabilities(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		coreReady          bool
		externalGIFEnabled bool
		wantExternalGIF    bool
	}{
		{name: "initialized server advertises enabled feature", coreReady: true, externalGIFEnabled: true, wantExternalGIF: true},
		{name: "operator can disable feature", coreReady: true, externalGIFEnabled: false, wantExternalGIF: false},
		{name: "incomplete server does not advertise feature", coreReady: false, externalGIFEnabled: true, wantExternalGIF: false},
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
		})
	}
}
