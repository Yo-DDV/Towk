package core

import (
	"context"
	"errors"
	"fmt"
	"github.com/nats-io/nats.go/jetstream"
	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"slices"
	"sort"
	"time"
)

func (c *ChattoCore) purgeRoomAssets(ctx context.Context, actorID, roomID string, references *roomPurgeReferences) (attachmentsDeleted int, eventsDeleted int, err error) {
	creationByID := make(map[string]*corev1.AssetCreatedEvent)
	orderedIDs := make([]string, 0)
	for _, creation := range c.Assets.RoomAssetCreations(roomID) {
		if creation == nil || creation.GetAsset() == nil || creation.GetAsset().GetId() == "" {
			continue
		}
		assetID := creation.GetAsset().GetId()
		references.assetIDs[assetID] = struct{}{}
		creationByID[assetID] = creation
		orderedIDs = append(orderedIDs, assetID)
	}
	remaining := make([]string, 0, len(references.assetIDs))
	alreadyOrdered := make(map[string]struct{}, len(orderedIDs))
	for _, assetID := range orderedIDs {
		alreadyOrdered[assetID] = struct{}{}
	}
	for assetID := range references.provenAssetIDs {
		if _, present := alreadyOrdered[assetID]; !present {
			remaining = append(remaining, assetID)
		}
	}
	sort.Strings(remaining)
	orderedIDs = append(orderedIDs, remaining...)

	processed := make(map[string]struct{}, len(orderedIDs))
	for _, assetID := range orderedIDs {
		if _, done := processed[assetID]; done {
			continue
		}
		if err := events.ValidateSecureDeleteAggregate(events.AssetAggregate(assetID)); err != nil {
			return attachmentsDeleted, eventsDeleted, fmt.Errorf("room attachment has invalid asset id")
		}

		creation := creationByID[assetID]
		if creation == nil {
			creation, _ = c.Assets.AssetCreation(assetID)
		}
		if creation != nil && creation.GetAsset() != nil {
			if ownerRoomID, ok := c.Assets.AssetRoomID(assetID); !ok || ownerRoomID != roomID {
				return attachmentsDeleted, eventsDeleted, fmt.Errorf("room attachment ownership mismatch")
			}
		}

		_, alreadyCleaned := references.cleanedAttachmentIDs[assetID]
		attachment := &corev1.Attachment{Id: assetID, RoomId: roomID}
		if creation != nil && creation.GetAsset() != nil {
			hydrated := attachmentFromAsset(creation.GetAsset())
			if hydrated == nil {
				return attachmentsDeleted, eventsDeleted, fmt.Errorf("room attachment metadata is invalid")
			}
			attachment = hydrated
			attachment.RoomId = roomID
		}
		deleteErr := c.media().DeleteAttachmentFromStorage(ctx, attachment)
		if deleteErr != nil && !roomPurgeStorageAlreadyMissing(deleteErr) {
			return attachmentsDeleted, eventsDeleted, fmt.Errorf("delete room attachment: %w", deleteErr)
		}
		// Re-run the storage delete on every reconciliation pass. A writer that
		// was authorized before the tombstone can recreate bytes after an earlier
		// pass; the in-memory cleaned set controls only the summary counter.
		if !alreadyCleaned && deleteErr == nil {
			attachmentsDeleted++
		}
		references.cleanedAttachmentIDs[assetID] = struct{}{}
		deleted, err := c.replaceAssetHistoryWithTombstone(ctx, actorID, assetID)
		if err != nil {
			return attachmentsDeleted, eventsDeleted, err
		}
		eventsDeleted += deleted
		processed[assetID] = struct{}{}
	}

	legacyIDs := make([]string, 0, len(references.legacyAttachments))
	for assetID := range references.legacyAttachments {
		legacyIDs = append(legacyIDs, assetID)
	}
	sort.Strings(legacyIDs)
	for _, assetID := range legacyIDs {
		if _, current := processed[assetID]; current {
			continue
		}
		_, alreadyCleaned := references.cleanedAttachmentIDs[assetID]
		attachment := references.legacyAttachments[assetID]
		if attachment == nil {
			continue
		}
		if attachment.GetRoomId() != roomID {
			if attachment.GetRoomId() != "" {
				return attachmentsDeleted, eventsDeleted, fmt.Errorf("legacy attachment ownership mismatch")
			}
			c.logger.Warn("Skipped legacy attachment without room ownership evidence", "room_id", roomID, "attachment_id", assetID)
			continue
		}
		if err := events.ValidateSecureDeleteAggregate(events.AssetAggregate(assetID)); err != nil {
			return attachmentsDeleted, eventsDeleted, fmt.Errorf("legacy attachment has invalid asset id")
		}
		deleteErr := c.media().DeleteAttachmentFromStorage(ctx, attachment)
		if deleteErr != nil && !roomPurgeStorageAlreadyMissing(deleteErr) {
			return attachmentsDeleted, eventsDeleted, fmt.Errorf("delete legacy room attachment: %w", deleteErr)
		}
		if !alreadyCleaned && deleteErr == nil {
			attachmentsDeleted++
		}
		references.cleanedAttachmentIDs[assetID] = struct{}{}
		deleted, err := c.replaceAssetHistoryWithTombstone(ctx, actorID, assetID)
		if err != nil {
			return attachmentsDeleted, eventsDeleted, err
		}
		eventsDeleted += deleted
		references.assetIDs[assetID] = struct{}{}
	}
	return attachmentsDeleted, eventsDeleted, nil
}

