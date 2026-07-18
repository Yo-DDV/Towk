package core

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"math"
	"os"
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

func TestPrepareCompletedVoicePayloadNormalizesWebMToMP4(t *testing.T) {
	ctx := testContext(t)
	normalizedContent := testVoiceMP4Content("normalized webm voice")
	stubVoiceMessageTranscoder(t, normalizedContent)

	uploadedContent := append([]byte{0x1a, 0x45, 0xdf, 0xa3}, []byte("webm input")...)
	input := testTempVoiceFile(t, uploadedContent)
	defer os.Remove(input.Name())
	defer input.Close()
	session := &AssetUploadSession{
		Filename:     "voice-message.webm",
		ContentType:  "audio/webm",
		Size:         int64(len(uploadedContent)),
		VoiceMessage: &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: testVoicePeaks(32)},
	}

	payload, err := prepareCompletedUploadPayload(ctx, session, input, make(chan struct{}, defaultMaxConcurrentVoiceMessageTranscodes))
	if err != nil {
		t.Fatalf("prepareCompletedUploadPayload: %v", err)
	}
	defer payload.cleanup()
	if payload.filename != "voice-message.m4a" {
		t.Fatalf("normalized filename = %q, want voice-message.m4a", payload.filename)
	}
	if payload.contentType != "audio/mp4" {
		t.Fatalf("normalized content type = %q, want audio/mp4", payload.contentType)
	}
	if payload.size != int64(len(normalizedContent)) {
		t.Fatalf("normalized size = %d, want %d", payload.size, len(normalizedContent))
	}
	got, err := io.ReadAll(payload.reader)
	if err != nil {
		t.Fatalf("read normalized payload: %v", err)
	}
	if !bytes.Equal(got, normalizedContent) {
		t.Fatal("normalized payload bytes do not match transcoder output")
	}
}

func TestPrepareCompletedVoicePayloadKeepsMP4WithoutTranscoder(t *testing.T) {
	previousTranscoder := voiceMessageTranscodeToMP4
	voiceMessageTranscodeToMP4 = func(context.Context, string, string) error {
		t.Fatal("audio/mp4 voice messages must not require transcoding")
		return nil
	}
	t.Cleanup(func() { voiceMessageTranscodeToMP4 = previousTranscoder })

	ctx := testContext(t)
	content := testVoiceMP4Content("native ios voice")
	input := testTempVoiceFile(t, content)
	defer os.Remove(input.Name())
	defer input.Close()
	session := &AssetUploadSession{
		Filename:     "voice-message.mp4",
		ContentType:  "audio/mp4",
		Size:         int64(len(content)),
		VoiceMessage: &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: testVoicePeaks(32)},
	}

	payload, err := prepareCompletedUploadPayload(ctx, session, input, make(chan struct{}, defaultMaxConcurrentVoiceMessageTranscodes))
	if err != nil {
		t.Fatalf("prepareCompletedUploadPayload: %v", err)
	}
	defer payload.cleanup()
	if payload.filename != "voice-message.m4a" {
		t.Fatalf("mp4 filename = %q, want voice-message.m4a", payload.filename)
	}
	if payload.contentType != "audio/mp4" {
		t.Fatalf("mp4 content type = %q, want audio/mp4", payload.contentType)
	}
	if payload.size != int64(len(content)) {
		t.Fatalf("mp4 size = %d, want %d", payload.size, len(content))
	}
	got, err := io.ReadAll(payload.reader)
	if err != nil {
		t.Fatalf("read mp4 payload: %v", err)
	}
	if !bytes.Equal(got, content) {
		t.Fatal("mp4 payload bytes changed without transcoding")
	}
}

