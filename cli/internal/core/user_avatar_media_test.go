package core

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"io"
	"strings"
	"sync"
	"testing"

	"hmans.de/chatto/internal/assets"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestReplaceUserAvatarFromUploadStoresAnimatedWebPAndUsesCanonicalDisplayURL(t *testing.T) {
	c, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := c.CreateUser(ctx, SystemActorID, "animated-avatar", "Animated Avatar", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	staticAsset, err := c.ReplaceUserAvatarFromUpload(ctx, user.GetId(), bytes.NewReader(testAvatarPNG(t, 96, 64)))
	if err != nil {
		t.Fatalf("store static avatar: %v", err)
	}
	if staticAsset.GetFilename() != assets.StaticAvatarFilename {
		t.Fatalf("static filename = %q, want %q", staticAsset.GetFilename(), assets.StaticAvatarFilename)
	}
	width, height := 32, 32
	staticURL, err := c.GetUserAvatarDisplayURL(ctx, user.GetId(), &width, &height, "cover")
	if err != nil {
		t.Fatalf("static display URL: %v", err)
	}
	if !strings.Contains(staticURL, "/t/") {
		t.Fatalf("static display URL = %q, want transformed URL", staticURL)
	}

	animatedAsset, err := c.ReplaceUserAvatarFromUpload(ctx, user.GetId(), bytes.NewReader(testAnimatedAvatarGIF(t, 64, 64, 3)))
	if err != nil {
		t.Fatalf("store animated avatar: %v", err)
	}
	if animatedAsset.GetFilename() != assets.AnimatedAvatarFilename {
		t.Fatalf("animated filename = %q, want %q", animatedAsset.GetFilename(), assets.AnimatedAvatarFilename)
	}
	if animatedAsset.GetContentType() != "image/webp" {
		t.Fatalf("animated content type = %q, want image/webp", animatedAsset.GetContentType())
	}
	if animatedAsset.GetSize() <= 0 || animatedAsset.GetSize() > assets.MaxAvatarProcessedSize {
		t.Fatalf("animated stored size = %d", animatedAsset.GetSize())
	}

	rawURL, err := c.GetUserAvatarURL(ctx, user.GetId(), nil, nil, "")
	if err != nil {
		t.Fatalf("raw animated URL: %v", err)
	}
	displayURL, err := c.GetUserAvatarDisplayURL(ctx, user.GetId(), &width, &height, "cover")
	if err != nil {
		t.Fatalf("animated display URL: %v", err)
	}
	if displayURL != rawURL || strings.Contains(displayURL, "/t/") {
		t.Fatalf("animated display URL = %q, raw = %q", displayURL, rawURL)
	}

	reader, info, err := c.GetServerAssetFromAnyBackend(ctx, animatedAsset.GetId())
	if err != nil {
		t.Fatalf("read animated asset: %v", err)
	}
	if closer, ok := reader.(io.Closer); ok {
		defer closer.Close()
	}
	stored, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read animated bytes: %v", err)
	}
	if info.ContentType != "image/webp" {
		t.Fatalf("stored content type = %q, want image/webp", info.ContentType)
	}
	if len(stored) < 12 || string(stored[:4]) != "RIFF" || string(stored[8:12]) != "WEBP" || !bytes.Contains(stored, []byte("ANIM")) {
		t.Fatal("stored animated avatar is not animated WebP")
	}

	if _, _, err := c.GetServerAssetFromAnyBackend(ctx, staticAsset.GetId()); err == nil {
		t.Fatal("replaced static avatar binary is still present")
	}
}

