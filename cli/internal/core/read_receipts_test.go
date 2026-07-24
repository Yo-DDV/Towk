package core

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"hmans.de/chatto/internal/core/subjects"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

type readReceiptFixture struct {
	core   *ChattoCore
	nc     *nats.Conn
	room   *corev1.Room
	author *corev1.User
	reader *corev1.User
	viewer *corev1.User
}

func newReadReceiptFixture(t *testing.T) readReceiptFixture {
	t.Helper()
	chatto, nc := setupTestCore(t)
	ctx := testContext(t)
	room, err := chatto.CreateRoom(ctx, SystemActorID, KindChannel, "", "Receipts", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	create := func(login string) *corev1.User {
		user, err := chatto.CreateUser(ctx, SystemActorID, login, login, "password123")
		if err != nil {
			t.Fatalf("CreateUser(%s): %v", login, err)
		}
		if _, err := chatto.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
			t.Fatalf("JoinRoom(%s): %v", login, err)
		}
		return user
	}
	return readReceiptFixture{
		core:   chatto,
		nc:     nc,
		room:   room,
		author: create("receipt-author"),
		reader: create("receipt-reader"),
		viewer: create("receipt-viewer"),
	}
}

func (f readReceiptFixture) post(t *testing.T, actor *corev1.User, body string) *corev1.Event {
	t.Helper()
	event, err := f.core.PostMessage(testContext(t), KindChannel, f.room.Id, actor.Id, body, nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(%s): %v", body, err)
	}
	return event
}

func readerCountFor(t *testing.T, summaries []*ReadReceiptSummaryRecord, eventID string) int {
	t.Helper()
	for _, summary := range summaries {
		if summary.MessageEventID == eventID {
			return summary.ReaderCount
		}
	}
	t.Fatalf("summary for %s not found", eventID)
	return 0
}

func TestReadReceiptModel_AdvancesMonotonicallyAndPublishesCompactDelta(t *testing.T) {
	f := newReadReceiptFixture(t)
	ctx := testContext(t)
	first := f.post(t, f.author, "first")
	second := f.post(t, f.author, "second")

	sub, err := f.nc.SubscribeSync(subjects.LiveSyncRoomEvent(string(KindChannel), f.room.Id, "read_receipt"))
	if err != nil {
		t.Fatalf("SubscribeSync: %v", err)
	}
	if err := f.nc.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	advance, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", second.Id)
	if err != nil {
		t.Fatalf("Advance: %v", err)
	}
	if !advance.Updated || advance.EventID != second.Id || advance.EventSequence == 0 || advance.ReadAt.IsZero() {
		t.Fatalf("advance = %+v", advance)
	}

	msg, err := sub.NextMsg(2 * time.Second)
	if err != nil {
		t.Fatalf("NextMsg: %v", err)
	}
	var live corev1.LiveEvent
	if err := proto.Unmarshal(msg.Data, &live); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	delta := live.GetPublicReadReceiptAdvanced()
	if delta == nil || delta.GetRoomId() != f.room.Id || delta.GetUserId() != f.reader.Id || delta.GetEventId() != second.Id {
		t.Fatalf("delta = %+v", delta)
	}

	stale, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", first.Id)
	if err != nil {
		t.Fatalf("stale Advance: %v", err)
	}
	if stale.Updated || stale.EventID != second.Id {
		t.Fatalf("stale advance = %+v", stale)
	}

	summaries, err := f.core.ReadReceipts().Summaries(ctx, f.viewer.Id, f.room.Id, "", []string{first.Id, second.Id})
	if err != nil {
		t.Fatalf("Summaries: %v", err)
	}
	if readerCountFor(t, summaries, first.Id) != 1 || readerCountFor(t, summaries, second.Id) != 1 {
		t.Fatalf("summaries = %+v", summaries)
	}
	readers, err := f.core.ReadReceipts().Readers(ctx, f.viewer.Id, f.room.Id, "", first.Id)
	if err != nil {
		t.Fatalf("Readers: %v", err)
	}
	if len(readers) != 1 || readers[0].UserID != f.reader.Id || readers[0].ReadAt.IsZero() {
		t.Fatalf("readers = %+v", readers)
	}
}