func TestPrepareCompletedVoicePayloadBoundsConcurrentTranscodes(t *testing.T) {
	previousTranscoder := voiceMessageTranscodeToMP4
	started := make(chan struct{}, 4)
	release := make(chan struct{})
	released := false
	defer func() {
		if !released {
			close(release)
		}
	}()
	voiceMessageTranscodeToMP4 = func(_ context.Context, _ string, outputPath string) error {
		started <- struct{}{}
		<-release
		return os.WriteFile(outputPath, testVoiceMP4Content("bounded voice"), 0o600)
	}
	t.Cleanup(func() { voiceMessageTranscodeToMP4 = previousTranscoder })

	results := make(chan error, 4)
	transcodeSlots := make(chan struct{}, defaultMaxConcurrentVoiceMessageTranscodes)
	for range 4 {
		input := testTempVoiceFile(t, append([]byte{0x1a, 0x45, 0xdf, 0xa3}, []byte("webm input")...))
		t.Cleanup(func() {
			input.Close()
			os.Remove(input.Name())
		})
		session := &AssetUploadSession{
			Filename:     "voice-message.webm",
			ContentType:  "audio/webm",
			Size:         14,
			VoiceMessage: &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: testVoicePeaks(32)},
		}
		go func() {
			payload, err := prepareCompletedUploadPayload(context.Background(), session, input, transcodeSlots)
			if payload != nil {
				payload.cleanup()
			}
			results <- err
		}()
	}

	for range 2 {
		select {
		case <-started:
		case <-time.After(3 * time.Second):
			t.Fatal("voice transcode did not start")
		}
	}
	select {
	case <-started:
		t.Fatal("more than two voice transcodes started concurrently")
	case <-time.After(100 * time.Millisecond):
	}

	close(release)
	released = true
	for range 4 {
		if err := <-results; err != nil {
			t.Fatalf("prepareCompletedUploadPayload: %v", err)
		}
	}
}

func TestPrepareCompletedVoicePayloadCancelsWhileWaitingForTranscodeCapacity(t *testing.T) {
	previousTranscoder := voiceMessageTranscodeToMP4
	voiceMessageTranscodeToMP4 = func(context.Context, string, string) error {
		t.Fatal("cancelled admission must not start the transcoder")
		return nil
	}
	t.Cleanup(func() { voiceMessageTranscodeToMP4 = previousTranscoder })

	input := testTempVoiceFile(t, append([]byte{0x1a, 0x45, 0xdf, 0xa3}, []byte("webm input")...))
	defer os.Remove(input.Name())
	defer input.Close()
	session := &AssetUploadSession{
		Filename:     "voice-message.webm",
		ContentType:  "audio/webm",
		Size:         14,
		VoiceMessage: &VoiceMessageUploadMetadata{DurationMS: 1_000, WaveformPeaks: testVoicePeaks(32)},
	}
	transcodeSlots := make(chan struct{}, 1)
	transcodeSlots <- struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	payload, err := prepareCompletedUploadPayload(ctx, session, input, transcodeSlots)
	if payload != nil {
		payload.cleanup()
		t.Fatal("cancelled admission returned a payload")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("prepareCompletedUploadPayload error = %v, want context canceled", err)
	}
}