func TestReplaceUserAvatarFromUploadRejectsInvalidReplacementWithoutChangingAvatar(t *testing.T) {
	c, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := c.CreateUser(ctx, SystemActorID, "avatar-rollback", "Avatar Rollback", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	initial, err := c.ReplaceUserAvatarFromUpload(ctx, user.GetId(), bytes.NewReader(testAvatarPNG(t, 32, 32)))
	if err != nil {
		t.Fatalf("store initial avatar: %v", err)
	}

	_, err = c.ReplaceUserAvatarFromUpload(ctx, user.GetId(), strings.NewReader("not an image"))
	if !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("invalid replacement error = %v, want ErrInvalidArgument", err)
	}
	current, err := c.GetUserAvatar(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserAvatar: %v", err)
	}
	if current == nil || current.GetId() != initial.GetId() {
		t.Fatalf("current avatar = %v, want initial %q", current, initial.GetId())
	}
	reader, _, err := c.GetServerAssetFromAnyBackend(ctx, initial.GetId())
	if err != nil {
		t.Fatalf("initial avatar removed after rejected replacement: %v", err)
	}
	if closer, ok := reader.(io.Closer); ok {
		closer.Close()
	}
}

func TestReplaceUserAvatarFromUploadConcurrentReplacementsDeleteSupersededAssets(t *testing.T) {
	c, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := c.CreateUser(ctx, SystemActorID, "avatar-concurrent", "Avatar Concurrent", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	initial, err := c.ReplaceUserAvatarFromUpload(ctx, user.GetId(), bytes.NewReader(testAvatarPNG(t, 32, 32)))
	if err != nil {
		t.Fatalf("store initial avatar: %v", err)
	}

	ready := make(chan struct{}, 2)
	release := make(chan struct{})
	type replacementResult struct {
		asset *corev1.AssetRecord
		err   error
	}
	results := make(chan replacementResult, 2)
	for _, size := range []int{48, 64} {
		data := testAvatarPNG(t, size, size)
		go func() {
			asset, replaceErr := c.ReplaceUserAvatarFromUpload(ctx, user.GetId(), &avatarBarrierReader{
				Reader:  bytes.NewReader(data),
				ready:   ready,
				release: release,
			})
			results <- replacementResult{asset: asset, err: replaceErr}
		}()
	}
	<-ready
	<-ready
	close(release)

	replacements := make([]*corev1.AssetRecord, 0, 2)
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatalf("concurrent replacement: %v", result.err)
		}
		replacements = append(replacements, result.asset)
	}

	current, err := c.GetUserAvatar(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserAvatar: %v", err)
	}
	if current == nil {
		t.Fatal("current avatar is nil after concurrent replacements")
	}

	for _, superseded := range append([]*corev1.AssetRecord{initial}, replacements...) {
		if superseded.GetId() == current.GetId() {
			continue
		}
		if _, _, err := c.GetServerAssetFromAnyBackend(ctx, superseded.GetId()); err == nil {
			t.Fatalf("superseded avatar %q is still present", superseded.GetId())
		}
	}
	reader, _, err := c.GetServerAssetFromAnyBackend(ctx, current.GetId())
	if err != nil {
		t.Fatalf("current avatar %q is missing: %v", current.GetId(), err)
	}
	if closer, ok := reader.(io.Closer); ok {
		closer.Close()
	}
}

type avatarBarrierReader struct {
	io.Reader
	once    sync.Once
	ready   chan<- struct{}
	release <-chan struct{}
}

func (r *avatarBarrierReader) Read(p []byte) (int, error) {
	r.once.Do(func() {
		r.ready <- struct{}{}
		<-r.release
	})
	return r.Reader.Read(p)
}

func testAvatarPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 160, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode PNG: %v", err)
	}
	return buf.Bytes()
}

func testAnimatedAvatarGIF(t *testing.T, width, height, frames int) []byte {
	t.Helper()
	palette := color.Palette{
		color.RGBA{R: 220, A: 255},
		color.RGBA{G: 220, A: 255},
		color.RGBA{B: 220, A: 255},
	}
	animation := &gif.GIF{
		Image:     make([]*image.Paletted, frames),
		Delay:     make([]int, frames),
		LoopCount: 1,
	}
	for i := 0; i < frames; i++ {
		frame := image.NewPaletted(image.Rect(0, 0, width, height), palette)
		for pixel := range frame.Pix {
			frame.Pix[pixel] = uint8(i % len(palette))
		}
		animation.Image[i] = frame
		animation.Delay[i] = 8
	}
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, animation); err != nil {
		t.Fatalf("encode GIF: %v", err)
	}
	return buf.Bytes()
}
