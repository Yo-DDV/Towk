package core

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/nats-io/nats.go/jetstream"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"testing"
)

type roomPurgeLiveKitFake struct {
	snapshots []liveKitParticipantSnapshot
	removed   []string
}

func (f *roomPurgeLiveKitFake) ListCallParticipants(context.Context) ([]liveKitParticipantSnapshot, error) {
	return append([]liveKitParticipantSnapshot(nil), f.snapshots...), nil
}

func (f *roomPurgeLiveKitFake) RemoveCallParticipant(_ context.Context, _, roomID, callID, participantID string) error {
	f.removed = append(f.removed, roomID+"\x00"+callID+"\x00"+participantID)
	return nil
}

func TestPurgeRoomLiveCallEvictsOnlyTargetParticipantsAndCapturesKey(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	targetRoomID := "R00000000000000"
	controlRoomID := "R11111111111111"
	targetCallID := "C00000000000000"
	controlCallID := "C11111111111111"
	fake := &roomPurgeLiveKitFake{snapshots: []liveKitParticipantSnapshot{
		{
			RoomID: targetRoomID,
			CallID: targetCallID,
			Participants: []liveKitObservedParticipant{
				{UserID: "U00000000000000", ParticipantID: "participant-target", DeviceIndex: 1},
			},
		},
		{
			RoomID: controlRoomID,
			CallID: controlCallID,
			Participants: []liveKitObservedParticipant{
				{UserID: "U11111111111111", ParticipantID: "participant-control", DeviceIndex: 1},
			},
		},
	}}
	chatto.callModel.livekit = fake
	references := newRoomPurgeReferences()

	if err := chatto.purgeRoomLiveCall(ctx, targetRoomID, references); err != nil {
		t.Fatalf("purgeRoomLiveCall: %v", err)
	}
	if len(fake.removed) != 1 || fake.removed[0] != targetRoomID+"\x00"+targetCallID+"\x00participant-target" {
		t.Fatalf("removed participants = %#v", fake.removed)
	}
	if _, ok := references.callKeyRefs["call.e2ee."+targetCallID]; !ok {
		t.Fatal("target call key was not captured")
	}
	if _, ok := references.callKeyRefs["call.e2ee."+controlCallID]; ok {
		t.Fatal("control call key was captured")
	}
}