func TestReadReceiptModel_DoesNotPublishReceiptForOwnMessage(t *testing.T) {
	f := newReadReceiptFixture(t)
	message := f.post(t, f.author, "self")
	advance, err := f.core.ReadReceipts().Advance(testContext(t), f.author.Id, f.room.Id, "", message.Id)
	if err != nil {
		t.Fatalf("Advance: %v", err)
	}
	if advance.Updated {
		t.Fatalf("own-message advance = %+v, want no update", advance)
	}
	summaries, err := f.core.ReadReceipts().Summaries(testContext(t), f.viewer.Id, f.room.Id, "", []string{message.Id})
	if err != nil {
		t.Fatalf("Summaries: %v", err)
	}
	if readerCountFor(t, summaries, message.Id) != 0 {
		t.Fatalf("summaries = %+v", summaries)
	}
}

func TestReadReceiptModel_ConcurrentAdvancesConvergeOnHighestCursor(t *testing.T) {
	f := newReadReceiptFixture(t)
	ctx := testContext(t)
	messages := make([]*corev1.Event, 0, 12)
	for i := 0; i < 12; i++ {
		messages = append(messages, f.post(t, f.author, "concurrent"))
	}

	var updated atomic.Int32
	var wg sync.WaitGroup
	errs := make(chan error, len(messages)*2)
	for repeat := 0; repeat < 2; repeat++ {
		for _, message := range messages {
			message := message
			wg.Add(1)
			go func() {
				defer wg.Done()
				result, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", message.Id)
				if err != nil {
					errs <- err
					return
				}
				if result.Updated {
					updated.Add(1)
				}
			}()
		}
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent Advance: %v", err)
	}
	if updated.Load() == 0 {
		t.Fatal("no concurrent advance updated the cursor")
	}

	last := messages[len(messages)-1]
	summaries, err := f.core.ReadReceipts().Summaries(ctx, f.viewer.Id, f.room.Id, "", []string{messages[0].Id, last.Id})
	if err != nil {
		t.Fatalf("Summaries: %v", err)
	}
	if readerCountFor(t, summaries, messages[0].Id) != 1 || readerCountFor(t, summaries, last.Id) != 1 {
		t.Fatalf("summaries = %+v", summaries)
	}
}

func TestReadReceiptModel_UserOptOutPreservesHistoryWithoutBackfill(t *testing.T) {
	f := newReadReceiptFixture(t)
	ctx := testContext(t)
	before := f.post(t, f.author, "before opt out")
	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", before.Id); err != nil {
		t.Fatalf("initial Advance: %v", err)
	}

	disabled := false
	if _, err := f.core.UpdateUserSettings(ctx, f.reader.Id, UserSettingsInput{ReadReceiptsEnabled: &disabled}); err != nil {
		t.Fatalf("disable user receipts: %v", err)
	}
	during := f.post(t, f.author, "during opt out")
	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", during.Id); !errors.Is(err, ErrReadReceiptsDisabled) {
		t.Fatalf("disabled Advance error = %v, want ErrReadReceiptsDisabled", err)
	}

	// Ensure the durable enable event is strictly newer than the message event.
	time.Sleep(time.Millisecond)
	enabled := true
	if _, err := f.core.UpdateUserSettings(ctx, f.reader.Id, UserSettingsInput{ReadReceiptsEnabled: &enabled}); err != nil {
		t.Fatalf("re-enable user receipts: %v", err)
	}
	stale, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", during.Id)
	if err != nil {
		t.Fatalf("stale Advance after re-enable: %v", err)
	}
	if stale.Updated {
		t.Fatalf("stale advance = %+v, want no update", stale)
	}

	after := f.post(t, f.author, "after opt out")
	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", after.Id); err != nil {
		t.Fatalf("post-enable Advance: %v", err)
	}
	summaries, err := f.core.ReadReceipts().Summaries(ctx, f.viewer.Id, f.room.Id, "", []string{before.Id, during.Id, after.Id})
	if err != nil {
		t.Fatalf("Summaries: %v", err)
	}
	if readerCountFor(t, summaries, before.Id) != 1 || readerCountFor(t, summaries, during.Id) != 0 || readerCountFor(t, summaries, after.Id) != 1 {
		t.Fatalf("summaries = %+v", summaries)
	}
}

