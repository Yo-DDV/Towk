package connectapi

import "hmans.de/chatto/internal/assets"

// avatarUploadRequestMaxBytes keeps the MyAccount transport envelope aligned
// with the avatar processor. Instance-wide asset configuration may tighten this
// limit, but it must not make profile-avatar requests larger than the product
// contract permits.
func avatarUploadRequestMaxBytes(configuredMaxUploadSize int64) int {
	maxUploadSize := configuredMaxUploadSize
	if maxUploadSize <= 0 || maxUploadSize > assets.MaxAvatarUploadSize {
		maxUploadSize = assets.MaxAvatarUploadSize
	}
	return uploadRequestMaxBytes(maxUploadSize)
}
