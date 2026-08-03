package connectapi

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"hmans.de/chatto/internal/assets"
)

const (
	AvatarFramingHeader    = "X-Towk-Avatar-Framing"
	avatarFramingVersion   = "v1"
	maxAvatarFramingHeader = 96
)

func avatarFramingFromRequestHeader(header http.Header) (*assets.AvatarFraming, error) {
	values := header.Values(AvatarFramingHeader)
	if len(values) == 0 {
		return nil, nil
	}
	if len(values) != 1 {
		return nil, fmt.Errorf("avatar framing metadata must be provided once")
	}
	return parseAvatarFramingHeader(values[0])
}

func parseAvatarFramingHeader(value string) (*assets.AvatarFraming, error) {
	if value == "" {
		return nil, fmt.Errorf("avatar framing metadata is empty")
	}
	if len(value) > maxAvatarFramingHeader {
		return nil, fmt.Errorf("avatar framing metadata is too long")
	}
	parts := strings.Split(value, ":")
	if len(parts) < 2 || parts[0] != avatarFramingVersion {
		return nil, fmt.Errorf("avatar framing metadata has an unsupported format")
	}

	switch parts[1] {
	case string(assets.AvatarFramingModeContain):
		if len(parts) != 4 {
			return nil, fmt.Errorf("avatar framing metadata has an unsupported format")
		}
		dimensions, err := parseAvatarFramingNumbers(parts[2:])
		if err != nil {
			return nil, err
		}
		if err := validateAvatarFramingSource(dimensions[0], dimensions[1]); err != nil {
			return nil, err
		}
		return &assets.AvatarFraming{
			Mode:         assets.AvatarFramingModeContain,
			SourceWidth:  int(dimensions[0]),
			SourceHeight: int(dimensions[1]),
		}, nil

	case string(assets.AvatarFramingModeCrop):
		if len(parts) != 7 {
			return nil, fmt.Errorf("avatar framing metadata has an unsupported format")
		}
		values, err := parseAvatarFramingNumbers(parts[2:])
		if err != nil {
			return nil, err
		}
		sourceWidth, sourceHeight := values[0], values[1]
		x, y, size := values[2], values[3], values[4]
		if err := validateAvatarFramingSource(sourceWidth, sourceHeight); err != nil {
			return nil, err
		}
		if size == 0 {
			return nil, fmt.Errorf("avatar crop size must be positive")
		}
		if size > sourceWidth || size > sourceHeight || x > sourceWidth-size || y > sourceHeight-size {
			return nil, fmt.Errorf("avatar crop lies outside the source image")
		}
		return &assets.AvatarFraming{
			Mode:         assets.AvatarFramingModeCrop,
			SourceWidth:  int(sourceWidth),
			SourceHeight: int(sourceHeight),
			X:            int(x),
			Y:            int(y),
			Size:         int(size),
		}, nil

	default:
		return nil, fmt.Errorf("avatar framing metadata has an unsupported mode")
	}
}

func parseAvatarFramingNumbers(parts []string) ([]uint64, error) {
	decoded := make([]uint64, len(parts))
	for index, part := range parts {
		if part == "" || strings.IndexFunc(part, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			return nil, fmt.Errorf("avatar framing metadata contains an invalid number")
		}
		value, err := strconv.ParseUint(part, 10, 32)
		if err != nil {
			return nil, fmt.Errorf("avatar framing metadata contains an invalid number")
		}
		decoded[index] = value
	}
	return decoded, nil
}

func validateAvatarFramingSource(width, height uint64) error {
	if width == 0 || height == 0 {
		return fmt.Errorf("avatar framing dimensions must be positive")
	}
	if width > assets.MaxAvatarSourceDimension || height > assets.MaxAvatarSourceDimension {
		return fmt.Errorf("avatar framing source dimensions exceed the supported limit")
	}
	if width*height > assets.MaxAvatarSourcePixels {
		return fmt.Errorf("avatar framing source dimensions exceed the supported pixel limit")
	}
	return nil
}
