package core

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"testing"
	"time"

	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/testutil"
)

const (
	mediaBenchmarkChunkSize      = 512 << 10
	mediaBenchmarkCacheWarmReads = 1000
)

var benchmarkMediaBytes int64

type mediaBenchmarkEnv struct {
	core   *ChattoCore
	ctx    context.Context
	userID string
	roomID string
}

func BenchmarkMediaStorage(b *testing.B) {
	env := setupMediaBenchmarkEnv(b)
	b.Run("cache_read_512KiB", func(b *testing.B) {
		payload := deterministicBenchmarkPayload(mediaBenchmarkChunkSize)
		key := ImageCacheKey(AttachmentSignResource, "A-benchmark-cache", 960, 540, "contain")
		if err := env.core.StoreCachedResize(env.ctx, key, payload); err != nil {
			b.Fatalf("StoreCachedResize: %v", err)
		}
		if _, err := env.core.GetCachedResize(env.ctx, key); err != nil {
			b.Fatalf("warm GetCachedResize: %v", err)
		}
		for range mediaBenchmarkCacheWarmReads {
			got, err := env.core.GetCachedResize(env.ctx, key)
			if err != nil {
				b.Fatalf("stabilize GetCachedResize: %v", err)
			}
			if len(got) != len(payload) {
				b.Fatalf("stabilized cached resize bytes = %d, want %d", len(got), len(payload))
			}
		}

		b.ReportAllocs()
		b.SetBytes(int64(len(payload)))
		var read int64
		for b.Loop() {
			got, err := env.core.GetCachedResize(env.ctx, key)
			if err != nil {
				b.Fatal(err)
			}
			if len(got) != len(payload) {
				b.Fatalf("cached resize bytes = %d, want %d", len(got), len(payload))
			}
			read += int64(len(got))
		}
		benchmarkMediaBytes = read
	})

	b.Run("upload_chunk_512KiB", func(b *testing.B) {
		payload := deterministicBenchmarkPayload(mediaBenchmarkChunkSize)
		digest := sha256.Sum256(payload)
		sha := hex.EncodeToString(digest[:])
		warmMediaBenchmarkUploadChunk(b, env, payload, sha)

		b.ReportAllocs()
		b.SetBytes(int64(len(payload)))
		var committed int64
		for b.Loop() {
			b.StopTimer()
			upload, err := env.core.AssetUploads().CreateUpload(env.ctx, AssetUploadCreateInput{
				ActorID: env.userID, RoomID: env.roomID, Filename: "benchmark.bin",
				ContentType: "application/octet-stream", Size: int64(len(payload)), SHA256: sha,
			})
			if err != nil {
				b.Fatalf("CreateUpload: %v", err)
			}
			b.StartTimer()

			session, err := env.core.AssetUploads().UploadChunk(env.ctx, AssetUploadChunkInput{
				ActorID: env.userID, UploadID: upload.UploadID, Content: payload, ChunkSHA256: sha,
			})
			if err != nil {
				b.Fatal(err)
			}
			committed += session.CommittedOffset

			b.StopTimer()
			if _, err := env.core.AssetUploads().CancelUpload(env.ctx, AssetUploadCancelInput{
				ActorID: env.userID, UploadID: upload.UploadID,
			}); err != nil {
				b.Fatalf("CancelUpload: %v", err)
			}
			b.StartTimer()
		}
		benchmarkMediaBytes = committed
	})

	for _, size := range []int{1 << 20, 25 << 20} {
		size := size
		b.Run(fmt.Sprintf("materialize_%03dMiB", size>>20), func(b *testing.B) {
			payload := deterministicBenchmarkPayload(size)
			session := prepareMediaBenchmarkUpload(b, env, payload)
			warmFile, err := env.core.AssetUploads().materializeUpload(env.ctx, session)
			if err != nil {
				b.Fatalf("warm materializeUpload: %v", err)
			}
			warmName := warmFile.Name()
			if err := warmFile.Close(); err != nil {
				b.Fatalf("close warm materialized upload: %v", err)
			}
			if err := os.Remove(warmName); err != nil {
				b.Fatalf("remove warm materialized upload: %v", err)
			}

			b.ReportAllocs()
			b.SetBytes(int64(len(payload)))
			var materialized int64
			for b.Loop() {
				file, err := env.core.AssetUploads().materializeUpload(env.ctx, session)
				if err != nil {
					b.Fatal(err)
				}
				info, err := file.Stat()
				if err != nil {
					b.Fatalf("stat materialized upload: %v", err)
				}
				materialized += info.Size()

				b.StopTimer()
				name := file.Name()
				if err := file.Close(); err != nil {
					b.Fatalf("close materialized upload: %v", err)
				}
				if err := os.Remove(name); err != nil {
					b.Fatalf("remove materialized upload: %v", err)
				}
				b.StartTimer()
			}
			benchmarkMediaBytes = materialized

			b.StopTimer()
			if _, err := env.core.AssetUploads().CancelUpload(env.ctx, AssetUploadCancelInput{
				ActorID: env.userID, UploadID: session.UploadID,
			}); err != nil {
				b.Fatalf("CancelUpload: %v", err)
			}
		})
	}
}

