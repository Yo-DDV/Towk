package core

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"google.golang.org/protobuf/proto"
	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"sort"
	"time"
)

const (
	roomPurgeStateVersion        = 1
	roomPurgeStateKeyPrefix      = "room_purge."
	roomPurgeLeaseTTL            = 45 * time.Second
	roomPurgeLeaseRenewEvery     = 15 * time.Second
	roomPurgeQuiescenceDelay     = 100 * time.Millisecond
	roomPurgeMaxQuiescencePasses = 8
	roomPurgeMaxOCCAttempts      = 5
)

const (
	roomPurgeStatusInProgress = "in_progress"
	roomPurgeStatusComplete   = "complete"
)

var (
	ErrRoomPurgeInvalidRoomID        = errors.New("invalid room id for permanent deletion")
	ErrRoomPurgeNotArchived          = errors.New("room must be archived before permanent deletion")
	ErrRoomPurgeConfirmationMismatch = errors.New("room purge confirmation does not match")
	ErrRoomPurgeInProgress           = errors.New("room purge is already in progress")
	ErrRoomPurgeNotQuiescent         = errors.New("room purge could not reach a quiescent state")
)

// PurgeArchivedRoomResult is an operational summary. Counts are deliberately
// aggregate-only and never expose message text, filenames, storage keys, or
// other private room content.
type PurgeArchivedRoomResult struct {
	AlreadyPurged            bool
	RoomEventsDeleted        int
	RBACEventsDeleted        int
	AssetEventsDeleted       int
	AttachmentsDeleted       int
	LinkPreviewAssetsDeleted int
}

type roomPurgeState struct {
	Version                  int        `json:"version"`
	Status                   string     `json:"status"`
	GroupID                  string     `json:"groupId,omitempty"`
	ConfirmationSalt         string     `json:"confirmationSalt"`
	ConfirmationDigest       string     `json:"confirmationDigest"`
	StartedAt                time.Time  `json:"startedAt"`
	CompletedAt              *time.Time `json:"completedAt,omitempty"`
	RoomEventsDeleted        int        `json:"roomEventsDeleted,omitempty"`
	RBACEventsDeleted        int        `json:"rbacEventsDeleted,omitempty"`
	AssetEventsDeleted       int        `json:"assetEventsDeleted,omitempty"`
	AttachmentsDeleted       int        `json:"attachmentsDeleted,omitempty"`
	LinkPreviewAssetsDeleted int        `json:"linkPreviewAssetsDeleted,omitempty"`
	PendingAssetIDs          []string   `json:"pendingAssetIds,omitempty"`
	PendingLinkPreviewIDs    []string   `json:"pendingLinkPreviewIds,omitempty"`
	PendingCallKeyRefs       []string   `json:"pendingCallKeyRefs,omitempty"`
}

type roomPurgeReferences struct {
	messageEventIDs       map[string]struct{}
	assetIDs              map[string]struct{}
	provenAssetIDs        map[string]struct{}
	linkPreviewIDs        map[string]struct{}
	callKeyRefs           map[string]struct{}
	legacyAttachments     map[string]*corev1.Attachment
	cleanedAttachmentIDs  map[string]struct{}
	cleanedLinkPreviewIDs map[string]struct{}
	cleanedCallKeyRefs    map[string]struct{}
}

func newRoomPurgeReferences() *roomPurgeReferences {
	return &roomPurgeReferences{
		messageEventIDs:       make(map[string]struct{}),
		assetIDs:              make(map[string]struct{}),
		provenAssetIDs:        make(map[string]struct{}),
		linkPreviewIDs:        make(map[string]struct{}),
		callKeyRefs:           make(map[string]struct{}),
		legacyAttachments:     make(map[string]*corev1.Attachment),
		cleanedAttachmentIDs:  make(map[string]struct{}),
		cleanedLinkPreviewIDs: make(map[string]struct{}),
		cleanedCallKeyRefs:    make(map[string]struct{}),
	}
}

func (r *roomPurgeReferences) mergeSnapshot(snapshot RoomPurgeSnapshot) {
	if r == nil {
		return
	}
	for _, eventID := range snapshot.MessageEventIDs {
		if eventID != "" {
			r.messageEventIDs[eventID] = struct{}{}
		}
	}
	for _, assetID := range snapshot.AssetIDs {
		if assetID != "" {
			r.assetIDs[assetID] = struct{}{}
		}
	}
	for _, assetID := range snapshot.LinkPreviewAssetIDs {
		if assetID != "" {
			r.linkPreviewIDs[assetID] = struct{}{}
		}
	}
	for _, attachment := range snapshot.LegacyAttachments {
		if attachment == nil || attachment.GetId() == "" {
			continue
		}
		r.legacyAttachments[attachment.GetId()] = proto.Clone(attachment).(*corev1.Attachment)
	}
}