func TestPurgeRoomLinkPreviewAssetsDeletesOnlyManagedCompatibilityPair(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "R00000000000000"
	assetID := "A00000000000000"

	info, err := chatto.storage.linkPreviewAssets.Put(ctx, jetstream.ObjectMeta{
		Name: assetID,
		Headers: map[string][]string{
			"Content-Type": {"image/png"},
		},
	}, bytes.NewBufferString("preview"))
	if err != nil {
		t.Fatalf("put managed preview: %v", err)
	}
	if err := chatto.ensureLinkPreviewCompatibilityLink(ctx, info); err != nil {
		t.Fatalf("ensure compatibility link: %v", err)
	}

	references := newRoomPurgeReferences()
	references.linkPreviewIDs[assetID] = struct{}{}
	deleted, err := chatto.purgeRoomLinkPreviewAssets(ctx, roomID, references)
	if err != nil {
		t.Fatalf("purgeRoomLinkPreviewAssets: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}
	if _, err := chatto.storage.linkPreviewAssets.GetInfo(ctx, assetID); !errors.Is(err, jetstream.ErrObjectNotFound) {
		t.Fatalf("managed preview still resolves: %v", err)
	}
	if _, err := chatto.storage.serverAssets.GetInfo(ctx, assetID); !errors.Is(err, jetstream.ErrObjectNotFound) {
		t.Fatalf("compatibility link still resolves: %v", err)
	}
}

func TestPurgeRoomLinkPreviewAssetsRefusesSameNamedUnrelatedServerAsset(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "R00000000000000"
	assetID := "A00000000000000"

	if _, err := chatto.storage.linkPreviewAssets.Put(ctx, jetstream.ObjectMeta{Name: assetID}, bytes.NewBufferString("preview")); err != nil {
		t.Fatalf("put managed preview: %v", err)
	}
	if _, err := chatto.storage.serverAssets.Put(ctx, jetstream.ObjectMeta{Name: assetID}, bytes.NewBufferString("branding")); err != nil {
		t.Fatalf("put unrelated server asset: %v", err)
	}

	references := newRoomPurgeReferences()
	references.linkPreviewIDs[assetID] = struct{}{}
	if _, err := chatto.purgeRoomLinkPreviewAssets(ctx, roomID, references); err == nil {
		t.Fatal("purge accepted a same-named non-link server asset")
	}
	if _, err := chatto.storage.linkPreviewAssets.GetInfo(ctx, assetID); err != nil {
		t.Fatalf("managed preview was deleted after failed proof: %v", err)
	}
	if _, err := chatto.storage.serverAssets.GetInfo(ctx, assetID); err != nil {
		t.Fatalf("unrelated server asset was deleted: %v", err)
	}
}

func TestPurgeRoomLinkPreviewAssetsDoesNotDeleteAmbiguousLegacyServerAsset(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "R00000000000000"
	assetID := "A00000000000000"

	if _, err := chatto.storage.serverAssets.Put(ctx, jetstream.ObjectMeta{Name: assetID}, bytes.NewBufferString("legacy-or-branding")); err != nil {
		t.Fatalf("put ambiguous server asset: %v", err)
	}
	references := newRoomPurgeReferences()
	references.linkPreviewIDs[assetID] = struct{}{}
	deleted, err := chatto.purgeRoomLinkPreviewAssets(ctx, roomID, references)
	if err != nil {
		t.Fatalf("purgeRoomLinkPreviewAssets: %v", err)
	}
	if deleted != 0 {
		t.Fatalf("deleted = %d, want 0 for ambiguous legacy bytes", deleted)
	}
	if _, err := chatto.storage.serverAssets.GetInfo(ctx, assetID); err != nil {
		t.Fatalf("ambiguous server asset was deleted: %v", err)
	}
}

func TestRoomPurgeStorageAlreadyMissingDoesNotMaskJoinedFailure(t *testing.T) {
	missing := fmt.Errorf("wrapped missing: %w", jetstream.ErrObjectNotFound)
	if !roomPurgeStorageAlreadyMissing(missing) {
		t.Fatal("wrapped missing storage error was not recognized")
	}
	joined := errors.Join(missing, errors.New("cache deletion failed"))
	if roomPurgeStorageAlreadyMissing(joined) {
		t.Fatal("joined storage/cache failure was incorrectly treated as already missing")
	}
}

func TestRoomPurgeCleanupProjectionWaitsForEarlierFactsBeforePurging(t *testing.T) {
	roomID := "R00000000000000"
	messageID := "E00000000000000"
	timeline := NewRoomTimelineProjection()
	threads := NewThreadProjection()
	reactions := NewReactionProjection()
	rbac := NewRBACProjection()
	config := NewConfigProjection()
	calls := NewCallStateProjection()

	waited := false
	cleanup := NewRoomPurgeCleanupProjection(
		func(context.Context) error {
			waited = true
			return timeline.Apply(&corev1.Event{
				Id:      messageID,
				ActorId: "U00000000000000",
				Event: &corev1.Event_MessagePosted{MessagePosted: &corev1.MessagePostedEvent{
					RoomId: roomID,
				}},
			}, 1)
		},
		timeline,
		threads,
		reactions,
		rbac,
		config,
		calls,
	)

	if err := cleanup.Apply(&corev1.Event{
		Id: "E00000000000001",
		Event: &corev1.Event_RoomDeleted{RoomDeleted: &corev1.RoomDeletedEvent{
			RoomId: roomID,
		}},
	}, 2); err != nil {
		t.Fatalf("Apply cleanup: %v", err)
	}
	if !waited {
		t.Fatal("cleanup did not wait for the core projections")
	}
	if _, ok := timeline.Get(messageID); ok {
		t.Fatal("message projected during the wait remained after room cleanup")
	}
}

func TestValidRoomPurgeCallKeyRefRejectsForgedReferences(t *testing.T) {
	tests := []struct {
		name string
		ref  string
		want bool
	}{
		{name: "canonical", ref: "call.e2ee.C00000000000000", want: true},
		{name: "wrong prefix", ref: "call.other.C00000000000000", want: false},
		{name: "wildcard", ref: "call.e2ee.C0000000000000*", want: false},
		{name: "dot escape", ref: "call.e2ee.C0000000000000.", want: false},
		{name: "short", ref: "call.e2ee.C0", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validRoomPurgeCallKeyRef(tt.ref); got != tt.want {
				t.Fatalf("validRoomPurgeCallKeyRef(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}