func TestReadReceiptModel_ServerOptOutIsReciprocalAndDoesNotBackfill(t *testing.T) {
	f := newReadReceiptFixture(t)
	ctx := testContext(t)
	if err := f.core.GrantUserPermission(ctx, SystemActorID, f.author.Id, PermServerManage); err != nil {
		t.Fatalf("GrantUserPermission(server.manage): %v", err)
	}
	before := f.post(t, f.author, "server before")
	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", before.Id); err != nil {
		t.Fatalf("initial Advance: %v", err)
	}

	disabled := false
	if _, err := f.core.UpdateServerConfig(ctx, f.author.Id, ServerConfigUpdateInput{ReadReceiptsEnabled: &disabled}); err != nil {
		t.Fatalf("disable server receipts: %v", err)
	}
	during := f.post(t, f.author, "server disabled")
	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", during.Id); !errors.Is(err, ErrReadReceiptsDisabled) {
		t.Fatalf("disabled Advance error = %v, want ErrReadReceiptsDisabled", err)
	}
	if _, err := f.core.ReadReceipts().Summaries(ctx, f.viewer.Id, f.room.Id, "", []string{before.Id}); !errors.Is(err, ErrReadReceiptsDisabled) {
		t.Fatalf("disabled Summaries error = %v, want ErrReadReceiptsDisabled", err)
	}

	time.Sleep(time.Millisecond)
	enabled := true
	if _, err := f.core.UpdateServerConfig(ctx, f.author.Id, ServerConfigUpdateInput{ReadReceiptsEnabled: &enabled}); err != nil {
		t.Fatalf("re-enable server receipts: %v", err)
	}
	after := f.post(t, f.author, "server after")
	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", after.Id); err != nil {
		t.Fatalf("post-enable Advance: %v", err)
	}
	summaries, err := f.core.ReadReceipts().Summaries(ctx, f.viewer.Id, f.room.Id, "", []string{before.Id, during.Id, after.Id})
	if err != nil {
		t.Fatalf("Summaries: %v", err)
	}
	if readerCountFor(t, summaries, before.Id) != 1 || readerCountFor(t, summaries, during.Id) != 0 || readerCountFor(t, summaries, after.Id) != 1 {
		t.Fatalf("summaries = %+v", summaries)
	}
}

func TestReadReceiptModel_ThreadCursorIsIsolatedFromRoomCursor(t *testing.T) {
	f := newReadReceiptFixture(t)
	ctx := testContext(t)
	root := f.post(t, f.author, "thread root")
	reply, err := f.core.PostMessage(ctx, KindChannel, f.room.Id, f.author.Id, "thread reply", nil, root.Id, "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage reply: %v", err)
	}
	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, root.Id, reply.Id); err != nil {
		t.Fatalf("thread Advance: %v", err)
	}
	threadSummaries, err := f.core.ReadReceipts().Summaries(ctx, f.viewer.Id, f.room.Id, root.Id, []string{reply.Id})
	if err != nil {
		t.Fatalf("thread Summaries: %v", err)
	}
	if readerCountFor(t, threadSummaries, reply.Id) != 1 {
		t.Fatalf("thread summaries = %+v", threadSummaries)
	}
	if _, err := f.core.ReadReceipts().Summaries(ctx, f.viewer.Id, f.room.Id, "", []string{reply.Id}); err == nil {
		t.Fatal("room summary accepted a thread-only message")
	}
}

