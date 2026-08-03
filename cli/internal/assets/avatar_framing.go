package assets

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"
	"image/gif"
	"math"

	"github.com/HugoSmits86/nativewebp"
	"github.com/disintegration/imageorient"
	xdraw "golang.org/x/image/draw"
)

// AvatarFramingMode selects how a source image is placed in the canonical
// square avatar canvas.
type AvatarFramingMode string

const (
	AvatarFramingModeCrop    AvatarFramingMode = "crop"
	AvatarFramingModeContain AvatarFramingMode = "contain"
)

// AvatarFraming is display-oriented geometry supplied by a client after it has
// decoded the selected file. SourceWidth and SourceHeight make stale or forged
// geometry detectable before any pixels are transformed.
type AvatarFraming struct {
	Mode         AvatarFramingMode
	SourceWidth  int
	SourceHeight int
	X            int
	Y            int
	Size         int
}

func validateAvatarFraming(framing *AvatarFraming, width, height int) error {
	if framing == nil {
		return nil
	}
	if width <= 0 || height <= 0 || framing.SourceWidth <= 0 || framing.SourceHeight <= 0 {
		return fmt.Errorf("avatar framing dimensions must be positive")
	}
	if framing.SourceWidth != width || framing.SourceHeight != height {
		return fmt.Errorf(
			"avatar framing source dimensions %dx%d do not match decoded image dimensions %dx%d",
			framing.SourceWidth,
			framing.SourceHeight,
			width,
			height,
		)
	}

	switch framing.Mode {
	case AvatarFramingModeContain:
		if framing.X != 0 || framing.Y != 0 || framing.Size != 0 {
			return fmt.Errorf("full-image avatar framing cannot include crop coordinates")
		}
	case AvatarFramingModeCrop:
		if framing.Size <= 0 {
			return fmt.Errorf("avatar crop size must be positive")
		}
		if framing.X < 0 || framing.Y < 0 || framing.Size > width || framing.Size > height {
			return fmt.Errorf("avatar crop lies outside the decoded image")
		}
		if framing.X > width-framing.Size || framing.Y > height-framing.Size {
			return fmt.Errorf("avatar crop lies outside the decoded image")
		}
	default:
		return fmt.Errorf("unsupported avatar framing mode %q", framing.Mode)
	}
	return nil
}

func processStaticAvatarFraming(data []byte, framing *AvatarFraming) ([]byte, error) {
	img, _, err := imageorient.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed to decode avatar image: %w", err)
	}
	bounds := img.Bounds()
	if err := validateAvatarFraming(framing, bounds.Dx(), bounds.Dy()); err != nil {
		return nil, err
	}

	framed, err := renderAvatarFrame(img, framing)
	if err != nil {
		return nil, err
	}
	var encoded bytes.Buffer
	if err := nativewebp.Encode(&encoded, framed, nil); err != nil {
		return nil, fmt.Errorf("failed to encode framed avatar to WebP: %w", err)
	}
	return encoded.Bytes(), nil
}

