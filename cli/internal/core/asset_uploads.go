package core

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"
	"hmans.de/chatto/internal/assets"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/runtimecap"
)

const (
	assetUploadKeyPrefix              = "asset_upload."
	assetUploadCapacityKey            = "asset_upload_capacity"
	assetUploadTempObjectPrefix       = "asset-upload."
	defaultAssetUploadSessionTTL      = 15 * time.Minute
	defaultPendingAttachmentAssetTTL  = 24 * time.Hour
	assetUploadCleanupInterval        = 5 * time.Minute
	assetUploadOrphanChunkMaxAge      = defaultAssetUploadSessionTTL + time.Hour
	assetUploadCapacityHeadroomRatio  = 20
	assetUploadCapacityMaxRetries     = 32
	assetUploadCapacityMaxEntries     = 4096
	normalizedVoiceMessageContentType = "audio/mp4"
	normalizedVoiceMessageExtension   = ".m4a"
	voiceMessageTranscodeTimeout      = 5 * time.Minute
	voiceMessageProbeTimeout          = 15 * time.Second
	voiceMessageDurationToleranceMS   = 1500
)

// AssetUploadMaxChunkSize is the largest resumable upload chunk accepted by
// the core and by the Connect request limit. One MiB halves the request count
// of the former policy while bounding per-request memory and retry exposure.
const AssetUploadMaxChunkSize = 1024 * 1024

type AssetUploadStatus string

const (
	AssetUploadStatusOpen      AssetUploadStatus = "open"
	AssetUploadStatusCompleted AssetUploadStatus = "completed"
	AssetUploadStatusCancelled AssetUploadStatus = "cancelled"
)

type AssetUploadCreateInput struct {
	ActorID      string
	RoomID       string
	Filename     string
	ContentType  string
	Size         int64
	SHA256       string
	VoiceMessage *VoiceMessageUploadMetadata
}

type AssetUploadChunkInput struct {
	ActorID     string
	UploadID    string
	Offset      int64
	Content     []byte
	ChunkSHA256 string
}

type AssetUploadCompleteInput struct {
	ActorID  string
	UploadID string
}

type AssetUploadCancelInput struct {
	ActorID  string
	UploadID string
}

type AssetUploadSession struct {
	UploadID        string                      `json:"upload_id"`
	ActorID         string                      `json:"actor_id"`
	RoomID          string                      `json:"room_id"`
	Filename        string                      `json:"filename"`
	ContentType     string                      `json:"content_type"`
	Size            int64                       `json:"size"`
	SHA256          string                      `json:"sha256"`
	Status          AssetUploadStatus           `json:"status"`
	CommittedOffset int64                       `json:"committed_offset"`
	MaxChunkSize    int32                       `json:"max_chunk_size"`
	ExpiresAt       time.Time                   `json:"expires_at"`
	AssetID         string                      `json:"asset_id,omitempty"`
	ChunkKeys       []string                    `json:"chunk_keys,omitempty"`
	VoiceMessage    *VoiceMessageUploadMetadata `json:"voice_message,omitempty"`
}

