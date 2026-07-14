package core

import (
	"errors"
	"sync"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestVoiceCallParticipantIDIsStableAndAccountScoped(t *testing.T) {
	first := VoiceCallParticipantID("user-a", "browser-session-1")
	if first == "" {
		t.Fatal("VoiceCallParticipantID returned an empty identity")
	}
	if got := VoiceCallParticipantID("user-a", "browser-session-1"); got != first {
		t.Fatalf("VoiceCallParticipantID is not stable: got %q, want %q", got, first)
	}
	if got := VoiceCallParticipantID("user-b", "browser-session-1"); got == first {
		t.Fatal("the same client instance must not collide across accounts")
	}
	if got := VoiceCallParticipantID("user-a", "browser-session-2"); got == first {
		t.Fatal("different client instances must receive different identities")
	}
	if got := VoiceCallParticipantID("user-a", ""); got != "user-a" {
		t.Fatalf("legacy empty client instance identity = %q, want user ID", got)
	}
}

func TestGenerateVoiceCallTokenForParticipantUsesConnectionIdentity(t *testing.T) {
	result, err := GenerateVoiceCallTokenForParticipant(
		"devkey",
		"secret",
		"space_room",
		VoiceCallParticipantIdentity{
			UserID:        "user-a",
			ParticipantID: "device-participant-a",
			DeviceIndex:   2,
		},
		"Alice",
		"alice",
		"https://example.com/alice.jpg",
		"e2ee-key",
		"call-a",
	)
	if err != nil {
		t.Fatalf("GenerateVoiceCallTokenForParticipant: %v", err)
	}

	parser := jwt.NewParser(jwt.WithoutClaimsValidation())
	token, _, err := parser.ParseUnverified(result.Token, jwt.MapClaims{})
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	claims := token.Claims.(jwt.MapClaims)
	if got := claims["sub"]; got != "device-participant-a" {
		t.Fatalf("token identity = %v, want device participant identity", got)
	}
	metadata, ok := claims["metadata"].(string)
	if !ok {
		t.Fatal("token metadata claim missing")
	}
	parsed := ParseParticipantMetadata(metadata)
	if parsed.UserID != "user-a" || parsed.ParticipantID != "device-participant-a" || parsed.DeviceIndex != 2 {
		t.Fatalf("participant metadata = %+v, want account and device identity", parsed)
	}
}

func TestJoinCallParticipantRequiresChoiceAndCapsCompanions(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "room-multi-device"

	first, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-1", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join first device: %v", err)
	}
	if first.Status != CallJoinStatusJoined || first.DeviceIndex != 1 {
		t.Fatalf("first join = %+v, want joined as device 1", first)
	}

	decision, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-2", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("ask for second device: %v", err)
	}
	if decision.Status != CallJoinStatusSelectionRequired || !decision.CompanionAllowed || decision.ActiveDeviceCount != 1 {
		t.Fatalf("second join decision = %+v, want companion-or-transfer choice", decision)
	}
	if got := chatto.CallState.Participants(roomID); len(got) != 1 {
		t.Fatalf("selection-only request mutated participants: %+v", got)
	}

	second, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-2", CallJoinModeCompanion)
	if err != nil {
		t.Fatalf("join companion: %v", err)
	}
	if second.Status != CallJoinStatusJoined || second.DeviceIndex != 2 {
		t.Fatalf("companion join = %+v, want joined as device 2", second)
	}
	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 2 || participants[0].UserID != "user-a" || participants[1].UserID != "user-a" {
		t.Fatalf("participants = %+v, want two connections for one account", participants)
	}

	thirdDecision, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-3", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("ask for third device: %v", err)
	}
	if thirdDecision.Status != CallJoinStatusSelectionRequired || thirdDecision.CompanionAllowed || thirdDecision.ActiveDeviceCount != 2 {
		t.Fatalf("third join decision = %+v, want transfer-or-cancel only", thirdDecision)
	}
	if _, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-3", CallJoinModeCompanion); !errors.Is(err, ErrCallDeviceLimit) {
		t.Fatalf("third companion error = %v, want ErrCallDeviceLimit", err)
	}
}

