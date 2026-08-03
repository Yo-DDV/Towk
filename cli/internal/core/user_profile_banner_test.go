package core

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"io"
	"strings"
	"testing"
	"time"

	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/testutil"
	"hmans.de/chatto/internal/testutil/fakes3"
)

func profileBannerPNG(t *testing.T, width, height int, blue uint8) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: blue, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func profileBannerCore(t *testing.T, backend config.StorageBackend) *ChattoCore {
	t.Helper()
	_, nc := testutil.StartSharedNATS(t)
	cfg := config.CoreConfig{
		SecretKey: "profile-banner-test-secret",
		Assets: config.AssetsConfig{
			SigningSecret:  "profile-banner-signing-secret",
			StorageBackend: backend,
		},
	}
	if backend == config.StorageBackendS3 {
		useSSL := false
		pathStyle := true
		cfg.Assets.S3 = config.S3Config{
			Endpoint:        fakes3.NewServer(t).EndpointHost(),
			Bucket:          "profile-banner-tests",
			AccessKeyID:     "test-key",
			SecretAccessKey: "test-secret",
			UseSSL:          &useSSL,
			PathStyle:       &pathStyle,
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	instance, err := NewChattoCore(ctx, nc, cfg)
	if err != nil {
		t.Fatalf("NewChattoCore: %v", err)
	}
	startCoreServices(t, instance)
	return instance
}

func readProfileBannerBytes(t *testing.T, instance *ChattoCore, userID string) []byte {
	t.Helper()
	reader, _, err := instance.GetServerAssetFromAnyBackend(testContext(t), ProfileBannerAssetID(userID))
	if err != nil {
		t.Fatalf("read profile banner: %v", err)
	}
	if closer, ok := reader.(io.Closer); ok {
		defer closer.Close()
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func waitForProfileBannerMissing(t *testing.T, instance *ChattoCore, userID string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		reader, _, err := instance.GetServerAssetFromAnyBackend(testContext(t), ProfileBannerAssetID(userID))
		if err != nil {
			return
		}
		if closer, ok := reader.(io.Closer); ok {
			closer.Close()
		}
		if time.Now().After(deadline) {
			t.Fatal("profile banner remained in storage")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestProfileBannerAssetIDIsDeterministicAndStorageSafe(t *testing.T) {
	first := ProfileBannerAssetID("user/with spaces?and=query")
	second := ProfileBannerAssetID("user/with spaces?and=query")
	other := ProfileBannerAssetID("another-user")
	if first != second || first == other || !IsProfileBannerAssetID(first) {
		t.Fatalf("unexpected deterministic IDs: %q %q %q", first, second, other)
	}
	if strings.ContainsAny(first, "/ ?#") {
		t.Fatalf("asset ID contains path-unsafe characters: %q", first)
	}
}

func TestUserProfileBannerLifecycleAcrossStorageBackends(t *testing.T) {
	for _, backend := range []config.StorageBackend{config.StorageBackendNATS, config.StorageBackendS3} {
		t.Run(string(backend), func(t *testing.T) {
			instance := profileBannerCore(t, backend)
			ctx := testContext(t)
			user, err := instance.CreateUser(ctx, "", "banner-user-"+string(backend), "Banner User", "password123")
			if err != nil {
				t.Fatal(err)
			}

			first, err := instance.ReplaceUserProfileBannerFromUpload(ctx, user.Id, bytes.NewReader(profileBannerPNG(t, 900, 300, 80)))
			if err != nil {
				t.Fatal(err)
			}
			firstBytes := readProfileBannerBytes(t, instance, user.Id)

			second, err := instance.ReplaceUserProfileBannerFromUpload(ctx, user.Id, bytes.NewReader(profileBannerPNG(t, 1200, 400, 180)))
			if err != nil {
				t.Fatal(err)
			}
			if first.Id != second.Id || first.Id != ProfileBannerAssetID(user.Id) {
				t.Fatalf("replacement changed canonical ID: %q -> %q", first.Id, second.Id)
			}
			secondBytes := readProfileBannerBytes(t, instance, user.Id)
			if bytes.Equal(firstBytes, secondBytes) {
				t.Fatal("replacement did not change stored bytes")
			}

			if _, err := instance.ReplaceUserProfileBannerFromUpload(ctx, user.Id, strings.NewReader("not an image")); err == nil {
				t.Fatal("invalid replacement was accepted")
			}
			if got := readProfileBannerBytes(t, instance, user.Id); !bytes.Equal(got, secondBytes) {
				t.Fatal("invalid replacement changed the current banner")
			}

			if err := instance.DeleteUserProfileBanner(ctx, user.Id); err != nil {
				t.Fatal(err)
			}
			waitForProfileBannerMissing(t, instance, user.Id)

			if _, err := instance.ReplaceUserProfileBannerFromUpload(ctx, user.Id, bytes.NewReader(profileBannerPNG(t, 900, 300, 220))); err != nil {
				t.Fatal(err)
			}
			if err := instance.DeleteUser(ctx, SystemActorID, user.Id); err != nil {
				t.Fatal(err)
			}
			waitForProfileBannerMissing(t, instance, user.Id)
		})
	}
}