func TestVoiceMessageUploadPersistsMetadataAndUsesIndependentPermission(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	normalizedContent := testVoiceMP4Content("normalized channel voice")
	stubVoiceMessageTranscoder(t, normalizedContent)
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
	if got := attachment.GetContentType(); got != "audio/mp4" {
		t.Fatalf("attachment content type = %q, want audio/mp4", got)
	}
	if got := attachment.GetFilename(); got != "voice-message.m4a" {
		t.Fatalf("attachment filename = %q, want voice-message.m4a", got)
	}
	if got := attachment.GetSize(); got != int64(len(normalizedContent)) {
		t.Fatalf("attachment size = %d, want %d", got, len(normalizedContent))
	}
	storedContent, err := core.storage.serverAssets.GetBytes(ctx, attachment.GetId())
	if err != nil {
		t.Fatalf("read stored normalized voice attachment: %v", err)
	}
	if !bytes.Equal(storedContent, normalizedContent) {
		t.Fatal("stored voice attachment was not normalized to mp4 payload")
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

func TestVoiceMessageUploadWorksInDMRoom(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	stubVoiceMessageTranscoder(t, testVoiceMP4Content("normalized dm voice"))
	sender, err := core.CreateUser(ctx, SystemActorID, "voice-dm-sender", "Voice DM Sender", "password")
	if err != nil {
		t.Fatalf("CreateUser sender: %v", err)
	}
	recipient, err := core.CreateUser(ctx, SystemActorID, "voice-dm-recipient", "Voice DM Recipient", "password")
	if err != nil {
		t.Fatalf("CreateUser recipient: %v", err)
	}
	dm, created, err := core.RoomCommands().StartDM(ctx, RoomStartDMInput{
		ActorID:        sender.Id,
		ParticipantIDs: []string{recipient.Id},
	})
	if err != nil {
		t.Fatalf("StartDM: %v", err)
	}
	if !created || KindOfRoom(dm) != KindDM {
		t.Fatalf("StartDM created=%v kind=%v, want new DM", created, KindOfRoom(dm))
	}

	content := append([]byte{0x1a, 0x45, 0xdf, 0xa3}, []byte("dm voice payload")...)
	sum := sha256.Sum256(content)
	upload, err := core.AssetUploads().CreateUpload(ctx, AssetUploadCreateInput{
		ActorID: sender.Id, RoomID: dm.Id, Filename: "voice-message.webm", ContentType: "audio/webm; codecs=opus",
		Size: int64(len(content)), SHA256: hex.EncodeToString(sum[:]),
		VoiceMessage: &VoiceMessageUploadMetadata{DurationMS: 1_234, WaveformPeaks: testVoicePeaks(32)},
	})
	if err != nil {
		t.Fatalf("CreateUpload in DM: %v", err)
	}
	chunkSum := sha256.Sum256(content)
	if _, err := core.AssetUploads().UploadChunk(ctx, AssetUploadChunkInput{
		ActorID: sender.Id, UploadID: upload.UploadID, Content: content, ChunkSHA256: hex.EncodeToString(chunkSum[:]),
	}); err != nil {
		t.Fatalf("UploadChunk in DM: %v", err)
	}
	_, attachment, err := core.AssetUploads().CompleteUpload(ctx, AssetUploadCompleteInput{ActorID: sender.Id, UploadID: upload.UploadID})
	if err != nil {
		t.Fatalf("CompleteUpload in DM: %v", err)
	}
	if got := attachment.GetVoiceMessage().GetDurationMs(); got != 1_234 {
		t.Fatalf("DM attachment voice duration = %d, want 1234", got)
	}
	if got := attachment.GetContentType(); got != "audio/mp4" {
		t.Fatalf("DM attachment content type = %q, want audio/mp4", got)
	}

	result, err := core.Messages().PostMessage(ctx, MessagePostInput{ActorID: sender.Id, RoomID: dm.Id, AttachmentAssetIDs: []string{attachment.GetId()}})
	if err != nil {
		t.Fatalf("PostMessage in DM: %v", err)
	}
	if result == nil || result.Event == nil {
		t.Fatalf("PostMessage in DM result = %+v, want event", result)
	}
	postedAttachments, err := core.MessageAttachments(ctx, MessageAttachmentsInput{
		ActorID: sender.Id,
		RoomID:  dm.Id,
		EventID: result.Event.Id,
	})
	if err != nil {
		t.Fatalf("MessageAttachments in DM: %v", err)
	}
	found := false
	for _, postedAttachment := range postedAttachments {
		if postedAttachment.GetId() == attachment.GetId() && postedAttachment.GetVoiceMessage() != nil {
			found = true
		}
	}
	if !found {
		t.Fatalf("posted DM voice attachment %s not found in DM timeline", attachment.GetId())
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

func stubVoiceMessageTranscoder(t *testing.T, output []byte) {
	t.Helper()
	previousTranscoder := voiceMessageTranscodeToMP4
	voiceMessageTranscodeToMP4 = func(_ context.Context, _ string, outputPath string) error {
		return os.WriteFile(outputPath, output, 0o600)
	}
	t.Cleanup(func() { voiceMessageTranscodeToMP4 = previousTranscoder })
}

func testVoiceMP4Content(suffix string) []byte {
	header := []byte{0x00, 0x00, 0x00, 0x18, 'f', 't', 'y', 'p', 'M', '4', 'A', ' ', 0x00, 0x00, 0x00, 0x00}
	return append(append([]byte(nil), header...), []byte(suffix)...)
}

func testTempVoiceFile(t *testing.T, content []byte) *os.File {
	t.Helper()
	tmp, err := os.CreateTemp("", "towk-voice-test-*")
	if err != nil {
		t.Fatalf("CreateTemp: %v", err)
	}
	if _, err := tmp.Write(content); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		t.Fatalf("write temp voice file: %v", err)
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		t.Fatalf("rewind temp voice file: %v", err)
	}
	return tmp
}