func TestTransferCallParticipantReplacesOnlySameAccountDevices(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "room-transfer-device"
	remover := &recordingLiveKitParticipantClient{}
	chatto.callModel.livekit = remover

	first, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-1", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join first device: %v", err)
	}
	second, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-2", CallJoinModeCompanion)
	if err != nil {
		t.Fatalf("join second device: %v", err)
	}
	other, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-b", "browser-session-b", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join other account: %v", err)
	}

	transferred, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-3", CallJoinModeTransfer)
	if err != nil {
		t.Fatalf("transfer call: %v", err)
	}
	if transferred.Status != CallJoinStatusJoined || transferred.DeviceIndex != 1 {
		t.Fatalf("transfer result = %+v, want new primary device", transferred)
	}
	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 2 {
		t.Fatalf("participants after transfer = %+v, want new device and other account", participants)
	}
	if !hasCallParticipant(participants, "user-a", transferred.ParticipantID) || !hasCallParticipant(participants, "user-b", other.ParticipantID) {
		t.Fatalf("participants after transfer = %+v", participants)
	}
	if hasCallParticipant(participants, "user-a", first.ParticipantID) || hasCallParticipant(participants, "user-a", second.ParticipantID) {
		t.Fatalf("old account devices survived transfer: %+v", participants)
	}
	if len(remover.removed) != 2 {
		t.Fatalf("LiveKit removals = %+v, want both old device identities", remover.removed)
	}
}

func TestLeaveCallParticipantPreservesSiblingDevice(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "room-exact-leave"

	first, _ := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-1", CallJoinModeAsk)
	second, _ := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-2", CallJoinModeCompanion)

	if err := chatto.LeaveCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-2", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("leave companion: %v", err)
	}
	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].ParticipantID != first.ParticipantID {
		t.Fatalf("participants after exact leave = %+v, want first device only", participants)
	}
	if participants[0].ParticipantID == second.ParticipantID {
		t.Fatal("left device remained projected")
	}
	if _, ok := chatto.CallState.ActiveCall(roomID); !ok {
		t.Fatal("leaving one device must not end the call")
	}
}

func TestConcurrentCompanionAdmissionNeverExceedsTwoDevices(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "room-concurrent-companions"
	if _, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-1", CallJoinModeAsk); err != nil {
		t.Fatalf("join first device: %v", err)
	}

	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, clientID := range []string{"browser-session-2", "browser-session-3"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", clientID, CallJoinModeCompanion)
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)

	var joined, rejected int
	for err := range errs {
		switch {
		case err == nil:
			joined++
		case errors.Is(err, ErrCallDeviceLimit):
			rejected++
		default:
			t.Fatalf("concurrent companion error: %v", err)
		}
	}
	if joined != 1 || rejected != 1 {
		t.Fatalf("concurrent results: joined=%d rejected=%d, want 1 and 1", joined, rejected)
	}
	if participants := chatto.CallState.Participants(roomID); len(participants) != 2 {
		t.Fatalf("participants after concurrent joins = %+v, want exactly two", participants)
	}
}

func TestConnectionReconciliationRemovesOnlyMissingDevice(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "room-device-reconciliation"
	first, _ := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-1", CallJoinModeAsk)
	second, _ := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-2", CallJoinModeCompanion)

	err := chatto.callModel.ReconcileRoomConnections(ctx, roomID, []liveKitObservedParticipant{{
		UserID:        "user-a",
		ParticipantID: second.ParticipantID,
		DeviceIndex:   second.DeviceIndex,
	}})
	if err != nil {
		t.Fatalf("ReconcileRoomConnections: %v", err)
	}

	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].ParticipantID != second.ParticipantID {
		t.Fatalf("participants after reconciliation = %+v, want second device only", participants)
	}
	if participants[0].ParticipantID == first.ParticipantID {
		t.Fatal("missing first device survived connection-scoped reconciliation")
	}
	if _, ok := chatto.CallState.ActiveCall(roomID); !ok {
		t.Fatal("removing one missing device must not end the call")
	}
}

