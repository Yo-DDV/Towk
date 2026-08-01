package assets

import (
	"bytes"
	"encoding/binary"
	"image/gif"
	"io"
	"strings"
	"testing"
)

func TestProcessAvatarAssetPreservesAnimationAndForcesInfiniteLoop(t *testing.T) {
	source := createAnimatedGIF(64, 64, 3)
	decoded, err := gif.DecodeAll(bytes.NewReader(source))
	if err != nil {
		t.Fatalf("decode source GIF: %v", err)
	}
	decoded.LoopCount = 2
	var finite bytes.Buffer
	if err := gif.EncodeAll(&finite, decoded); err != nil {
		t.Fatalf("encode finite-loop GIF: %v", err)
	}

	result, err := ProcessAvatarAsset(bytes.NewReader(finite.Bytes()))
	if err != nil {
		t.Fatalf("ProcessAvatarAsset: %v", err)
	}
	if !result.Animated {
		t.Fatal("animated GIF was stored as a static avatar")
	}
	if result.Filename != AnimatedAvatarFilename {
		t.Fatalf("filename = %q, want %q", result.Filename, AnimatedAvatarFilename)
	}
	if result.ContentType != "image/webp" {
		t.Fatalf("content type = %q, want image/webp", result.ContentType)
	}
	if int64(len(result.Data)) > MaxAvatarProcessedSize {
		t.Fatalf("processed size = %d, limit = %d", len(result.Data), MaxAvatarProcessedSize)
	}
	if got, err := animatedWebPLoopCount(result.Data); err != nil {
		t.Fatalf("read animated WebP loop count: %v", err)
	} else if got != 0 {
		t.Fatalf("animated WebP loop count = %d, want 0 (infinite)", got)
	}
	if got := webPChunkCount(result.Data, "ANMF"); got != 3 {
		t.Fatalf("ANMF frame chunks = %d, want 3", got)
	}
}

func TestProcessAvatarAssetKeepsStaticInputsStatic(t *testing.T) {
	webpReader, err := ProcessAvatarImage(bytes.NewReader(createTestImage(80, 40)))
	if err != nil {
		t.Fatalf("create WebP fixture: %v", err)
	}
	webp, err := io.ReadAll(webpReader)
	if err != nil {
		t.Fatalf("read WebP fixture: %v", err)
	}

	for name, source := range map[string][]byte{
		"png":              createTestImage(80, 40),
		"webp":             webp,
		"single-frame-gif": createStaticGIF(80, 40),
	} {
		t.Run(name, func(t *testing.T) {
			result, err := ProcessAvatarAsset(bytes.NewReader(source))
			if err != nil {
				t.Fatalf("ProcessAvatarAsset: %v", err)
			}
			if result.Animated {
				t.Fatal("static source was marked animated")
			}
			if result.Filename != StaticAvatarFilename {
				t.Fatalf("filename = %q, want %q", result.Filename, StaticAvatarFilename)
			}
			if len(result.Data) < 12 || string(result.Data[:4]) != "RIFF" || string(result.Data[8:12]) != "WEBP" {
				t.Fatal("processed static avatar is not WebP")
			}
			if got := webPChunkCount(result.Data, "ANIM"); got != 0 {
				t.Fatalf("static avatar contains %d ANIM chunks", got)
			}
		})
	}
}

func TestProcessAvatarAssetEnforcesCompressedSizeLimit(t *testing.T) {
	input := io.MultiReader(
		strings.NewReader("GIF89a"),
		io.LimitReader(zeroReader{}, MaxAvatarUploadSize),
	)
	_, err := ProcessAvatarAssetWithConfig(input, Config{MaxUploadSize: DefaultMaxUploadSize})
	if err == nil || !strings.Contains(err.Error(), "exceeds maximum size") {
		t.Fatalf("oversized avatar error = %v, want size rejection", err)
	}
}

func TestProcessAvatarAssetEnforcesSourceDimensions(t *testing.T) {
	data := createPNGHeader(MaxAvatarSourceDimension+1, 1)
	_, err := ProcessAvatarAsset(bytes.NewReader(data))
	if err == nil || !strings.Contains(err.Error(), "avatar dimensions") {
		t.Fatalf("oversized dimensions error = %v, want avatar dimension rejection", err)
	}
}

func TestProcessAvatarAssetEnforcesAnimationFrameLimit(t *testing.T) {
	data := createAnimatedGIF(1, 1, MaxAvatarAnimationFrames+1)
	_, err := ProcessAvatarAsset(bytes.NewReader(data))
	if err == nil || !strings.Contains(err.Error(), "frames") {
		t.Fatalf("excessive frame error = %v, want frame rejection", err)
	}
}

func TestProcessAvatarAssetEnforcesAnimationPixelBudget(t *testing.T) {
	data := createAnimatedGIF(512, 512, 65)
	_, err := ProcessAvatarAsset(bytes.NewReader(data))
	if err == nil || !strings.Contains(err.Error(), "cumulative pixel") {
		t.Fatalf("excessive animation pixel error = %v, want pixel-budget rejection", err)
	}
}

func TestProcessAvatarAssetRejectsUnsupportedContent(t *testing.T) {
	_, err := ProcessAvatarAsset(strings.NewReader(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`))
	if err == nil {
		t.Fatal("SVG avatar was accepted")
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}

func animatedWebPLoopCount(data []byte) (uint16, error) {
	payload, err := findWebPChunk(data, "ANIM")
	if err != nil {
		return 0, err
	}
	if len(payload) < 6 {
		return 0, io.ErrUnexpectedEOF
	}
	return binary.LittleEndian.Uint16(payload[4:6]), nil
}

func webPChunkCount(data []byte, wanted string) int {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return 0
	}
	riffEnd := int(binary.LittleEndian.Uint32(data[4:8])) + 8
	if riffEnd > len(data) {
		return 0
	}
	count := 0
	for offset := 12; offset+8 <= riffEnd; {
		chunkType := string(data[offset : offset+4])
		chunkSize := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		payloadEnd := offset + 8 + chunkSize
		if payloadEnd > riffEnd || payloadEnd < offset+8 {
			return count
		}
		if chunkType == wanted {
			count++
		}
		offset = payloadEnd
		if chunkSize%2 != 0 {
			offset++
		}
	}
	return count
}

func findWebPChunk(data []byte, wanted string) ([]byte, error) {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return nil, io.ErrUnexpectedEOF
	}
	riffEnd := int(binary.LittleEndian.Uint32(data[4:8])) + 8
	if riffEnd > len(data) {
		return nil, io.ErrUnexpectedEOF
	}
	for offset := 12; offset+8 <= riffEnd; {
		chunkType := string(data[offset : offset+4])
		chunkSize := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		payloadStart := offset + 8
		payloadEnd := payloadStart + chunkSize
		if payloadEnd > riffEnd || payloadEnd < payloadStart {
			return nil, io.ErrUnexpectedEOF
		}
		if chunkType == wanted {
			return data[payloadStart:payloadEnd], nil
		}
		offset = payloadEnd
		if chunkSize%2 != 0 {
			offset++
		}
	}
	return nil, io.EOF
}
