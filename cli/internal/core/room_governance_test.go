package core

import (
	"errors"
	"testing"

	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

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
	state, _, err := chatto.GetRoomHistoryPurgeOperation(ctx, operation.ID)
	if err != nil {
		t.Fatalf("GetRoomHistoryPurgeOperation: %v", err)
	}
	if state.Status != RoomHistoryPurgeCompleted {
		t.Fatalf("operation status = %s, want completed", state.Status)
	}
}