func TestConnectionReconciliationEvictsTransferredIdentityWithoutResurrectingIt(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "room-transfer-reconciliation"
	first, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-1", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join first device: %v", err)
	}
	if _, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-2", CallJoinModeCompanion); err != nil {
		t.Fatalf("join companion: %v", err)
	}
	transferred, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-3", CallJoinModeTransfer)
	if err != nil {
		t.Fatalf("transfer call: %v", err)
	}
	activeCall, ok := chatto.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing after transfer")
	}

	recorder := &recordingLiveKitParticipantClient{snapshots: []liveKitParticipantSnapshot{{
		SpaceID: LegacySpaceIDForRoomKind(KindChannel),
		RoomID:  roomID,
		CallID:  activeCall.CallID,
		Participants: []liveKitObservedParticipant{
			{UserID: "user-a", ParticipantID: first.ParticipantID, DeviceIndex: first.DeviceIndex},
			{UserID: "user-a", ParticipantID: transferred.ParticipantID, DeviceIndex: transferred.DeviceIndex},
		},
	}}}
	chatto.callModel.livekit = recorder

	if err := chatto.callModel.ReconcileWithLiveKit(ctx); err != nil {
		t.Fatalf("ReconcileWithLiveKit: %v", err)
	}
	if len(recorder.removed) != 1 || recorder.removed[0].userID != first.ParticipantID {
		t.Fatalf("LiveKit removals = %+v, want stale transferred identity", recorder.removed)
	}
	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].ParticipantID != transferred.ParticipantID {
		t.Fatalf("participants after reconciliation = %+v, want transferred device only", participants)
	}
}

func TestConnectionScopedWebhookJoinRequiresDurableAdmission(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "room-webhook-admission"
	admitted, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-1", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join admitted device: %v", err)
	}
	activeCall, ok := chatto.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing")
	}
	recorder := &recordingLiveKitParticipantClient{}
	chatto.callModel.livekit = recorder
	staleParticipantID := VoiceCallParticipantID("user-a", "browser-session-stale")

	err = chatto.HandleCallParticipantConnectionJoined(
		ctx,
		LegacySpaceIDForRoomKind(KindChannel),
		roomID,
		"user-a",
		staleParticipantID,
		2,
		"Alice",
		"alice",
		"",
		activeCall.CallID,
	)
	if !errors.Is(err, ErrCallParticipantNotAdmitted) {
		t.Fatalf("stale webhook join error = %v, want ErrCallParticipantNotAdmitted", err)
	}
	if len(recorder.removed) != 1 || recorder.removed[0].userID != staleParticipantID {
		t.Fatalf("LiveKit removals = %+v, want stale connection eviction", recorder.removed)
	}
	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].ParticipantID != admitted.ParticipantID {
		t.Fatalf("participants after stale webhook = %+v, want admitted device only", participants)
	}
}

func TestRoomLeaveRemovesAllAccountDevices(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := chatto.CreateUser(ctx, SystemActorID, "multi-device-room-leaver", "Multi Device Room Leaver", "password")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	room, err := chatto.CreateRoom(ctx, SystemActorID, KindChannel, "", "multi-device-room-leave", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := chatto.JoinRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("JoinRoom: %v", err)
	}
	first, _ := chatto.JoinCallParticipant(ctx, KindChannel, room.Id, user.Id, "browser-session-1", CallJoinModeAsk)
	second, _ := chatto.JoinCallParticipant(ctx, KindChannel, room.Id, user.Id, "browser-session-2", CallJoinModeCompanion)
	recorder := &recordingLiveKitParticipantClient{}
	chatto.callModel.livekit = recorder

	if err := chatto.LeaveRoom(ctx, user.Id, KindChannel, user.Id, room.Id); err != nil {
		t.Fatalf("LeaveRoom: %v", err)
	}
	if participants := chatto.CallState.Participants(room.Id); len(participants) != 0 {
		t.Fatalf("participants after room leave = %+v, want none", participants)
	}
	removed := make(map[string]bool, len(recorder.removed))
	for _, participant := range recorder.removed {
		removed[participant.userID] = true
	}
	if len(removed) != 2 || !removed[first.ParticipantID] || !removed[second.ParticipantID] {
		t.Fatalf("LiveKit removals = %+v, want both connection identities", recorder.removed)
	}
}

func hasCallParticipant(participants []CallParticipant, userID, participantID string) bool {
	for _, participant := range participants {
		if participant.UserID == userID && participant.ParticipantID == participantID {
			return true
		}
	}
	return false
}