func (c *ChattoCore) replaceAssetHistoryWithTombstone(ctx context.Context, actorID, assetID string) (int, error) {
	aggregate := events.AssetAggregate(assetID)
	if err := events.ValidateSecureDeleteAggregate(aggregate); err != nil {
		return 0, err
	}
	filter := aggregate.AllEventsFilter()
	var lastErr error
	for attempt := 0; attempt < roomPurgeMaxOCCAttempts; attempt++ {
		expectedSeq, err := c.EventPublisher.LastSubjectSeq(ctx, filter)
		if err != nil {
			return 0, fmt.Errorf("read asset purge OCC tail: %w", err)
		}
		tombstone := newEvent(actorID, &corev1.Event{Event: &corev1.Event_AssetDeleted{
			AssetDeleted: &corev1.AssetDeletedEvent{AssetId: assetID},
		}})
		subject := aggregate.SubjectFor(tombstone)
		seq, err := c.EventPublisher.AppendAtFilter(ctx, subject, tombstone, filter, expectedSeq)
		if err != nil {
			if errors.Is(err, events.ErrConflict) {
				lastErr = err
				continue
			}
			return 0, fmt.Errorf("append asset purge tombstone: %w", err)
		}
		if err := c.AssetsProjector.WaitFor(ctx, events.SubjectPosition(subject, seq)); err != nil {
			return 0, fmt.Errorf("wait for asset purge tombstone: %w", err)
		}
		deleted, err := c.EventPublisher.SecureDeleteAggregateThroughExcept(
			ctx,
			aggregate,
			seq,
			map[uint64]struct{}{seq: {}},
		)
		if err != nil {
			return deleted, fmt.Errorf("secure-delete asset history: %w", err)
		}
		return deleted, nil
	}
	return 0, fmt.Errorf("append asset purge tombstone after %d attempts: %w", roomPurgeMaxOCCAttempts, lastErr)
}

func roomPurgeStorageAlreadyMissing(err error) bool {
	if err == nil {
		return false
	}
	return roomPurgeAllErrorLeavesMatch(err, func(leaf error) bool {
		return errors.Is(leaf, jetstream.ErrObjectNotFound) || IsNoSuchKeyError(leaf)
	})
}

func roomPurgeAllErrorLeavesMatch(err error, match func(error) bool) bool {
	if err == nil || match == nil {
		return false
	}
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		children := joined.Unwrap()
		if len(children) == 0 {
			return match(err)
		}
		for _, child := range children {
			if !roomPurgeAllErrorLeavesMatch(child, match) {
				return false
			}
		}
		return true
	}
	if wrapped, ok := err.(interface{ Unwrap() error }); ok {
		if child := wrapped.Unwrap(); child != nil {
			return roomPurgeAllErrorLeavesMatch(child, match)
		}
	}
	return match(err)
}

