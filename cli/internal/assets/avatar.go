package assets

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"io"
)

const (
	// MaxAvatarUploadSize bounds the compressed source admitted by the avatar
	// endpoint. It intentionally matches the existing web-client limit.
	MaxAvatarUploadSize int64 = 10 * 1024 * 1024
	// MaxAvatarProcessedSize bounds the canonical WebP stored and served for an
	// avatar so an animation cannot expand into an unexpectedly large asset.
	MaxAvatarProcessedSize int64 = 10 * 1024 * 1024

	// Avatar sources are resized to MaxAvatarDim before storage, but their
	// decoded dimensions still need a tighter surface-specific allocation bound.
	MaxAvatarSourceDimension = 4096
	MaxAvatarSourcePixels    = 16_777_216

	// Animated avatars retain full-canvas snapshots during GIF compositing.
	// These limits keep that work bounded independently from attachment media.
	MaxAvatarAnimationFrames           = 120
	MaxAvatarAnimationCumulativePixels = 16_777_216

	StaticAvatarFilename   = "avatar.webp"
	AnimatedAvatarFilename = "avatar-animated.webp"
)

// ProcessedAvatar is the canonical avatar binary ready for durable storage.
// Static inputs and single-frame GIFs become static WebP; multi-frame GIFs
// become animated WebP and are forced to loop continuously.
type ProcessedAvatar struct {
	Data        []byte
	Filename    string
	ContentType string
	Animated    bool
}

// ProcessAvatarAsset uses the default shared asset configuration while applying
// avatar-specific limits that are intentionally stricter than attachment limits.
func ProcessAvatarAsset(input io.Reader) (*ProcessedAvatar, error) {
	return ProcessAvatarAssetWithConfig(input, DefaultConfig())
}

// ProcessAvatarAssetWithConfig validates and canonicalizes an uploaded avatar.
// The configured upload limit can tighten the avatar limit but can never raise
// it above MaxAvatarUploadSize.
func ProcessAvatarAssetWithConfig(input io.Reader, cfg Config) (*ProcessedAvatar, error) {
	maxUploadSize := cfg.MaxUploadSize
	if maxUploadSize <= 0 || maxUploadSize > MaxAvatarUploadSize {
		maxUploadSize = MaxAvatarUploadSize
	}

	data, err := readAndValidateImage(input, maxUploadSize)
	if err != nil {
		return nil, err
	}

	contentType := DetectImageContentType(data)
	switch contentType {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
		// Supported avatar inputs. The magic bytes are authoritative; request
		// filenames and declared MIME types are intentionally not trusted.
	default:
		return nil, fmt.Errorf("unsupported avatar image type")
	}

	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed to decode avatar image configuration: %w", err)
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > MaxAvatarSourceDimension || config.Height > MaxAvatarSourceDimension {
		return nil, fmt.Errorf("avatar dimensions %dx%d exceed the supported limit of %dx%d", config.Width, config.Height, MaxAvatarSourceDimension, MaxAvatarSourceDimension)
	}
	pixels := int64(config.Width) * int64(config.Height)
	if pixels > MaxAvatarSourcePixels {
		return nil, fmt.Errorf("avatar contains %d pixels, exceeding the supported limit of %d", pixels, MaxAvatarSourcePixels)
	}

	animated := false
	if contentType == "image/gif" {
		frames, err := inspectGIFFrames(data)
		if err != nil {
			return nil, err
		}
		if frames < 1 {
			return nil, fmt.Errorf("GIF has no frames")
		}
		if frames > MaxAvatarAnimationFrames {
			return nil, fmt.Errorf("animated avatar has %d frames, exceeding the supported limit of %d", frames, MaxAvatarAnimationFrames)
		}
		if pixels*int64(frames) > MaxAvatarAnimationCumulativePixels {
			return nil, fmt.Errorf("animated avatar exceeds the cumulative pixel limit of %d", MaxAvatarAnimationCumulativePixels)
		}
		animated = frames > 1
	}

	if animated {
		result, err := transformAnimatedGIF(data, MaxAvatarDim, MaxAvatarDim, FitContain)
		if err != nil {
			return nil, err
		}
		processed, err := readBoundedAvatarOutput(result.Reader)
		if err != nil {
			return nil, err
		}
		if err := forceAnimatedWebPLoopForever(processed); err != nil {
			return nil, err
		}
		return &ProcessedAvatar{
			Data:        processed,
			Filename:    AnimatedAvatarFilename,
			ContentType: "image/webp",
			Animated:    true,
		}, nil
	}

	staticReader, err := ProcessAvatarImageWithConfig(bytes.NewReader(data), Config{MaxUploadSize: maxUploadSize})
	if err != nil {
		return nil, err
	}
	processed, err := readBoundedAvatarOutput(staticReader)
	if err != nil {
		return nil, err
	}
	return &ProcessedAvatar{
		Data:        processed,
		Filename:    StaticAvatarFilename,
		ContentType: "image/webp",
		Animated:    false,
	}, nil
}

func readBoundedAvatarOutput(reader io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, MaxAvatarProcessedSize+1))
	if err != nil {
		return nil, fmt.Errorf("failed to read processed avatar: %w", err)
	}
	if int64(len(data)) > MaxAvatarProcessedSize {
		return nil, fmt.Errorf("processed avatar exceeds maximum size of %d bytes", MaxAvatarProcessedSize)
	}
	return data, nil
}

// forceAnimatedWebPLoopForever rewrites the ANIM chunk's loop count in-place.
// WebP stores this count as a little-endian uint16 after the four-byte
// background color; zero means infinite looping.
func forceAnimatedWebPLoopForever(data []byte) error {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return fmt.Errorf("processed animated avatar is not a WebP container")
	}

	riffEnd := int(binary.LittleEndian.Uint32(data[4:8])) + 8
	if riffEnd > len(data) || riffEnd < 12 {
		return fmt.Errorf("processed animated avatar has an invalid RIFF size")
	}

	for offset := 12; offset+8 <= riffEnd; {
		chunkType := string(data[offset : offset+4])
		chunkSize := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		payloadStart := offset + 8
		payloadEnd := payloadStart + chunkSize
		if chunkSize < 0 || payloadEnd < payloadStart || payloadEnd > riffEnd {
			return fmt.Errorf("processed animated avatar has an invalid WebP chunk")
		}
		if chunkType == "ANIM" {
			if chunkSize < 6 {
				return fmt.Errorf("processed animated avatar has an invalid ANIM chunk")
			}
			data[payloadStart+4] = 0
			data[payloadStart+5] = 0
			return nil
		}
		offset = payloadEnd
		if chunkSize%2 != 0 {
			offset++
		}
	}

	return fmt.Errorf("processed animated avatar is missing an ANIM chunk")
}
