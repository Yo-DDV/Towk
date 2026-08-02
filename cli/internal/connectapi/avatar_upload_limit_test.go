package connectapi

import (
	"testing"

	"hmans.de/chatto/internal/assets"
)

func TestAvatarUploadRequestMaxBytesCapsAndTightensTheTransportEnvelope(t *testing.T) {
	const protobufOverhead = 64 * 1024
	for _, test := range []struct {
		name       string
		configured int64
		want       int
	}{
		{
			name:       "default larger asset limit is capped",
			configured: assets.DefaultMaxUploadSize,
			want:       int(assets.MaxAvatarUploadSize) + protobufOverhead,
		},
		{
			name:       "zero configuration falls back to avatar limit",
			configured: 0,
			want:       int(assets.MaxAvatarUploadSize) + protobufOverhead,
		},
		{
			name:       "smaller instance limit is preserved",
			configured: 5 * 1024 * 1024,
			want:       5*1024*1024 + protobufOverhead,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := avatarUploadRequestMaxBytes(test.configured); got != test.want {
				t.Fatalf("avatarUploadRequestMaxBytes(%d) = %d, want %d", test.configured, got, test.want)
			}
		})
	}
}
