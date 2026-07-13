package core

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"testing"

	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/testutil"
)

func TestServerAssetsObjectStoreHasHardQuota(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	ctx := testContext(t)
	const maxStoreBytes = 64 * 1024
	core, err := NewChattoCore(ctx, nc, config.CoreConfig{
		SecretKey: "server-assets-quota-secret",
		Assets: config.AssetsConfig{
			SigningSecret: "server-assets-quota-signing-secret",
			MaxStoreBytes: maxStoreBytes,
		},
	})
	if err != nil {
		t.Fatalf("NewChattoCore: %v", err)
	}
	stream, err := core.js.Stream(ctx, "OBJ_SERVER_ASSETS")
	if err != nil {
		t.Fatalf("SERVER_ASSETS stream: %v", err)
	}
	info, err := stream.Info(ctx)
	if err != nil {
		t.Fatalf("SERVER_ASSETS stream info: %v", err)
	}
	want := core.config.Assets.MaxStoreBytesOrDefault()
	if info.Config.MaxBytes != want {
		t.Fatalf("SERVER_ASSETS max bytes = %d, want %d", info.Config.MaxBytes, want)
	}

	quotaReached := false
	// SERVER_ASSETS uses S2 compression. High-entropy bytes ensure the test
	// exercises the configured byte ceiling rather than compression ratio.
	payload := make([]byte, 1024)
	if _, err := rand.Read(payload); err != nil {
		t.Fatalf("random quota payload: %v", err)
	}
	for i := 0; i < 256; i++ {
		if _, err := core.storage.serverAssets.PutBytes(ctx, fmt.Sprintf("quota-%03d", i), payload); err != nil {
			quotaReached = true
			break
		}
	}
	if !quotaReached {
		t.Fatal("SERVER_ASSETS accepted objects beyond its configured hard quota")
	}
}

func TestServerAssetsQuotaCanBeLoweredWithoutDeletingExistingObjects(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	ctx := testContext(t)
	payload := make([]byte, 128*1024)
	if _, err := rand.Read(payload); err != nil {
		t.Fatalf("random existing payload: %v", err)
	}

	initial, err := NewChattoCore(ctx, nc, config.CoreConfig{
		SecretKey: "server-assets-quota-lowering-secret",
		Assets: config.AssetsConfig{
			SigningSecret: "server-assets-quota-lowering-signing-secret",
			MaxStoreBytes: 1024 * 1024,
		},
	})
	if err != nil {
		t.Fatalf("create initial core: %v", err)
	}
	if _, err := initial.storage.serverAssets.PutBytes(ctx, "existing", payload); err != nil {
		t.Fatalf("store existing object: %v", err)
	}

	lowered, err := NewChattoCore(ctx, nc, config.CoreConfig{
		SecretKey: "server-assets-quota-lowering-secret",
		Assets: config.AssetsConfig{
			SigningSecret: "server-assets-quota-lowering-signing-secret",
			MaxStoreBytes: 64 * 1024,
		},
	})
	if err != nil {
		t.Fatalf("lower existing SERVER_ASSETS quota: %v", err)
	}
	got, err := lowered.storage.serverAssets.GetBytes(ctx, "existing")
	if err != nil {
		t.Fatalf("read object after lowering quota: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatal("existing object changed after lowering SERVER_ASSETS quota")
	}
	if _, err := lowered.storage.serverAssets.PutBytes(ctx, "blocked", payload[:1024]); err == nil {
		t.Fatal("SERVER_ASSETS accepted a new object while existing usage exceeded the lowered quota")
	}
}
