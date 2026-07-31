package core

import (
	"errors"
	"slices"
	"testing"
	"time"

	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestRoomHistoryPurgeEventClassificationTracksAllMessageOwnedProtoVariants(t *testing.T) {
	fields := (&corev1.Event{}).ProtoReflect().Descriptor().Oneofs().ByName("event").Fields()
	var got []string
	for index := 0; index < fields.Len(); index++ {
		field := fields.Get(index)
		number := int(field.Number())
		if (number >= 400 && number <= 454) || (number >= 1050 && number <= 1051) {
			got = append(got, string(field.Name()))
		}
	}
	slices.Sort(got)

	want := []string{
		"asset_created",
		"asset_deleted",
		"asset_processing_failed",
		"asset_processing_started",
		"asset_processing_succeeded",
		"message_body",
		"message_edited",
		"message_posted",
		"message_request_claimed",
		"message_retracted",
		"reaction_added",
		"reaction_removed",
		"thread_created",
		"thread_followed",
		"thread_unfollowed",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("message-owned event descriptor set = %v, want %v; classify new variants before enabling purge", got, want)
	}

	classified := []*corev1.Event{
		{Event: &corev1.Event_AssetCreated{}},
		{Event: &corev1.Event_AssetDeleted{}},
		{Event: &corev1.Event_AssetProcessingFailed{}},
		{Event: &corev1.Event_AssetProcessingStarted{}},
		{Event: &corev1.Event_AssetProcessingSucceeded{}},
		{Event: &corev1.Event_MessageBody{}},
		{Event: &corev1.Event_MessageEdited{}},
		{Event: &corev1.Event_MessagePosted{}},
		{Event: &corev1.Event_MessageRequestClaimed{}},
		{Event: &corev1.Event_MessageRetracted{}},
		{Event: &corev1.Event_ReactionAdded{}},
		{Event: &corev1.Event_ReactionRemoved{}},
		{Event: &corev1.Event_ThreadCreated{}},
		{Event: &corev1.Event_ThreadFollowed{}},
		{Event: &corev1.Event_ThreadUnfollowed{}},
	}
	for _, event := range classified {
		if !isMessageOwnedRoomEvent(event) {
			t.Fatalf("message-owned event is not classified for purge: %T", event.GetEvent())
		}
	}
}

func TestRoomPostingPolicyBlocksAdditiveContentAndAllowsBypass(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)

	user, err := chatto.CreateUser(ctx, SystemActorID, "room-lock-member", "Room Lock Member", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := chatto.CreateRoom(ctx, SystemActorID, KindChannel, "", "room-lock", "Lock test")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := chatto.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}
	room, err = chatto.GetRoom(ctx, KindChannel, room.Id)
	if err != nil {
		t.Fatalf("GetRoom: %v", err)
	}

	locked, err := chatto.SetRoomPostingPolicy(
		ctx,
		SystemActorID,
		room.Id,
		corev1.RoomPostingPolicy_ROOM_POSTING_POLICY_LOCKED,
		room.GetRevision(),
	)
	if err != nil {
		t.Fatalf("SetRoomPostingPolicy: %v", err)
	}
	if effectiveRoomPostingPolicy(locked) != corev1.RoomPostingPolicy_ROOM_POSTING_POLICY_LOCKED {
		t.Fatalf("posting policy = %v, want LOCKED", locked.GetPostingPolicy())
	}
	if _, err := chatto.PostMessage(ctx, KindChannel, room.Id, user.Id, "blocked", nil, "", "", nil, false); !errors.Is(err, ErrRoomLocked) {
		t.Fatalf("PostMessage error = %v, want ErrRoomLocked", err)
	}
	directoryRoom, err := chatto.RoomDirectoryReads().GetRoom(ctx, user.Id, room.Id)
	if err != nil {
		t.Fatalf("GetRoom directory view: %v", err)
	}
	if directoryRoom.ViewerState.CanPostMessage ||
		directoryRoom.ViewerState.CanPostInThread ||
		directoryRoom.ViewerState.CanAttach ||
		directoryRoom.ViewerState.CanReact ||
		directoryRoom.ViewerState.CanEchoMessage {
		t.Fatalf("locked room exposed additive UI capabilities: %+v", directoryRoom.ViewerState)
	}
	if err := chatto.GrantRoomPermission(ctx, SystemActorID, room.Id, RoleEveryone, PermRoomBypassLock); err != nil {
		t.Fatalf("GrantRoomPermission bypass: %v", err)
	}
	if _, err := chatto.PostMessage(ctx, KindChannel, room.Id, user.Id, "allowed", nil, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage with bypass: %v", err)
	}
}

func TestRoomPostingPolicyUsesRoomWideOCC(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)

	user, err := chatto.CreateUser(ctx, SystemActorID, "room-lock-occ", "Room Lock OCC", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := chatto.CreateRoom(ctx, SystemActorID, KindChannel, "", "room-lock-occ", "OCC")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := chatto.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}
	room, err = chatto.GetRoom(ctx, KindChannel, room.Id)
	if err != nil {
		t.Fatalf("GetRoom: %v", err)
	}
	staleRevision := room.GetRevision()
	if _, err := chatto.PostMessage(ctx, KindChannel, room.Id, user.Id, "moves the room tail", nil, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if _, err := chatto.SetRoomPostingPolicy(
		ctx,
		SystemActorID,
		room.Id,
		corev1.RoomPostingPolicy_ROOM_POSTING_POLICY_LOCKED,
		staleRevision,
	); !errors.Is(err, events.ErrConflict) {
		t.Fatalf("SetRoomPostingPolicy error = %v, want events.ErrConflict", err)
	}
}

