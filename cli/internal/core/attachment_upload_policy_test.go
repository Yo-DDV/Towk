package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/nats-io/nats.go/jetstream"
)

func TestNormalizeAttachmentUploadMetadata(t *testing.T) {
	t.Run("normalizes ordinary metadata", func(t *testing.T) {
		filename, contentType, err := normalizeAttachmentUploadMetadata(" report.PDF ", "Application/PDF; charset=binary")
		if err != nil {
			t.Fatalf("normalizeAttachmentUploadMetadata: %v", err)
		}
		if filename != "report.PDF" || contentType != "application/pdf" {
			t.Fatalf("metadata = %q, %q, want report.PDF, application/pdf", filename, contentType)
		}
	})

	for _, tt := range []struct {
		name        string
		filename    string
		contentType string
	}{
		{name: "windows executable", filename: "program.EXE"},
		{name: "windows installer", filename: "installer.msi"},
		{name: "shell command", filename: "launch.command"},
		{name: "shell script", filename: "launch.sh"},
		{name: "javascript", filename: "launch.js", contentType: "text/javascript"},
		{name: "python script", filename: "launch.py", contentType: "text/x-python"},
		{name: "apple script", filename: "launch.scpt"},
		{name: "automator workflow", filename: "launch.workflow"},
		{name: "internet shortcut", filename: "launch.url"},
		{name: "dynamic library", filename: "library.dylib"},
		{name: "shared object", filename: "library.so"},
		{name: "java class", filename: "Main.class"},
		{name: "mobile package", filename: "mobile.apk", contentType: "application/zip"},
		{name: "executable mime", filename: "renamed.dat", contentType: "application/x-executable"},
		{name: "path separator", filename: "folder/report.pdf"},
		{name: "windows path separator", filename: `folder\report.pdf`},
		{name: "control character", filename: "bad\nname.pdf"},
		{name: "bidirectional filename control", filename: "invoice\u202eexe.pdf"},
		{name: "oversized filename", filename: strings.Repeat("a", maxAttachmentFilenameBytes+1)},
		{name: "oversized content type", filename: "report.pdf", contentType: strings.Repeat("a", maxAttachmentContentTypeBytes+1)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := normalizeAttachmentUploadMetadata(tt.filename, tt.contentType)
			if !errors.Is(err, ErrInvalidArgument) {
				t.Fatalf("error = %v, want ErrInvalidArgument", err)
			}
		})
	}

	for _, filename := range []string{"bundle.zip", "bundle.tar.gz", "bundle.7z", "bundle.rar"} {
		t.Run("allows archive "+filename, func(t *testing.T) {
			if _, _, err := normalizeAttachmentUploadMetadata(filename, "application/octet-stream"); err != nil {
				t.Fatalf("archive rejected: %v", err)
			}
		})
	}
}

func TestValidateAttachmentExecutableContent(t *testing.T) {
	for _, tt := range []struct {
		name   string
		prefix []byte
	}{
		{name: "portable executable", prefix: []byte{0x4d, 0x5a, 0x90, 0x00}},
		{name: "elf", prefix: []byte{0x7f, 0x45, 0x4c, 0x46}},
		{name: "mach o", prefix: []byte{0xcf, 0xfa, 0xed, 0xfe}},
		{name: "webassembly", prefix: []byte{0x00, 0x61, 0x73, 0x6d}},
		{name: "script shebang", prefix: []byte("#!/bin/sh\n")},
	} {
		t.Run(tt.name, func(t *testing.T) {
			reader := bytes.NewReader(append(tt.prefix, []byte("payload")...))
			err := validateAttachmentExecutableContent(reader)
			if !errors.Is(err, ErrInvalidArgument) {
				t.Fatalf("error = %v, want ErrInvalidArgument", err)
			}
			position, seekErr := reader.Seek(0, io.SeekCurrent)
			if seekErr != nil || position != 0 {
				t.Fatalf("reader position = %d, %v, want 0", position, seekErr)
			}
		})
	}

	for _, prefix := range [][]byte{
		{0x50, 0x4b, 0x03, 0x04},
		{0x1f, 0x8b, 0x08},
		[]byte("%PDF-1.7"),
	} {
		if err := validateAttachmentExecutableContent(bytes.NewReader(prefix)); err != nil {
			t.Fatalf("ordinary content %x rejected: %v", prefix, err)
		}
	}
}

func TestAssetUploadRejectsRenamedExecutableAndDeletesChunks(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)

	user, err := core.CreateUser(ctx, SystemActorID, "blocked-upload", "Blocked Upload", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := core.CreateRoom(ctx, user.Id, KindChannel, "", "blocked-uploads", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}

	content := []byte{0x4d, 0x5a, 0x90, 0x00, 0x01, 0x02}
	sum := sha256.Sum256(content)
	upload, err := core.AssetUploads().CreateUpload(ctx, AssetUploadCreateInput{
		ActorID:     user.Id,
		RoomID:      room.Id,
		Filename:    "renamed.txt",
		ContentType: "text/plain",
		Size:        int64(len(content)),
		SHA256:      hex.EncodeToString(sum[:]),
	})
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	chunkSum := sha256.Sum256(content)
	committed, err := core.AssetUploads().UploadChunk(ctx, AssetUploadChunkInput{
		ActorID:     user.Id,
		UploadID:    upload.UploadID,
		Offset:      0,
		Content:     content,
		ChunkSHA256: hex.EncodeToString(chunkSum[:]),
	})
	if err != nil {
		t.Fatalf("UploadChunk: %v", err)
	}
	if len(committed.ChunkKeys) != 1 {
		t.Fatalf("chunk count = %d, want 1", len(committed.ChunkKeys))
	}

	if _, _, err := core.AssetUploads().CompleteUpload(ctx, AssetUploadCompleteInput{
		ActorID:  user.Id,
		UploadID: upload.UploadID,
	}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("CompleteUpload error = %v, want ErrInvalidArgument", err)
	}
	if _, err := core.storage.serverAssets.GetInfo(ctx, committed.ChunkKeys[0]); !errors.Is(err, jetstream.ErrObjectNotFound) {
		t.Fatalf("rejected upload chunk lookup = %v, want object not found", err)
	}
	if _, err := core.storage.runtimeStateKV.Get(ctx, assetUploadKey(upload.UploadID)); !errors.Is(err, jetstream.ErrKeyNotFound) && !errors.Is(err, jetstream.ErrKeyDeleted) {
		t.Fatalf("rejected upload session lookup = %v, want key not found/deleted", err)
	}
}
