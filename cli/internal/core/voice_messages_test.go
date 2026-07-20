package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"testing"
	"time"
)

func TestValidateVoiceMessageUpload(t *testing.T) {
	valid := &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: testVoicePeaks(32)}
	tests := []struct {
		name        string
		metadata    *VoiceMessageUploadMetadata
		contentType string
		size        int64
		wantErr     bool
	}{
		{name: "ordinary attachment", metadata: nil, contentType: "text/plain", size: 1},
		{name: "webm", metadata: valid, contentType: "audio/webm", size: 1},
		{name: "mp4", metadata: valid, contentType: "audio/mp4", size: 1},
		{name: "ogg", metadata: valid, contentType: "audio/ogg", size: 1},
		{name: "unsupported audio", metadata: valid, contentType: "audio/mpeg", size: 1, wantErr: true},
		{name: "empty", metadata: valid, contentType: "audio/webm", size: 0, wantErr: true},
		{name: "oversized", metadata: valid, contentType: "audio/webm", size: MaxVoiceMessageUploadSize + 1, wantErr: true},
		{name: "too short", metadata: &VoiceMessageUploadMetadata{DurationMS: MinVoiceMessageDurationMS - 1, WaveformPeaks: testVoicePeaks(32)}, contentType: "audio/webm", size: 1, wantErr: true},
		{name: "too long", metadata: &VoiceMessageUploadMetadata{DurationMS: MaxVoiceMessageDurationMS + 1, WaveformPeaks: testVoicePeaks(32)}, contentType: "audio/webm", size: 1, wantErr: true},
		{name: "too few peaks", metadata: &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: testVoicePeaks(MinVoiceMessageWaveformPeaks - 1)}, contentType: "audio/webm", size: 1, wantErr: true},
		{name: "too many peaks", metadata: &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: testVoicePeaks(MaxVoiceMessageWaveformPeaks + 1)}, contentType: "audio/webm", size: 1, wantErr: true},
		{name: "negative peak", metadata: &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: append([]float32{-0.01}, testVoicePeaks(31)...)}, contentType: "audio/webm", size: 1, wantErr: true},
		{name: "peak above one", metadata: &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: append([]float32{1.01}, testVoicePeaks(31)...)}, contentType: "audio/webm", size: 1, wantErr: true},
		{name: "nan peak", metadata: &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: append([]float32{float32(math.NaN())}, testVoicePeaks(31)...)}, contentType: "audio/webm", size: 1, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateVoiceMessageUpload(tt.metadata, tt.contentType, tt.size)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateVoiceMessageUpload() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateVoiceMessageContainer(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		content     []byte
		wantErr     bool
	}{
		{name: "webm", contentType: "audio/webm", content: append([]byte{0x1a, 0x45, 0xdf, 0xa3}, []byte("webm")...)},
		{name: "ogg", contentType: "audio/ogg", content: []byte("OggSvoice")},
		{name: "mp4", contentType: "audio/mp4", content: []byte{0, 0, 0, 16, 'f', 't', 'y', 'p', 'm', 'p', '4', '2'}},
		{name: "mismatched", contentType: "audio/webm", content: []byte("OggSvoice"), wantErr: true},
		{name: "truncated", contentType: "audio/mp4", content: []byte("ftyp"), wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reader := bytes.NewReader(tt.content)
			err := validateVoiceMessageContainer(reader, tt.contentType)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateVoiceMessageContainer() error = %v, wantErr %v", err, tt.wantErr)
			}
			if got, err := reader.Seek(0, 1); err != nil || got != 0 {
				t.Fatalf("reader position = %d, %v; want 0", got, err)
			}
		})
	}
}

