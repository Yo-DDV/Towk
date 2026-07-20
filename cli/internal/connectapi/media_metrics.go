package connectapi

import "time"

type AssetUploadOperation string

const (
	AssetUploadCreate   AssetUploadOperation = "create"
	AssetUploadChunk    AssetUploadOperation = "chunk"
	AssetUploadComplete AssetUploadOperation = "complete"
	AssetUploadCancel   AssetUploadOperation = "cancel"
)

type AssetUploadOutcome string

const (
	AssetUploadSuccess AssetUploadOutcome = "success"
	AssetUploadError   AssetUploadOutcome = "error"
)

// AssetUploadObserver receives process-local aggregate timings only. Values
// intentionally exclude upload, user, room, and asset identifiers.
type AssetUploadObserver interface {
	ObserveAssetUpload(operation AssetUploadOperation, outcome AssetUploadOutcome, sizeBytes int64, duration time.Duration)
}

type Option func(*API)

func WithAssetUploadObserver(observer AssetUploadObserver) Option {
	return func(api *API) {
		api.assetUploadObserver = observer
	}
}