func (c *ChattoCore) purgeRoomLinkPreviewAssets(ctx context.Context, roomID string, references *roomPurgeReferences) (int, error) {
	candidates := make(map[string]struct{})
	for assetID := range references.linkPreviewIDs {
		if err := events.ValidateSecureDeleteAggregate(events.AssetAggregate(assetID)); err != nil {
			return 0, fmt.Errorf("link preview has invalid asset id")
		}
		candidates[assetID] = struct{}{}
	}
	if len(candidates) == 0 {
		return 0, nil
	}

	exclusive, err := c.exclusiveRoomLinkPreviewAssetIDs(ctx, roomID, candidates)
	if err != nil {
		return 0, err
	}
	ids := sortedSetKeys(candidates)
	deleted := 0
	for _, assetID := range ids {
		_, alreadyCleaned := references.cleanedLinkPreviewIDs[assetID]
		if _, belongsOnlyToRoom := exclusive[assetID]; !belongsOnlyToRoom {
			// Shared previews are cache objects, not room-owned attachments. The
			// target room's durable reference is erased while the shared bytes stay
			// available to the other room.
			references.cleanedLinkPreviewIDs[assetID] = struct{}{}
			continue
		}

		// Current preview images live in the dedicated LINK_PREVIEW_ASSETS
		// object store. Its ObjectInfo is the ownership proof used by
		// deleteLinkPreviewCompatibilityLink: a same-named SERVER_ASSETS object
		// is deleted only when it is the exact compatibility link to this target.
		// Never synthesize a generic SERVER_ASSETS or S3 key from an event-provided
		// ID; a corrupt body must not be able to erase branding or another asset.
		info, err := c.storage.linkPreviewAssets.GetInfo(ctx, assetID)
		if errors.Is(err, jetstream.ErrObjectNotFound) {
			// No managed preview bytes remain. Ambiguous pre-dedicated-store legacy
			// objects are intentionally retained because the room event alone is not
			// sufficient proof that a generic server asset belongs exclusively to it.
			if err := c.storage.runtimeStateKV.Purge(ctx, linkPreviewAssetKey(assetID)); err != nil && !isRuntimeStateKeyAbsent(err) {
				return deleted, fmt.Errorf("purge missing link preview lifecycle state: %w", err)
			}
			references.cleanedLinkPreviewIDs[assetID] = struct{}{}
			continue
		}
		if err != nil {
			return deleted, fmt.Errorf("inspect link preview asset: %w", err)
		}
		if info == nil || info.Name != assetID || info.Deleted {
			return deleted, fmt.Errorf("link preview ownership proof is invalid")
		}
		if err := c.deleteLinkPreviewCompatibilityLink(ctx, info); err != nil {
			return deleted, fmt.Errorf("delete link preview compatibility link: %w", err)
		}
		if err := c.storage.linkPreviewAssets.Delete(ctx, assetID); err != nil && !errors.Is(err, jetstream.ErrObjectNotFound) {
			return deleted, fmt.Errorf("delete link preview asset: %w", err)
		}
		if err := c.storage.runtimeStateKV.Purge(ctx, linkPreviewAssetKey(assetID)); err != nil && !isRuntimeStateKeyAbsent(err) {
			return deleted, fmt.Errorf("purge link preview lifecycle state: %w", err)
		}
		if _, err := c.media().DeleteCachedResizesForServerAsset(ctx, assetID); err != nil {
			return deleted, fmt.Errorf("delete link preview resize cache: %w", err)
		}
		references.cleanedLinkPreviewIDs[assetID] = struct{}{}
		if !alreadyCleaned {
			deleted++
		}
	}
	return deleted, nil
}

func (c *ChattoCore) exclusiveRoomLinkPreviewAssetIDs(
	ctx context.Context,
	roomID string,
	candidates map[string]struct{},
) (map[string]struct{}, error) {
	exclusive := make(map[string]struct{}, len(candidates))
	for assetID := range candidates {
		exclusive[assetID] = struct{}{}
	}
	bodyEvents, _, err := c.EventPublisher.SubjectEventsWithSubjectsAfter(
		ctx,
		events.RoomEventTypeFilter(events.EventMessageBody),
		0,
	)
	if err != nil {
		return nil, fmt.Errorf("inspect link preview references before purge: %w", err)
	}
	for _, subjectEvent := range bodyEvents {
		if subjectEvent == nil || subjectEvent.Event == nil {
			continue
		}
		ownerRoomID, ok := events.ParseRoomSubject(subjectEvent.Subject)
		if !ok {
			return nil, fmt.Errorf("message-body event has invalid room subject")
		}
		if ownerRoomID == roomID {
			continue
		}
		bodyEvent := subjectEvent.Event.GetMessageBody()
		if bodyEvent == nil || bodyEvent.GetBody() == nil {
			continue
		}
		preview := bodyEvent.GetBody().GetLinkPreview()
		if preview == nil {
			continue
		}
		assetID := preview.GetImageAssetId()
		if assetID == "" && preview.GetImageAsset() != nil {
			assetID = preview.GetImageAsset().GetId()
		}
		if _, candidate := candidates[assetID]; candidate {
			delete(exclusive, assetID)
		}
	}
	return exclusive, nil
}

