package core

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/c2h5oh/datasize"
	"github.com/nats-io/nats.go/jetstream"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/testutil"
)

func TestAssetUploadChunkPolicyBalancesRTTAndRetryCost(t *testing.T) {
	if AssetUploadMaxChunkSize != 1024*1024 {
		t.Fatalf("maximum upload chunk size = %d, want 1 MiB", AssetUploadMaxChunkSize)
	}

	const ordinaryUploadSize = 25 * 1024 * 1024
	requestCount := (ordinaryUploadSize + AssetUploadMaxChunkSize - 1) / AssetUploadMaxChunkSize
	if requestCount != 25 {
		t.Fatalf("25 MiB upload request count = %d, want 25", requestCount)
	}
	if AssetUploadMaxChunkSize > 1024*1024 {
		t.Fatalf("single retry exposure = %d bytes, want at most 1 MiB", AssetUploadMaxChunkSize)
	}
}

func TestAssetUploadCapacityMathRejectsOverflow(t *testing.T) {
	if !exceedsInt64Limit(math.MaxInt64, math.MaxInt64, 1) {
		t.Fatal("capacity math accepted a sum above MaxInt64")
	}
	if exceedsInt64Limit(10, 3, 4, 3) {
		t.Fatal("capacity math rejected an exact fit")
	}
}

func TestAssetUploadReservationAccountsForStorageBackend(t *testing.T) {
	const size = int64(3 * 1024 * 1024)
	if got := initialAssetUploadReservationBytes(size, true); got != size {
		t.Fatalf("S3 reservation = %d, want one temporary copy", got)
	}
	if got := initialAssetUploadReservationBytes(size, false); got != 2*size {
		t.Fatalf("NATS reservation = %d, want temporary plus durable copies", got)
	}
	if got := initialAssetUploadReservationBytes(math.MaxInt64, false); got != math.MaxInt64 {
		t.Fatalf("overflowing NATS reservation = %d, want saturated MaxInt64", got)
	}
}

