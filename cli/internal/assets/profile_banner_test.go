package assets

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func encodedBannerPNG(t *testing.T, width, height int, transparent bool) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	alpha := uint8(255)
	if transparent {
		alpha = 180
	}
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8((x * 255) / max(width, 1)),
				G: uint8((y * 255) / max(height, 1)),
				B: 120,
				A: alpha,
			})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func encodedBannerJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 90, G: uint8(x % 255), B: uint8(y % 255), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestProcessProfileBannerAssetProducesExactThreeToOneOutput(t *testing.T) {
	for name, source := range map[string][]byte{
		"landscape": encodedBannerJPEG(t, 1800, 700),
		"portrait":  encodedBannerPNG(t, 700, 1400, false),
	} {
		t.Run(name, func(t *testing.T) {
			processed, err := ProcessProfileBannerAsset(bytes.NewReader(source))
			if err != nil {
				t.Fatal(err)
			}
			if processed.Width != ProfileBannerWidth || processed.Height != ProfileBannerHeight {
				t.Fatalf("unexpected declared output dimensions: %dx%d", processed.Width, processed.Height)
			}
			config, _, err := image.DecodeConfig(bytes.NewReader(processed.Data))
			if err != nil {
				t.Fatal(err)
			}
			if config.Width != ProfileBannerWidth || config.Height != ProfileBannerHeight {
				t.Fatalf("unexpected encoded dimensions: %dx%d", config.Width, config.Height)
			}
			if int64(len(processed.Data)) > MaxProfileBannerProcessedSize {
				t.Fatalf("processed image exceeds bound: %d", len(processed.Data))
			}
		})
	}
}

func TestProcessProfileBannerAssetPreservesTransparencyAsWebP(t *testing.T) {
	processed, err := ProcessProfileBannerAsset(
		bytes.NewReader(encodedBannerPNG(t, 900, 300, true)),
	)
	if err != nil {
		t.Fatal(err)
	}
	if processed.ContentType != "image/webp" || processed.Filename != "profile-banner.webp" {
		t.Fatalf("unexpected transparent output: %s %s", processed.ContentType, processed.Filename)
	}
}

func TestProcessProfileBannerAssetRejectsUnsupportedAndAnimatedInputs(t *testing.T) {
	var gifData bytes.Buffer
	palette := color.Palette{color.Black, color.White}
	frame := image.NewPaletted(image.Rect(0, 0, 600, 200), palette)
	if err := gif.EncodeAll(&gifData, &gif.GIF{
		Image: []*image.Paletted{frame, frame},
		Delay: []int{5, 5},
	}); err != nil {
		t.Fatal(err)
	}

	for name, source := range map[string][]byte{
		"gif":  gifData.Bytes(),
		"svg":  []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`),
		"html": []byte(`<html><script>alert(1)</script></html>`),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ProcessProfileBannerAsset(bytes.NewReader(source))
			if err == nil {
				t.Fatal("expected unsupported input to be rejected")
			}
		})
	}
}

func TestProcessProfileBannerAssetRejectsSmallAndOversizedInputs(t *testing.T) {
	if _, err := ProcessProfileBannerAsset(
		bytes.NewReader(encodedBannerPNG(t, MinProfileBannerSourceWidth-1, 400, false)),
	); err == nil || !strings.Contains(err.Error(), "below the minimum") {
		t.Fatalf("expected minimum dimension error, got %v", err)
	}

	tooLarge := bytes.Repeat([]byte{0}, int(MaxProfileBannerUploadSize)+1)
	if _, err := ProcessProfileBannerAsset(bytes.NewReader(tooLarge)); err == nil {
		t.Fatal("expected compressed byte limit rejection")
	}
}
