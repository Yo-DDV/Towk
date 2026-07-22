package core

import (
	"errors"
	"sync"
	"testing"
	"time"

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

func TestLegacyJoinCannotImplicitlyTransferAnActiveDevice(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "room-legacy-join-choice"
	remover := &recordingLiveKitParticipantClient{}
	chatto.callModel.livekit = remover

	first, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-1", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join current client: %v", err)
	}

	decision, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("ask from legacy client: %v", err)
	}
	if decision.Status != CallJoinStatusSelectionRequired || !decision.CompanionAllowed || decision.ActiveDeviceCount != 1 {
		t.Fatalf("legacy join decision = %+v, want companion-or-transfer choice", decision)
	}
	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].ParticipantID != first.ParticipantID {
		t.Fatalf("legacy join changed active participants: %+v", participants)
	}
	if len(remover.removed) != 0 {
		t.Fatalf("legacy join removed active LiveKit participants: %+v", remover.removed)
	}
}

func TestLegacyTokenReplayCannotReadmitAnExplicitlyLeftParticipant(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	const roomID = "room-legacy-token-replay"

	legacy, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join legacy participant: %v", err)
	}
	if _, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-b", "browser-b", CallJoinModeAsk); err != nil {
		t.Fatalf("join call keeper: %v", err)
	}
	active, ok := chatto.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing")
	}
	if err := chatto.LeaveCallParticipant(ctx, KindChannel, roomID, "user-a", "", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("leave legacy participant: %v", err)
	}
	remover := &recordingLiveKitParticipantClient{}
	chatto.callModel.livekit = remover

	err = chatto.HandleObservedCallParticipantConnectionJoined(
		ctx,
		LegacySpaceIDForRoomKind(KindChannel),
		roomID,
		"user-a",
		legacy.ParticipantID,
		legacy.DeviceIndex,
		"Alice",
		"alice",
		"",
		CallParticipantConnectionObservation{ID: "stale-legacy-join"},
		active.CallID,
	)
	if !errors.Is(err, ErrCallParticipantNotAdmitted) {
		t.Fatalf("stale legacy join error = %v, want ErrCallParticipantNotAdmitted", err)
	}
	for _, participant := range chatto.CallState.Participants(roomID) {
		if participant.UserID == "user-a" {
			t.Fatalf("stale legacy token readmitted explicit leaver: %+v", participant)
		}
	}
	if len(remover.removed) != 1 || remover.removed[0].userID != legacy.ParticipantID {
		t.Fatalf("evicted participants = %+v, want legacy participant %q", remover.removed, legacy.ParticipantID)
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
	callBeforeTransfer, ok := chatto.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing before shared-room transfer")
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
	callAfterTransfer, ok := chatto.CallState.ActiveCall(roomID)
	if !ok || callAfterTransfer.CallID != callBeforeTransfer.CallID {
		t.Fatalf("shared-room transfer changed call from %q to %+v ok=%v", callBeforeTransfer.CallID, callAfterTransfer, ok)
	}
}