func TestVoiceMessageUploadPersistsMetadataAndUsesIndependentPermission(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := core.CreateUser(ctx, SystemActorID, "voice-uploader", "Voice Uploader", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := core.CreateRoom(ctx, user.Id, KindChannel, "", "voice-messages", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}
	if err := core.DenyRoomPermission(ctx, SystemActorID, room.Id, RoleEveryone, PermMessageAttach); err != nil {
		t.Fatalf("DenyRoomPermission attach: %v", err)
	}

	content := append([]byte{0x1a, 0x45, 0xdf, 0xa3}, []byte("test voice data")...)
	sum := sha256.Sum256(content)
	metadata := &VoiceMessageUploadMetadata{DurationMS: 1_234, WaveformPeaks: testVoicePeaks(32)}
	upload, err := core.AssetUploads().CreateUpload(ctx, AssetUploadCreateInput{
		ActorID: user.Id, RoomID: room.Id, Filename: "voice-message.webm", ContentType: "audio/webm; codecs=opus",
		Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:]), VoiceMessage: metadata,
	})
	if err != nil {
		t.Fatalf("CreateUpload with ordinary attachments denied: %v", err)
	}
	metadata.WaveformPeaks[0] = 1
	if upload.VoiceMessage.WaveformPeaks[0] == 1 {
		t.Fatal("upload session aliases caller waveform metadata")
	}
	chunkSum := sha256.Sum256(content)
	if _, err := core.AssetUploads().UploadChunk(ctx, AssetUploadChunkInput{
		ActorID: user.Id, UploadID: upload.UploadID, Content: content, ChunkSHA256: hex.EncodeToString(chunkSum[:]),
	}); err != nil {
		t.Fatalf("UploadChunk: %v", err)
	}

	if err := core.DenyRoomPermission(ctx, SystemActorID, room.Id, RoleEveryone, PermMessageVoice); err != nil {
		t.Fatalf("DenyRoomPermission voice: %v", err)
	}
	if _, _, err := core.AssetUploads().CompleteUpload(ctx, AssetUploadCompleteInput{ActorID: user.Id, UploadID: upload.UploadID}); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("CompleteUpload after voice permission revoke = %v, want permission denied", err)
	}
	if err := core.ClearRoomPermissionState(ctx, SystemActorID, room.Id, RoleEveryone, PermMessageVoice); err != nil {
		t.Fatalf("ClearRoomPermissionState voice: %v", err)
	}

	_, attachment, err := core.AssetUploads().CompleteUpload(ctx, AssetUploadCompleteInput{ActorID: user.Id, UploadID: upload.UploadID})
	if err != nil {
		t.Fatalf("CompleteUpload: %v", err)
	}
	if got := attachment.GetVoiceMessage().GetDurationMs(); got != 1_234 {
		t.Fatalf("attachment voice duration = %d, want 1234", got)
	}
	declared, ok := core.Assets.AssetCreation(attachment.GetId())
	if !ok || declared.GetAsset().GetVoiceMessage() == nil {
		t.Fatalf("durable voice metadata missing: %+v", declared)
	}

	if err := core.DenyRoomPermission(ctx, SystemActorID, room.Id, RoleEveryone, PermMessageVoice); err != nil {
		t.Fatalf("DenyRoomPermission voice before post: %v", err)
	}
	_, err = core.Messages().PreflightPost(ctx, MessagePostInput{ActorID: user.Id, RoomID: room.Id, AttachmentAssetIDs: []string{attachment.GetId()}})
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("PreflightPost after voice permission revoke = %v, want permission denied", err)
	}
	if err := core.ClearRoomPermissionState(ctx, SystemActorID, room.Id, RoleEveryone, PermMessageVoice); err != nil {
		t.Fatalf("ClearRoomPermissionState voice before post: %v", err)
	}
	genericContent := []byte("ordinary attachment")
	genericAttachment, err := core.uploadAttachmentBinary(ctx, room.Id, "ordinary.txt", "text/plain", bytes.NewReader(genericContent))
	if err != nil {
		t.Fatalf("uploadAttachmentBinary ordinary: %v", err)
	}
	genericSum := sha256.Sum256(genericContent)
	if err := core.assetLifecycle().RecordUploadedPendingAttachmentAsset(ctx, user.Id, room.Id, genericAttachment, hex.EncodeToString(genericSum[:]), time.Now().Add(time.Hour), false); err != nil {
		t.Fatalf("RecordUploadedPendingAttachmentAsset ordinary: %v", err)
	}
	_, err = core.Messages().PreflightPost(ctx, MessagePostInput{
		ActorID: user.Id, RoomID: room.Id, AttachmentAssetIDs: []string{attachment.GetId(), genericAttachment.GetId()},
	})
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("PreflightPost mixed voice and ordinary attachment = %v, want attach permission denied", err)
	}
	if _, err := core.Messages().PostMessage(ctx, MessagePostInput{ActorID: user.Id, RoomID: room.Id, AttachmentAssetIDs: []string{attachment.GetId()}}); err != nil {
		t.Fatalf("PostMessage with attach denied and voice allowed: %v", err)
	}
}

func TestVoiceMessageUploadRejectsMismatchedContainer(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := core.CreateUser(ctx, SystemActorID, "voice-container", "Voice Container", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := core.CreateRoom(ctx, user.Id, KindChannel, "", "voice-container", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := core.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}
	before, err := core.GetAssetCount(ctx)
	if err != nil {
		t.Fatalf("GetAssetCount before: %v", err)
	}

	content := []byte("OggS content declared as WebM")
	sum := sha256.Sum256(content)
	upload, err := core.AssetUploads().CreateUpload(ctx, AssetUploadCreateInput{
		ActorID: user.Id, RoomID: room.Id, Filename: "voice-message.webm", ContentType: "audio/webm",
		Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:]),
		VoiceMessage: &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: testVoicePeaks(32)},
	})
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	if _, err := core.AssetUploads().UploadChunk(ctx, AssetUploadChunkInput{
		ActorID: user.Id, UploadID: upload.UploadID, Content: content, ChunkSHA256: hex.EncodeToString(sum[:]),
	}); err != nil {
		t.Fatalf("UploadChunk: %v", err)
	}
	if _, _, err := core.AssetUploads().CompleteUpload(ctx, AssetUploadCompleteInput{ActorID: user.Id, UploadID: upload.UploadID}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("CompleteUpload mismatched container = %v, want invalid argument", err)
	}
	after, err := core.GetAssetCount(ctx)
	if err != nil {
		t.Fatalf("GetAssetCount after: %v", err)
	}
	if after != before {
		t.Fatalf("asset count after rejected upload = %d, want %d", after, before)
	}
}

func testVoicePeaks(count int) []float32 {
	peaks := make([]float32, count)
	for i := range peaks {
		peaks[i] = float32((i%8)+1) / 8
	}
	return peaks
}
