package assets

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"io"
	"math"
	"strings"
	"testing"
)

func TestProcessAvatarAssetWithFramingUsesSelectedStaticPixels(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 6, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 6; x++ {
			if x < 3 {
				source.SetNRGBA(x, y, color.NRGBA{R: 240, A: 255})
			} else {
				source.SetNRGBA(x, y, color.NRGBA{B: 240, A: 255})
			}
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatalf("encode PNG: %v", err)
	}

	result, err := ProcessAvatarAssetWithConfigAndFraming(
		bytes.NewReader(encoded.Bytes()),
		DefaultConfig(),
		&AvatarFraming{
			Mode:         AvatarFramingModeCrop,
			SourceWidth:  6,
			SourceHeight: 4,
			X:            3,
			Y:            0,
			Size:         3,
		},
	)
	if err != nil {
		t.Fatalf("ProcessAvatarAssetWithConfigAndFraming: %v", err)
	}
	if result.Animated || result.ContentType != "image/webp" || result.Filename != StaticAvatarFilename {
		t.Fatalf("unexpected result metadata: %+v", result)
	}
	decoded, _, err := image.Decode(bytes.NewReader(result.Data))
	if err != nil {
		t.Fatalf("decode cropped WebP: %v", err)
	}
	if got := decoded.Bounds().Size(); got != (image.Point{X: 3, Y: 3}) {
		t.Fatalf("cropped dimensions = %v, want 3x3", got)
	}
	r, g, b, a := decoded.At(1, 1).RGBA()
	if b <= r || b <= g || a == 0 {
		t.Fatalf("cropped center pixel = rgba(%d,%d,%d,%d), want opaque blue", r, g, b, a)
	}
}

func TestContainRectangleKeepsSinglePixelSourceVisible(t *testing.T) {
	if rect := containRectangle(1, 1, 1); rect != image.Rect(0, 0, 1, 1) {
		t.Fatalf("single-pixel contain rectangle = %v, want 1x1", rect)
	}
}

func TestContainRectangleFitsInsideCircularAvatar(t *testing.T) {
	rect := containRectangle(1200, 800, 400)
	if rect.Empty() {
		t.Fatal("contain rectangle is empty")
	}
	radius := 200.0
	halfWidth := float64(rect.Dx()) / 2
	halfHeight := float64(rect.Dy()) / 2
	if distance := math.Hypot(halfWidth, halfHeight); distance > radius {
		t.Fatalf("contained corner distance = %.3f, want <= %.3f", distance, radius)
	}
}

func TestProcessAvatarAssetWithContainKeepsCompleteStaticImageVisible(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 6, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 6; x++ {
			source.SetNRGBA(x, y, color.NRGBA{R: 220, G: 40, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatalf("encode PNG: %v", err)
	}

	result, err := ProcessAvatarAssetWithConfigAndFraming(
		bytes.NewReader(encoded.Bytes()),
		DefaultConfig(),
		&AvatarFraming{Mode: AvatarFramingModeContain, SourceWidth: 6, SourceHeight: 2},
	)
	if err != nil {
		t.Fatalf("ProcessAvatarAssetWithConfigAndFraming: %v", err)
	}
	decoded, _, err := image.Decode(bytes.NewReader(result.Data))
	if err != nil {
		t.Fatalf("decode contained WebP: %v", err)
	}
	if got := decoded.Bounds().Size(); got != (image.Point{X: 6, Y: 6}) {
		t.Fatalf("contained dimensions = %v, want 6x6", got)
	}
	_, _, _, topAlpha := decoded.At(3, 0).RGBA()
	red, _, _, centerAlpha := decoded.At(2, 2).RGBA()
	if topAlpha != 0 {
		t.Fatalf("top padding alpha = %d, want transparent", topAlpha)
	}
	if red == 0 || centerAlpha == 0 {
		t.Fatalf("center pixel = red %d alpha %d, want visible source content", red, centerAlpha)
	}
}

func TestProcessAvatarAssetWithFramingRejectsStaleOrOutOfBoundsGeometry(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewNRGBA(image.Rect(0, 0, 8, 6))); err != nil {
		t.Fatalf("encode PNG: %v", err)
	}

	for name, framing := range map[string]*AvatarFraming{
		"source mismatch": {
			Mode: AvatarFramingModeCrop, SourceWidth: 6, SourceHeight: 8, Size: 6,
		},
		"outside source": {
			Mode: AvatarFramingModeCrop, SourceWidth: 8, SourceHeight: 6, X: 4, Size: 5,
		},
		"empty crop": {
			Mode: AvatarFramingModeCrop, SourceWidth: 8, SourceHeight: 6,
		},
		"unknown mode": {
			Mode: "stretch", SourceWidth: 8, SourceHeight: 6,
		},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ProcessAvatarAssetWithConfigAndFraming(
				bytes.NewReader(encoded.Bytes()),
				DefaultConfig(),
				framing,
			)
			if err == nil || !strings.Contains(err.Error(), "avatar") {
				t.Fatalf("framing error = %v, want validated avatar framing rejection", err)
			}
		})
	}
}