func TestReadReceiptModel_UsesCurrentMembershipForAuthorizationAndReaderLists(t *testing.T) {
	f := newReadReceiptFixture(t)
	ctx := testContext(t)
	message := f.post(t, f.author, "membership")
	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", message.Id); err != nil {
		t.Fatalf("Advance: %v", err)
	}
	outsider, err := f.core.CreateUser(ctx, SystemActorID, "receipt-outsider", "Receipt Outsider", "password123")
	if err != nil {
		t.Fatalf("CreateUser outsider: %v", err)
	}
	if _, err := f.core.ReadReceipts().Summaries(ctx, outsider.Id, f.room.Id, "", []string{message.Id}); err == nil {
		t.Fatal("non-member could inspect receipts")
	}

	if err := f.core.LeaveRoom(ctx, f.reader.Id, KindChannel, f.reader.Id, f.room.Id); err != nil {
		t.Fatalf("LeaveRoom: %v", err)
	}
	summaries, err := f.core.ReadReceipts().Summaries(ctx, f.viewer.Id, f.room.Id, "", []string{message.Id})
	if err != nil {
		t.Fatalf("Summaries after leave: %v", err)
	}
	if readerCountFor(t, summaries, message.Id) != 0 {
		t.Fatalf("former member leaked in summaries: %+v", summaries)
	}
}

func TestReadReceiptModel_ReenabledGenerationCoversEarlierPostEnableMessagesOnly(t *testing.T) {
	f := newReadReceiptFixture(t)
	ctx := testContext(t)

	disabled := false
	if _, err := f.core.UpdateUserSettings(ctx, f.reader.Id, UserSettingsInput{ReadReceiptsEnabled: &disabled}); err != nil {
		t.Fatalf("disable user receipts: %v", err)
	}
	during := f.post(t, f.author, "during disabled generation")
	time.Sleep(time.Millisecond)
	enabled := true
	if _, err := f.core.UpdateUserSettings(ctx, f.reader.Id, UserSettingsInput{ReadReceiptsEnabled: &enabled}); err != nil {
		t.Fatalf("re-enable user receipts: %v", err)
	}
	first := f.post(t, f.author, "first after enable")
	second := f.post(t, f.author, "second after enable")

	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", second.Id); err != nil {
		t.Fatalf("Advance second post-enable message: %v", err)
	}
	summaries, err := f.core.ReadReceipts().Summaries(ctx, f.viewer.Id, f.room.Id, "", []string{during.Id, first.Id, second.Id})
	if err != nil {
		t.Fatalf("Summaries: %v", err)
	}
	if readerCountFor(t, summaries, during.Id) != 0 || readerCountFor(t, summaries, first.Id) != 1 || readerCountFor(t, summaries, second.Id) != 1 {
		t.Fatalf("summaries = %+v", summaries)
	}
}

func TestReadReceiptModel_GroupDMMembershipBoundsPublishingAndInspection(t *testing.T) {
	f := newReadReceiptFixture(t)
	ctx := testContext(t)
	dm, _, err := f.core.FindOrCreateDM(ctx, f.author.Id, []string{f.reader.Id, f.viewer.Id})
	if err != nil {
		t.Fatalf("FindOrCreateDM: %v", err)
	}
	message, err := f.core.PostMessage(ctx, KindDM, dm.Id, f.author.Id, "group dm", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage DM: %v", err)
	}
	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, dm.Id, "", message.Id); err != nil {
		t.Fatalf("Advance DM: %v", err)
	}
	summaries, err := f.core.ReadReceipts().Summaries(ctx, f.viewer.Id, dm.Id, "", []string{message.Id})
	if err != nil {
		t.Fatalf("Summaries DM: %v", err)
	}
	if readerCountFor(t, summaries, message.Id) != 1 {
		t.Fatalf("summaries = %+v", summaries)
	}
	outsider, err := f.core.CreateUser(ctx, SystemActorID, "receipt-dm-outsider", "Receipt DM Outsider", "password123")
	if err != nil {
		t.Fatalf("CreateUser outsider: %v", err)
	}
	if _, err := f.core.ReadReceipts().Summaries(ctx, outsider.Id, dm.Id, "", []string{message.Id}); !errors.Is(err, ErrNotRoomMember) {
		t.Fatalf("outsider Summaries error = %v, want ErrNotRoomMember", err)
	}
}

