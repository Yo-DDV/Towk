package connectapi

import (
	"testing"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/core"
)

func TestAssetUploadRequestLimitCoversAdvertisedChunk(t *testing.T) {
	const protobufOverhead = 64 * 1024
	want := core.AssetUploadMaxChunkSize + protobufOverhead
	if got := assetUploadRequestMaxBytes(); got != want {
		t.Fatalf("asset upload request limit = %d, want %d", got, want)
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