func TestAssetUploadCapacityReservationIsAtomicAndReleased(t *testing.T) {
	core := setupAssetUploadCapacityCore(t, 8*1024*1024)
	ctx := testContext(t)
	userID, roomID := setupAssetUploadCapacityRoom(t, core, ctx)
	const uploadSize = 3 * 1024 * 1024

	inputs := []AssetUploadCreateInput{
		assetUploadCreateInput(userID, roomID, "first.bin", uploadSize),
		assetUploadCreateInput(userID, roomID, "second.bin", uploadSize),
	}
	results := make(chan *AssetUploadSession, len(inputs))
	errs := make(chan error, len(inputs))
	var wg sync.WaitGroup
	for _, input := range inputs {
		input := input
		wg.Add(1)
		go func() {
			defer wg.Done()
			upload, err := core.AssetUploads().CreateUpload(ctx, input)
			results <- upload
			errs <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errs)

	var admitted *AssetUploadSession
	var admittedCount, rejectedCount int
	for upload := range results {
		if upload != nil {
			admitted = upload
			admittedCount++
		}
	}
	for err := range errs {
		switch {
		case err == nil:
		case err == ErrAssetStorageCapacity:
			rejectedCount++
		default:
			t.Fatalf("CreateUpload error = %v", err)
		}
	}
	if admittedCount != 1 || rejectedCount != 1 {
		t.Fatalf("admitted=%d rejected=%d, want 1/1", admittedCount, rejectedCount)
	}

	if _, err := core.AssetUploads().CancelUpload(ctx, AssetUploadCancelInput{ActorID: userID, UploadID: admitted.UploadID}); err != nil {
		t.Fatalf("CancelUpload: %v", err)
	}
	if _, err := core.AssetUploads().CreateUpload(ctx, assetUploadCreateInput(userID, roomID, "after-cancel.bin", uploadSize)); err != nil {
		t.Fatalf("CreateUpload after reservation release: %v", err)
	}
}

func TestAssetUploadReservationTracksCommittedChunks(t *testing.T) {
	core := setupAssetUploadCapacityCore(t, 8*1024*1024)
	ctx := testContext(t)
	userID, roomID := setupAssetUploadCapacityRoom(t, core, ctx)
	const uploadSize = 3 * 1024 * 1024

	upload, err := core.AssetUploads().CreateUpload(ctx, assetUploadCreateInput(userID, roomID, "progress.bin", uploadSize))
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	chunk := bytes.Repeat([]byte{0x5a}, AssetUploadMaxChunkSize)
	sum := sha256.Sum256(chunk)
	if _, err := core.AssetUploads().UploadChunk(ctx, AssetUploadChunkInput{
		ActorID:     userID,
		UploadID:    upload.UploadID,
		Content:     chunk,
		ChunkSHA256: hex.EncodeToString(sum[:]),
	}); err != nil {
		t.Fatalf("UploadChunk: %v", err)
	}

	ledger, err := core.AssetUploads().loadCapacityReservations(ctx)
	if err != nil {
		t.Fatalf("loadCapacityReservations: %v", err)
	}
	reservation, ok := ledger.Reservations[upload.UploadID]
	if !ok {
		t.Fatalf("reservation for %q missing", upload.UploadID)
	}
	want := int64(2*uploadSize - AssetUploadMaxChunkSize)
	if reservation.RemainingBytes != want {
		t.Fatalf("remaining reservation = %d, want %d", reservation.RemainingBytes, want)
	}
}

func TestAssetUploadExpiredCleanupReleasesCapacity(t *testing.T) {
	core := setupAssetUploadCapacityCore(t, 8*1024*1024)
	ctx := testContext(t)
	userID, roomID := setupAssetUploadCapacityRoom(t, core, ctx)
	const uploadSize = 3 * 1024 * 1024

	upload, err := core.AssetUploads().CreateUpload(ctx, assetUploadCreateInput(userID, roomID, "expired.bin", uploadSize))
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	session, revision, err := core.AssetUploads().loadUpload(ctx, upload.UploadID)
	if err != nil {
		t.Fatalf("loadUpload: %v", err)
	}
	session.ExpiresAt = time.Now().Add(-time.Minute)
	if err := core.AssetUploads().updateUpload(ctx, session, revision); err != nil {
		t.Fatalf("expire upload session: %v", err)
	}
	if err := core.AssetUploads().CleanupExpired(ctx); err != nil {
		t.Fatalf("CleanupExpired: %v", err)
	}
	if _, err := core.AssetUploads().CreateUpload(ctx, assetUploadCreateInput(userID, roomID, "after-expiry.bin", uploadSize)); err != nil {
		t.Fatalf("CreateUpload after expired reservation cleanup: %v", err)
	}
}

func TestAssetUploadCompletionReleasesCapacity(t *testing.T) {
	core := setupAssetUploadCapacityCore(t, 8*1024*1024)
	ctx := testContext(t)
	userID, roomID := setupAssetUploadCapacityRoom(t, core, ctx)
	const uploadSize = 2 * 1024 * 1024

	upload, err := core.AssetUploads().CreateUpload(ctx, assetUploadCreateInput(userID, roomID, "complete.bin", uploadSize))
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	chunk := make([]byte, AssetUploadMaxChunkSize)
	sum := sha256.Sum256(chunk)
	for offset := int64(0); offset < uploadSize; offset += int64(len(chunk)) {
		if _, err := core.AssetUploads().UploadChunk(ctx, AssetUploadChunkInput{
			ActorID:     userID,
			UploadID:    upload.UploadID,
			Offset:      offset,
			Content:     chunk,
			ChunkSHA256: hex.EncodeToString(sum[:]),
		}); err != nil {
			t.Fatalf("UploadChunk at %d: %v", offset, err)
		}
	}
	if _, attachment, err := core.AssetUploads().CompleteUpload(ctx, AssetUploadCompleteInput{ActorID: userID, UploadID: upload.UploadID}); err != nil {
		t.Fatalf("CompleteUpload: %v", err)
	} else if attachment == nil || attachment.GetId() == "" {
		t.Fatal("CompleteUpload returned no attachment")
	}
	ledger, err := core.AssetUploads().loadCapacityReservations(ctx)
	if err != nil {
		t.Fatalf("loadCapacityReservations: %v", err)
	}
	if _, ok := ledger.Reservations[upload.UploadID]; ok {
		t.Fatalf("completed upload %q still reserves capacity", upload.UploadID)
	}
}

func TestAssetUploadAuthorizationPrecedesCapacityDisclosure(t *testing.T) {
	core := setupAssetUploadCapacityCore(t, 8*1024*1024)
	ctx := testContext(t)
	_, roomID := setupAssetUploadCapacityRoom(t, core, ctx)
	outsider, err := core.CreateUser(ctx, SystemActorID, "capacity-outsider", "Capacity Outsider", "password")
	if err != nil {
		t.Fatalf("CreateUser outsider: %v", err)
	}
	_, err = core.AssetUploads().CreateUpload(ctx, assetUploadCreateInput(outsider.Id, roomID, "too-large.bin", 4*1024*1024))
	if !errors.Is(err, ErrNotRoomMember) && !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("unauthorized capacity probe error = %v, want membership or permission denial", err)
	}
}