func TestCompactReadReceiptIntervalsDoesNotBridgeSequenceGaps(t *testing.T) {
	oldGeneration := timestamppb.New(time.Unix(100, 0).UTC())
	newGeneration := timestamppb.New(time.Unix(200, 0).UTC())
	intervals := compactReadReceiptIntervals([]*corev1.PublicReadReceiptInterval{
		{GenerationStartedAt: oldGeneration, StartEventSequence: 1, EndEventSequence: 10, EndEventId: "M10"},
		{GenerationStartedAt: newGeneration, StartEventSequence: 12, EndEventSequence: 15, EndEventId: "M15"},
	})
	if len(intervals) != 2 {
		t.Fatalf("interval count = %d, want 2", len(intervals))
	}

	adjacent := compactReadReceiptIntervals([]*corev1.PublicReadReceiptInterval{
		{GenerationStartedAt: oldGeneration, StartEventSequence: 1, EndEventSequence: 10, EndEventId: "M10"},
		{GenerationStartedAt: newGeneration, StartEventSequence: 11, EndEventSequence: 15, EndEventId: "M15"},
	})
	if len(adjacent) != 1 || adjacent[0].GetEndEventSequence() != 15 {
		t.Fatalf("adjacent intervals = %+v, want one interval ending at 15", adjacent)
	}
	if !adjacent[0].GetGenerationStartedAt().AsTime().Equal(oldGeneration.AsTime()) {
		t.Fatalf("merged generation start = %v, want %v", adjacent[0].GetGenerationStartedAt(), oldGeneration)
	}
}

func TestReadReceiptModel_CleanupRemovesUserAndRoomCursors(t *testing.T) {
	f := newReadReceiptFixture(t)
	ctx := testContext(t)
	message := f.post(t, f.author, "cleanup")
	if _, err := f.core.ReadReceipts().Advance(ctx, f.reader.Id, f.room.Id, "", message.Id); err != nil {
		t.Fatalf("Advance: %v", err)
	}
	key := roomReadReceiptKey(f.room.Id, f.reader.Id)
	if _, err := f.core.storage.runtimeStateKV.Get(ctx, key); err != nil {
		t.Fatalf("cursor Get: %v", err)
	}
	if err := f.core.ReadReceipts().DeleteUserCursors(ctx, f.reader.Id); err != nil {
		t.Fatalf("DeleteUserCursors: %v", err)
	}
	if _, err := f.core.storage.runtimeStateKV.Get(ctx, key); err == nil {
		t.Fatal("user cursor still exists")
	}

	if _, err := f.core.ReadReceipts().Advance(ctx, f.viewer.Id, f.room.Id, "", message.Id); err != nil {
		t.Fatalf("viewer Advance: %v", err)
	}
	if err := f.core.ReadReceipts().DeleteRoomCursors(ctx, f.room.Id); err != nil {
		t.Fatalf("DeleteRoomCursors: %v", err)
	}
	if _, err := f.core.storage.runtimeStateKV.Get(ctx, roomReadReceiptKey(f.room.Id, f.viewer.Id)); err == nil {
		t.Fatal("room cursor still exists")
	}
}