func (c *ChattoCore) replaceRoomHistoryWithTombstone(ctx context.Context, actorID, roomID string, expectedSeq uint64) (int, uint64, error) {
	aggregate := events.RoomAggregate(roomID)
	filter := aggregate.AllEventsFilter()
	tombstone := newEvent(actorID, &corev1.Event{Event: &corev1.Event_RoomDeleted{
		RoomDeleted: &corev1.RoomDeletedEvent{RoomId: roomID},
	}})
	subject := aggregate.SubjectFor(tombstone)
	seq, err := c.EventPublisher.AppendAtFilter(ctx, subject, tombstone, filter, expectedSeq)
	if err != nil {
		if errors.Is(err, events.ErrConflict) {
			return 0, 0, events.ErrConflict
		}
		return 0, 0, fmt.Errorf("append final room purge tombstone: %w", err)
	}
	if err := c.WaitForProjectionsCurrent(ctx); err != nil {
		return 0, seq, fmt.Errorf("wait for final room purge tombstone: %w", err)
	}
	deleted, err := c.EventPublisher.SecureDeleteAggregateThroughExcept(
		ctx,
		aggregate,
		seq,
		map[uint64]struct{}{seq: {}},
	)
	if err != nil {
		return deleted, seq, fmt.Errorf("secure-delete room history: %w", err)
	}
	return deleted, seq, nil
}

func (c *ChattoCore) roomPurgeIsQuiescent(ctx context.Context, roomID string, references *roomPurgeReferences) (bool, error) {
	roomEvents, _, err := c.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(roomID).AllEventsFilter())
	if err != nil {
		return false, fmt.Errorf("inspect purged room history: %w", err)
	}
	if len(roomEvents) != 1 || roomEvents[0].GetRoomDeleted().GetRoomId() != roomID {
		return false, nil
	}
	rbacEvents, _, err := c.EventPublisher.SubjectEvents(ctx, events.RBACScopedAggregate(roomID).AllEventsFilter())
	if err != nil {
		return false, fmt.Errorf("inspect purged room RBAC history: %w", err)
	}
	if len(rbacEvents) != 0 || len(c.Assets.RoomAssetCreations(roomID)) != 0 {
		return false, nil
	}
	for assetID := range references.provenAssetIDs {
		assetEvents, _, err := c.EventPublisher.SubjectEvents(ctx, events.AssetAggregate(assetID).AllEventsFilter())
		if err != nil {
			return false, fmt.Errorf("inspect purged asset history: %w", err)
		}
		if len(assetEvents) != 1 || assetEvents[0].GetAssetDeleted().GetAssetId() != assetID {
			return false, nil
		}
	}
	preferenceEvents, err := c.EventPublisher.RoomNotificationPreferenceEventCount(ctx, roomID)
	if err != nil {
		return false, fmt.Errorf("inspect purged room notification preferences: %w", err)
	}
	if preferenceEvents != 0 {
		return false, nil
	}
	for _, group := range c.RoomGroups.All() {
		if group != nil && slices.Contains(group.GetRoomIds(), roomID) {
			return false, nil
		}
	}
	runtimeKeys, err := c.roomRuntimeStateKeyCount(ctx, roomID)
	if err != nil {
		return false, err
	}
	if runtimeKeys != 0 {
		return false, nil
	}
	if c.CallState != nil {
		call := c.CallState.RoomSnapshot(roomID)
		if call.Call.CallID != "" || len(call.Participants) != 0 {
			return false, nil
		}
	}
	return true, nil
}

func sleepRoomPurge(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		if cause := context.Cause(ctx); cause != nil {
			return cause
		}
		return ctx.Err()
	}
}
