package core

import (
	"context"
	"errors"
	"testing"
	"time"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestForgetOneToOneDMIsPrivateAndKeepsMembership(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)

	alice, err := chatto.CreateUser(ctx, SystemActorID, "dm-forget-alice", "Alice", "password123")
	if err != nil {
		t.Fatalf("CreateUser(alice): %v", err)
	}
	bob, err := chatto.CreateUser(ctx, SystemActorID, "dm-forget-bob", "Bob", "password123")
	if err != nil {
		t.Fatalf("CreateUser(bob): %v", err)
	}
	room, _, err := chatto.FindOrCreateDM(ctx, alice.Id, []string{bob.Id})
	if err != nil {
		t.Fatalf("FindOrCreateDM: %v", err)
	}
	oldMessage, err := chatto.PostMessage(ctx, KindDM, room.Id, bob.Id, "old message", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(old): %v", err)
	}

	if err := chatto.RoomCommands().LeaveRoom(ctx, RoomIDInput{ActorID: alice.Id, RoomID: room.Id}); err != nil {
		t.Fatalf("LeaveRoom(one-to-one DM): %v", err)
	}

	for _, userID := range []string{alice.Id, bob.Id} {
		member, err := chatto.RoomMembershipExists(ctx, KindDM, userID, room.Id)
		if err != nil {
			t.Fatalf("RoomMembershipExists(%s): %v", userID, err)
		}
		if !member {
			t.Fatalf("%s lost DM membership after private deletion", userID)
		}
	}

	visible, err := chatto.CanAccessDMConversation(ctx, alice.Id, room.Id)
	if err != nil {
		t.Fatalf("CanAccessDMConversation(alice): %v", err)
	}
	if visible {
		t.Fatal("deleted DM remains visible to the acting participant")
	}
	visible, err = chatto.CanAccessDMConversation(ctx, bob.Id, room.Id)
	if err != nil {
		t.Fatalf("CanAccessDMConversation(bob): %v", err)
	}
	if !visible {
		t.Fatal("private deletion changed the other participant's visibility")
	}

	accessible, err := chatto.CanAccessDMEvent(ctx, alice.Id, room.Id, oldMessage.Id)
	if err != nil {
		t.Fatalf("CanAccessDMEvent(alice, old): %v", err)
	}
	if accessible {
		t.Fatal("acting participant can still access deleted DM history")
	}
	accessible, err = chatto.CanAccessDMEvent(ctx, bob.Id, room.Id, oldMessage.Id)
	if err != nil {
		t.Fatalf("CanAccessDMEvent(bob, old): %v", err)
	}
	if !accessible {
		t.Fatal("other participant lost access to retained history")
	}

	newMessage, err := chatto.PostMessage(ctx, KindDM, room.Id, bob.Id, "new message", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(new): %v", err)
	}
	visible, err = chatto.CanAccessDMConversation(ctx, alice.Id, room.Id)
	if err != nil {
		t.Fatalf("CanAccessDMConversation(alice after new root): %v", err)
	}
	if !visible {
		t.Fatal("new root message did not make the DM visible again")
	}
	accessible, err = chatto.CanAccessDMEvent(ctx, alice.Id, room.Id, oldMessage.Id)
	if err != nil {
		t.Fatalf("CanAccessDMEvent(alice, old after reappearance): %v", err)
	}
	if accessible {
		t.Fatal("old history became accessible after DM reappearance")
	}
	accessible, err = chatto.CanAccessDMEvent(ctx, alice.Id, room.Id, newMessage.Id)
	if err != nil {
		t.Fatalf("CanAccessDMEvent(alice, new): %v", err)
	}
	if !accessible {
		t.Fatal("new message is not accessible after DM reappearance")
	}
}

