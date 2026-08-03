package assets

import (
	"bytes"
	"fmt"
	"image"
	"io"
)

const (
	MaxProfileBannerUploadSize    int64 = 8 * 1024 * 1024
	MaxProfileBannerProcessedSize int64 = 5 * 1024 * 1024

	ProfileBannerWidth  = 1536
	ProfileBannerHeight = 512

	MinProfileBannerSourceWidth           = 600
	MinProfileBannerSourceHeight          = 200
	MaxProfileBannerSourceDimension       = 8192
	MaxProfileBannerSourcePixels    int64 = 24_000_000
	ProfileBannerJPEGQuality              = 82
)

type ProcessedProfileBanner struct {
	Data        []byte
	Filename    string
	ContentType string
	Width       int
	Height      int
}

func ProcessProfileBannerAsset(input io.Reader) (*ProcessedProfileBanner, error) {
	return ProcessProfileBannerAssetWithConfig(input, DefaultConfig())
}

func ProcessProfileBannerAssetWithConfig(
	input io.Reader,
	cfg Config,
) (*ProcessedProfileBanner, error) {
	maxUploadSize := cfg.MaxUploadSize
	if maxUploadSize <= 0 || maxUploadSize > MaxProfileBannerUploadSize {
		maxUploadSize = MaxProfileBannerUploadSize
	}

	data, err := readAndValidateImage(input, maxUploadSize)
	if err != nil {
		return nil, err
	}

	contentType := DetectImageContentType(data)
	switch contentType {
	case "image/jpeg", "image/png", "image/webp":
	default:
		return nil, fmt.Errorf("unsupported profile banner image type")
	}

	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed to decode profile banner configuration: %w", err)
	}
	if config.Width < MinProfileBannerSourceWidth || config.Height < MinProfileBannerSourceHeight {
		return nil, fmt.Errorf(
			"profile banner dimensions %dx%d are below the minimum of %dx%d",
			config.Width,
			config.Height,
			MinProfileBannerSourceWidth,
			MinProfileBannerSourceHeight,
		)
	}
	if config.Width > MaxProfileBannerSourceDimension || config.Height > MaxProfileBannerSourceDimension {
		return nil, fmt.Errorf(
			"profile banner dimensions %dx%d exceed the supported limit of %d pixels per side",
			config.Width,
			config.Height,
			MaxProfileBannerSourceDimension,
		)
	}
	pixels := int64(config.Width) * int64(config.Height)
	if pixels > MaxProfileBannerSourcePixels {
		return nil, fmt.Errorf(
			"profile banner contains %d pixels, exceeding the supported limit of %d",
			pixels,
			MaxProfileBannerSourcePixels,
		)
	}

	transformed, err := TransformImageWithOptions(
		data,
		ProfileBannerWidth,
		ProfileBannerHeight,
		FitCover,
		TransformOptions{JPEGQuality: ProfileBannerJPEGQuality},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to transform profile banner: %w", err)
	}

	processed, err := io.ReadAll(io.LimitReader(transformed.Reader, MaxProfileBannerProcessedSize+1))
	if err != nil {
		return nil, fmt.Errorf("failed to read processed profile banner: %w", err)
	}
	if int64(len(processed)) > MaxProfileBannerProcessedSize {
		return nil, fmt.Errorf(
			"processed profile banner exceeds maximum size of %d bytes",
			MaxProfileBannerProcessedSize,
		)
	}

	filename := "profile-banner.jpg"
	if transformed.ContentType == "image/webp" {
		filename = "profile-banner.webp"
	}
	return &ProcessedProfileBanner{
		Data:        processed,
		Filename:    filename,
		ContentType: transformed.ContentType,
		Width:       ProfileBannerWidth,
		Height:      ProfileBannerHeight,
	}, nil
}