type assetUploadCapacityReservation struct {
	RemainingBytes int64     `json:"remaining_bytes"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type assetUploadCapacityLedger struct {
	Reservations map[string]assetUploadCapacityReservation `json:"reservations"`
}

type completedUploadPayload struct {
	reader      io.ReadSeeker
	cleanup     func()
	filename    string
	contentType string
	size        int64
}

var (
	voiceMessageTranscodeToMP4 = runVoiceMessageTranscodeToMP4
	voiceMessageProbeDuration  = runVoiceMessageProbeDuration
)

type AssetUploadModel struct {
	core *ChattoCore
}

func (c *ChattoCore) AssetUploads() *AssetUploadModel {
	return &AssetUploadModel{core: c}
}

func (m *AssetUploadModel) CreateUpload(ctx context.Context, input AssetUploadCreateInput) (*AssetUploadSession, error) {
	filename, contentType, err := normalizeAttachmentUploadMetadata(input.Filename, input.ContentType)
	if err != nil {
		return nil, err
	}
	if input.Size < 0 {
		return nil, invalidArgument("size must be non-negative")
	}
	if !validSHA256Hex(input.SHA256) {
		return nil, invalidArgument("sha256 must be lowercase hexadecimal SHA-256")
	}
	if err := m.checkUploadSize(contentType, input.Size); err != nil {
		return nil, err
	}
	if err := validateVoiceMessageUpload(input.VoiceMessage, contentType, input.Size); err != nil {
		return nil, err
	}
	if err := m.authorizeUpload(ctx, input.ActorID, input.RoomID, input.VoiceMessage != nil); err != nil {
		return nil, err
	}

	now := time.Now()
	uploadID := NewAssetID()
	expiresAt := now.Add(defaultAssetUploadSessionTTL)
	if err := m.reserveCapacity(ctx, uploadID, input.Size, expiresAt); err != nil {
		return nil, err
	}
	session := &AssetUploadSession{
		UploadID:     uploadID,
		ActorID:      input.ActorID,
		RoomID:       input.RoomID,
		Filename:     filename,
		ContentType:  contentType,
		Size:         input.Size,
		SHA256:       strings.ToLower(input.SHA256),
		Status:       AssetUploadStatusOpen,
		MaxChunkSize: AssetUploadMaxChunkSize,
		ExpiresAt:    expiresAt,
		VoiceMessage: cloneVoiceMessageUploadMetadata(input.VoiceMessage),
	}
	value, err := json.Marshal(session)
	if err != nil {
		m.releaseCapacityBestEffort(ctx, uploadID)
		return nil, err
	}
	if _, err := m.core.storage.runtimeStateKV.Create(ctx, assetUploadKey(session.UploadID), value, jetstream.KeyTTL(time.Until(session.ExpiresAt))); err != nil {
		m.releaseCapacityBestEffort(ctx, uploadID)
		return nil, fmt.Errorf("create upload session: %w", err)
	}
	return session, nil
}

func (m *AssetUploadModel) GetUpload(ctx context.Context, actorID, uploadID string) (*AssetUploadSession, error) {
	session, _, err := m.loadUpload(ctx, uploadID)
	if err != nil {
		return nil, err
	}
	if session.ActorID != actorID {
		return nil, ErrPermissionDenied
	}
	return session, nil
}

func (m *AssetUploadModel) UploadChunk(ctx context.Context, input AssetUploadChunkInput) (*AssetUploadSession, error) {
	if len(input.Content) == 0 {
		return nil, invalidArgument("chunk content is required")
	}
	if !validSHA256Hex(input.ChunkSHA256) {
		return nil, invalidArgument("chunk_sha256 must be lowercase hexadecimal SHA-256")
	}
	sum := sha256.Sum256(input.Content)
	if hex.EncodeToString(sum[:]) != input.ChunkSHA256 {
		return nil, invalidArgument("chunk_sha256 does not match content")
	}
	session, revision, err := m.loadUpload(ctx, input.UploadID)
	if err != nil {
		return nil, err
	}
	if session.ActorID != input.ActorID {
		return nil, ErrPermissionDenied
	}
	if session.Status != AssetUploadStatusOpen {
		return nil, invalidArgument("upload is not open")
	}
	if input.Offset != session.CommittedOffset {
		return nil, invalidArgument("chunk offset does not match committed offset")
	}
	if int32(len(input.Content)) > session.MaxChunkSize {
		return nil, invalidArgument("chunk exceeds maximum chunk size")
	}
	if input.Offset+int64(len(input.Content)) > session.Size {
		return nil, invalidArgument("chunk exceeds declared upload size")
	}
	chunkKey := assetUploadTempObjectKey(session.UploadID, input.Offset)
	if err := m.core.assetUploadLimiter.Acquire(ctx); err != nil {
		return nil, err
	}
	defer m.core.assetUploadLimiter.Release()
	if _, err := m.core.storage.serverAssets.Put(ctx, jetstream.ObjectMeta{
		Name: chunkKey,
		Headers: map[string][]string{
			"Upload-Id": {session.UploadID},
		},
	}, bytes.NewReader(input.Content)); err != nil {
		return nil, fmt.Errorf("store upload chunk: %w", err)
	}
	session.ChunkKeys = append(session.ChunkKeys, chunkKey)
	session.CommittedOffset += int64(len(input.Content))
	if err := m.updateUpload(ctx, session, revision); err != nil {
		_ = m.core.storage.serverAssets.Delete(ctx, chunkKey)
		return nil, err
	}
	if err := m.reduceCapacityReservation(ctx, session.UploadID, int64(len(input.Content))); err != nil {
		m.core.logger.Warn("Failed to reduce asset upload capacity reservation", "upload_id", session.UploadID, "error", err)
	}
	return session, nil
}

func (m *AssetUploadModel) CompleteUpload(ctx context.Context, input AssetUploadCompleteInput) (*AssetUploadSession, *corev1.Attachment, error) {
	session, revision, err := m.loadUpload(ctx, input.UploadID)
	if err != nil {
		return nil, nil, err
	}
	if session.ActorID != input.ActorID {
		return nil, nil, ErrPermissionDenied
	}
	if session.Status == AssetUploadStatusCompleted {
		declared, ok := m.core.assetLifecycle().AssetCreation(session.AssetID)
		if !ok {
			return nil, nil, ErrNotFound
		}
		attachment := attachmentFromAsset(declared.GetAsset())
		if attachment != nil {
			attachment.RoomId = session.RoomID
		}
		return session, attachment, nil
	}
	if session.Status != AssetUploadStatusOpen {
		return nil, nil, invalidArgument("upload is not open")
	}
	if session.CommittedOffset != session.Size {
		return nil, nil, invalidArgument("upload is incomplete")
	}
	if err := m.authorizeUpload(ctx, input.ActorID, session.RoomID, session.VoiceMessage != nil); err != nil {
		return nil, nil, err
	}
	tmp, err := m.materializeUpload(ctx, session)
	if err != nil {
		return nil, nil, err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	validationErr := validateAttachmentExecutableContent(tmp)
	if validationErr == nil && session.VoiceMessage != nil {
		validationErr = validateVoiceMessageContainer(tmp, session.ContentType)
	}
	if validationErr != nil {
		session.Status = AssetUploadStatusCancelled
		if updateErr := m.updateUpload(ctx, session, revision); updateErr != nil {
			m.core.logger.Warn("Failed to mark rejected asset upload as cancelled", "upload_id", session.UploadID, "error", updateErr)
		}
		m.deleteUploadChunks(ctx, session)
		m.releaseCapacityBestEffort(ctx, session.UploadID)
		if deleteErr := m.core.storage.runtimeStateKV.Delete(ctx, assetUploadKey(session.UploadID)); deleteErr != nil && !errors.Is(deleteErr, jetstream.ErrKeyNotFound) && !errors.Is(deleteErr, jetstream.ErrKeyDeleted) {
			m.core.logger.Warn("Failed to delete rejected asset upload session", "upload_id", session.UploadID, "error", deleteErr)
		}
		return nil, nil, validationErr
	}
	attachment, animatedGIF, err := m.storeCompletedUpload(ctx, session, tmp)
	if err != nil {
		return nil, nil, err
	}
	pendingExpiresAt := time.Now().Add(defaultPendingAttachmentAssetTTL)
	needsVideoProcessing := m.core.OnVideoProcessingRequested != nil && AttachmentNeedsVideoProcessing(attachment, animatedGIF)
	if err := m.core.assetLifecycle().RecordUploadedPendingAttachmentAsset(ctx, input.ActorID, session.RoomID, attachment, session.SHA256, pendingExpiresAt, needsVideoProcessing); err != nil {
		m.core.media().DeleteAttachmentFromStorage(ctx, attachment)
		return nil, nil, err
	}
	session.Status = AssetUploadStatusCompleted
	session.AssetID = attachment.GetId()
	session.ExpiresAt = pendingExpiresAt
	if err := m.updateUpload(ctx, session, revision); err != nil {
		return nil, nil, err
	}
	m.deleteUploadChunks(ctx, session)
	m.releaseCapacityBestEffort(ctx, session.UploadID)
	return session, attachment, nil
}

func (m *AssetUploadModel) CancelUpload(ctx context.Context, input AssetUploadCancelInput) (*AssetUploadSession, error) {
	session, revision, err := m.loadUpload(ctx, input.UploadID)
	if err != nil {
		return nil, err
	}
	if session.ActorID != input.ActorID {
		return nil, ErrPermissionDenied
	}
	if session.Status == AssetUploadStatusCompleted {
		return nil, invalidArgument("completed uploads cannot be cancelled")
	}
	session.Status = AssetUploadStatusCancelled
	if err := m.updateUpload(ctx, session, revision); err != nil {
		return nil, err
	}
	m.deleteUploadChunks(ctx, session)
	m.releaseCapacityBestEffort(ctx, session.UploadID)
	_ = m.core.storage.runtimeStateKV.Delete(ctx, assetUploadKey(session.UploadID))
	return session, nil
}

func (m *AssetUploadModel) RunCleanup(ctx context.Context) error {
	ticker := time.NewTicker(assetUploadCleanupInterval)
	defer ticker.Stop()
	for {
		if err := m.CleanupExpired(ctx); err != nil {
			m.core.logger.Warn("Asset upload cleanup failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (m *AssetUploadModel) CleanupExpired(ctx context.Context) error {
	now := time.Now()
	if err := m.cleanupExpiredUploadSessions(ctx, now); err != nil {
		return err
	}
	if err := m.cleanupOrphanUploadChunks(ctx, now); err != nil {
		return err
	}
	if err := m.cleanupExpiredPendingAssets(ctx, now); err != nil {
		return err
	}
	return nil
}

func (m *AssetUploadModel) cleanupExpiredUploadSessions(ctx context.Context, now time.Time) error {
	lister, err := m.core.storage.runtimeStateKV.ListKeysFiltered(ctx, assetUploadKeyPrefix+"*")
	if err != nil {
		if errors.Is(err, jetstream.ErrNoKeysFound) {
			return nil
		}
		return fmt.Errorf("list asset upload sessions: %w", err)
	}
	var keys []string
	for key := range lister.Keys() {
		keys = append(keys, key)
	}
	for _, key := range keys {
		entry, err := m.core.storage.runtimeStateKV.Get(ctx, key)
		if err != nil {
			if errors.Is(err, jetstream.ErrKeyNotFound) || errors.Is(err, jetstream.ErrKeyDeleted) {
				continue
			}
			return fmt.Errorf("load asset upload session for cleanup: %w", err)
		}
		var session AssetUploadSession
		if err := json.Unmarshal(entry.Value(), &session); err != nil {
			m.core.logger.Warn("Deleting malformed asset upload session", "upload_key", key, "error", err)
			_ = m.core.storage.runtimeStateKV.Delete(ctx, key)
			m.releaseCapacityBestEffort(ctx, strings.TrimPrefix(key, assetUploadKeyPrefix))
			continue
		}
		expired := !session.ExpiresAt.After(now)
		if session.Status == AssetUploadStatusOpen && !expired {
			continue
		}
		if session.Status == AssetUploadStatusCompleted && !expired {
			continue
		}
		m.deleteUploadChunks(ctx, &session)
		m.releaseCapacityBestEffort(ctx, session.UploadID)
		_ = m.core.storage.runtimeStateKV.Delete(ctx, key)
	}
	return nil
}

func (m *AssetUploadModel) cleanupOrphanUploadChunks(ctx context.Context, now time.Time) error {
	objects, err := m.core.storage.serverAssets.List(ctx)
	if err != nil {
		if errors.Is(err, jetstream.ErrNoObjectsFound) {
			return nil
		}
		return fmt.Errorf("list asset upload chunks: %w", err)
	}
	cutoff := now.Add(-assetUploadOrphanChunkMaxAge)
	for _, info := range objects {
		if info == nil || !strings.HasPrefix(info.Name, assetUploadTempObjectPrefix) || info.ModTime.After(cutoff) {
			continue
		}
		if err := m.core.storage.serverAssets.Delete(ctx, info.Name); err != nil && !errors.Is(err, jetstream.ErrObjectNotFound) {
			m.core.logger.Warn("Failed to delete orphan asset upload chunk", "chunk_key", info.Name, "error", err)
		}
	}
	return nil
}

func (m *AssetUploadModel) cleanupExpiredPendingAssets(ctx context.Context, now time.Time) error {
	claimed := make(map[string]struct{})
	for _, owner := range m.core.assetLifecycle().MessageAssetOwners() {
		if owner.AssetID != "" && !m.core.assetLifecycle().MessageTombstoned(owner.MessageEventID) {
			claimed[owner.AssetID] = struct{}{}
		}
	}
	for _, declared := range m.core.assetLifecycle().PendingExpiredAssets(now) {
		asset := declared.GetAsset()
		if asset == nil || asset.GetId() == "" {
			continue
		}
		if _, ok := claimed[asset.GetId()]; ok {
			continue
		}
		roomID := declared.GetRoomId()
		if roomID == "" {
			if projectedRoomID, ok := m.core.assetLifecycle().AssetRoomID(asset.GetId()); ok {
				roomID = projectedRoomID
			}
		}
		if roomID == "" {
			continue
		}
		attachment := attachmentFromAsset(asset)
		if attachment == nil {
			continue
		}
		attachment.RoomId = roomID
		if err := m.core.assetLifecycle().RecordAssetDeleted(ctx, SystemActorID, roomID, asset.GetId()); err != nil {
			return fmt.Errorf("record expired pending asset deletion: %w", err)
		}
		if err := m.core.media().DeleteAttachmentFromStorage(ctx, attachment); err != nil {
			m.core.logger.Warn("Failed to delete expired pending attachment binary", "attachment_id", asset.GetId(), "error", err)
		}
	}
	return nil
}

func (m *AssetUploadModel) checkUploadSize(contentType string, size int64) error {
	maxSize := m.core.AssetsConfig().MaxUploadSize
	if strings.HasPrefix(contentType, "video/") && m.core.VideoMaxUploadSize > 0 {
		maxSize = m.core.VideoMaxUploadSize
	}
	if size > maxSize {
		return fmt.Errorf("attachment exceeds maximum size of %d bytes: %w", maxSize, ErrInvalidArgument)
	}
	return nil
}

func (m *AssetUploadModel) authorizeUpload(ctx context.Context, actorID, roomID string, voiceMessage bool) error {
	room, kind, err := m.core.requireRoomMember(ctx, actorID, roomID)
	if err != nil {
		return err
	}
	if room.Archived {
		return ErrRoomArchived
	}
	if voiceMessage {
		canSendVoiceMessages, err := m.core.CanSendVoiceMessages(ctx, actorID, kind, room.Id)
		if err != nil {
			return err
		}
		if !canSendVoiceMessages {
			return ErrPermissionDenied
		}
		return nil
	}
	canAttach, err := m.core.CanAttachFiles(ctx, actorID, kind, room.Id)
	if err != nil {
		return err
	}
	if !canAttach {
		return ErrPermissionDenied
	}
	return nil
}

func cloneVoiceMessageUploadMetadata(metadata *VoiceMessageUploadMetadata) *VoiceMessageUploadMetadata {
	if metadata == nil {
		return nil
	}
	return &VoiceMessageUploadMetadata{
		DurationMS:    metadata.DurationMS,
		WaveformPeaks: append([]float32(nil), metadata.WaveformPeaks...),
	}
}

func (m *AssetUploadModel) loadUpload(ctx context.Context, uploadID string) (*AssetUploadSession, uint64, error) {
	uploadID = strings.TrimSpace(uploadID)
	if uploadID == "" {
		return nil, 0, invalidArgument("upload_id is required")
	}
	entry, err := m.core.storage.runtimeStateKV.Get(ctx, assetUploadKey(uploadID))
	if err != nil {
		if errors.Is(err, jetstream.ErrKeyNotFound) || errors.Is(err, jetstream.ErrKeyDeleted) {
			return nil, 0, ErrNotFound
		}
		return nil, 0, fmt.Errorf("load upload session: %w", err)
	}
	var session AssetUploadSession
	if err := json.Unmarshal(entry.Value(), &session); err != nil {
		return nil, 0, fmt.Errorf("decode upload session: %w", err)
	}
	if session.ExpiresAt.Before(time.Now()) && session.Status == AssetUploadStatusOpen {
		session.Status = AssetUploadStatusCancelled
		return &session, entry.Revision(), ErrNotFound
	}
	return &session, entry.Revision(), nil
}

func (m *AssetUploadModel) updateUpload(ctx context.Context, session *AssetUploadSession, revision uint64) error {
	value, err := json.Marshal(session)
	if err != nil {
		return err
	}
	ttl := time.Until(session.ExpiresAt)
	if ttl <= 0 {
		ttl = time.Second
	}
	if _, err := m.core.updateRuntimeStateTokenTTL(ctx, assetUploadKey(session.UploadID), value, revision, ttl); err != nil {
		return fmt.Errorf("update upload session: %w", err)
	}
	return nil
}

func (m *AssetUploadModel) materializeUpload(ctx context.Context, session *AssetUploadSession) (*os.File, error) {
	tmp, err := os.CreateTemp("", "chatto-asset-upload-*")
	if err != nil {
		return nil, fmt.Errorf("create upload temp file: %w", err)
	}
	cleanup := true
	defer func() {
		if cleanup {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()
	chunkKeys := append([]string(nil), session.ChunkKeys...)
	sort.Slice(chunkKeys, func(i, j int) bool {
		return chunkOffset(chunkKeys[i]) < chunkOffset(chunkKeys[j])
	})
	hasher := sha256.New()
	w := io.MultiWriter(tmp, hasher)
	for _, key := range chunkKeys {
		obj, err := m.core.storage.serverAssets.Get(ctx, key)
		if err != nil {
			return nil, fmt.Errorf("read upload chunk: %w", err)
		}
		if _, err := io.Copy(w, obj); err != nil {
			obj.Close()
			return nil, fmt.Errorf("copy upload chunk: %w", err)
		}
		if err := obj.Close(); err != nil {
			return nil, fmt.Errorf("close upload chunk: %w", err)
		}
	}
	if got := hex.EncodeToString(hasher.Sum(nil)); got != session.SHA256 {
		return nil, invalidArgument("sha256 does not match uploaded content")
	}
	if pos, err := tmp.Seek(0, io.SeekStart); err != nil || pos != 0 {
		return nil, fmt.Errorf("rewind upload temp file: %w", err)
	}
	cleanup = false
	return tmp, nil
}

func (m *AssetUploadModel) storeCompletedUpload(ctx context.Context, session *AssetUploadSession, reader io.ReadSeeker) (*corev1.Attachment, bool, error) {
	attachmentID := NewAssetID()
	payload, err := prepareCompletedUploadPayload(ctx, session, reader, m.core.mediaTranscodeLimiter, m.core.MediaFFmpegPath, m.core.MediaFFprobePath)
	if err != nil {
		return nil, false, err
	}
	defer payload.cleanup()

	reader = payload.reader
	contentType := payload.contentType
	filename := payload.filename
	isImage := strings.HasPrefix(contentType, "image/")
	var content []byte
	var size int64
	var width, height int32
	var animatedGIF bool

	if isImage {
		result, err := assets.ProcessAttachmentImageWithConfig(reader, m.core.AssetsConfig())
		if err != nil {
			return nil, false, fmt.Errorf("failed to process image: %w", err)
		}
		content = result.Original
		size = int64(len(content))
		width = int32(result.Width)
		height = int32(result.Height)
		animatedGIF = contentType == "image/gif" && assets.IsAnimatedGIF(content)
		reader = bytes.NewReader(content)
	} else {
		size = payload.size
		if _, err := reader.Seek(0, io.SeekStart); err != nil {
			return nil, false, fmt.Errorf("rewind upload temp file: %w", err)
		}
	}
	if err := m.checkUploadSize(contentType, size); err != nil {
		return nil, false, err
	}
	if err := validateVoiceMessageUpload(session.VoiceMessage, contentType, size); err != nil {
		return nil, false, err
	}
	if !m.core.ShouldUseS3() {
		if err := m.setCapacityReservation(ctx, session.UploadID, size, session.ExpiresAt); err != nil {
			return nil, false, err
		}
	}

	var storage *corev1.DeprecatedAsset
	if m.core.ShouldUseS3() {
		s3Key := S3KeyAttachment(attachmentID)
		if _, err := m.core.s3Client.PutObject(ctx, s3Key, reader, size, contentType); err != nil {
			return nil, false, fmt.Errorf("failed to upload attachment to S3: %w", err)
		}
		storage = &corev1.DeprecatedAsset{
			Asset: &corev1.DeprecatedAsset_S3{
				S3: &corev1.S3Asset{Key: s3Key, Bucket: proto.String(m.core.s3Client.Bucket())},
			},
		}
	} else {
		if _, err := reader.Seek(0, io.SeekStart); err != nil {
			return nil, false, fmt.Errorf("rewind upload temp file: %w", err)
		}
		if _, err := m.core.storage.serverAssets.Put(ctx, jetstream.ObjectMeta{
			Name: attachmentID,
			Headers: map[string][]string{
				"Content-Type": {contentType},
				"Filename":     {filename},
				"Room-Id":      {session.RoomID},
			},
		}, reader); err != nil {
			return nil, false, fmt.Errorf("failed to store attachment: %w", err)
		}
		storage = &corev1.DeprecatedAsset{
			Asset: &corev1.DeprecatedAsset_Nats{
				Nats: &corev1.NATSAsset{Key: attachmentID},
			},
		}
	}

	return &corev1.Attachment{
		Id:           attachmentID,
		RoomId:       session.RoomID,
		Filename:     filename,
		ContentType:  contentType,
		Size:         size,
		Width:        width,
		Height:       height,
		Storage:      storage,
		VoiceMessage: voiceMessageMetadataProto(session.VoiceMessage),
	}, animatedGIF, nil
}

func prepareCompletedUploadPayload(
	ctx context.Context,
	session *AssetUploadSession,
	reader io.ReadSeeker,
	transcodeLimiter *runtimecap.Limiter,
	ffmpegPath string,
	ffprobePath string,
) (*completedUploadPayload, error) {
	payload := &completedUploadPayload{
		reader:      reader,
		cleanup:     func() {},
		filename:    session.Filename,
		contentType: session.ContentType,
		size:        session.Size,
	}
	if session.VoiceMessage == nil {
		return payload, nil
	}
	payload.filename = normalizedVoiceMessageFilename(session.Filename)
	payload.contentType = normalizedVoiceMessageContentType
	input, ok := reader.(*os.File)
	if !ok {
		return nil, fmt.Errorf("voice message verification requires a materialized upload file")
	}
	if transcodeLimiter == nil {
		return nil, fmt.Errorf("voice message media verification capacity is not initialized")
	}
	if err := transcodeLimiter.Acquire(ctx); err != nil {
		return nil, err
	}
	defer transcodeLimiter.Release()
	if err := verifyVoiceMessageDuration(ctx, session, ffprobePath, input.Name()); err != nil {
		return nil, err
	}
	if session.ContentType == normalizedVoiceMessageContentType {
		return payload, nil
	}

	output, err := os.CreateTemp("", "towk-voice-message-*.m4a")
	if err != nil {
		return nil, fmt.Errorf("create normalized voice message temp file: %w", err)
	}
	outputPath := output.Name()
	if err := output.Close(); err != nil {
		os.Remove(outputPath)
		return nil, fmt.Errorf("close normalized voice message temp file: %w", err)
	}
	if err := voiceMessageTranscodeToMP4(ctx, ffmpegPath, input.Name(), outputPath); err != nil {
		os.Remove(outputPath)
		return nil, err
	}

	outputReader, err := os.Open(outputPath)
	if err != nil {
		os.Remove(outputPath)
		return nil, fmt.Errorf("open normalized voice message: %w", err)
	}
	cleanup := func() {
		outputReader.Close()
		os.Remove(outputPath)
	}
	if err := validateVoiceMessageContainer(outputReader, normalizedVoiceMessageContentType); err != nil {
		cleanup()
		return nil, err
	}
	if err := verifyVoiceMessageDuration(ctx, session, ffprobePath, outputPath); err != nil {
		cleanup()
		return nil, err
	}
	info, err := outputReader.Stat()
	if err != nil {
		cleanup()
		return nil, fmt.Errorf("stat normalized voice message: %w", err)
	}
	if info.Size() <= 0 {
		cleanup()
		return nil, invalidArgument("normalized voice message must contain audio data")
	}
	if _, err := outputReader.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, fmt.Errorf("rewind normalized voice message: %w", err)
	}

	payload.reader = outputReader
	payload.cleanup = cleanup
	payload.size = info.Size()
	return payload, nil
}

func normalizedVoiceMessageFilename(filename string) string {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return "voice-message" + normalizedVoiceMessageExtension
	}
	ext := filepath.Ext(filename)
	if ext == "" {
		return filename + normalizedVoiceMessageExtension
	}
	return strings.TrimSuffix(filename, ext) + normalizedVoiceMessageExtension
}

type voiceMessageProbeOutput struct {
	Streams []voiceMessageProbeStream `json:"streams"`
	Format  struct {
		Duration string `json:"duration"`
	} `json:"format"`
}

type voiceMessageProbeStream struct {
	CodecType string `json:"codec_type"`
	Duration  string `json:"duration"`
}

func verifyVoiceMessageDuration(ctx context.Context, session *AssetUploadSession, ffprobePath, inputPath string) error {
	if session == nil || session.VoiceMessage == nil {
		return nil
	}
	durationMS, err := voiceMessageProbeDuration(ctx, ffprobePath, inputPath)
	if err != nil {
		if errors.Is(err, ErrInvalidArgument) {
			return err
		}
		return fmt.Errorf("verify voice message duration: %w", err)
	}
	if durationMS < MinVoiceMessageDurationMS || durationMS > MaxVoiceMessageDurationMS {
		return invalidArgument(fmt.Sprintf("voice message audio duration must be between %d and %d milliseconds", MinVoiceMessageDurationMS, MaxVoiceMessageDurationMS))
	}
	declared := session.VoiceMessage.DurationMS
	if absInt64(durationMS-declared) > voiceMessageDurationToleranceMS {
		return invalidArgument("voice message declared duration does not match the uploaded audio")
	}
	session.VoiceMessage.DurationMS = durationMS
	return nil
}

func runVoiceMessageProbeDuration(ctx context.Context, ffprobePath, inputPath string) (int64, error) {
	if ffprobePath == "" {
		var err error
		ffprobePath, err = exec.LookPath("ffprobe")
		if err != nil {
			return 0, fmt.Errorf("ffprobe is required to verify voice message duration: %w", err)
		}
	}
	probeCtx, cancel := context.WithTimeout(ctx, voiceMessageProbeTimeout)
	defer cancel()
	cmd := exec.CommandContext(
		probeCtx,
		ffprobePath,
		"-v",
		"error",
		"-print_format",
		"json",
		"-show_streams",
		"-show_format",
		inputPath,
	)
	output, err := cmd.Output()
	if err != nil {
		if errors.Is(probeCtx.Err(), context.DeadlineExceeded) {
			return 0, invalidArgument("voice message audio duration could not be determined before timeout")
		}
		return 0, invalidArgument("voice message audio metadata could not be verified")
	}
	var probe voiceMessageProbeOutput
	if err := json.Unmarshal(output, &probe); err != nil {
		return 0, fmt.Errorf("parse voice message duration probe: %w", err)
	}
	hasAudio := false
	durationMS, ok := parseProbeDurationMS(probe.Format.Duration)
	for _, stream := range probe.Streams {
		if stream.CodecType == "video" {
			return 0, invalidArgument("voice messages must not contain a video track")
		}
		if stream.CodecType != "audio" {
			continue
		}
		hasAudio = true
		if !ok {
			durationMS, ok = parseProbeDurationMS(stream.Duration)
		}
	}
	if !hasAudio {
		return 0, invalidArgument("voice messages must contain an audio track")
	}
	if !ok {
		return 0, invalidArgument("voice message audio duration could not be determined")
	}
	return durationMS, nil
}

func parseProbeDurationMS(raw string) (int64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "N/A" {
		return 0, false
	}
	seconds, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 {
		return 0, false
	}
	return int64(math.Round(seconds * 1000)), true
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func runVoiceMessageTranscodeToMP4(ctx context.Context, ffmpegPath, inputPath, outputPath string) error {
	if ffmpegPath == "" {
		var err error
		ffmpegPath, err = exec.LookPath("ffmpeg")
		if err != nil {
			return fmt.Errorf("ffmpeg is required to normalize voice messages for iOS playback: %w", err)
		}
	}
	transcodeCtx, cancel := context.WithTimeout(ctx, voiceMessageTranscodeTimeout)
	defer cancel()
	cmd := exec.CommandContext(
		transcodeCtx,
		ffmpegPath,
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		inputPath,
		"-t",
		fmt.Sprintf("%.3f", float64(MaxVoiceMessageDurationMS+voiceMessageDurationToleranceMS)/1000),
		"-vn",
		"-map",
		"0:a:0",
		"-c:a",
		"aac",
		"-b:a",
		"96k",
		"-movflags",
		"+faststart",
		"-f",
		"mp4",
		"-y",
		outputPath,
	)
	if err := cmd.Run(); err != nil {
		if errors.Is(transcodeCtx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("voice message normalization timed out after %s", voiceMessageTranscodeTimeout)
		}
		return fmt.Errorf("voice message normalization failed: %w", err)
	}
	return nil
}

func (m *AssetUploadModel) deleteUploadChunks(ctx context.Context, session *AssetUploadSession) {
	for _, key := range session.ChunkKeys {
		if err := m.core.storage.serverAssets.Delete(ctx, key); err != nil && !errors.Is(err, jetstream.ErrObjectNotFound) {
			m.core.logger.Warn("Failed to delete asset upload chunk", "upload_id", session.UploadID, "error", err)
		}
	}
}

func (m *AssetUploadModel) reserveCapacity(ctx context.Context, uploadID string, size int64, expiresAt time.Time) error {
	remaining := initialAssetUploadReservationBytes(size, m.core.ShouldUseS3())
	for range assetUploadCapacityMaxRetries {
		now := time.Now()
		ledger, revision, absent, err := m.loadCapacityReservationsWithRevision(ctx)
		if err != nil {
			return err
		}
		pruneAssetUploadCapacityLedger(&ledger, now)
		if len(ledger.Reservations) >= assetUploadCapacityMaxEntries {
			return ErrAssetStorageCapacity
		}

		usedBytes, maxBytes, err := m.serverAssetsCapacity(ctx)
		if err != nil {
			return err
		}
		reservedBytes := assetUploadReservedBytes(ledger)
		headroomBytes := assetUploadCapacityHeadroom(maxBytes)
		if exceedsInt64Limit(maxBytes, usedBytes, reservedBytes, remaining, headroomBytes) {
			// Capacity details are operational data. Keep the public error stable
			// and non-enumerating for authenticated room members.
			return ErrAssetStorageCapacity
		}

		ledger.Reservations[uploadID] = assetUploadCapacityReservation{
			RemainingBytes: remaining,
			ExpiresAt:      expiresAt,
		}
		if err := m.storeCapacityReservations(ctx, ledger, revision, absent); err == nil {
			return nil
		} else if isRuntimeStateRevisionConflict(err) {
			continue
		} else {
			return fmt.Errorf("reserve asset upload capacity: %w", err)
		}
	}
	return fmt.Errorf("asset upload capacity reservation conflicted after %d retries", assetUploadCapacityMaxRetries)
}

func (m *AssetUploadModel) serverAssetsCapacity(ctx context.Context) (int64, int64, error) {
	// ObjectStore.Status mutates cached stream information in nats.go and is not
	// safe for concurrent calls on the shared ObjectStore handle. A fresh stream
	// handle keeps admission race-free and exposes the effective runtime quota.
	stream, err := m.core.js.Stream(ctx, "OBJ_SERVER_ASSETS")
	if err != nil {
		return 0, 0, fmt.Errorf("open SERVER_ASSETS stream: %w", err)
	}
	info, err := stream.Info(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("inspect SERVER_ASSETS capacity: %w", err)
	}
	return saturatingUint64ToInt64(info.State.Bytes), info.Config.MaxBytes, nil
}

func (m *AssetUploadModel) reduceCapacityReservation(ctx context.Context, uploadID string, committedBytes int64) error {
	if committedBytes <= 0 {
		return nil
	}
	return m.mutateCapacityReservation(ctx, uploadID, func(reservation assetUploadCapacityReservation) (assetUploadCapacityReservation, bool) {
		reservation.RemainingBytes = max(0, reservation.RemainingBytes-committedBytes)
		return reservation, true
	})
}

func (m *AssetUploadModel) setCapacityReservation(
	ctx context.Context,
	uploadID string,
	remainingBytes int64,
	expiresAt time.Time,
) error {
	if remainingBytes < 0 || !expiresAt.After(time.Now()) {
		return ErrAssetStorageCapacity
	}
	for range assetUploadCapacityMaxRetries {
		now := time.Now()
		ledger, revision, absent, err := m.loadCapacityReservationsWithRevision(ctx)
		if err != nil {
			return err
		}
		pruneAssetUploadCapacityLedger(&ledger, now)
		if _, exists := ledger.Reservations[uploadID]; !exists && len(ledger.Reservations) >= assetUploadCapacityMaxEntries {
			return ErrAssetStorageCapacity
		}

		usedBytes, maxBytes, err := m.serverAssetsCapacity(ctx)
		if err != nil {
			return err
		}
		reservedBytes := assetUploadReservedBytesExcluding(ledger, uploadID)
		headroomBytes := assetUploadCapacityHeadroom(maxBytes)
		if exceedsInt64Limit(maxBytes, usedBytes, reservedBytes, remainingBytes, headroomBytes) {
			return ErrAssetStorageCapacity
		}

		ledger.Reservations[uploadID] = assetUploadCapacityReservation{
			RemainingBytes: remainingBytes,
			ExpiresAt:      expiresAt,
		}
		if err := m.storeCapacityReservations(ctx, ledger, revision, absent); err == nil {
			return nil
		} else if isRuntimeStateRevisionConflict(err) {
			continue
		} else {
			return fmt.Errorf("set asset upload capacity reservation: %w", err)
		}
	}
	return fmt.Errorf("asset upload capacity reservation conflicted after %d retries", assetUploadCapacityMaxRetries)
}

func (m *AssetUploadModel) releaseCapacityBestEffort(ctx context.Context, uploadID string) {
	if err := m.releaseCapacityReservation(ctx, uploadID); err != nil {
		m.core.logger.Warn("Failed to release asset upload capacity reservation", "upload_id", uploadID, "error", err)
	}
}

func (m *AssetUploadModel) releaseCapacityReservation(ctx context.Context, uploadID string) error {
	return m.mutateCapacityReservation(ctx, uploadID, func(reservation assetUploadCapacityReservation) (assetUploadCapacityReservation, bool) {
		return reservation, false
	})
}

func (m *AssetUploadModel) mutateCapacityReservation(ctx context.Context, uploadID string, mutate func(assetUploadCapacityReservation) (assetUploadCapacityReservation, bool)) error {
	for range assetUploadCapacityMaxRetries {
		ledger, revision, absent, err := m.loadCapacityReservationsWithRevision(ctx)
		if err != nil {
			return err
		}
		if absent {
			return nil
		}
		pruneAssetUploadCapacityLedger(&ledger, time.Now())
		reservation, ok := ledger.Reservations[uploadID]
		if !ok {
			return nil
		}
		if updated, keep := mutate(reservation); keep {
			ledger.Reservations[uploadID] = updated
		} else {
			delete(ledger.Reservations, uploadID)
		}
		if err := m.storeCapacityReservations(ctx, ledger, revision, false); err == nil {
			return nil
		} else if isRuntimeStateRevisionConflict(err) {
			continue
		} else {
			return err
		}
	}
	return fmt.Errorf("asset upload capacity update conflicted after %d retries", assetUploadCapacityMaxRetries)
}

func (m *AssetUploadModel) loadCapacityReservations(ctx context.Context) (assetUploadCapacityLedger, error) {
	ledger, _, _, err := m.loadCapacityReservationsWithRevision(ctx)
	return ledger, err
}

func (m *AssetUploadModel) loadCapacityReservationsWithRevision(ctx context.Context) (assetUploadCapacityLedger, uint64, bool, error) {
	ledger := assetUploadCapacityLedger{Reservations: make(map[string]assetUploadCapacityReservation)}
	entry, err := m.core.storage.runtimeStateKV.Get(ctx, assetUploadCapacityKey)
	if err != nil {
		if isRuntimeStateKeyAbsent(err) {
			return ledger, 0, true, nil
		}
		return ledger, 0, false, fmt.Errorf("load asset upload capacity reservations: %w", err)
	}
	if err := json.Unmarshal(entry.Value(), &ledger); err != nil {
		return ledger, 0, false, fmt.Errorf("decode asset upload capacity reservations: %w", err)
	}
	if ledger.Reservations == nil {
		ledger.Reservations = make(map[string]assetUploadCapacityReservation)
	}
	return ledger, entry.Revision(), false, nil
}

func (m *AssetUploadModel) storeCapacityReservations(ctx context.Context, ledger assetUploadCapacityLedger, revision uint64, create bool) error {
	data, err := json.Marshal(ledger)
	if err != nil {
		return err
	}
	ttl := defaultAssetUploadSessionTTL + time.Minute
	if create {
		_, err = m.core.storage.runtimeStateKV.Create(ctx, assetUploadCapacityKey, data, jetstream.KeyTTL(ttl))
		return err
	}
	_, err = m.core.updateRuntimeStateTokenTTL(ctx, assetUploadCapacityKey, data, revision, ttl)
	return err
}

func pruneAssetUploadCapacityLedger(ledger *assetUploadCapacityLedger, now time.Time) {
	for uploadID, reservation := range ledger.Reservations {
		if !reservation.ExpiresAt.After(now) {
			delete(ledger.Reservations, uploadID)
		}
	}
}

func assetUploadReservedBytes(ledger assetUploadCapacityLedger) int64 {
	var total int64
	for _, reservation := range ledger.Reservations {
		total = saturatingAddInt64(total, reservation.RemainingBytes)
	}
	return total
}

func assetUploadReservedBytesExcluding(ledger assetUploadCapacityLedger, uploadID string) int64 {
	total := int64(0)
	for reservedUploadID, reservation := range ledger.Reservations {
		if reservedUploadID == uploadID {
			continue
		}
		total = saturatingAddInt64(total, reservation.RemainingBytes)
	}
	return total
}

func initialAssetUploadReservationBytes(size int64, useS3 bool) int64 {
	if useS3 {
		return size
	}
	return saturatingAddInt64(size, size)
}

func assetUploadCapacityHeadroom(maxBytes int64) int64 {
	if maxBytes <= 0 {
		return 0
	}
	return max(1, maxBytes/assetUploadCapacityHeadroomRatio)
}

func saturatingUint64ToInt64(value uint64) int64 {
	if value > math.MaxInt64 {
		return math.MaxInt64
	}
	return int64(value)
}

func saturatingAddInt64(values ...int64) int64 {
	var total int64
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if total > math.MaxInt64-value {
			return math.MaxInt64
		}
		total += value
	}
	return total
}

func exceedsInt64Limit(limit int64, values ...int64) bool {
	if limit < 0 {
		return true
	}
	remaining := limit
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if value > remaining {
			return true
		}
		remaining -= value
	}
	return false
}

func assetUploadKey(uploadID string) string {
	return assetUploadKeyPrefix + uploadID
}

func assetUploadTempObjectKey(uploadID string, offset int64) string {
	return fmt.Sprintf("%s%s.%020d.%s", assetUploadTempObjectPrefix, uploadID, offset, NewAssetID())
}

func chunkOffset(key string) int64 {
	parts := strings.Split(strings.TrimPrefix(key, assetUploadTempObjectPrefix), ".")
	for i := len(parts) - 1; i >= 0; i-- {
		if len(parts[i]) != 20 {
			continue
		}
		offset, err := strconv.ParseInt(parts[i], 10, 64)
		if err == nil {
			return offset
		}
	}
	return 0
}

func validSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil && strings.ToLower(value) == value
}