func TestTransferCallParticipantFencesFinishedRoomWhenAccountIsAlone(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "room-transfer-last-account"

	first, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-1", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join first device: %v", err)
	}
	second, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-2", CallJoinModeCompanion)
	if err != nil {
		t.Fatalf("join second device: %v", err)
	}
	oldCall, ok := chatto.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing before transfer")
	}

	transferred, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "browser-session-3", CallJoinModeTransfer)
	if err != nil {
		t.Fatalf("transfer call: %v", err)
	}
	newCall, ok := chatto.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing after transfer")
	}
	if newCall.CallID == oldCall.CallID {
		t.Fatalf("transfer kept call ID %q while removing the final LiveKit participants", oldCall.CallID)
	}

	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].ParticipantID != transferred.ParticipantID || participants[0].CallID != newCall.CallID {
		t.Fatalf("participants after transfer = %+v, want transferred device in fresh call %q", participants, newCall.CallID)
	}
	if hasCallParticipant(participants, "user-a", first.ParticipantID) || hasCallParticipant(participants, "user-a", second.ParticipantID) {
		t.Fatalf("old account devices survived transfer: %+v", participants)
	}

	if err := chatto.HandleCallRoomFinished(ctx, LegacySpaceIDForRoomKind(KindChannel), roomID, oldCall.CallID); err != nil {
		t.Fatalf("handle delayed old room finish: %v", err)
	}
	participants = chatto.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].ParticipantID != transferred.ParticipantID {
		t.Fatalf("delayed old room finish removed transferred device: %+v", participants)
	}
	active, ok := chatto.CallState.ActiveCall(roomID)
	if !ok || active.CallID != newCall.CallID {
		t.Fatalf("active call after delayed old room finish = %+v ok=%v, want %q", active, ok, newCall.CallID)
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

func TestDelayedLeaveForOldCallCannotRemoveReplacementCallParticipant(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	const (
		roomID           = "room-delayed-leave"
		userID           = "user-a"
		clientInstanceID = "browser-session-1"
	)

	first, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, userID, clientInstanceID, CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join first call: %v", err)
	}
	firstCall, ok := chatto.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("first call missing")
	}
	if err := chatto.callModel.AppendParticipantLeftForCall(ctx, roomID, userID, first.ParticipantID, firstCall.CallID, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_RECONCILIATION); err != nil {
		t.Fatalf("end first call: %v", err)
	}

	second, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, userID, clientInstanceID, CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join replacement call: %v", err)
	}
	secondCall, ok := chatto.CallState.ActiveCall(roomID)
	if !ok || secondCall.CallID == firstCall.CallID {
		t.Fatalf("replacement call = %+v ok=%v, want call after %q", secondCall, ok, firstCall.CallID)
	}

	// This represents an HTTP LeaveCall request for the first call that was
	// delayed until after the same browser session had joined its replacement.
	if err := chatto.LeaveCallParticipant(ctx, KindChannel, roomID, userID, clientInstanceID, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER, firstCall.CallID); err != nil {
		t.Fatalf("apply delayed leave: %v", err)
	}

	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].ParticipantID != second.ParticipantID || participants[0].CallID != secondCall.CallID {
		t.Fatalf("participants after delayed leave = %+v, want replacement participant in call %q", participants, secondCall.CallID)
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
	now := time.Unix(1_700_300_000, 0)
	chatto.callModel.now = func() time.Time { return now }

	err := chatto.callModel.ReconcileRoomConnections(ctx, roomID, []liveKitObservedParticipant{{
		UserID:        "user-a",
		ParticipantID: second.ParticipantID,
		DeviceIndex:   second.DeviceIndex,
	}})
	if err != nil {
		t.Fatalf("ReconcileRoomConnections: %v", err)
	}

	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 2 || participants[0].ParticipantID != first.ParticipantID || participants[0].ConnectionState != corev1.CallParticipantConnectionState_CALL_PARTICIPANT_CONNECTION_STATE_INTERRUPTED {
		t.Fatalf("participants during reconciliation grace = %+v, want interrupted first device retained", participants)
	}

	now = now.Add(CallParticipantRecoveryGrace + time.Millisecond)
	err = chatto.callModel.ReconcileRoomConnections(ctx, roomID, []liveKitObservedParticipant{{
		UserID:        "user-a",
		ParticipantID: second.ParticipantID,
		DeviceIndex:   second.DeviceIndex,
	}})
	if err != nil {
		t.Fatalf("ReconcileRoomConnections after grace: %v", err)
	}
	participants = chatto.CallState.Participants(roomID)
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

func TestConnectionReconciliationAllowsSameClientToStartFreshCallAfterGrace(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	roomID := "room-long-network-outage"
	clientInstanceID := "browser-session-1"
	first, err := chatto.JoinCallParticipant(
		ctx,
		KindChannel,
		roomID,
		"user-a",
		clientInstanceID,
		CallJoinModeAsk,
	)
	if err != nil {
		t.Fatalf("join initial call: %v", err)
	}
	now := time.Unix(1_700_400_000, 0)
	chatto.callModel.now = func() time.Time { return now }

	if err := chatto.callModel.ReconcileRoomConnections(ctx, roomID, nil); err != nil {
		t.Fatalf("mark initial connection interrupted: %v", err)
	}
	now = now.Add(CallParticipantRecoveryGrace + time.Millisecond)
	if err := chatto.callModel.ReconcileRoomConnections(ctx, roomID, nil); err != nil {
		t.Fatalf("expire initial connection after grace: %v", err)
	}
	if _, ok := chatto.CallState.ActiveCall(roomID); ok {
		t.Fatal("initial call should be ended after its only connection expires")
	}

	if _, err := chatto.JoinCallParticipant(
		ctx,
		KindChannel,
		roomID,
		"user-a",
		clientInstanceID,
		CallJoinModeCompanion,
		first.CallID,
	); !errors.Is(err, ErrCallNoLongerActive) {
		t.Fatalf("stale-generation recovery error = %v, want ErrCallNoLongerActive", err)
	}

	second, err := chatto.JoinCallParticipant(
		ctx,
		KindChannel,
		roomID,
		"user-a",
		clientInstanceID,
		CallJoinModeCompanion,
	)
	if err != nil {
		t.Fatalf("join fresh call generation: %v", err)
	}
	if second.CallID == "" || second.CallID == first.CallID {
		t.Fatalf("fresh call ID = %q, want value distinct from %q", second.CallID, first.CallID)
	}
	if second.ParticipantID != first.ParticipantID {
		t.Fatalf(
			"fresh participant ID = %q, want stable connection identity %q",
			second.ParticipantID,
			first.ParticipantID,
		)
	}
	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].CallID != second.CallID {
		t.Fatalf("participants after fresh recovery = %+v, want one participant in new call", participants)
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

func TestConnectionReconciliationEvictsUnadmittedLegacyIdentity(t *testing.T) {
	chatto, _ := setupTestCore(t)
	ctx := testContext(t)
	const roomID = "room-legacy-reconciliation"

	legacy, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-a", "", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join legacy participant: %v", err)
	}
	keeper, err := chatto.JoinCallParticipant(ctx, KindChannel, roomID, "user-b", "browser-b", CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join call keeper: %v", err)
	}
	activeCall, ok := chatto.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing")
	}
	if err := chatto.LeaveCallParticipant(ctx, KindChannel, roomID, "user-a", "", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("leave legacy participant: %v", err)
	}
	recorder := &recordingLiveKitParticipantClient{snapshots: []liveKitParticipantSnapshot{{
		SpaceID: LegacySpaceIDForRoomKind(KindChannel),
		RoomID:  roomID,
		CallID:  activeCall.CallID,
		Participants: []liveKitObservedParticipant{
			{UserID: "user-a", ParticipantID: legacy.ParticipantID, DeviceIndex: legacy.DeviceIndex},
			{UserID: "user-b", ParticipantID: keeper.ParticipantID, DeviceIndex: keeper.DeviceIndex},
		},
	}}}
	chatto.callModel.livekit = recorder

	if err := chatto.callModel.ReconcileWithLiveKit(ctx); err != nil {
		t.Fatalf("ReconcileWithLiveKit: %v", err)
	}
	if len(recorder.removed) != 1 || recorder.removed[0].userID != legacy.ParticipantID {
		t.Fatalf("LiveKit removals = %+v, want stale legacy identity", recorder.removed)
	}
	participants := chatto.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].ParticipantID != keeper.ParticipantID {
		t.Fatalf("participants after reconciliation = %+v, want call keeper only", participants)
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
