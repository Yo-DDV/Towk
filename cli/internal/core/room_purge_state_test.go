package core

import (
	"context"
	"encoding/json"
	"errors"
	"google.golang.org/protobuf/proto"
	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"testing"
)

func TestWithRoomPurgeLeaseRejectsConcurrentOwner(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "R00000000000000"

	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- chatto.withRoomPurgeLease(ctx, roomID, func(context.Context) error {
			close(started)
			<-release
			return nil
		})
	}()
	<-started

	if err := chatto.withRoomPurgeLease(ctx, roomID, func(context.Context) error { return nil }); !errors.Is(err, ErrRoomPurgeInProgress) {
		t.Fatalf("second lease error = %v, want ErrRoomPurgeInProgress", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("first lease: %v", err)
	}
}

func marshalEventSlice(t *testing.T, eventsInRoom []*corev1.Event) []byte {
	t.Helper()
	var out []byte
	for _, event := range eventsInRoom {
		data, err := proto.Marshal(event)
		if err != nil {
			t.Fatalf("marshal event: %v", err)
		}
		out = append(out, data...)
		out = append(out, 0)
	}
	return out
}

func TestPrepareRoomPurgeReplacesStalePreDestructiveMarker(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	room, err := chatto.CreateRoom(ctx, SystemActorID, KindChannel, "", "purge-current-name", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := chatto.ArchiveRoom(ctx, SystemActorID, KindChannel, room.GetId()); err != nil {
		t.Fatalf("ArchiveRoom: %v", err)
	}

	stale, err := chatto.newRoomPurgeState("old-room-name", room.GetGroupId())
	if err != nil {
		t.Fatalf("newRoomPurgeState: %v", err)
	}
	encoded, err := json.Marshal(stale)
	if err != nil {
		t.Fatalf("marshal stale state: %v", err)
	}
	if _, err := chatto.storage.runtimeStateKV.Create(ctx, roomPurgeStateKey(room.GetId()), encoded); err != nil {
		t.Fatalf("create stale state: %v", err)
	}

	prepared, _, err := chatto.prepareRoomPurge(ctx, room.GetId(), room.GetName())
	if err != nil {
		t.Fatalf("prepareRoomPurge: %v", err)
	}
	if !chatto.roomPurgeConfirmationMatches(prepared, room.GetName()) {
		t.Fatal("replacement state does not accept the current exact room name")
	}
	if chatto.roomPurgeConfirmationMatches(prepared, "old-room-name") {
		t.Fatal("replacement state still accepts the stale confirmation")
	}
	if prepared.Status != roomPurgeStatusInProgress || prepared.GroupID != room.GetGroupId() {
		t.Fatalf("prepared state = %+v", prepared)
	}
}

func TestPurgeRoomRuntimeStateIsolatesTargetRoom(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	targetRoomID := "R00000000000000"
	controlRoomID := "R11111111111111"
	userID := "U00000000000000"
	threadID := "E00000000000000"

	targetKeys := []string{
		"read.room." + userID + "." + targetRoomID,
		"read.thread." + userID + "." + targetRoomID + "." + threadID,
		"thread_follow." + userID + "." + targetRoomID + "." + threadID,
	}
	controlKeys := []string{
		"read.room." + userID + "." + controlRoomID,
		"read.thread." + userID + "." + controlRoomID + "." + threadID,
		"thread_follow." + userID + "." + controlRoomID + "." + threadID,
	}
	for _, key := range append(append([]string{}, targetKeys...), controlKeys...) {
		if _, err := chatto.storage.runtimeStateKV.Put(ctx, key, []byte("state")); err != nil {
			t.Fatalf("put %s: %v", key, err)
		}
	}

	deleted, err := chatto.purgeRoomRuntimeState(ctx, targetRoomID)
	if err != nil {
		t.Fatalf("purgeRoomRuntimeState: %v", err)
	}
	if deleted != len(targetKeys) {
		t.Fatalf("deleted = %d, want %d", deleted, len(targetKeys))
	}
	for _, key := range targetKeys {
		if _, err := chatto.storage.runtimeStateKV.Get(ctx, key); !isRuntimeStateKeyAbsent(err) {
			t.Fatalf("target key %s still resolves: %v", key, err)
		}
	}
	for _, key := range controlKeys {
		if _, err := chatto.storage.runtimeStateKV.Get(ctx, key); err != nil {
			t.Fatalf("control key %s was affected: %v", key, err)
		}
	}
}

func TestExclusiveRoomLinkPreviewAssetIDsPreservesSharedPreview(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	targetRoomID := "R00000000000000"
	controlRoomID := "R11111111111111"
	sharedAssetID := "A00000000000000"
	targetOnlyAssetID := "A11111111111111"

	appendBody := func(eventID, roomID, assetID string) {
		t.Helper()
		event := newEvent(SystemActorID, &corev1.Event{
			Id: eventID,
			Event: &corev1.Event_MessageBody{
				MessageBody: &corev1.MessageBodyEvent{
					RoomId:  roomID,
					EventId: "E22222222222222",
					Body: &corev1.MessageBody{
						LinkPreview: &corev1.LinkPreview{ImageAssetId: assetID},
					},
				},
			},
		})
		if _, err := chatto.EventPublisher.Append(ctx, events.RoomAggregate(roomID).SubjectFor(event), event); err != nil {
			t.Fatalf("append body event: %v", err)
		}
	}
	appendBody("E00000000000000", targetRoomID, sharedAssetID)
	appendBody("E11111111111111", controlRoomID, sharedAssetID)
	appendBody("E33333333333333", targetRoomID, targetOnlyAssetID)

	exclusive, err := chatto.exclusiveRoomLinkPreviewAssetIDs(ctx, targetRoomID, map[string]struct{}{
		sharedAssetID:     {},
		targetOnlyAssetID: {},
	})
	if err != nil {
		t.Fatalf("exclusiveRoomLinkPreviewAssetIDs: %v", err)
	}
	if _, ok := exclusive[sharedAssetID]; ok {
		t.Fatal("shared preview was incorrectly classified as target-exclusive")
	}
	if _, ok := exclusive[targetOnlyAssetID]; !ok {
		t.Fatal("target-only preview was not classified as exclusive")
	}
}