func TestRoomHistoryPurgePreservesRoomAndRemovesMessageFacts(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)

	user, err := chatto.CreateUser(ctx, SystemActorID, "history-purge-member", "History Purge Member", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := chatto.CreateRoom(ctx, SystemActorID, KindChannel, "", "history-purge", "History purge")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := chatto.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}
	message, err := chatto.PostMessage(ctx, KindChannel, room.Id, user.Id, "remove me", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	room, err = chatto.GetRoom(ctx, KindChannel, room.Id)
	if err != nil {
		t.Fatalf("GetRoom: %v", err)
	}

	purgedRoom, operation, err := chatto.StartRoomHistoryPurge(ctx, RoomHistoryPurgeInput{
		ActorID:          SystemActorID,
		RoomID:           room.Id,
		ExpectedRevision: room.GetRevision(),
		ConfirmationName: room.GetName(),
	})
	if err != nil {
		t.Fatalf("StartRoomHistoryPurge: %v", err)
	}
	if purgedRoom.GetHistoryEpoch() != 1 {
		t.Fatalf("history epoch = %d, want 1", purgedRoom.GetHistoryEpoch())
	}
	if _, ok := chatto.RoomTimeline.Get(message.GetId()); ok {
		t.Fatal("message remained logically visible after purge barrier")
	}
	if got := chatto.RoomTimeline.RoomEvents(room.Id, 50, 0); len(got) != 0 {
		t.Fatalf("room timeline after purge = %v, want no visible entries", timelineEventIDs(got))
	}
	if err := chatto.processRoomHistoryPurge(ctx, operation.ID); err != nil {
		t.Fatalf("processRoomHistoryPurge: %v", err)
	}

	if _, err := chatto.GetRoom(ctx, KindChannel, room.Id); err != nil {
		t.Fatalf("room removed by message-history purge: %v", err)
	}
	isMember, err := chatto.RoomMembershipExists(ctx, KindChannel, user.Id, room.Id)
	if err != nil {
		t.Fatalf("RoomMembershipExists: %v", err)
	}
	if !isMember {
		t.Fatal("room membership removed by message-history purge")
	}
	roomEvents, _, err := chatto.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(room.Id).AllEventsFilter())
	if err != nil {
		t.Fatalf("SubjectEvents: %v", err)
	}
	for _, event := range roomEvents {
		if isMessageOwnedRoomEvent(event) {
			t.Fatalf("message-owned event survived physical cleanup: %T", event.GetEvent())
		}
	}
	replayedTimeline := NewRoomTimelineProjection()
	for index, event := range roomEvents {
		if err := replayedTimeline.Apply(event, uint64(index+1)); err != nil {
			t.Fatalf("replay retained room event %d: %v", index, err)
		}
	}
	if got := replayedTimeline.RoomEvents(room.Id, 50, 0); len(got) != 0 {
		t.Fatalf("replayed room timeline after physical cleanup = %v, want no visible entries", timelineEventIDs(got))
	}
	state, _, err := chatto.GetRoomHistoryPurgeOperation(ctx, operation.ID)
	if err != nil {
		t.Fatalf("GetRoomHistoryPurgeOperation: %v", err)
	}
	if state.Status != RoomHistoryPurgeCompleted {
		t.Fatalf("operation status = %s, want completed", state.Status)
	}
}

func TestRoomHistoryPurgeRecoversCommittedBarrierAfterKVCheckpointLoss(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)

	room, err := chatto.CreateRoom(ctx, SystemActorID, KindChannel, "", "history-purge-recovery", "Recovery")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if running, err := chatto.runningRoomHistoryPurge(ctx, room.Id); err != nil || running != nil {
		t.Fatalf("runningRoomHistoryPurge on empty registry = (%v, %v), want (nil, nil)", running, err)
	}

	state := roomHistoryPurgeState{
		Version:      1,
		ID:           NewRoomHistoryPurgeOperationID(),
		RoomID:       room.Id,
		ActorID:      SystemActorID,
		HistoryEpoch: 1,
		Status:       RoomHistoryPurgeRunning,
		StartedAt:    time.Now().UTC(),
	}
	if err := chatto.putRoomHistoryPurgeState(ctx, state, true); err != nil {
		t.Fatalf("putRoomHistoryPurgeState: %v", err)
	}

	barrier := newEvent(SystemActorID, &corev1.Event{
		Event: &corev1.Event_RoomHistoryPurged{
			RoomHistoryPurged: &corev1.RoomHistoryPurgedEvent{
				RoomId:       room.Id,
				HistoryEpoch: state.HistoryEpoch,
				OperationId:  state.ID,
			},
		},
	})
	aggregate := events.RoomAggregate(room.Id)
	barrierSeq, err := chatto.EventPublisher.Append(ctx, aggregate.SubjectFor(barrier), barrier)
	if err != nil {
		t.Fatalf("Append barrier: %v", err)
	}

	if err := chatto.processRoomHistoryPurge(ctx, state.ID); err != nil {
		t.Fatalf("processRoomHistoryPurge: %v", err)
	}
	recovered, err := chatto.getRoomHistoryPurgeState(ctx, state.ID)
	if err != nil {
		t.Fatalf("getRoomHistoryPurgeState: %v", err)
	}
	if recovered.BarrierSeq != barrierSeq {
		t.Fatalf("recovered barrier sequence = %d, want %d", recovered.BarrierSeq, barrierSeq)
	}
	if recovered.Status != RoomHistoryPurgeCompleted {
		t.Fatalf("recovered status = %s, want completed", recovered.Status)
	}
}
