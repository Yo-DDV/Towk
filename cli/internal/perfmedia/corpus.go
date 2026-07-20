package perfmedia

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"sort"

	"github.com/HugoSmits86/nativewebp"
)

type Profile string

const (
	ProfileSmoke         Profile = "smoke"
	ProfileStandard      Profile = "standard"
	ProfileQualification Profile = "qualification"
	ManifestFilename             = "manifest.json"
)

type Manifest struct {
	SchemaVersion int     `json:"schema_version"`
	Profile       Profile `json:"profile"`
	Entries       []Entry `json:"entries"`
}

type Entry struct {
	Path        string `json:"path"`
	Kind        string `json:"kind"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
	SHA256      string `json:"sha256"`
	Width       int    `json:"width,omitempty"`
	Height      int    `json:"height,omitempty"`
	Frames      int    `json:"frames,omitempty"`
	Invalid     bool   `json:"invalid,omitempty"`
}

type artifact struct {
	entry Entry
	write func(context.Context, io.Writer) error
}

func PayloadSizes(profile Profile) []int64 {
	var sizes []int64
	switch profile {
	case ProfileSmoke:
		sizes = []int64{1 << 20}
	case ProfileStandard:
		sizes = []int64{1 << 20, 25 << 20}
	case ProfileQualification:
		sizes = []int64{1 << 20, 25 << 20, 100 << 20, 250 << 20}
	default:
		return nil
	}
	return append([]int64(nil), sizes...)
}

func GenerateCorpus(ctx context.Context, repoRoot, outputDir string, profile Profile) (*Manifest, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	payloadSizes := PayloadSizes(profile)
	if payloadSizes == nil {
		return nil, fmt.Errorf("unknown media corpus profile %q", profile)
	}
	if outputDir == "" {
		return nil, errors.New("media corpus output directory is required")
	}
	if _, err := os.Stat(outputDir); err == nil {
		return nil, fmt.Errorf("media corpus output already exists: %s", outputDir)
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("inspect media corpus output: %w", err)
	}

	parent := filepath.Dir(outputDir)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return nil, fmt.Errorf("create media corpus parent: %w", err)
	}
	stagingDir, err := os.MkdirTemp(parent, ".towk-media-corpus-")
	if err != nil {
		return nil, fmt.Errorf("create media corpus staging directory: %w", err)
	}
	defer os.RemoveAll(stagingDir)

	artifacts := corpusArtifacts(repoRoot, payloadSizes)
	entries := make([]Entry, 0, len(artifacts))
	for _, item := range artifacts {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		entry, err := writeArtifact(ctx, stagingDir, item)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })

	manifest := &Manifest{SchemaVersion: 1, Profile: profile, Entries: entries}
	serialized, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode media corpus manifest: %w", err)
	}
	serialized = append(serialized, '\n')
	if err := os.WriteFile(filepath.Join(stagingDir, ManifestFilename), serialized, 0o644); err != nil {
		return nil, fmt.Errorf("write media corpus manifest: %w", err)
	}
	if err := os.Rename(stagingDir, outputDir); err != nil {
		return nil, fmt.Errorf("publish media corpus: %w", err)
	}
	return manifest, nil
}

func corpusArtifacts(repoRoot string, payloadSizes []int64) []artifact {
	artifacts := []artifact{
		imageArtifact("images/small-320x180.png", "image/png", 320, 180, 0, false, encodePNG()),
		imageArtifact("images/hd-1920x1080.jpg", "image/jpeg", 1920, 1080, 0, false, encodeJPEG(88)),
		imageArtifact("images/large-4000x3000.jpg", "image/jpeg", 4000, 3000, 0, false, encodeJPEG(88)),
		imageArtifact("images/alpha-1024x768.png", "image/png", 1024, 768, 0, true, encodePNG()),
		imageArtifact("images/lossless-1024x768.webp", "image/webp", 1024, 768, 0, false, encodeWebP()),
		imageArtifact("images/oriented-320x240.jpg", "image/jpeg", 320, 240, 0, false, encodeOrientedJPEG()),
		imageArtifact("images/static-64x64.gif", "image/gif", 64, 64, 1, false, encodeGIF(64, 64, 1)),
		imageArtifact("images/animated-320x180.gif", "image/gif", 320, 180, 24, false, encodeGIF(320, 180, 24)),
		fixtureArtifact(repoRoot, "audio/sample.mp3", "audio", "audio/mpeg", "apps/frontend/e2e/fixtures/test-audio.mp3", "9666845ad50ad80c561b07c1e7b3ecedd466a10f1d2ae709322d2e3a7bfbd1cf"),
		fixtureArtifact(repoRoot, "video/sample.mp4", "video", "video/mp4", "apps/frontend/e2e/fixtures/test-video.mp4", "f56e16ca99341a363c3f2fe2656979e517e5ae82b2c31b09c45371705fe133b7"),
		literalArtifact("malformed/truncated.png", "malformed", "image/png", true, []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")),
		literalArtifact("malformed/mime-mismatch.jpg", "malformed", "image/jpeg", true, []byte("this is not a JPEG image\n")),
		fixturePrefixArtifact(repoRoot, "malformed/truncated.mp4", "video/mp4", "apps/frontend/e2e/fixtures/test-video.mp4", 32),
		literalArtifact("requests/range-cases.txt", "request", "text/plain", false, []byte("bytes=0-0\nbytes=-128\nbytes=128-\nbytes=999999999-\nbytes=0-1,4-5\nbytes=9223372036854775808-\n")),
	}
	for _, size := range payloadSizes {
		size := size
		name := fmt.Sprintf("files/payload-%03dMiB.bin", size>>20)
		artifacts = append(artifacts, artifact{
			entry: Entry{Path: name, Kind: "file", ContentType: "application/octet-stream"},
			write: func(ctx context.Context, w io.Writer) error {
				return writeDeterministicPayload(ctx, w, size)
			},
		})
	}
	return artifacts
}

func imageArtifact(path, contentType string, width, height, frames int, alpha bool, encoder func(io.Writer, image.Image) error) artifact {
	return artifact{
		entry: Entry{Path: path, Kind: "image", ContentType: contentType, Width: width, Height: height, Frames: frames},
		write: func(ctx context.Context, w io.Writer) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			return encoder(w, patternedImage(width, height, alpha))
		},
	}
}

func fixtureArtifact(repoRoot, outputPath, kind, contentType, sourcePath, expectedSHA string) artifact {
	return artifact{
		entry: Entry{Path: outputPath, Kind: kind, ContentType: contentType},
		write: func(ctx context.Context, w io.Writer) error {
			return copyVerifiedFixture(ctx, w, filepath.Join(repoRoot, filepath.FromSlash(sourcePath)), expectedSHA)
		},
	}
}

func fixturePrefixArtifact(repoRoot, outputPath, contentType, sourcePath string, length int) artifact {
	return artifact{
		entry: Entry{Path: outputPath, Kind: "malformed", ContentType: contentType, Invalid: true},
		write: func(ctx context.Context, w io.Writer) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			contents, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(sourcePath)))
			if err != nil {
				return fmt.Errorf("read fixture prefix %s: %w", sourcePath, err)
			}
			if length > len(contents) {
				return fmt.Errorf("fixture %s is shorter than requested prefix", sourcePath)
			}
			_, err = w.Write(contents[:length])
			return err
		},
	}
}

func literalArtifact(path, kind, contentType string, invalid bool, contents []byte) artifact {
	return artifact{
		entry: Entry{Path: path, Kind: kind, ContentType: contentType, Invalid: invalid},
		write: func(ctx context.Context, w io.Writer) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			_, err := w.Write(contents)
			return err
		},
	}
}

func writeArtifact(ctx context.Context, root string, item artifact) (Entry, error) {
	path := filepath.Join(root, filepath.FromSlash(item.entry.Path))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return Entry{}, fmt.Errorf("create artifact directory for %s: %w", item.entry.Path, err)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return Entry{}, fmt.Errorf("create artifact %s: %w", item.entry.Path, err)
	}
	digest := sha256.New()
	writeErr := item.write(ctx, io.MultiWriter(file, digest))
	closeErr := file.Close()
	if writeErr != nil {
		return Entry{}, fmt.Errorf("write artifact %s: %w", item.entry.Path, writeErr)
	}
	if closeErr != nil {
		return Entry{}, fmt.Errorf("close artifact %s: %w", item.entry.Path, closeErr)
	}
	info, err := os.Stat(path)
	if err != nil {
		return Entry{}, fmt.Errorf("stat artifact %s: %w", item.entry.Path, err)
	}
	entry := item.entry
	entry.SizeBytes = info.Size()
	entry.SHA256 = hex.EncodeToString(digest.Sum(nil))
	return entry, nil
}

func copyVerifiedFixture(ctx context.Context, w io.Writer, path, expectedSHA string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open fixture %s: %w", path, err)
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := copyWithContext(ctx, io.MultiWriter(w, digest), file); err != nil {
		return fmt.Errorf("copy fixture %s: %w", path, err)
	}
	if got := hex.EncodeToString(digest.Sum(nil)); got != expectedSHA {
		return fmt.Errorf("fixture %s sha256 = %s, want %s", path, got, expectedSHA)
	}
	return nil
}

func copyWithContext(ctx context.Context, dst io.Writer, src io.Reader) (int64, error) {
	buffer := make([]byte, 64<<10)
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			return written, err
		}
		n, readErr := src.Read(buffer)
		if n > 0 {
			m, writeErr := dst.Write(buffer[:n])
			written += int64(m)
			if writeErr != nil {
				return written, writeErr
			}
			if m != n {
				return written, io.ErrShortWrite
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return written, nil
			}
			return written, readErr
		}
	}
}

func writeDeterministicPayload(ctx context.Context, w io.Writer, size int64) error {
	block := make([]byte, 64<<10)
	for i := range block {
		block[i] = byte((i*131 + i/251 + 17) % 251)
	}
	for remaining := size; remaining > 0; {
		if err := ctx.Err(); err != nil {
			return err
		}
		chunk := int64(len(block))
		if remaining < chunk {
			chunk = remaining
		}
		if _, err := w.Write(block[:chunk]); err != nil {
			return err
		}
		remaining -= chunk
	}
	return nil
}

func patternedImage(width, height int, alpha bool) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		row := y * img.Stride
		for x := 0; x < width; x++ {
			i := row + x*4
			img.Pix[i] = byte((x*13 + y*3) & 0xff)
			img.Pix[i+1] = byte((x*5 + y*11) & 0xff)
			img.Pix[i+2] = byte((x*x + y*7) & 0xff)
			img.Pix[i+3] = 0xff
			if alpha {
				img.Pix[i+3] = byte(64 + ((x+y)*191)/(width+height))
			}
		}
	}
	return img
}

func encodePNG() func(io.Writer, image.Image) error {
	return func(w io.Writer, img image.Image) error {
		encoder := png.Encoder{CompressionLevel: png.BestSpeed}
		return encoder.Encode(w, img)
	}
}

func encodeJPEG(quality int) func(io.Writer, image.Image) error {
	return func(w io.Writer, img image.Image) error {
		return jpeg.Encode(w, img, &jpeg.Options{Quality: quality})
	}
}

func encodeWebP() func(io.Writer, image.Image) error {
	return func(w io.Writer, img image.Image) error {
		return nativewebp.Encode(w, img, nil)
	}
}

func encodeGIF(width, height, frames int) func(io.Writer, image.Image) error {
	return func(w io.Writer, _ image.Image) error {
		palette := color.Palette{
			color.NRGBA{R: 0x16, G: 0x1b, B: 0x2d, A: 0xff},
			color.NRGBA{R: 0xe8, G: 0x78, B: 0x3b, A: 0xff},
			color.NRGBA{R: 0xc7, G: 0xc5, B: 0xc2, A: 0xff},
			color.NRGBA{R: 0x71, G: 0x72, B: 0x77, A: 0xff},
		}
		animation := &gif.GIF{LoopCount: 0}
		for frame := 0; frame < frames; frame++ {
			img := image.NewPaletted(image.Rect(0, 0, width, height), palette)
			for y := 0; y < height; y++ {
				row := y * img.Stride
				for x := 0; x < width; x++ {
					img.Pix[row+x] = uint8(((x / 16) + (y / 12) + frame) % len(palette))
				}
			}
			animation.Image = append(animation.Image, img)
			animation.Delay = append(animation.Delay, 5)
			animation.Disposal = append(animation.Disposal, gif.DisposalNone)
		}
		return gif.EncodeAll(w, animation)
	}
}

func encodeOrientedJPEG() func(io.Writer, image.Image) error {
	return func(w io.Writer, img image.Image) error {
		var base bytes.Buffer
		if err := jpeg.Encode(&base, img, &jpeg.Options{Quality: 88}); err != nil {
			return err
		}
		encoded := base.Bytes()
		if len(encoded) < 2 || encoded[0] != 0xff || encoded[1] != 0xd8 {
			return errors.New("generated JPEG is missing SOI marker")
		}
		exif := orientationEXIF(6)
		if _, err := w.Write(encoded[:2]); err != nil {
			return err
		}
		if _, err := w.Write(exif); err != nil {
			return err
		}
		_, err := w.Write(encoded[2:])
		return err
	}
}

func orientationEXIF(orientation uint16) []byte {
	payload := []byte{
		'E', 'x', 'i', 'f', 0, 0,
		'M', 'M', 0, 42,
		0, 0, 0, 8,
		0, 1,
		0x01, 0x12,
		0, 3,
		0, 0, 0, 1,
		0, 0, 0, 0,
		0, 0, 0, 0,
	}
	binary.BigEndian.PutUint16(payload[24:26], orientation)
	segment := make([]byte, 4+len(payload))
	segment[0], segment[1] = 0xff, 0xe1
	binary.BigEndian.PutUint16(segment[2:4], uint16(len(payload)+2))
	copy(segment[4:], payload)
	return segment
}
