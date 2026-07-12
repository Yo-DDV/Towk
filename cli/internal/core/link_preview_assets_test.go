package core

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"hmans.de/chatto/internal/config"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/testutil"
)

func TestLinkPreviewRateLimitIsDistributedAndHMACKeyed(t *testing.T) {
	_, nc := testutil.StartSharedNATS(t)
	cfg := config.CoreConfig{
		SecretKey: "link-preview-rate-limit-secret",
		Assets: config.AssetsConfig{
			SigningSecret: "link-preview-assets-secret",
			LinkPreviews: config.LinkPreviewAssetsConfig{
				FetchWindow:  config.Duration(time.Minute),
				FetchPerIP:   100,
				FetchPerUser: 3,
			},
		},
	}
	ctx := WithAuditRequestMetadata(testContext(t), &corev1.AuditRequestMetadata{IpHash: "preview-ip-fingerprint"})
	c1, err := NewChattoCore(ctx, nc, cfg)
	if err != nil {
		t.Fatalf("NewChattoCore c1: %v", err)
	}
	c2, err := NewChattoCore(ctx, nc, cfg)
	if err != nil {
		t.Fatalf("NewChattoCore c2: %v", err)
	}

	const attempts = 10
	start := make(chan struct{})
	results := make(chan error, attempts)
	var wg sync.WaitGroup
	for i := range attempts {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			selected := c1
			if index%2 == 1 {
				selected = c2
			}
			_, reserveErr := selected.ReserveLinkPreviewFetch(ctx, "preview-user@example.com")
			results <- reserveErr
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)

	var admitted, limited int
	for reserveErr := range results {
		switch {
		case reserveErr == nil:
			admitted++
		case errors.Is(reserveErr, ErrLinkPreviewRateLimitExceeded):
			limited++
		default:
			t.Fatalf("ReserveLinkPreviewFetch error = %v", reserveErr)
		}
	}
	if admitted != 3 || limited != attempts-3 {
		t.Fatalf("distributed attempts = admitted %d limited %d, want 3/%d", admitted, limited, attempts-3)
	}

	hash := c1.runtimeTokenHash("link_preview_rate_limit.user", "preview-user@example.com")
	key := linkPreviewRateLimitKeyPrefix + "user." + hash
	if strings.Contains(key, "preview-user") || strings.Contains(key, "example") {
		t.Fatalf("link preview rate-limit key exposes actor: %q", key)
	}
	assertRuntimeKVHasTTL(t, c1, key)
}

func TestLinkPreviewAssetLifecycleCleansUnclaimedObject(t *testing.T) {
	ctx := testContext(t)
	core, _ := setupTestCore(t)
	asset, err := core.storeLinkPreviewImage(ctx, "LPpending", []byte("preview"), "image/webp")
	if err != nil {
		t.Fatalf("storeLinkPreviewImage: %v", err)
	}
	if asset.GetNats().GetKey() != "LPpending" {
		t.Fatalf("stored key = %q", asset.GetNats().GetKey())
	}
	record, _, err := core.readLinkPreviewAsset(ctx, "LPpending")
	if err != nil || record.Status != linkPreviewAssetPending {
		t.Fatalf("pending record = %+v, err %v", record, err)
	}

	if err := core.cleanupExpiredLinkPreviewAssets(ctx, time.Now().Add(26*time.Hour)); err != nil {
		t.Fatalf("cleanupExpiredLinkPreviewAssets: %v", err)
	}
	if _, err := core.storage.linkPreviewAssets.GetInfo(ctx, "LPpending"); !errors.Is(err, jetstream.ErrObjectNotFound) {
		t.Fatalf("expired object error = %v, want ErrObjectNotFound", err)
	}
	if _, err := core.storage.serverAssets.GetInfo(ctx, "LPpending"); !errors.Is(err, jetstream.ErrObjectNotFound) {
		t.Fatalf("expired compatibility link error = %v, want ErrObjectNotFound", err)
	}
	if _, _, err := core.readLinkPreviewAsset(ctx, "LPpending"); !isRuntimeStateKeyAbsent(err) {
		t.Fatalf("expired lifecycle record error = %v, want absent", err)
	}
}

