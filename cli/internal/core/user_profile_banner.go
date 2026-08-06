package core

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"strings"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"

	"hmans.de/chatto/internal/assets"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const profileBannerAssetPrefix = "profile-banner-v1-"

func IsProfileBannerAssetID(assetID string) bool {
	return strings.HasPrefix(assetID, profileBannerAssetPrefix)
}

func ProfileBannerAssetID(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	return profileBannerAssetPrefix + hex.EncodeToString(sum[:])
}

func (c *ChattoCore) requireProfileBannerUser(
	ctx context.Context,
	userID string,
) (*corev1.User, error) {
	if userID == "" {
		return nil, fmt.Errorf("%w: user ID is required", ErrInvalidArgument)
	}
	user, err := c.GetUserReference(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user.GetDeleted() {
		return nil, ErrNotFound
	}
	return user, nil
}

func (c *ChattoCore) ReplaceUserProfileBannerFromUpload(
	ctx context.Context,
	userID string,
	reader io.Reader,
) (*corev1.AssetRecord, error) {
	if _, err := c.requireProfileBannerUser(ctx, userID); err != nil {
		return nil, err
	}

	processed, err := assets.ProcessProfileBannerAssetWithConfig(reader, c.AssetsConfig())
	if err != nil {
		return nil, invalidArgument(fmt.Sprintf("invalid profile banner image: %v", err))
	}

	assetID := ProfileBannerAssetID(userID)
	asset := &corev1.AssetRecord{
		Id:          assetID,
		Filename:    processed.Filename,
		ContentType: processed.ContentType,
		Size:        int64(len(processed.Data)),
	}

	if c.ShouldUseS3() {
		s3Key := S3KeyServerAsset(assetID)
		if _, err := c.s3Client.PutObjectFromBytes(
			ctx,
			s3Key,
			processed.Data,
			processed.ContentType,
		); err != nil {
			return nil, fmt.Errorf("failed to upload profile banner to S3: %w", err)
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
		if _, err := c.storage.serverAssets.Put(
			ctx,
			meta,
			bytes.NewReader(processed.Data),
		); err != nil {
			return nil, fmt.Errorf("failed to upload profile banner: %w", err)
		}
		asset.Storage = &corev1.AssetRecord_Nats{
			Nats: &corev1.NATSAsset{Key: assetID},
		}
	}

	c.logger.Info(
		"Uploaded user profile banner",
		"user_id", userID,
		"asset_id", assetID,
		"size", len(processed.Data),
		"content_type", processed.ContentType,
	)
	return asset, nil
}

func (c *ChattoCore) UserProfileBannerAssetID(
	ctx context.Context,
	userID string,
) (string, error) {
	if _, err := c.requireProfileBannerUser(ctx, userID); err != nil {
		return "", err
	}
	return ProfileBannerAssetID(userID), nil
}

// DeleteUserProfileBanner is idempotent. It uses the same storage cleanup path
// as avatars and other server assets, so NATS ObjectStore and S3 remain aligned.
func (c *ChattoCore) DeleteUserProfileBanner(ctx context.Context, userID string) error {
	if userID == "" {
		return fmt.Errorf("%w: user ID is required", ErrInvalidArgument)
	}
	assetID := ProfileBannerAssetID(userID)
	asset := &corev1.AssetRecord{Id: assetID}
	if c.ShouldUseS3() {
		asset.Storage = &corev1.AssetRecord_S3{
			S3: &corev1.S3Asset{
				Key:    assetID,
				Bucket: proto.String(c.s3Client.Bucket()),
			},
		}
	} else {
		asset.Storage = &corev1.AssetRecord_Nats{
			Nats: &corev1.NATSAsset{Key: assetID},
		}
	}
	c.deleteAsset(context.WithoutCancel(ctx), assetStorageFromAsset(asset), "profile_banner", userID)
	return nil
}