func TestDeterministicBenchmarkPayload(t *testing.T) {
	first := deterministicBenchmarkPayload(mediaBenchmarkChunkSize + 17)
	second := deterministicBenchmarkPayload(mediaBenchmarkChunkSize + 17)
	if !bytes.Equal(first, second) {
		t.Fatal("benchmark payload is not deterministic")
	}
	if len(first) != mediaBenchmarkChunkSize+17 {
		t.Fatalf("benchmark payload bytes = %d, want %d", len(first), mediaBenchmarkChunkSize+17)
	}
	if bytes.Equal(first[:mediaBenchmarkChunkSize], first[17:17+mediaBenchmarkChunkSize]) {
		t.Fatal("benchmark payload repeats as a constant block")
	}
}

func setupMediaBenchmarkEnv(b *testing.B) mediaBenchmarkEnv {
	b.Helper()
	_, nc := testutil.StartNATS(b)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	b.Cleanup(cancel)

	cfg := config.CoreConfig{
		SecretKey: "media-benchmark-core-secret",
		Assets: config.AssetsConfig{
			SigningSecret: "media-benchmark-signing-secret",
			MaxUploadSize: 300 << 20,
			Cache: config.AssetsCacheConfig{
				Enabled: true,
				TTL:     config.Duration(7 * 24 * time.Hour),
			},
		},
	}
	chattoCore, err := NewChattoCore(ctx, nc, cfg)
	if err != nil {
		b.Fatalf("NewChattoCore: %v", err)
	}
	startCoreServices(b, chattoCore)

	user, err := chattoCore.CreateUser(ctx, SystemActorID, "media-benchmark", "Media Benchmark", "password123")
	if err != nil {
		b.Fatalf("CreateUser: %v", err)
	}
	room, err := chattoCore.CreateRoom(ctx, user.Id, KindChannel, "", "media-benchmark", "")
	if err != nil {
		b.Fatalf("CreateRoom: %v", err)
	}
	if _, err := chattoCore.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		b.Fatalf("JoinRoom: %v", err)
	}
	return mediaBenchmarkEnv{core: chattoCore, ctx: ctx, userID: user.Id, roomID: room.Id}
}

func prepareMediaBenchmarkUpload(b *testing.B, env mediaBenchmarkEnv, payload []byte) *AssetUploadSession {
	b.Helper()
	digest := sha256.Sum256(payload)
	upload, err := env.core.AssetUploads().CreateUpload(env.ctx, AssetUploadCreateInput{
		ActorID: env.userID, RoomID: env.roomID, Filename: "materialize-benchmark.bin",
		ContentType: "application/octet-stream", Size: int64(len(payload)), SHA256: hex.EncodeToString(digest[:]),
	})
	if err != nil {
		b.Fatalf("CreateUpload: %v", err)
	}

	for offset := 0; offset < len(payload); offset += mediaBenchmarkChunkSize {
		end := min(offset+mediaBenchmarkChunkSize, len(payload))
		chunk := payload[offset:end]
		chunkDigest := sha256.Sum256(chunk)
		upload, err = env.core.AssetUploads().UploadChunk(env.ctx, AssetUploadChunkInput{
			ActorID: env.userID, UploadID: upload.UploadID, Offset: int64(offset),
			Content: chunk, ChunkSHA256: hex.EncodeToString(chunkDigest[:]),
		})
		if err != nil {
			b.Fatalf("UploadChunk(offset=%d): %v", offset, err)
		}
	}
	return upload
}

func warmMediaBenchmarkUploadChunk(b *testing.B, env mediaBenchmarkEnv, payload []byte, sha string) {
	b.Helper()
	upload, err := env.core.AssetUploads().CreateUpload(env.ctx, AssetUploadCreateInput{
		ActorID: env.userID, RoomID: env.roomID, Filename: "warm-benchmark.bin",
		ContentType: "application/octet-stream", Size: int64(len(payload)), SHA256: sha,
	})
	if err != nil {
		b.Fatalf("warm CreateUpload: %v", err)
	}
	if _, err := env.core.AssetUploads().UploadChunk(env.ctx, AssetUploadChunkInput{
		ActorID: env.userID, UploadID: upload.UploadID, Content: payload, ChunkSHA256: sha,
	}); err != nil {
		b.Fatalf("warm UploadChunk: %v", err)
	}
	if _, err := env.core.AssetUploads().CancelUpload(env.ctx, AssetUploadCancelInput{
		ActorID: env.userID, UploadID: upload.UploadID,
	}); err != nil {
		b.Fatalf("warm CancelUpload: %v", err)
	}
}

func deterministicBenchmarkPayload(size int) []byte {
	payload := make([]byte, size)
	var state uint64 = 0x9e3779b97f4a7c15
	for i := range payload {
		state ^= state << 7
		state ^= state >> 9
		state ^= state << 8
		payload[i] = byte(state)
	}
	return payload
}
