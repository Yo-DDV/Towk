package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/nats-io/nats.go/jetstream"
	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"slices"
	"testing"
)

func TestPurgeArchivedRoomRejectsUnauthorizedActiveMismatchAndForgedTargets(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)

	owner, err := chatto.CreateUser(ctx, SystemActorID, "purge-owner", "Purge Owner", "password123")
	if err != nil {
		t.Fatalf("CreateUser owner: %v", err)
	}
	if err := chatto.AssignOwnerRole(ctx, owner.GetId()); err != nil {
		t.Fatalf("AssignOwnerRole: %v", err)
	}
	member, err := chatto.CreateUser(ctx, SystemActorID, "purge-member", "Purge Member", "password123")
	if err != nil {
		t.Fatalf("CreateUser member: %v", err)
	}

	activeRoom, err := chatto.CreateRoom(ctx, SystemActorID, KindChannel, "", "purge-active", "")
	if err != nil {
		t.Fatalf("CreateRoom active: %v", err)
	}
	archivedRoom, err := chatto.CreateRoom(ctx, SystemActorID, KindChannel, "", "purge-archived", "")
	if err != nil {
		t.Fatalf("CreateRoom archived: %v", err)
	}
	if _, err := chatto.ArchiveRoom(ctx, SystemActorID, KindChannel, archivedRoom.GetId()); err != nil {
		t.Fatalf("ArchiveRoom: %v", err)
	}

	if _, err := chatto.PurgeArchivedRoom(ctx, member.GetId(), archivedRoom.GetId(), archivedRoom.GetName()); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("non-owner purge error = %v, want ErrPermissionDenied", err)
	}
	if _, err := chatto.PurgeArchivedRoom(ctx, owner.GetId(), activeRoom.GetId(), activeRoom.GetName()); !errors.Is(err, ErrRoomPurgeNotArchived) {
		t.Fatalf("active-room purge error = %v, want ErrRoomPurgeNotArchived", err)
	}
	if _, err := chatto.PurgeArchivedRoom(ctx, owner.GetId(), archivedRoom.GetId(), "Purge-Archived"); !errors.Is(err, ErrRoomPurgeConfirmationMismatch) {
		t.Fatalf("case-mismatched confirmation error = %v, want ErrRoomPurgeConfirmationMismatch", err)
	}
	if _, err := chatto.PurgeArchivedRoom(ctx, owner.GetId(), "R0000000000000.>", archivedRoom.GetName()); !errors.Is(err, ErrRoomPurgeInvalidRoomID) {
		t.Fatalf("forged room id error = %v, want ErrRoomPurgeInvalidRoomID", err)
	}
}