func (r *roomPurgeReferences) mergeBody(body *corev1.MessageBody) {
	if r == nil || body == nil {
		return
	}
	for _, assetID := range body.GetAssetIds() {
		if assetID != "" {
			r.assetIDs[assetID] = struct{}{}
		}
	}
	for _, attachment := range body.GetAttachments() {
		if attachment == nil || attachment.GetId() == "" {
			continue
		}
		r.legacyAttachments[attachment.GetId()] = proto.Clone(attachment).(*corev1.Attachment)
	}
	if preview := body.GetLinkPreview(); preview != nil {
		assetID := preview.GetImageAssetId()
		if assetID == "" && preview.GetImageAsset() != nil {
			assetID = preview.GetImageAsset().GetId()
		}
		if assetID != "" {
			r.linkPreviewIDs[assetID] = struct{}{}
		}
	}
}

func (s *roomPurgeState) captureReferences(references *roomPurgeReferences) {
	if s == nil || references == nil {
		return
	}
	s.PendingAssetIDs = sortedSetKeys(references.provenAssetIDs)
	s.PendingLinkPreviewIDs = sortedSetKeys(references.linkPreviewIDs)
	s.PendingCallKeyRefs = sortedSetKeys(references.callKeyRefs)
}

func (s *roomPurgeState) clearPendingReferences() {
	if s == nil {
		return
	}
	s.PendingAssetIDs = nil
	s.PendingLinkPreviewIDs = nil
	s.PendingCallKeyRefs = nil
}

func (r *roomPurgeReferences) mergeState(state roomPurgeState) {
	if r == nil {
		return
	}
	for _, assetID := range state.PendingAssetIDs {
		if assetID != "" {
			r.assetIDs[assetID] = struct{}{}
			r.provenAssetIDs[assetID] = struct{}{}
			r.cleanedAttachmentIDs[assetID] = struct{}{}
		}
	}
	for _, assetID := range state.PendingLinkPreviewIDs {
		if assetID != "" {
			r.linkPreviewIDs[assetID] = struct{}{}
			r.cleanedLinkPreviewIDs[assetID] = struct{}{}
		}
	}
	for _, keyRef := range state.PendingCallKeyRefs {
		if keyRef != "" {
			r.callKeyRefs[keyRef] = struct{}{}
			r.cleanedCallKeyRefs[keyRef] = struct{}{}
		}
	}
}

func sortedSetKeys(values map[string]struct{}) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for value := range values {
		if value != "" {
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}

func roomPurgeStateKey(roomID string) string {
	return roomPurgeStateKeyPrefix + roomID
}

func (c *ChattoCore) newRoomPurgeState(confirmation, groupID string) (roomPurgeState, error) {
	var salt [32]byte
	if _, err := rand.Read(salt[:]); err != nil {
		return roomPurgeState{}, fmt.Errorf("generate purge confirmation salt: %w", err)
	}
	state := roomPurgeState{
		Version:          roomPurgeStateVersion,
		Status:           roomPurgeStatusInProgress,
		GroupID:          groupID,
		ConfirmationSalt: base64.RawURLEncoding.EncodeToString(salt[:]),
		StartedAt:        time.Now().UTC(),
	}
	state.ConfirmationDigest = c.roomPurgeConfirmationDigest(state.ConfirmationSalt, confirmation)
	return state, nil
}

func (c *ChattoCore) roomPurgeConfirmationDigest(encodedSalt, confirmation string) string {
	if c == nil || encodedSalt == "" || confirmation == "" {
		return ""
	}
	if _, err := base64.RawURLEncoding.DecodeString(encodedSalt); err != nil {
		return ""
	}
	// A server-keyed HMAC prevents an offline dictionary attack against the
	// low-entropy room name if a RUNTIME_STATE backup is inspected. The random
	// salt keeps equal names on separate interrupted operations unlinkable.
	return c.runtimeTokenHash("room-purge-confirmation."+encodedSalt, confirmation)
}

func (c *ChattoCore) roomPurgeConfirmationMatches(state roomPurgeState, confirmation string) bool {
	if state.Version != roomPurgeStateVersion || state.ConfirmationSalt == "" || state.ConfirmationDigest == "" {
		return false
	}
	candidate := c.roomPurgeConfirmationDigest(state.ConfirmationSalt, confirmation)
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(state.ConfirmationDigest)) == 1
}