func TestLinkPreviewCompatibilityLinkRefusesLegacyObjectCollision(t *testing.T) {
	ctx := testContext(t)
	core, _ := setupTestCore(t)
	const assetID = "LPcollision"
	if _, err := core.storage.serverAssets.PutBytes(ctx, assetID, []byte("legacy")); err != nil {
		t.Fatalf("store legacy object: %v", err)
	}

	if _, err := core.storeLinkPreviewImage(ctx, assetID, []byte("new-preview"), "image/webp"); err == nil {
		t.Fatal("storeLinkPreviewImage unexpectedly replaced a legacy SERVER_ASSETS object")
	}
	legacyBytes, err := core.storage.serverAssets.GetBytes(ctx, assetID)
	if err != nil || string(legacyBytes) != "legacy" {
		t.Fatalf("legacy object bytes = %q, err %v", legacyBytes, err)
	}
	if _, err := core.storage.linkPreviewAssets.GetInfo(ctx, assetID); !errors.Is(err, jetstream.ErrObjectNotFound) {
		t.Fatalf("rolled-back preview object error = %v, want ErrObjectNotFound", err)
	}
	if _, _, err := core.readLinkPreviewAsset(ctx, assetID); !isRuntimeStateKeyAbsent(err) {
		t.Fatalf("rolled-back lifecycle error = %v, want absent", err)
	}
}

