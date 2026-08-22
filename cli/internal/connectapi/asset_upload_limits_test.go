package connectapi

import (
	"testing"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/core"
)

func TestAssetUploadRequestLimitCoversAdvertisedChunk(t *testing.T) {
	const envelopeOverhead = 64 * 1024
	// JSON clients base64-encode the chunk bytes (~4/3 expansion); the read
	// limit must cover the base64-expanded advertised chunk in either encoding.
	base64ChunkBytes := (core.AssetUploadMaxChunkSize + 2) / 3 * 4
	want := base64ChunkBytes + envelopeOverhead
	if got := assetUploadRequestMaxBytes(); got != want {
		t.Fatalf("asset upload request limit = %d, want %d", got, want)
	}
	// The base64 encoding of a full chunk must fit within the limit.
	if base64ChunkBytes > assetUploadRequestMaxBytes() {
		t.Fatalf("base64 chunk %d exceeds request limit %d", base64ChunkBytes, assetUploadRequestMaxBytes())
	}
}

func TestAssetStorageCapacityMapsToResourceExhaustedWithoutDetails(t *testing.T) {
	err := connectError(core.ErrAssetStorageCapacity)
	if got := connect.CodeOf(err); got != connect.CodeResourceExhausted {
		t.Fatalf("capacity error code = %v, want resource_exhausted", got)
	}
	if got := err.Error(); got != "resource_exhausted: asset storage capacity reached" {
		t.Fatalf("public capacity error = %q", got)
	}
}