func setupAssetUploadCapacityCore(t *testing.T, maxStoreBytes int64) *ChattoCore {
	t.Helper()
	_, nc := testutil.StartNATS(t)
	ctx := testContext(t)
	core, err := NewChattoCore(ctx, nc, config.CoreConfig{
		SecretKey: "asset-upload-capacity-secret",
		Assets: config.AssetsConfig{
			SigningSecret: "asset-upload-capacity-signing-secret",
			MaxStoreBytes: datasize.ByteSize(maxStoreBytes),
		},
	})
	if err != nil {
		t.Fatalf("NewChattoCore: %v", err)
	}
	startCoreServices(t, core)
	return core
}

func setupAssetUploadCapacityRoom(t *testing.T, core *ChattoCore, ctx context.Context) (string, string) {
	t.Helper()
	user, err := core.CreateUser(ctx, SystemActorID, "capacity-user", "Capacity User", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := core.CreateRoom(ctx, user.Id, KindChannel, "", "capacity-room", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}
	return user.Id, room.Id
}

func assetUploadCreateInput(actorID, roomID, filename string, size int64) AssetUploadCreateInput {
	sum := sha256.Sum256(make([]byte, size))
	return AssetUploadCreateInput{
		ActorID:     actorID,
		RoomID:      roomID,
		Filename:    filename,
		ContentType: "application/octet-stream",
		Size:        size,
		SHA256:      hex.EncodeToString(sum[:]),
	}
}

func TestAssetUploadCleanupDeletesExpiredUnclaimedPendingAsset(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	user, err := core.CreateUser(ctx, SystemActorID, "expired-pending-asset", "Expired Pending Asset", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := core.CreateRoom(ctx, user.Id, KindChannel, "", "expired-pending-assets", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}

	content := []byte("pending asset content")
	attachment, err := core.uploadAttachmentBinary(ctx, room.Id, "pending.txt", "text/plain", bytes.NewReader(content))
	if err != nil {
		t.Fatalf("uploadAttachmentBinary: %v", err)
	}
	sum := sha256.Sum256(content)
	if err := core.assetLifecycle().RecordUploadedPendingAttachmentAsset(ctx, user.Id, room.Id, attachment, hex.EncodeToString(sum[:]), time.Now().Add(-time.Minute), false); err != nil {
		t.Fatalf("RecordUploadedPendingAttachmentAsset: %v", err)
	}

	if _, err := core.PostMessage(ctx, KindChannel, room.Id, user.Id, "", []string{attachment.Id}, "", "", nil, false); err == nil {
		t.Fatal("PostMessage with expired pending asset succeeded")
	}
	if err := core.AssetUploads().CleanupExpired(ctx); err != nil {
		t.Fatalf("CleanupExpired: %v", err)
	}
	if _, ok := core.Assets.AssetCreation(attachment.Id); ok {
		t.Fatal("expired pending asset still projected after cleanup")
	}
	if _, _, err := core.GetAttachmentReader(ctx, attachment); err == nil {
		t.Fatal("expired pending attachment binary still readable after cleanup")
	}
}

func TestAssetUploadStaleChunkUpdateDoesNotDeleteCommittedChunk(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	user, err := core.CreateUser(ctx, SystemActorID, "stale-upload-chunk", "Stale Upload Chunk", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := core.CreateRoom(ctx, user.Id, KindChannel, "", "stale-upload-chunks", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}

	content := []byte("chunk content")
	sum := sha256.Sum256(content)
	upload, err := core.AssetUploads().CreateUpload(ctx, AssetUploadCreateInput{
		ActorID:     user.Id,
		RoomID:      room.Id,
		Filename:    "chunk.txt",
		ContentType: "text/plain",
		Size:        int64(len(content)),
		SHA256:      hex.EncodeToString(sum[:]),
	})
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	staleSession, staleRevision, err := core.AssetUploads().loadUpload(ctx, upload.UploadID)
	if err != nil {
		t.Fatalf("loadUpload: %v", err)
	}

	committed, err := core.AssetUploads().UploadChunk(ctx, AssetUploadChunkInput{
		ActorID:     user.Id,
		UploadID:    upload.UploadID,
		Offset:      0,
		Content:     content,
		ChunkSHA256: hex.EncodeToString(sum[:]),
	})
	if err != nil {
		t.Fatalf("UploadChunk: %v", err)
	}
	if len(committed.ChunkKeys) != 1 {
		t.Fatalf("committed chunk key count = %d, want 1", len(committed.ChunkKeys))
	}

	loserKey := assetUploadTempObjectKey(upload.UploadID, 0)
	if loserKey == committed.ChunkKeys[0] {
		t.Fatal("upload chunk temp keys are deterministic across attempts")
	}
	if _, err := core.storage.serverAssets.Put(ctx, jetstream.ObjectMeta{Name: loserKey}, bytes.NewReader(content)); err != nil {
		t.Fatalf("store loser chunk: %v", err)
	}
	staleSession.ChunkKeys = append(staleSession.ChunkKeys, loserKey)
	staleSession.CommittedOffset = int64(len(content))
	if err := core.AssetUploads().updateUpload(ctx, staleSession, staleRevision); err == nil {
		t.Fatal("stale upload update succeeded")
	}
	if err := core.storage.serverAssets.Delete(ctx, loserKey); err != nil && !errors.Is(err, jetstream.ErrObjectNotFound) {
		t.Fatalf("delete loser chunk: %v", err)
	}

	obj, err := core.storage.serverAssets.Get(ctx, committed.ChunkKeys[0])
	if err != nil {
		t.Fatalf("committed chunk was deleted by stale retry cleanup: %v", err)
	}
	if err := obj.Close(); err != nil {
		t.Fatalf("close committed chunk: %v", err)
	}

	completed, attachment, err := core.AssetUploads().CompleteUpload(ctx, AssetUploadCompleteInput{
		ActorID:  user.Id,
		UploadID: upload.UploadID,
	})
	if err != nil {
		t.Fatalf("CompleteUpload: %v", err)
	}
	if completed.Status != AssetUploadStatusCompleted {
		t.Fatalf("completed status = %q, want %q", completed.Status, AssetUploadStatusCompleted)
	}
	if attachment == nil || attachment.GetId() == "" {
		t.Fatal("CompleteUpload did not return an attachment")
	}
}

func TestAssetUploadAnimatedGIFDoesNotRequestVideoProcessingWhenDisabled(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	user, err := core.CreateUser(ctx, SystemActorID, "disabled-gif-upload", "Disabled GIF Upload", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := core.CreateRoom(ctx, user.Id, KindChannel, "", "disabled-gif-uploads", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}

	content := testAnimatedGIF(t)
	sum := sha256.Sum256(content)
	upload, err := core.AssetUploads().CreateUpload(ctx, AssetUploadCreateInput{
		ActorID:     user.Id,
		RoomID:      room.Id,
		Filename:    "animated.gif",
		ContentType: "image/gif",
		Size:        int64(len(content)),
		SHA256:      hex.EncodeToString(sum[:]),
	})
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	if _, err := core.AssetUploads().UploadChunk(ctx, AssetUploadChunkInput{
		ActorID:     user.Id,
		UploadID:    upload.UploadID,
		Offset:      0,
		Content:     content,
		ChunkSHA256: hex.EncodeToString(sum[:]),
	}); err != nil {
		t.Fatalf("UploadChunk: %v", err)
	}
	_, attachment, err := core.AssetUploads().CompleteUpload(ctx, AssetUploadCompleteInput{
		ActorID:  user.Id,
		UploadID: upload.UploadID,
	})
	if err != nil {
		t.Fatalf("CompleteUpload: %v", err)
	}
	declared, ok := core.Assets.AssetCreation(attachment.GetId())
	if !ok {
		t.Fatalf("AssetCreation(%q) missing", attachment.GetId())
	}
	if declared.GetNeedsVideoProcessing() {
		t.Fatal("animated GIF upload persisted needs_video_processing while video is disabled")
	}

	if _, err := core.PostMessage(ctx, KindChannel, room.Id, user.Id, "gif", []string{attachment.GetId()}, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if manifest, ok := core.Assets.VideoAttachmentManifest(attachment.GetId()); ok && manifest != nil && manifest.Started != nil {
		t.Fatalf("video processing manifest was started while disabled: %+v", manifest)
	}
}

func testAnimatedGIF(t *testing.T) []byte {
	t.Helper()
	palette := color.Palette{color.Black, color.White}
	frame1 := image.NewPaletted(image.Rect(0, 0, 2, 2), palette)
	frame2 := image.NewPaletted(image.Rect(0, 0, 2, 2), palette)
	frame2.SetColorIndex(1, 1, 1)
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, &gif.GIF{
		Image: []*image.Paletted{frame1, frame2},
		Delay: []int{10, 10},
	}); err != nil {
		t.Fatalf("EncodeAll animated GIF: %v", err)
	}
	return buf.Bytes()
}