func (s roomPurgeState) result(alreadyPurged bool) *PurgeArchivedRoomResult {
	return &PurgeArchivedRoomResult{
		AlreadyPurged:            alreadyPurged,
		RoomEventsDeleted:        s.RoomEventsDeleted,
		RBACEventsDeleted:        s.RBACEventsDeleted,
		AssetEventsDeleted:       s.AssetEventsDeleted,
		AttachmentsDeleted:       s.AttachmentsDeleted,
		LinkPreviewAssetsDeleted: s.LinkPreviewAssetsDeleted,
	}
}

// PurgeArchivedRoom permanently removes one archived channel room from the
// active Towk instance. Authorization, exact confirmation, idempotency,
// distributed serialization, storage cleanup, exact-subject event erasure, and
// tombstone preservation are enforced at this core authority boundary.
func (c *ChattoCore) PurgeArchivedRoom(ctx context.Context, actorID, roomID, confirmation string) (*PurgeArchivedRoomResult, error) {
	if actorID == "" {
		return nil, ErrNotAuthenticated
	}
	if confirmation == "" {
		return nil, invalidArgument("confirmation is required")
	}
	if err := events.ValidateSecureDeleteAggregate(events.RoomAggregate(roomID)); err != nil {
		return nil, ErrRoomPurgeInvalidRoomID
	}
	owner, err := c.IsServerOwner(ctx, actorID)
	if err != nil {
		return nil, fmt.Errorf("check room purge owner: %w", err)
	}
	if !owner {
		return nil, ErrPermissionDenied
	}

	var result *PurgeArchivedRoomResult
	err = c.withRoomPurgeLease(ctx, roomID, func(operationCtx context.Context) error {
		state, revision, err := c.prepareRoomPurge(operationCtx, roomID, confirmation)
		if err != nil {
			return err
		}
		resumeFromCompletedMarker := state.Status == roomPurgeStatusComplete
		references := newRoomPurgeReferences()
		references.mergeState(state)
		references.mergeSnapshot(c.RoomTimeline.RoomPurgeSnapshot(roomID))
		if _, err := c.collectRoomPurgeReferences(operationCtx, roomID, references); err != nil {
			return err
		}

		if state.Status == roomPurgeStatusComplete {
			stable, err := c.roomPurgeIsQuiescent(operationCtx, roomID, references)
			if err != nil {
				return err
			}
			if stable {
				result = state.result(true)
				return nil
			}

			// A stale in-flight writer can land just after an earlier successful
			// quiescence check. Reopen the durable operation instead of allowing a
			// completed marker to hide residual room-scoped state forever. The
			// original exact confirmation remains required because the room catalog
			// has already been removed.
			state.Status = roomPurgeStatusInProgress
			state.CompletedAt = nil
			revision, err = c.updateRoomPurgeState(operationCtx, roomID, state, revision)
			if err != nil {
				return err
			}
		}

		if err := c.purgeRoomLiveCall(operationCtx, roomID, references); err != nil {
			return err
		}
		if _, err := c.ensureArchivedRoomPurgeTombstone(operationCtx, actorID, roomID, confirmation); err != nil {
			return err
		}
		c.ApplyRoomDeletionCleanup(roomID)
		if err := c.ensureRoomPurgeGroupCascade(operationCtx, actorID, roomID, state.GroupID); err != nil {
			return err
		}
		if err := c.WaitForProjectionsCurrent(operationCtx); err != nil {
			return fmt.Errorf("wait for initial room purge tombstone projections: %w", err)
		}

		c.DismissRoomNotificationsForAllUsers(operationCtx, roomID)

		for pass := 0; pass < roomPurgeMaxQuiescencePasses; pass++ {
			if pass > 0 {
				if err := sleepRoomPurge(operationCtx, roomPurgeQuiescenceDelay); err != nil {
					return err
				}
			}
			if err := c.WaitForProjectionsCurrent(operationCtx); err != nil {
				return fmt.Errorf("wait for room purge reconciliation: %w", err)
			}
			references.mergeSnapshot(c.RoomTimeline.RoomPurgeSnapshot(roomID))
			roomTail, err := c.collectRoomPurgeReferences(operationCtx, roomID, references)
			if err != nil {
				return err
			}

			if err := c.purgeRoomLiveCall(operationCtx, roomID, references); err != nil {
				return err
			}
			if err := c.purgeRoomCallKeys(operationCtx, references); err != nil {
				return err
			}
			attachmentsDeleted, assetEventsDeleted, err := c.purgeRoomAssets(operationCtx, actorID, roomID, references)
			if err != nil {
				return err
			}
			linkPreviewsDeleted, err := c.purgeRoomLinkPreviewAssets(operationCtx, roomID, references)
			if err != nil {
				return err
			}
			if err := c.ensureRoomPurgeGroupCascade(operationCtx, actorID, roomID, state.GroupID); err != nil {
				return err
			}
			rbacDeleted, err := c.EventPublisher.SecureDeleteAggregate(operationCtx, events.RBACScopedAggregate(roomID))
			if err != nil {
				return fmt.Errorf("secure-delete room RBAC history: %w", err)
			}
			if _, err := c.EventPublisher.SecureDeleteRoomNotificationPreferenceEvents(operationCtx, roomID); err != nil {
				return fmt.Errorf("secure-delete room notification preferences: %w", err)
			}
			if _, err := c.purgeRoomRuntimeState(operationCtx, roomID); err != nil {
				return err
			}

			state.captureReferences(references)
			state.AttachmentsDeleted += attachmentsDeleted
			state.AssetEventsDeleted += assetEventsDeleted
			state.LinkPreviewAssetsDeleted += linkPreviewsDeleted
			state.RBACEventsDeleted += rbacDeleted
			revision, err = c.updateRoomPurgeState(operationCtx, roomID, state, revision)
			if err != nil {
				return err
			}

			roomDeleted, finalSeq, err := c.replaceRoomHistoryWithTombstone(operationCtx, actorID, roomID, roomTail)
			if errors.Is(err, events.ErrConflict) {
				continue
			}
			if err != nil {
				return err
			}
			state.RoomEventsDeleted += roomDeleted
			c.ApplyRoomDeletionCleanup(roomID)

			if err := c.WaitForProjectionsCurrent(operationCtx); err != nil {
				return fmt.Errorf("wait for final room purge tombstone projections: %w", err)
			}
			stable, err := c.roomPurgeIsQuiescent(operationCtx, roomID, references)
			if err != nil {
				return err
			}
			if !stable {
				continue
			}

			// Require a second stable observation after a quiet interval. This
			// catches stale in-flight room, RBAC, preference, runtime, asset, or
			// group-layout writes that were authorized before the tombstone but
			// committed immediately after the first check.
			if err := sleepRoomPurge(operationCtx, roomPurgeQuiescenceDelay); err != nil {
				return err
			}
			if err := c.WaitForProjectionsCurrent(operationCtx); err != nil {
				return fmt.Errorf("wait for final room purge stability: %w", err)
			}
			references.mergeSnapshot(c.RoomTimeline.RoomPurgeSnapshot(roomID))
			if _, err := c.collectRoomPurgeReferences(operationCtx, roomID, references); err != nil {
				return err
			}
			if err := c.purgeRoomLiveCall(operationCtx, roomID, references); err != nil {
				return err
			}
			if err := c.purgeRoomCallKeys(operationCtx, references); err != nil {
				return err
			}
			if err := c.ensureRoomPurgeGroupCascade(operationCtx, actorID, roomID, state.GroupID); err != nil {
				return err
			}
			stable, err = c.roomPurgeIsQuiescent(operationCtx, roomID, references)
			if err != nil {
				return err
			}
			if !stable {
				continue
			}

			completedAt := time.Now().UTC()
			state.Status = roomPurgeStatusComplete
			state.CompletedAt = &completedAt
			state.clearPendingReferences()
			if _, err := c.updateRoomPurgeState(operationCtx, roomID, state, revision); err != nil {
				return err
			}
			result = state.result(resumeFromCompletedMarker)
			c.logger.Info("Archived room permanently purged",
				"room_id", roomID,
				"room_events_deleted", state.RoomEventsDeleted,
				"rbac_events_deleted", state.RBACEventsDeleted,
				"asset_events_deleted", state.AssetEventsDeleted,
				"attachments_deleted", state.AttachmentsDeleted,
				"link_preview_assets_deleted", state.LinkPreviewAssetsDeleted,
				"final_sequence", finalSeq)
			return nil
		}
		return ErrRoomPurgeNotQuiescent
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