func TestAnimatedAvatarFramingUsesSameCompositedRegionForEveryFrame(t *testing.T) {
	palette := color.Palette{
		color.NRGBA{A: 0},
		color.NRGBA{R: 255, A: 255},
		color.NRGBA{B: 255, A: 255},
		color.NRGBA{G: 255, A: 255},
	}
	first := image.NewPaletted(image.Rect(0, 0, 4, 2), palette)
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			if x < 2 {
				first.SetColorIndex(x, y, 1)
			} else {
				first.SetColorIndex(x, y, 2)
			}
		}
	}
	second := image.NewPaletted(image.Rect(0, 0, 2, 2), palette)
	for index := range second.Pix {
		second.Pix[index] = 3
	}
	animation := &gif.GIF{
		Image:     []*image.Paletted{first, second},
		Delay:     []int{3, 9},
		Disposal:  []byte{gif.DisposalNone, gif.DisposalNone},
		LoopCount: 4,
		Config: image.Config{
			ColorModel: palette,
			Width:      4,
			Height:     2,
		},
	}
	framing := &AvatarFraming{
		Mode: AvatarFramingModeCrop, SourceWidth: 4, SourceHeight: 2, X: 2, Size: 2,
	}

	composited := compositeGIFFrames(animation)
	for index, frame := range composited {
		framed, err := renderAvatarFrame(frame, framing)
		if err != nil {
			t.Fatalf("render frame %d: %v", index, err)
		}
		r, g, b, a := framed.At(0, 0).RGBA()
		if b <= r || b <= g || a == 0 {
			t.Fatalf("frame %d crop pixel = rgba(%d,%d,%d,%d), want retained blue", index, r, g, b, a)
		}
	}

	var source bytes.Buffer
	if err := gif.EncodeAll(&source, animation); err != nil {
		t.Fatalf("encode GIF: %v", err)
	}
	result, err := ProcessAvatarAssetWithConfigAndFraming(
		bytes.NewReader(source.Bytes()),
		DefaultConfig(),
		framing,
	)
	if err != nil {
		t.Fatalf("ProcessAvatarAssetWithConfigAndFraming: %v", err)
	}
	if !result.Animated || result.Filename != AnimatedAvatarFilename {
		t.Fatalf("animated framing result metadata: %+v", result)
	}
	if got := countAvatarWebPChunks(result.Data, "ANMF"); got != 2 {
		t.Fatalf("ANMF chunks = %d, want 2", got)
	}
	if loop, err := avatarWebPLoopCount(result.Data); err != nil {
		t.Fatalf("read loop count: %v", err)
	} else if loop != 0 {
		t.Fatalf("loop count = %d, want infinite", loop)
	}
}

func TestAnimatedAvatarContainPadsEveryFrameToSquare(t *testing.T) {
	animation := createFramingTestGIF(t, 6, 2, 2)
	result, err := ProcessAvatarAssetWithConfigAndFraming(
		bytes.NewReader(animation),
		DefaultConfig(),
		&AvatarFraming{Mode: AvatarFramingModeContain, SourceWidth: 6, SourceHeight: 2},
	)
	if err != nil {
		t.Fatalf("ProcessAvatarAssetWithConfigAndFraming: %v", err)
	}
	if !result.Animated {
		t.Fatal("contained animation became static")
	}
	if got := countAvatarWebPChunks(result.Data, "ANMF"); got != 2 {
		t.Fatalf("ANMF chunks = %d, want 2", got)
	}
}

func createFramingTestGIF(t *testing.T, width, height, frames int) []byte {
	t.Helper()
	palette := color.Palette{
		color.NRGBA{A: 0},
		color.NRGBA{R: 255, G: 80, A: 255},
		color.NRGBA{B: 255, A: 255},
	}
	animation := &gif.GIF{
		Image:     make([]*image.Paletted, frames),
		Delay:     make([]int, frames),
		Disposal:  make([]byte, frames),
		LoopCount: 0,
		Config: image.Config{
			ColorModel: palette,
			Width:      width,
			Height:     height,
		},
	}
	for frameIndex := 0; frameIndex < frames; frameIndex++ {
		frame := image.NewPaletted(image.Rect(0, 0, width, height), palette)
		for pixelIndex := range frame.Pix {
			frame.Pix[pixelIndex] = uint8(1 + frameIndex%2)
		}
		animation.Image[frameIndex] = frame
		animation.Delay[frameIndex] = 4 + frameIndex
		animation.Disposal[frameIndex] = gif.DisposalNone
	}
	var encoded bytes.Buffer
	if err := gif.EncodeAll(&encoded, animation); err != nil {
		t.Fatalf("encode framing GIF: %v", err)
	}
	return encoded.Bytes()
}

func countAvatarWebPChunks(data []byte, wanted string) int {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return 0
	}
	end := int(binary.LittleEndian.Uint32(data[4:8])) + 8
	if end > len(data) {
		return 0
	}
	count := 0
	for offset := 12; offset+8 <= end; {
		size := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		payloadEnd := offset + 8 + size
		if payloadEnd < offset+8 || payloadEnd > end {
			return count
		}
		if string(data[offset:offset+4]) == wanted {
			count++
		}
		offset = payloadEnd + size%2
	}
	return count
}

func avatarWebPLoopCount(data []byte) (uint16, error) {
	if len(data) < 12 {
		return 0, io.ErrUnexpectedEOF
	}
	end := int(binary.LittleEndian.Uint32(data[4:8])) + 8
	if end > len(data) {
		return 0, io.ErrUnexpectedEOF
	}
	for offset := 12; offset+8 <= end; {
		size := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		payload := offset + 8
		payloadEnd := payload + size
		if payloadEnd < payload || payloadEnd > end {
			return 0, io.ErrUnexpectedEOF
		}
		if string(data[offset:offset+4]) == "ANIM" {
			if size < 6 {
				return 0, io.ErrUnexpectedEOF
			}
			return binary.LittleEndian.Uint16(data[payload+4 : payload+6]), nil
		}
		offset = payloadEnd + size%2
	}
	return 0, io.EOF
}