func TestStartDMRestoresVisibilityWithoutHistory(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)

	alice, err := chatto.CreateUser(ctx, SystemActorID, "dm-restore-alice", "Alice", "password123")
	if err != nil {
		t.Fatalf("CreateUser(alice): %v", err)
	}
	bob, err := chatto.CreateUser(ctx, SystemActorID, "dm-restore-bob", "Bob", "password123")
	if err != nil {
		t.Fatalf("CreateUser(bob): %v", err)
	}
	room, _, err := chatto.FindOrCreateDM(ctx, alice.Id, []string{bob.Id})
	if err != nil {
		t.Fatalf("FindOrCreateDM: %v", err)
	}
	oldMessage, err := chatto.PostMessage(ctx, KindDM, room.Id, bob.Id, "old message", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(old): %v", err)
	}
	if err := chatto.ForgetOneToOneDM(ctx, alice.Id, room.Id); err != nil {
		t.Fatalf("ForgetOneToOneDM: %v", err)
	}

	restored, created, err := chatto.RoomCommands().StartDM(ctx, RoomStartDMInput{
		ActorID:        alice.Id,
		ParticipantIDs: []string{bob.Id},
	})
	if err != nil {
		t.Fatalf("StartDM(existing): %v", err)
	}
	if created {
		t.Fatal("StartDM created a second room instead of restoring the existing DM")
	}
	if restored.Id != room.Id {
		t.Fatalf("StartDM restored room %s, want %s", restored.Id, room.Id)
	}
	visible, err := chatto.CanAccessDMConversation(ctx, alice.Id, room.Id)
	if err != nil {
		t.Fatalf("CanAccessDMConversation: %v", err)
	}
	if !visible {
		t.Fatal("StartDM did not restore sidebar visibility")
	}
	accessible, err := chatto.CanAccessDMEvent(ctx, alice.Id, room.Id, oldMessage.Id)
	if err != nil {
		t.Fatalf("CanAccessDMEvent(old): %v", err)
	}
	if accessible {
		t.Fatal("StartDM restored deleted history")
	}
}

func TestForgetOneToOneDMRejectsUnsupportedTargets(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := context.Background()

	alice, err := chatto.CreateUser(ctx, SystemActorID, "dm-reject-alice", "Alice", "password123")
	if err != nil {
		t.Fatalf("CreateUser(alice): %v", err)
	}
	bob, err := chatto.CreateUser(ctx, SystemActorID, "dm-reject-bob", "Bob", "password123")
	if err != nil {
		t.Fatalf("CreateUser(bob): %v", err)
	}
	carol, err := chatto.CreateUser(ctx, SystemActorID, "dm-reject-carol", "Carol", "password123")
	if err != nil {
		t.Fatalf("CreateUser(carol): %v", err)
	}

	selfDM, _, err := chatto.FindOrCreateDM(ctx, alice.Id, nil)
	if err != nil {
		t.Fatalf("FindOrCreateDM(self): %v", err)
	}
	if err := chatto.ForgetOneToOneDM(ctx, alice.Id, selfDM.Id); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ForgetOneToOneDM(self) error = %v, want ErrInvalidArgument", err)
	}

	groupDM, _, err := chatto.FindOrCreateDM(ctx, alice.Id, []string{bob.Id, carol.Id})
	if err != nil {
		t.Fatalf("FindOrCreateDM(group): %v", err)
	}
	if err := chatto.ForgetOneToOneDM(ctx, alice.Id, groupDM.Id); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ForgetOneToOneDM(group) error = %v, want ErrInvalidArgument", err)
	}

	oneToOne, _, err := chatto.FindOrCreateDM(ctx, alice.Id, []string{bob.Id})
	if err != nil {
		t.Fatalf("FindOrCreateDM(one-to-one): %v", err)
	}
	if err := chatto.ForgetOneToOneDM(ctx, carol.Id, oneToOne.Id); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ForgetOneToOneDM(non-member) error = %v, want ErrPermissionDenied", err)
	}
}

