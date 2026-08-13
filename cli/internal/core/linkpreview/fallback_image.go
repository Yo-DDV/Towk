package linkpreview

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"net/url"
	"strings"

	"hmans.de/chatto/internal/assets"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const (
	fallbackImageWidth  = 600
	fallbackImageHeight = 315
)

func (f *Fetcher) generateAndStoreFallbackImage(ctx context.Context, rawURL string) (*corev1.AssetRecord, error) {
	if f == nil || f.newAssetID == nil || f.storeImage == nil {
		return nil, fmt.Errorf("fallback image storage unavailable")
	}
	config := f.assetsConfig
	if config == nil {
		defaultConfig := assets.DefaultConfig()
		config = &defaultConfig
	}
	pngData, err := renderDomainFallbackPNG(rawURL)
	if err != nil {
		return nil, err
	}
	processed, err := assets.ProcessLinkPreviewImageWithConfig(bytes.NewReader(pngData), *config)
	if err != nil {
		return nil, fmt.Errorf("process fallback image: %w", err)
	}
	processedData, err := readProcessedImage(processed)
	if err != nil {
		return nil, err
	}
	assetID := f.newAssetID()
	asset, err := f.storeImage(ctx, assetID, processedData, "image/webp")
	if err != nil {
		return nil, fmt.Errorf("store fallback image: %w", err)
	}
	return asset, nil
}

func renderDomainFallbackPNG(rawURL string) ([]byte, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Hostname() == "" {
		return nil, fmt.Errorf("invalid fallback image URL")
	}
	domain := strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
	digest := sha256.Sum256([]byte(domain))
	base := color.RGBA{R: 32 + digest[0]%128, G: 32 + digest[1]%128, B: 48 + digest[2]%128, A: 255}
	accent := color.RGBA{R: 96 + digest[3]%160, G: 96 + digest[4]%160, B: 96 + digest[5]%160, A: 255}

	canvas := image.NewRGBA(image.Rect(0, 0, fallbackImageWidth, fallbackImageHeight))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: base}, image.Point{}, draw.Src)
	for y := 0; y < fallbackImageHeight; y++ {
		for x := 0; x < fallbackImageWidth; x++ {
			mix := uint8((x + y) * 96 / (fallbackImageWidth + fallbackImageHeight))
			canvas.SetRGBA(x, y, color.RGBA{
				R: uint8((uint16(base.R)*(255-uint16(mix)) + uint16(accent.R)*uint16(mix)) / 255),
				G: uint8((uint16(base.G)*(255-uint16(mix)) + uint16(accent.G)*uint16(mix)) / 255),
				B: uint8((uint16(base.B)*(255-uint16(mix)) + uint16(accent.B)*uint16(mix)) / 255),
				A: 255,
			})
		}
	}
	centerX, centerY := fallbackImageWidth/2, fallbackImageHeight/2
	radius := fallbackImageHeight / 4
	mark := color.RGBA{R: 255, G: 255, B: 255, A: 220}
	for y := centerY - radius; y <= centerY+radius; y++ {
		for x := centerX - radius; x <= centerX+radius; x++ {
			if (x-centerX)*(x-centerX)+(y-centerY)*(y-centerY) <= radius*radius {
				canvas.SetRGBA(x, y, mark)
			}
		}
	}
	barWidth := radius / 3
	draw.Draw(canvas, image.Rect(centerX-barWidth/2, centerY-radius/2, centerX+barWidth/2, centerY+radius/2), &image.Uniform{C: accent}, image.Point{}, draw.Src)

	var output bytes.Buffer
	if err := png.Encode(&output, canvas); err != nil {
		return nil, fmt.Errorf("encode fallback image: %w", err)
	}
	return output.Bytes(), nil
}
