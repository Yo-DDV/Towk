package core

import (
	"context"
	"fmt"
	"google.golang.org/protobuf/proto"
	"hmans.de/chatto/internal/events"
	"hmans.de/chatto/internal/kms"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"sort"
)

// collectRoomPurgeReferences reads the exact room aggregate and returns the
// stream tail represented by the collected snapshot. Final tombstone append uses
// that tail as its OCC precondition, so no uninspected event can be erased in the
// same pass.
func (c *ChattoCore) collectRoomPurgeReferences(ctx context.Context, roomID string, references *roomPurgeReferences) (uint64, error) {
	eventsInRoom, lastSeq, err := c.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(roomID).AllEventsFilter())
	if err != nil {
		return 0, fmt.Errorf("read room history for purge references: %w", err)
	}
	for _, event := range eventsInRoom {
		if event == nil {
			continue
		}
		if event.GetMessagePosted() != nil && event.GetId() != "" {
			references.messageEventIDs[event.GetId()] = struct{}{}
		}
		if bodyEvent := event.GetMessageBody(); bodyEvent != nil {
			references.mergeBody(bodyEvent.GetBody())
		}
		if started := event.GetVoiceCallStarted(); started != nil {
			callID := started.GetCallId()
			keyRef := started.GetE2EeKeyRef()
			if callID != "" && keyRef != "" && keyRef == kms.CallKeyRef(callID) {
				references.callKeyRefs[keyRef] = struct{}{}
			}
		}
	}
	if c.CallState != nil {
		snapshot := c.CallState.RoomSnapshot(roomID)
		if snapshot.Call.CallID != "" {
			keyRef := snapshot.Call.E2EEKeyRef
			if keyRef == "" {
				keyRef = kms.CallKeyRef(snapshot.Call.CallID)
			}
			if keyRef == kms.CallKeyRef(snapshot.Call.CallID) {
				references.callKeyRefs[keyRef] = struct{}{}
			}
		}
	}
	for _, creation := range c.Assets.RoomAssetCreations(roomID) {
		if creation == nil || creation.GetAsset() == nil || creation.GetAsset().GetId() == "" {
			continue
		}
		assetID := creation.GetAsset().GetId()
		references.assetIDs[assetID] = struct{}{}
		references.provenAssetIDs[assetID] = struct{}{}
	}
	return lastSeq, nil
}

// RoomAssetCreations returns current room-owned assets deepest-derivative first.
// Deleting children before parents preserves ownership evidence throughout a
// partial purge and makes crash recovery deterministic.
func (p *AssetProjection) RoomAssetCreations(roomID string) []*corev1.AssetCreatedEvent {
	if p == nil || roomID == "" {
		return nil
	}
	p.RLock()
	defer p.RUnlock()

	creations := make(map[string]*corev1.AssetCreatedEvent)
	for assetID, creation := range p.assetCreations {
		if creation == nil || p.assetRoomIDLocked(assetID) != roomID {
			continue
		}
		creations[assetID] = proto.Clone(creation).(*corev1.AssetCreatedEvent)
	}
	out := make([]*corev1.AssetCreatedEvent, 0, len(creations))
	for _, creation := range creations {
		out = append(out, creation)
	}
	depth := func(assetID string) int {
		seen := make(map[string]struct{})
		current := creations[assetID]
		value := 0
		for current != nil && current.GetParentAssetId() != "" {
			parentID := current.GetParentAssetId()
			if _, looped := seen[parentID]; looped {
				break
			}
			seen[parentID] = struct{}{}
			value++
			current = creations[parentID]
		}
		return value
	}
	sort.Slice(out, func(i, j int) bool {
		iID := out[i].GetAsset().GetId()
		jID := out[j].GetAsset().GetId()
		iDepth := depth(iID)
		jDepth := depth(jID)
		if iDepth != jDepth {
			return iDepth > jDepth
		}
		return iID < jID
	})
	return out
}

func (c *ChattoCore) purgeRoomLiveCall(ctx context.Context, roomID string, references *roomPurgeReferences) error {
	if c.callModel == nil || c.CallState == nil {
		return fmt.Errorf("call model is not initialized")
	}
	projected := c.CallState.RoomSnapshot(roomID)
	if projected.Call.CallID != "" {
		keyRef := projected.Call.E2EEKeyRef
		if keyRef == "" {
			keyRef = kms.CallKeyRef(projected.Call.CallID)
		}
		if keyRef != kms.CallKeyRef(projected.Call.CallID) {
			return fmt.Errorf("room call key reference does not match call id")
		}
		references.callKeyRefs[keyRef] = struct{}{}
	}
	if c.callModel.livekit == nil {
		return nil
	}

	snapshots, err := c.callModel.livekit.ListCallParticipants(ctx)
	if err != nil {
		return fmt.Errorf("list room call participants before purge: %w", err)
	}
	for _, snapshot := range snapshots {
		if snapshot.RoomID != roomID {
			continue
		}
		if snapshot.CallID != "" {
			references.callKeyRefs[kms.CallKeyRef(snapshot.CallID)] = struct{}{}
		}
		participants := snapshotObservedParticipants(snapshot)
		if len(participants) == 0 {
			continue
		}
		if snapshot.CallID == "" {
			return fmt.Errorf("room call participant snapshot has no call id")
		}
		remover, ok := c.callModel.livekit.(liveKitParticipantRemover)
		if !ok {
			return fmt.Errorf("room call participant remover is unavailable")
		}
		seen := make(map[string]struct{}, len(participants))
		for _, participant := range participants {
			if participant.ParticipantID == "" {
				return fmt.Errorf("room call participant has no identity")
			}
			if _, duplicate := seen[participant.ParticipantID]; duplicate {
				continue
			}
			seen[participant.ParticipantID] = struct{}{}
			if err := remover.RemoveCallParticipant(
				ctx,
				snapshot.SpaceID,
				snapshot.RoomID,
				snapshot.CallID,
				participant.ParticipantID,
			); err != nil {
				return fmt.Errorf("remove room call participant before purge: %w", err)
			}
		}
	}
	return nil
}