func TestLinkPreviewAssetLifecycleRepairsClaimAndCollectsAfterEdit(t *testing.T) {
	ctx := testContext(t)
	core, _ := setupTestCore(t)
	asset, err := core.storeLinkPreviewImage(ctx, "LPlive", []byte("preview"), "image/webp")
	if err != nil {
		t.Fatalf("storeLinkPreviewImage: %v", err)
	}

	room, err := core.CreateRoom(ctx, SystemActorID, KindChannel, "", "preview-lifecycle", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	user, err := core.CreateUser(ctx, SystemActorID, "preview-lifecycle", "Preview lifecycle", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := core.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}
	imageAssetID := asset.GetId()
	preview := &corev1.LinkPreview{
		Url:          "https://example.com/article",
		Title:        "Example",
		ImageAssetId: &imageAssetID,
		ImageAsset:   asset,
	}
	event, err := core.PostMessage(ctx, KindChannel, room.Id, user.Id, "preview", nil, "", "", preview, false)
	if err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	record, revision, err := core.readLinkPreviewAsset(ctx, asset.GetId())
	if err != nil || record.Status != linkPreviewAssetClaimed {
		t.Fatalf("claimed record = %+v, err %v", record, err)
	}

	// Simulate the narrow crash window after EVT append but before claim
	// finalization. Cleanup must consult the projected body and repair it.
	record.Status = linkPreviewAssetClaiming
	record.ClaimEventID = event.GetId()
	record.ClaimStartedAt = time.Now().Add(-2 * time.Minute)
	if err := core.updateLinkPreviewAsset(ctx, record, revision); err != nil {
		t.Fatalf("simulate unfinished claim: %v", err)
	}
	if err := core.cleanupExpiredLinkPreviewAssets(ctx, time.Now().Add(26*time.Hour)); err != nil {
		t.Fatalf("repair cleanup: %v", err)
	}
	repaired, _, err := core.readLinkPreviewAsset(ctx, asset.GetId())
	if err != nil || repaired.Status != linkPreviewAssetClaimed {
		t.Fatalf("repaired record = %+v, err %v", repaired, err)
	}
	if _, err := core.storage.linkPreviewAssets.GetInfo(ctx, asset.GetId()); err != nil {
		t.Fatalf("live preview object removed: %v", err)
	}
	for _, status := range []linkPreviewAssetStatus{linkPreviewAssetPending, linkPreviewAssetDeleting} {
		record, revision, err = core.readLinkPreviewAsset(ctx, asset.GetId())
		if err != nil {
			t.Fatalf("read record before %s repair: %v", status, err)
		}
		record.Status = status
		if err := core.updateLinkPreviewAsset(ctx, record, revision); err != nil {
			t.Fatalf("set referenced record to %s: %v", status, err)
		}
		if err := core.cleanupExpiredLinkPreviewAssets(ctx, time.Now().Add(26*time.Hour)); err != nil {
			t.Fatalf("repair referenced %s record: %v", status, err)
		}
		repaired, _, err = core.readLinkPreviewAsset(ctx, asset.GetId())
		if err != nil || repaired.Status != linkPreviewAssetClaimed {
			t.Fatalf("referenced %s repair = %+v, err %v", status, repaired, err)
		}
	}
	if err := core.storage.runtimeStateKV.Delete(ctx, linkPreviewAssetKey(asset.GetId())); err != nil {
		t.Fatalf("delete lifecycle to simulate inter-stream restore window: %v", err)
	}
	if err := core.storage.serverAssets.Delete(ctx, asset.GetId()); err != nil {
		t.Fatalf("delete compatibility link to simulate inter-store restore window: %v", err)
	}
	if err := core.cleanupExpiredLinkPreviewAssets(ctx, time.Now().Add(26*time.Hour)); err != nil {
		t.Fatalf("repair missing referenced lifecycle: %v", err)
	}
	repaired, _, err = core.readLinkPreviewAsset(ctx, asset.GetId())
	if err != nil || repaired.Status != linkPreviewAssetClaimed {
		t.Fatalf("missing referenced lifecycle repair = %+v, err %v", repaired, err)
	}
	legacyBytes, err := core.storage.serverAssets.GetBytes(ctx, asset.GetId())
	if err != nil || string(legacyBytes) != "preview" {
		t.Fatalf("repaired compatibility link bytes = %q, err %v", legacyBytes, err)
	}

	if err := core.DeleteLinkPreviewFromMessage(ctx, user.Id, KindChannel, room.Id, event.GetId(), preview.GetUrl()); err != nil {
		t.Fatalf("DeleteLinkPreviewFromMessage: %v", err)
	}
	if err := core.cleanupExpiredLinkPreviewAssets(ctx, time.Now().Add(26*time.Hour)); err != nil {
		t.Fatalf("post-edit cleanup: %v", err)
	}
	if _, err := core.storage.linkPreviewAssets.GetInfo(ctx, asset.GetId()); !errors.Is(err, jetstream.ErrObjectNotFound) {
		t.Fatalf("unreferenced object error = %v, want ErrObjectNotFound", err)
	}
	if _, err := core.storage.serverAssets.GetInfo(ctx, asset.GetId()); !errors.Is(err, jetstream.ErrObjectNotFound) {
		t.Fatalf("unreferenced compatibility link error = %v, want ErrObjectNotFound", err)
	}
}

func TestFailedMessageAppendOnlyAbortsUncommittedPreviewClaim(t *testing.T) {
	ctx := testContext(t)
	core, _ := setupTestCore(t)

	for _, tt := range []struct {
		assetID   string
		eventID   string
		sequence  uint64
		wantState linkPreviewAssetStatus
	}{
		{assetID: "LPcommitted", eventID: "Ecommitted", sequence: 42, wantState: linkPreviewAssetClaiming},
		{assetID: "LPuncommitted", eventID: "Euncommitted", sequence: 0, wantState: linkPreviewAssetPending},
	} {
		if _, err := core.storeLinkPreviewImage(ctx, tt.assetID, []byte("preview"), "image/webp"); err != nil {
			t.Fatalf("store %s: %v", tt.assetID, err)
		}
		managed, err := core.beginLinkPreviewAssetClaim(ctx, tt.assetID, tt.eventID)
		if err != nil || !managed {
			t.Fatalf("begin claim %s = managed %v err %v", tt.assetID, managed, err)
		}
		if err := core.handleFailedLinkPreviewAppend(ctx, tt.assetID, tt.eventID, tt.sequence); err != nil {
			t.Fatalf("handle failed append %s: %v", tt.assetID, err)
		}
		record, _, err := core.readLinkPreviewAsset(ctx, tt.assetID)
		if err != nil || record.Status != tt.wantState {
			t.Fatalf("claim state for sequence %d = %q err %v, want %q", tt.sequence, record.Status, err, tt.wantState)
		}
	}
}

func TestBusyLinkPreviewImageClaimRetainsTextMetadata(t *testing.T) {
	ctx := testContext(t)
	core, _ := setupTestCore(t)
	asset, err := core.storeLinkPreviewImage(ctx, "LPbusy", []byte("preview"), "image/webp")
	if err != nil {
		t.Fatalf("storeLinkPreviewImage: %v", err)
	}
	record, revision, err := core.readLinkPreviewAsset(ctx, asset.GetId())
	if err != nil {
		t.Fatalf("read lifecycle: %v", err)
	}
	record.Status = linkPreviewAssetDeleting
	if err := core.updateLinkPreviewAsset(ctx, record, revision); err != nil {
		t.Fatalf("mark deleting: %v", err)
	}

	room, err := core.CreateRoom(ctx, SystemActorID, KindChannel, "", "preview-busy", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	user, err := core.CreateUser(ctx, SystemActorID, "preview-busy", "Preview busy", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := core.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}
	assetID := asset.GetId()
	event, err := core.PostMessage(ctx, KindChannel, room.Id, user.Id, "preview", nil, "", "", &corev1.LinkPreview{
		Url:          "https://example.com/busy",
		Title:        "Text metadata survives",
		ImageAssetId: &assetID,
		ImageAsset:   asset,
	}, false)
	if err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	body, err := core.GetFullMessageBodyByEventID(ctx, event.GetId())
	if err != nil {
		t.Fatalf("GetFullMessageBodyByEventID: %v", err)
	}
	if body.LinkPreview.GetTitle() != "Text metadata survives" {
		t.Fatalf("link preview metadata = %+v", body.LinkPreview)
	}
	if body.LinkPreview.GetImageAssetId() != "" || body.LinkPreview.GetImageAsset() != nil {
		t.Fatalf("busy preview retained image reference: %+v", body.LinkPreview)
	}
}

func TestLinkPreviewObjectStoreHasHardQuota(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	ctx := testContext(t)
	const maxStoreBytes = 64 * 1024
	core, err := NewChattoCore(ctx, nc, config.CoreConfig{
		SecretKey: "link-preview-quota-secret",
		Assets: config.AssetsConfig{
			SigningSecret: "link-preview-quota-assets-secret",
			LinkPreviews: config.LinkPreviewAssetsConfig{
				MaxStoreBytes: maxStoreBytes,
			},
		},
	})
	if err != nil {
		t.Fatalf("NewChattoCore: %v", err)
	}
	stream, err := core.js.Stream(ctx, "OBJ_LINK_PREVIEW_ASSETS")
	if err != nil {
		t.Fatalf("LINK_PREVIEW_ASSETS stream: %v", err)
	}
	info, err := stream.Info(ctx)
	if err != nil {
		t.Fatalf("LINK_PREVIEW_ASSETS stream info: %v", err)
	}
	want := core.config.Assets.LinkPreviews.MaxStoreBytesOrDefault()
	if info.Config.MaxBytes != want {
		t.Fatalf("LINK_PREVIEW_ASSETS max bytes = %d, want %d", info.Config.MaxBytes, want)
	}

	quotaReached := false
	payload := make([]byte, 1024)
	for i := 0; i < 256; i++ {
		if _, err := core.storage.linkPreviewAssets.PutBytes(ctx, fmt.Sprintf("quota-%03d", i), payload); err != nil {
			quotaReached = true
			break
		}
	}
	if !quotaReached {
		t.Fatal("LINK_PREVIEW_ASSETS accepted objects beyond its configured hard quota")
	}
}

func TestLinkPreviewRestartPreservesCommittedClaimAfterProjectionWaitFailure(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	cfg := config.CoreConfig{
		SecretKey: "link-preview-restart-secret",
		Assets: config.AssetsConfig{
			SigningSecret: "link-preview-restart-assets-secret",
		},
	}
	start := func(core *ChattoCore) func() {
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() { done <- core.Run(ctx) }()
		bootCtx, bootCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer bootCancel()
		if err := core.WaitForBoot(bootCtx); err != nil {
			cancel()
			t.Fatalf("WaitForBoot: %v", err)
		}
		return func() {
			cancel()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("core.Run did not stop")
			}
		}
	}

	ctx := testContext(t)
	first, err := NewChattoCore(ctx, nc, cfg)
	if err != nil {
		t.Fatalf("first core: %v", err)
	}
	stopFirst := start(first)
	asset, err := first.storeLinkPreviewImage(ctx, "LPrestart", []byte("preview"), "image/webp")
	if err != nil {
		stopFirst()
		t.Fatalf("storeLinkPreviewImage: %v", err)
	}
	room, err := first.CreateRoom(ctx, SystemActorID, KindChannel, "", "preview-restart", "")
	if err != nil {
		stopFirst()
		t.Fatalf("CreateRoom: %v", err)
	}
	user, err := first.CreateUser(ctx, SystemActorID, "preview-restart", "Preview restart", "password123")
	if err != nil {
		stopFirst()
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := first.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		stopFirst()
		t.Fatalf("JoinRoom: %v", err)
	}
	assetID := asset.GetId()
	preview := &corev1.LinkPreview{
		Url:          "https://example.com/restart",
		ImageAssetId: &assetID,
		ImageAsset:   asset,
	}
	if _, err := first.storeLinkPreviewImage(ctx, "LPstale-restart", []byte("stale"), "image/webp"); err != nil {
		stopFirst()
		t.Fatalf("store stale link preview: %v", err)
	}
	stopFirst()

	// The in-memory room projection is still readable, but its projector is
	// stopped. The EVT append succeeds and the projection wait times out,
	// reproducing the durable-sequence error path in PostMessage.
	postCtx, cancelPost := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancelPost()
	if _, err := first.PostMessage(postCtx, KindChannel, room.Id, user.Id, "preview", nil, "", "", preview, false); err == nil {
		t.Fatal("PostMessage unexpectedly succeeded with stopped projection")
	}
	claim, _, err := first.readLinkPreviewAsset(ctx, assetID)
	if err != nil || claim.Status != linkPreviewAssetClaiming || claim.ClaimEventID == "" {
		t.Fatalf("durably appended claim = %+v, err %v; want claiming with event ID", claim, err)
	}

	secondCfg := cfg
	// A deliberately tiny test-only TTL makes both objects eligible as soon
	// as the restarted cleanup runner acquires its lease.
	secondCfg.Assets.LinkPreviews.PendingTTL = config.Duration(time.Nanosecond)
	second, err := NewChattoCore(ctx, nc, secondCfg)
	if err != nil {
		t.Fatalf("second core: %v", err)
	}
	second.assetModel.cleanupPollEvery = 10 * time.Millisecond
	stopSecond := start(second)
	defer stopSecond()
	deadline := time.Now().Add(5 * time.Second)
	for {
		_, staleErr := second.storage.linkPreviewAssets.GetInfo(ctx, "LPstale-restart")
		if errors.Is(staleErr, jetstream.ErrObjectNotFound) {
			break
		}
		if staleErr != nil {
			t.Fatalf("inspect stale preview after restart: %v", staleErr)
		}
		if time.Now().After(deadline) {
			t.Fatal("restart cleanup did not process the stale unclaimed preview")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := second.storage.linkPreviewAssets.GetInfo(ctx, assetID); err != nil {
		t.Fatalf("restart cleanup removed a referenced preview: %v", err)
	}
	repaired, _, err := second.readLinkPreviewAsset(ctx, assetID)
	if err != nil || repaired.Status != linkPreviewAssetClaimed {
		t.Fatalf("restart did not repair committed claim = %+v, err %v", repaired, err)
	}
}