func TestPurgeArchivedRoomErasesExactRoomAndPreservesControl(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)

	owner, err := chatto.CreateUser(ctx, SystemActorID, "purge-complete-owner", "Purge Complete Owner", "password123")
	if err != nil {
		t.Fatalf("CreateUser owner: %v", err)
	}
	if err := chatto.AssignOwnerRole(ctx, owner.GetId()); err != nil {
		t.Fatalf("AssignOwnerRole: %v", err)
	}

	target, err := chatto.CreateRoom(ctx, owner.GetId(), KindChannel, "", "purge-target", "Target room")
	if err != nil {
		t.Fatalf("CreateRoom target: %v", err)
	}
	control, err := chatto.CreateRoom(ctx, owner.GetId(), KindChannel, "", "purge-control", "Control room")
	if err != nil {
		t.Fatalf("CreateRoom control: %v", err)
	}
	extraGroup, err := chatto.CreateRoomGroup(ctx, owner.GetId(), "Purge race target", "")
	if err != nil {
		t.Fatalf("CreateRoomGroup: %v", err)
	}
	lateGroupAdd := newEvent(owner.GetId(), &corev1.Event{Event: &corev1.Event_RoomAddedToGroup{
		RoomAddedToGroup: &corev1.RoomAddedToGroupEvent{
			GroupId: extraGroup.GetId(),
			RoomId:  target.GetId(),
		},
	}})
	lateGroupSubject := events.GroupAggregate(extraGroup.GetId()).SubjectFor(lateGroupAdd)
	lateGroupSeq, err := chatto.EventPublisher.Append(ctx, lateGroupSubject, lateGroupAdd)
	if err != nil {
		t.Fatalf("append duplicate group membership: %v", err)
	}
	if err := chatto.rooms().waitForGroupLayout(ctx, events.SubjectPosition(lateGroupSubject, lateGroupSeq)); err != nil {
		t.Fatalf("wait duplicate group membership: %v", err)
	}

	targetAttachment, err := chatto.media().UploadAttachment(
		ctx,
		owner.GetId(),
		target.GetId(),
		"target.txt",
		"text/plain",
		bytes.NewBufferString("target attachment"),
	)
	if err != nil {
		t.Fatalf("UploadAttachment target: %v", err)
	}
	controlAttachment, err := chatto.media().UploadAttachment(
		ctx,
		owner.GetId(),
		control.GetId(),
		"control.txt",
		"text/plain",
		bytes.NewBufferString("control attachment"),
	)
	if err != nil {
		t.Fatalf("UploadAttachment control: %v", err)
	}

	targetRoot, err := chatto.PostMessage(
		ctx,
		KindChannel,
		target.GetId(),
		owner.GetId(),
		"target root",
		[]string{targetAttachment.GetId()},
		"",
		"",
		nil,
		false,
	)
	if err != nil {
		t.Fatalf("PostMessage target root: %v", err)
	}
	targetReply, err := chatto.PostMessage(
		ctx,
		KindChannel,
		target.GetId(),
		owner.GetId(),
		"target reply",
		nil,
		targetRoot.GetId(),
		targetRoot.GetId(),
		nil,
		false,
	)
	if err != nil {
		t.Fatalf("PostMessage target reply: %v", err)
	}
	if added, err := chatto.AddReaction(ctx, KindChannel, target.GetId(), targetRoot.GetId(), "heart", owner.GetId()); err != nil || !added {
		t.Fatalf("AddReaction target = %v, %v; want added", added, err)
	}

	controlRoot, err := chatto.PostMessage(
		ctx,
		KindChannel,
		control.GetId(),
		owner.GetId(),
		"control root",
		[]string{controlAttachment.GetId()},
		"",
		"",
		nil,
		false,
	)
	if err != nil {
		t.Fatalf("PostMessage control root: %v", err)
	}

	controlBefore, _, err := chatto.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(control.GetId()).AllEventsFilter())
	if err != nil {
		t.Fatalf("read control events before purge: %v", err)
	}
	controlBytesBefore := marshalEventSlice(t, controlBefore)

	if _, err := chatto.ArchiveRoom(ctx, owner.GetId(), KindChannel, target.GetId()); err != nil {
		t.Fatalf("ArchiveRoom target: %v", err)
	}

	result, err := chatto.PurgeArchivedRoom(ctx, owner.GetId(), target.GetId(), target.GetName())
	if err != nil {
		t.Fatalf("PurgeArchivedRoom: %v", err)
	}
	if result.AlreadyPurged {
		t.Fatal("first purge reported AlreadyPurged")
	}
	if result.RoomEventsDeleted == 0 {
		t.Fatal("first purge deleted no room events")
	}
	if result.AttachmentsDeleted == 0 {
		t.Fatal("first purge deleted no attachments")
	}

	if _, err := chatto.GetRoom(ctx, KindChannel, target.GetId()); !errors.Is(err, jetstream.ErrKeyNotFound) {
		t.Fatalf("GetRoom target after purge error = %v, want ErrKeyNotFound", err)
	}
	targetEvents, _, err := chatto.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(target.GetId()).AllEventsFilter())
	if err != nil {
		t.Fatalf("read target events after purge: %v", err)
	}
	if len(targetEvents) != 1 || targetEvents[0].GetRoomDeleted().GetRoomId() != target.GetId() {
		t.Fatalf("target events after purge = %+v, want one RoomDeleted tombstone", targetEvents)
	}
	if event, err := chatto.GetRoomEventByEventID(ctx, KindChannel, target.GetId(), targetRoot.GetId()); err != nil || event != nil {
		t.Fatalf("target root after purge = %+v, %v; want unavailable", event, err)
	}
	if chatto.Threads.ReplyCount(targetRoot.GetId()) != 0 {
		t.Fatalf("target thread reply count after purge = %d, want 0", chatto.Threads.ReplyCount(targetRoot.GetId()))
	}
	if reactions, err := chatto.GetReactions(ctx, targetRoot.GetId()); err != nil || len(reactions) != 0 {
		t.Fatalf("target reactions after purge = %+v, %v; want none", reactions, err)
	}
	for _, group := range chatto.RoomGroups.All() {
		if group != nil && slices.Contains(group.GetRoomIds(), target.GetId()) {
			t.Fatalf("target room remains in group %s after purge", group.GetId())
		}
	}
	if _, ok := chatto.Assets.AssetCreation(targetAttachment.GetId()); ok {
		t.Fatal("target asset creation remains after purge")
	}
	if _, _, err := chatto.media().GetAttachment(ctx, targetAttachment.GetId()); err == nil {
		t.Fatal("target attachment binary remains after purge")
	}

	assetEvents, _, err := chatto.EventPublisher.SubjectEvents(ctx, events.AssetAggregate(targetAttachment.GetId()).AllEventsFilter())
	if err != nil {
		t.Fatalf("read target asset events after purge: %v", err)
	}
	if len(assetEvents) != 1 || assetEvents[0].GetAssetDeleted().GetAssetId() != targetAttachment.GetId() {
		t.Fatalf("target asset events = %+v, want one AssetDeleted tombstone", assetEvents)
	}

	if room, err := chatto.GetRoom(ctx, KindChannel, control.GetId()); err != nil || room.GetName() != control.GetName() {
		t.Fatalf("control room after purge = %+v, %v", room, err)
	}
	controlEvents, _, err := chatto.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(control.GetId()).AllEventsFilter())
	if err != nil {
		t.Fatalf("read control events after purge: %v", err)
	}
	controlBytesAfter := marshalEventSlice(t, controlEvents)
	if !bytes.Equal(controlBytesBefore, controlBytesAfter) {
		t.Fatal("control room event bytes changed during target purge")
	}
	if event, err := chatto.GetRoomEventByEventID(ctx, KindChannel, control.GetId(), controlRoot.GetId()); err != nil || event == nil {
		t.Fatalf("control message after purge = %+v, %v; want preserved", event, err)
	}
	if _, _, err := chatto.media().GetAttachment(ctx, controlAttachment.GetId()); err != nil {
		t.Fatalf("control attachment after purge: %v", err)
	}

	stateEntry, err := chatto.storage.runtimeStateKV.Get(ctx, roomPurgeStateKey(target.GetId()))
	if err != nil {
		t.Fatalf("read room purge marker: %v", err)
	}
	if bytes.Contains(stateEntry.Value(), []byte(target.GetName())) {
		t.Fatal("room purge marker persisted the clear-text confirmation")
	}
	var state roomPurgeState
	if err := json.Unmarshal(stateEntry.Value(), &state); err != nil {
		t.Fatalf("decode room purge marker: %v", err)
	}
	if state.Status != roomPurgeStatusComplete || len(state.PendingAssetIDs) != 0 || len(state.PendingLinkPreviewIDs) != 0 {
		t.Fatalf("room purge marker = %+v, want complete without pending references", state)
	}

	retry, err := chatto.PurgeArchivedRoom(ctx, owner.GetId(), target.GetId(), target.GetName())
	if err != nil {
		t.Fatalf("retry PurgeArchivedRoom: %v", err)
	}
	if !retry.AlreadyPurged {
		t.Fatal("retry did not report AlreadyPurged")
	}
	if retry.RoomEventsDeleted != result.RoomEventsDeleted || retry.AttachmentsDeleted != result.AttachmentsDeleted {
		t.Fatalf("retry result = %+v, want original summary %+v", retry, result)
	}

	lateEvent := newEvent(owner.GetId(), &corev1.Event{Event: &corev1.Event_RoomUpdated{
		RoomUpdated: &corev1.RoomUpdatedEvent{
			RoomId:      target.GetId(),
			Name:        target.GetName(),
			Description: "late stale writer",
		},
	}})
	if _, err := chatto.EventPublisher.Append(ctx, events.RoomAggregate(target.GetId()).SubjectFor(lateEvent), lateEvent); err != nil {
		t.Fatalf("append late target event: %v", err)
	}
	repaired, err := chatto.PurgeArchivedRoom(ctx, owner.GetId(), target.GetId(), target.GetName())
	if err != nil {
		t.Fatalf("repair completed purge: %v", err)
	}
	if !repaired.AlreadyPurged {
		t.Fatal("repair of a completed purge did not preserve alreadyPurged semantics")
	}
	targetEvents, _, err = chatto.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(target.GetId()).AllEventsFilter())
	if err != nil {
		t.Fatalf("read target events after repair: %v", err)
	}
	if len(targetEvents) != 1 || targetEvents[0].GetRoomDeleted().GetRoomId() != target.GetId() {
		t.Fatalf("target events after repair = %+v, want one RoomDeleted tombstone", targetEvents)
	}

	_ = targetReply
}
