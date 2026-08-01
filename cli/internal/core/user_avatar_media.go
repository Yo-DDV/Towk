package core

import (
	"bytes"
	"context"
	"fmt"
	"io"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"

	"hmans.de/chatto/internal/assets"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// ReplaceUserAvatarFromUpload validates, canonicalizes, stores and commits a
// user avatar as one replacement operation. The previous binary is retained
// until the new avatar event has been committed, so a rejected or failed
// replacement cannot leave the profile pointing at a deleted asset.
func (c *ChattoCore) ReplaceUserAvatarFromUpload(ctx context.Context, userID string, reader io.Reader) (*corev1.AssetRecord, error) {
	if _, err := c.GetUser(ctx, userID); err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	oldAvatar, err := c.GetUserAvatar(ctx, userID)
	if err != nil {
		return nil, err
	}

	processed, err := assets.ProcessAvatarAssetWithConfig(reader, c.AssetsConfig())
	if err != nil {
		return nil, invalidArgument(fmt.Sprintf("invalid avatar image: %v", err))
	}

	assetID := NewAssetID()
	asset := &corev1.AssetRecord{
		Id:          assetID,
		Filename:    processed.Filename,
		ContentType: processed.ContentType,
		Size:        int64(len(processed.Data)),
	}

	if c.ShouldUseS3() {
		s3Key := S3KeyServerAsset(assetID)
		if _, err := c.s3Client.PutObjectFromBytes(ctx, s3Key, processed.Data, processed.ContentType); err != nil {
			return nil, fmt.Errorf("failed to upload avatar to S3: %w", err)
		}
		asset.Storage = &corev1.AssetRecord_S3{
			S3: &corev1.S3Asset{
				Key:    assetID,
				Bucket: proto.String(c.s3Client.Bucket()),
			},
		}
	} else {
		headers := nats.Header{}
		headers.Set("Content-Type", processed.ContentType)
		meta := jetstream.ObjectMeta{
			Name:    assetID,
			Headers: headers,
		}
		if _, err := c.storage.serverAssets.Put(ctx, meta, bytes.NewReader(processed.Data)); err != nil {
			return nil, fmt.Errorf("failed to upload avatar: %w", err)
		}
		asset.Storage = &corev1.AssetRecord_Nats{
			Nats: &corev1.NATSAsset{Key: assetID},
		}
	}

	if err := c.SetUserAvatar(ctx, userID, asset); err != nil {
		c.CleanupAsset(context.WithoutCancel(ctx), DeprecatedAssetFromAsset(asset))
		return nil, err
	}

	if oldAvatar != nil && oldAvatar.GetId() != asset.GetId() {
		c.deleteAsset(context.WithoutCancel(ctx), assetStorageFromAsset(oldAvatar), "avatar", userID)
	}

	c.logger.Info(
		"Uploaded user avatar",
		"user_id", userID,
		"asset_id", assetID,
		"size", len(processed.Data),
		"animated", processed.Animated,
	)
	return asset, nil
}

// GetUserAvatarDisplayURL returns the best URL for a rendered avatar. Animated
// avatars are already canonical 256 px WebP assets, so transformed URLs would
// only decode their first frame; serve the canonical asset instead. Static
// avatars keep using the existing signed derivative path.
func (c *ChattoCore) GetUserAvatarDisplayURL(ctx context.Context, userID string, width, height *int, fit string) (string, error) {
	avatar, err := c.GetUserAvatar(ctx, userID)
	if err != nil {
		return "", err
	}
	if avatar != nil && avatar.GetFilename() == assets.AnimatedAvatarFilename {
		return c.GetUserAvatarURL(ctx, userID, nil, nil, "")
	}
	return c.GetUserAvatarURL(ctx, userID, width, height, fit)
}