func TestRepeatedDMDeletionAdvancesCutoff(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)

	alice, err := chatto.CreateUser(ctx, SystemActorID, "dm-repeat-alice", "Alice", "password123")
	if err != nil {
		t.Fatalf("CreateUser(alice): %v", err)
	}
	bob, err := chatto.CreateUser(ctx, SystemActorID, "dm-repeat-bob", "Bob", "password123")
	if err != nil {
		t.Fatalf("CreateUser(bob): %v", err)
	}
	room, _, err := chatto.FindOrCreateDM(ctx, alice.Id, []string{bob.Id})
	if err != nil {
		t.Fatalf("FindOrCreateDM: %v", err)
	}
	first, err := chatto.PostMessage(ctx, KindDM, room.Id, bob.Id, "first", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(first): %v", err)
	}
	if err := chatto.ForgetOneToOneDM(ctx, alice.Id, room.Id); err != nil {
		t.Fatalf("ForgetOneToOneDM(first): %v", err)
	}
	second, err := chatto.PostMessage(ctx, KindDM, room.Id, bob.Id, "second", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(second): %v", err)
	}
	if err := chatto.ForgetOneToOneDM(ctx, alice.Id, room.Id); err != nil {
		t.Fatalf("ForgetOneToOneDM(second): %v", err)
	}
	for _, eventID := range []string{first.Id, second.Id} {
		accessible, err := chatto.CanAccessDMEvent(ctx, alice.Id, room.Id, eventID)
		if err != nil {
			t.Fatalf("CanAccessDMEvent(%s): %v", eventID, err)
		}
		if accessible {
			t.Fatalf("event %s remains accessible after repeated deletion", eventID)
		}
	}
}

func TestDMAssetAccessRequiresMembershipAndKeepsPendingUploaderAsset(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)

	alice, err := chatto.CreateUser(ctx, SystemActorID, "dm-asset-alice", "Alice", "password123")
	if err != nil {
		t.Fatalf("CreateUser(alice): %v", err)
	}
	bob, err := chatto.CreateUser(ctx, SystemActorID, "dm-asset-bob", "Bob", "password123")
	if err != nil {
		t.Fatalf("CreateUser(bob): %v", err)
	}
	carol, err := chatto.CreateUser(ctx, SystemActorID, "dm-asset-carol", "Carol", "password123")
	if err != nil {
		t.Fatalf("CreateUser(carol): %v", err)
	}
	room, _, err := chatto.FindOrCreateDM(ctx, alice.Id, []string{bob.Id})
	if err != nil {
		t.Fatalf("FindOrCreateDM: %v", err)
	}
	if _, err := chatto.PostMessage(ctx, KindDM, room.Id, bob.Id, "history", nil, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if err := chatto.ForgetOneToOneDM(ctx, alice.Id, room.Id); err != nil {
		t.Fatalf("ForgetOneToOneDM: %v", err)
	}
	if err := chatto.RestoreOneToOneDMVisibility(ctx, alice.Id, room.Id); err != nil {
		t.Fatalf("RestoreOneToOneDMVisibility: %v", err)
	}

	pending := &corev1.Attachment{
		Id:          NewAssetID(),
		RoomId:      room.Id,
		Filename:    "pending.txt",
		ContentType: "text/plain",
		Size:        7,
	}
	if err := chatto.assetLifecycle().RecordUploadedPendingAttachmentAsset(
		ctx,
		alice.Id,
		room.Id,
		pending,
		"",
		time.Now().Add(time.Hour),
		false,
	); err != nil {
		t.Fatalf("RecordUploadedPendingAttachmentAsset: %v", err)
	}

	accessible, err := chatto.CanAccessDMAsset(ctx, alice.Id, room.Id, pending.Id)
	if err != nil {
		t.Fatalf("CanAccessDMAsset(uploader): %v", err)
	}
	if !accessible {
		t.Fatal("pending attachment is not accessible to its uploader")
	}
	accessible, err = chatto.CanAccessDMAsset(ctx, carol.Id, room.Id, pending.Id)
	if err != nil {
		t.Fatalf("CanAccessDMAsset(non-member): %v", err)
	}
	if accessible {
		t.Fatal("non-member can access a DM attachment")
	}
}