func transformAnimatedGIFFraming(data []byte, framing *AvatarFraming) (*TransformResult, error) {
	animation, err := gif.DecodeAll(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed to decode animated GIF: %w", err)
	}
	if len(animation.Image) == 0 {
		return nil, fmt.Errorf("GIF has no frames")
	}
	if len(animation.Image) > MaxAvatarAnimationFrames {
		return nil, fmt.Errorf(
			"animated avatar has %d frames, exceeding the supported limit of %d",
			len(animation.Image),
			MaxAvatarAnimationFrames,
		)
	}

	canvasWidth, canvasHeight := animation.Config.Width, animation.Config.Height
	if canvasWidth <= 0 || canvasHeight <= 0 {
		canvasWidth = animation.Image[0].Bounds().Max.X
		canvasHeight = animation.Image[0].Bounds().Max.Y
	}
	if err := validateAvatarFraming(framing, canvasWidth, canvasHeight); err != nil {
		return nil, err
	}
	if int64(canvasWidth)*int64(canvasHeight)*int64(len(animation.Image)) > MaxAvatarAnimationCumulativePixels {
		return nil, fmt.Errorf(
			"animated avatar exceeds the cumulative pixel limit of %d",
			MaxAvatarAnimationCumulativePixels,
		)
	}

	composited := compositeGIFFrames(animation)
	frames := make([]image.Image, len(composited))
	for index, frame := range composited {
		framed, err := renderAvatarFrame(frame, framing)
		if err != nil {
			return nil, err
		}
		frames[index] = framed
	}

	durations := make([]uint, len(animation.Image))
	disposals := make([]uint, len(animation.Image))
	for index := range animation.Image {
		delay := 0
		if index < len(animation.Delay) {
			delay = animation.Delay[index]
		}
		durations[index] = uint(delay) * 10 // GIF centiseconds to WebP milliseconds.
		disposals[index] = 0                // Full compositing has already resolved disposal.
	}

	webpAnimation := &nativewebp.Animation{
		Images:          frames,
		Durations:       durations,
		Disposals:       disposals,
		LoopCount:       convertGIFLoopCount(animation.LoopCount),
		BackgroundColor: 0,
	}
	var encoded bytes.Buffer
	if err := nativewebp.EncodeAll(&encoded, webpAnimation, nil); err != nil {
		return nil, fmt.Errorf("failed to encode framed animated WebP: %w", err)
	}
	return &TransformResult{
		Reader:      bytes.NewReader(encoded.Bytes()),
		ContentType: "image/webp",
	}, nil
}

func renderAvatarFrame(img image.Image, framing *AvatarFraming) (*image.NRGBA, error) {
	if framing == nil {
		return nil, fmt.Errorf("avatar framing is required")
	}
	bounds := img.Bounds()
	if err := validateAvatarFraming(framing, bounds.Dx(), bounds.Dy()); err != nil {
		return nil, err
	}

	sourceRect := bounds
	targetSize := max(bounds.Dx(), bounds.Dy())
	destinationRect := image.Rect(0, 0, targetSize, targetSize)
	if framing.Mode == AvatarFramingModeCrop {
		sourceRect = image.Rect(
			bounds.Min.X+framing.X,
			bounds.Min.Y+framing.Y,
			bounds.Min.X+framing.X+framing.Size,
			bounds.Min.Y+framing.Y+framing.Size,
		)
		targetSize = framing.Size
		destinationRect = image.Rect(0, 0, targetSize, targetSize)
	}
	if targetSize > MaxAvatarDim {
		targetSize = MaxAvatarDim
	}
	if targetSize <= 0 {
		return nil, fmt.Errorf("avatar framing produced an invalid target size")
	}

	destination := image.NewNRGBA(image.Rect(0, 0, targetSize, targetSize))
	if framing.Mode == AvatarFramingModeContain {
		destinationRect = containRectangle(sourceRect.Dx(), sourceRect.Dy(), targetSize)
	} else {
		destinationRect = destination.Bounds()
	}

	if sourceRect.Dx() == destinationRect.Dx() && sourceRect.Dy() == destinationRect.Dy() {
		draw.Draw(destination, destinationRect, img, sourceRect.Min, draw.Src)
	} else {
		xdraw.CatmullRom.Scale(
			destination,
			destinationRect,
			img,
			sourceRect,
			draw.Src,
			nil,
		)
	}
	return destination, nil
}

func containRectangle(sourceWidth, sourceHeight, targetSize int) image.Rectangle {
	if sourceWidth <= 0 || sourceHeight <= 0 || targetSize <= 0 {
		return image.Rectangle{}
	}
	// Avatars are rendered through a circular mask. Inscribe the complete
	// source rectangle in that circle so no corner is clipped by compact,
	// message, member-list, or profile avatar surfaces.
	ratio := float64(targetSize) / math.Hypot(float64(sourceWidth), float64(sourceHeight))
	width := max(1, min(targetSize, int(math.Floor(float64(sourceWidth)*ratio))))
	height := max(1, min(targetSize, int(math.Floor(float64(sourceHeight)*ratio))))
	x := (targetSize - width) / 2
	y := (targetSize - height) / 2
	return image.Rect(x, y, x+width, y+height)
}
