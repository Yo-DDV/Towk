package http_server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/livekit/protocol/webhook"
	"google.golang.org/protobuf/encoding/protojson"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestLiveKitWebhookReturnsRetryableStatusWhenCallMutationFails(t *testing.T) {
	const (
		apiKey    = "devkey"
		apiSecret = "devsecret"
		serverID  = "test-server"
		roomID    = "room-retryable-webhook"
		userID    = "user1"
	)
	testCtx := testContext(t)
	s := setupHTTPServerTestServer(t, config.AuthConfig{})
	s.config.LiveKit = config.LiveKitConfig{
		Enabled:   true,
		URL:       "ws://livekit.example.test",
		APIKey:    apiKey,
		APISecret: apiSecret,
		ServerID:  serverID,
	}
	s.setupWebhookRoutes()

	if err := s.core.RecordCallParticipantJoined(testCtx, core.KindChannel, roomID, userID, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantJoined() error = %v", err)
	}
	active, ok := s.core.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing")
	}
	event := &livekit.WebhookEvent{
		Event: webhook.EventParticipantLeft,
		Room: &livekit.Room{
			Name: core.LiveKitRoomName(serverID, core.LegacySpaceIDForRoomKind(core.KindChannel), roomID, active.CallID),
		},
		Participant: &livekit.ParticipantInfo{Identity: userID},
	}
	req := signedLiveKitWebhookRequest(t, apiKey, apiSecret, event)
	canceled, cancel := context.WithCancel(req.Context())
	cancel()
	req = req.WithContext(canceled)
	recorder := httptest.NewRecorder()

	s.router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("webhook status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
}

func TestLiveKitWebhookAcknowledgesRejectedUnadmittedConnection(t *testing.T) {
	const (
		apiKey    = "devkey"
		apiSecret = "devsecret"
		serverID  = "test-server"
		roomID    = "room-rejected-connection"
		userID    = "user1"
	)
	ctx := testContext(t)
	s := setupHTTPServerTestServer(t, config.AuthConfig{})
	s.config.LiveKit = config.LiveKitConfig{
		Enabled:   true,
		URL:       "ws://livekit.example.test",
		APIKey:    apiKey,
		APISecret: apiSecret,
		ServerID:  serverID,
	}
	s.setupWebhookRoutes()

	if err := s.core.RecordCallParticipantJoined(ctx, core.KindChannel, roomID, userID, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantJoined() error = %v", err)
	}
	active, ok := s.core.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing")
	}
	event := &livekit.WebhookEvent{
		Event: webhook.EventParticipantJoined,
		Room: &livekit.Room{
			Name: core.LiveKitRoomName(serverID, core.LegacySpaceIDForRoomKind(core.KindChannel), roomID, active.CallID),
		},
		Participant: &livekit.ParticipantInfo{
			Identity: "device-rogue",
			Metadata: `{"userId":"user1","callId":"` + active.CallID + `"}`,
		},
	}
	recorder := httptest.NewRecorder()

	s.router.ServeHTTP(recorder, signedLiveKitWebhookRequest(t, apiKey, apiSecret, event))

	if recorder.Code != http.StatusOK {
		t.Fatalf("webhook status = %d, want %d", recorder.Code, http.StatusOK)
	}
	participants := s.core.CallState.Participants(roomID)
	if len(participants) != 1 || participants[0].ParticipantID != userID {
		t.Fatalf("participants = %+v, want only the admitted legacy connection", participants)
	}
}

func TestLiveKitWebhookRejectsLegacyTokenReplayAfterExplicitLeave(t *testing.T) {
	const (
		apiKey    = "devkey"
		apiSecret = "devsecret"
		serverID  = "test-server"
		roomID    = "room-legacy-replay"
		userID    = "user1"
	)
	ctx := testContext(t)
	s := setupHTTPServerTestServer(t, config.AuthConfig{})
	s.config.LiveKit = config.LiveKitConfig{
		Enabled: true, URL: "ws://livekit.example.test", APIKey: apiKey, APISecret: apiSecret, ServerID: serverID,
	}
	s.setupWebhookRoutes()

	legacy, err := s.core.JoinCallParticipant(ctx, core.KindChannel, roomID, userID, "", core.CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join legacy participant: %v", err)
	}
	if _, err := s.core.JoinCallParticipant(ctx, core.KindChannel, roomID, "user2", "browser-2", core.CallJoinModeAsk); err != nil {
		t.Fatalf("join call keeper: %v", err)
	}
	active, ok := s.core.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing")
	}
	if err := s.core.LeaveCallParticipant(ctx, core.KindChannel, roomID, userID, "", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("leave legacy participant: %v", err)
	}
	event := &livekit.WebhookEvent{
		Event: webhook.EventParticipantJoined,
		Id:    "stale-legacy-token-join",
		Room: &livekit.Room{
			Name: core.LiveKitRoomName(serverID, core.LegacySpaceIDForRoomKind(core.KindChannel), roomID, active.CallID),
		},
		Participant: &livekit.ParticipantInfo{
			Identity: legacy.ParticipantID,
			Metadata: `{"userId":"` + userID + `","participantId":"` + legacy.ParticipantID + `","callId":"` + active.CallID + `"}`,
		},
	}
	recorder := httptest.NewRecorder()

	s.router.ServeHTTP(recorder, signedLiveKitWebhookRequest(t, apiKey, apiSecret, event))

	if recorder.Code != http.StatusOK {
		t.Fatalf("webhook status = %d, want %d", recorder.Code, http.StatusOK)
	}
	for _, participant := range s.core.CallState.Participants(roomID) {
		if participant.UserID == userID {
			t.Fatalf("stale legacy token readmitted explicit leaver: %+v", participant)
		}
	}
}

func TestLiveKitWebhookDuplicateIdentityLeaveDoesNotEndCall(t *testing.T) {
	const (
		apiKey    = "devkey"
		apiSecret = "devsecret"
		serverID  = "test-server"
		roomID    = "room1"
		userID    = "user1"
	)
	ctx := testContext(t)
	s := setupHTTPServerTestServer(t, config.AuthConfig{})
	s.config.LiveKit = config.LiveKitConfig{
		Enabled:   true,
		URL:       "ws://livekit.example.test",
		APIKey:    apiKey,
		APISecret: apiSecret,
		ServerID:  serverID,
	}
	s.setupWebhookRoutes()

	if err := s.core.RecordCallParticipantJoined(ctx, core.KindChannel, roomID, userID, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
		t.Fatalf("RecordCallParticipantJoined() error = %v", err)
	}
	active, ok := s.core.CallState.ActiveCall(roomID)
	if !ok || active.CallID == "" {
		t.Fatalf("expected active call for room %s", roomID)
	}
	if _, err := s.core.GetVoiceCallE2EEKey(ctx, roomID); err != nil {
		t.Fatalf("GetVoiceCallE2EEKey() before webhook error = %v", err)
	}

	event := &livekit.WebhookEvent{
		Event: webhook.EventParticipantLeft,
		Room: &livekit.Room{
			Name: core.LiveKitRoomName(serverID, core.LegacySpaceIDForRoomKind(core.KindChannel), roomID, active.CallID),
		},
		Participant: &livekit.ParticipantInfo{
			Identity:         userID,
			DisconnectReason: livekit.DisconnectReason_DUPLICATE_IDENTITY,
		},
	}
	req := signedLiveKitWebhookRequest(t, apiKey, apiSecret, event)
	recorder := httptest.NewRecorder()
	s.router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("webhook status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	participants, err := s.core.GetCallParticipants(ctx, core.LegacySpaceIDForRoomKind(core.KindChannel), roomID)
	if err != nil {
		t.Fatalf("GetCallParticipants() error = %v", err)
	}
	if len(participants) != 1 || participants[0].UserID != userID {
		t.Fatalf("participants after duplicate identity leave = %+v, want user still active", participants)
	}
	if got, ok := s.core.CallState.ActiveCall(roomID); !ok || got.CallID != active.CallID {
		t.Fatalf("active call after duplicate identity leave = %+v, %v; want call %q active", got, ok, active.CallID)
	}
	if _, err := s.core.GetVoiceCallE2EEKey(ctx, roomID); err != nil {
		t.Fatalf("GetVoiceCallE2EEKey() after duplicate identity leave error = %v", err)
	}

	leftEvents, _, err := s.core.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(roomID).Subject(events.EventCallParticipantLeft))
	if err != nil {
		t.Fatalf("SubjectEvents(call_left) error = %v", err)
	}
	if len(leftEvents) != 0 {
		t.Fatalf("call_left events after duplicate identity leave = %d, want 0", len(leftEvents))
	}
	endedEvents, _, err := s.core.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(roomID).Subject(events.EventCallEnded))
	if err != nil {
		t.Fatalf("SubjectEvents(call_ended) error = %v", err)
	}
	if len(endedEvents) != 0 {
		t.Fatalf("call_ended events after duplicate identity leave = %d, want 0", len(endedEvents))
	}
}

func TestLiveKitWebhookTerminalDisconnectRemovesParticipantImmediately(t *testing.T) {
	for _, reason := range []livekit.DisconnectReason{
		livekit.DisconnectReason_CLIENT_INITIATED,
		livekit.DisconnectReason_PARTICIPANT_REMOVED,
		livekit.DisconnectReason_ROOM_DELETED,
		livekit.DisconnectReason_ROOM_CLOSED,
	} {
		t.Run(reason.String(), func(t *testing.T) {
			const (
				apiKey    = "devkey"
				apiSecret = "devsecret"
				serverID  = "test-server"
				roomID    = "room-terminal-disconnect"
			)
			ctx := testContext(t)
			s := setupHTTPServerTestServer(t, config.AuthConfig{})
			s.config.LiveKit = config.LiveKitConfig{
				Enabled: true, URL: "ws://livekit.example.test", APIKey: apiKey, APISecret: apiSecret, ServerID: serverID,
			}
			s.setupWebhookRoutes()

			if err := s.core.RecordCallParticipantJoined(ctx, core.KindChannel, roomID, "user1", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
				t.Fatalf("join departing participant: %v", err)
			}
			if err := s.core.RecordCallParticipantJoined(ctx, core.KindChannel, roomID, "user2", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER); err != nil {
				t.Fatalf("join call keeper: %v", err)
			}
			active, ok := s.core.CallState.ActiveCall(roomID)
			if !ok {
				t.Fatal("active call missing")
			}
			event := &livekit.WebhookEvent{
				Event: webhook.EventParticipantLeft,
				Id:    "terminal-disconnect-" + reason.String(),
				Room: &livekit.Room{
					Name: core.LiveKitRoomName(serverID, core.LegacySpaceIDForRoomKind(core.KindChannel), roomID, active.CallID),
				},
				Participant: &livekit.ParticipantInfo{
					Identity:         "user1",
					DisconnectReason: reason,
				},
			}
			recorder := httptest.NewRecorder()

			s.router.ServeHTTP(recorder, signedLiveKitWebhookRequest(t, apiKey, apiSecret, event))

			if recorder.Code != http.StatusOK {
				t.Fatalf("webhook status = %d, want %d", recorder.Code, http.StatusOK)
			}
			participants := s.core.CallState.Participants(roomID)
			if len(participants) != 1 || participants[0].UserID != "user2" {
				t.Fatalf("participants after terminal disconnect = %+v, want only call keeper", participants)
			}
		})
	}
}

func TestLiveKitWebhookPreservesAccountAndConnectionIdentity(t *testing.T) {
	const (
		apiKey    = "devkey"
		apiSecret = "devsecret"
		serverID  = "test-server"
		roomID    = "room-multi-webhook"
		userID    = "user1"
	)
	ctx := testContext(t)
	s := setupHTTPServerTestServer(t, config.AuthConfig{})
	s.config.LiveKit = config.LiveKitConfig{
		Enabled:   true,
		URL:       "ws://livekit.example.test",
		APIKey:    apiKey,
		APISecret: apiSecret,
		ServerID:  serverID,
	}
	s.setupWebhookRoutes()

	first, err := s.core.JoinCallParticipant(ctx, core.KindChannel, roomID, userID, "browser-session-1", core.CallJoinModeAsk)
	if err != nil {
		t.Fatalf("join first device: %v", err)
	}
	second, err := s.core.JoinCallParticipant(ctx, core.KindChannel, roomID, userID, "browser-session-2", core.CallJoinModeCompanion)
	if err != nil {
		t.Fatalf("join companion device: %v", err)
	}
	active, ok := s.core.CallState.ActiveCall(roomID)
	if !ok {
		t.Fatal("active call missing")
	}

	joined := &livekit.WebhookEvent{
		Event:     webhook.EventParticipantJoined,
		Id:        "webhook-joined-1",
		CreatedAt: time.Now().Add(-30 * time.Second).Unix(),
		Room: &livekit.Room{
			Name: core.LiveKitRoomName(serverID, core.LegacySpaceIDForRoomKind(core.KindChannel), roomID, active.CallID),
		},
		Participant: &livekit.ParticipantInfo{
			Identity: second.ParticipantID,
			Name:     "Alice",
			Metadata: `{"userId":"user1","participantId":"` + second.ParticipantID + `","deviceIndex":2,"login":"alice","callId":"` + active.CallID + `"}`,
		},
	}
	joinedRecorder := httptest.NewRecorder()
	s.router.ServeHTTP(joinedRecorder, signedLiveKitWebhookRequest(t, apiKey, apiSecret, joined))
	if joinedRecorder.Code != http.StatusOK {
		t.Fatalf("join webhook status = %d", joinedRecorder.Code)
	}

	participants := s.core.CallState.Participants(roomID)
	if len(participants) != 2 {
		t.Fatalf("participants after join webhook = %+v", participants)
	}
	if participants[1].UserID != userID || participants[1].ParticipantID != second.ParticipantID || participants[1].DeviceIndex != 2 {
		t.Fatalf("companion projection = %+v", participants[1])
	}

	left := &livekit.WebhookEvent{
		Event:     webhook.EventParticipantLeft,
		Id:        "webhook-left-1",
		CreatedAt: joined.CreatedAt + 10,
		Room:      joined.Room,
		Participant: &livekit.ParticipantInfo{
			Identity: second.ParticipantID,
			Metadata: joined.Participant.Metadata,
		},
	}
	leftRecorder := httptest.NewRecorder()
	s.router.ServeHTTP(leftRecorder, signedLiveKitWebhookRequest(t, apiKey, apiSecret, left))
	if leftRecorder.Code != http.StatusOK {
		t.Fatalf("leave webhook status = %d", leftRecorder.Code)
	}
	participants = s.core.CallState.Participants(roomID)
	if len(participants) != 2 || participants[0].ParticipantID != first.ParticipantID || participants[1].ParticipantID != second.ParticipantID ||
		participants[1].ConnectionState != corev1.CallParticipantConnectionState_CALL_PARTICIPANT_CONNECTION_STATE_INTERRUPTED {
		t.Fatalf("participants after connection interruption = %+v, want retained interrupted companion", participants)
	}

	recovered := &livekit.WebhookEvent{
		Event:       webhook.EventParticipantJoined,
		Id:          "webhook-joined-2",
		CreatedAt:   left.CreatedAt + 10,
		Room:        joined.Room,
		Participant: joined.Participant,
	}
	recoveredRecorder := httptest.NewRecorder()
	s.router.ServeHTTP(recoveredRecorder, signedLiveKitWebhookRequest(t, apiKey, apiSecret, recovered))
	if recoveredRecorder.Code != http.StatusOK {
		t.Fatalf("recovery webhook status = %d", recoveredRecorder.Code)
	}

	// An exact delayed retry of the old left webhook must not regress the newer
	// connected state or append another durable observation.
	replayedLeftRecorder := httptest.NewRecorder()
	s.router.ServeHTTP(replayedLeftRecorder, signedLiveKitWebhookRequest(t, apiKey, apiSecret, left))
	if replayedLeftRecorder.Code != http.StatusOK {
		t.Fatalf("replayed leave webhook status = %d", replayedLeftRecorder.Code)
	}
	participants = s.core.CallState.Participants(roomID)
	if len(participants) != 2 || participants[1].ConnectionState != corev1.CallParticipantConnectionState_CALL_PARTICIPANT_CONNECTION_STATE_CONNECTED {
		t.Fatalf("participants after recovery and stale replay = %+v, want connected companion", participants)
	}
	connectionEvents, _, err := s.core.EventPublisher.SubjectEvents(ctx, events.RoomAggregate(roomID).Subject(events.EventCallParticipantConnectionChanged))
	if err != nil {
		t.Fatalf("SubjectEvents(call_connection_changed) error = %v", err)
	}
	if len(connectionEvents) != 3 {
		t.Fatalf("connection events = %d, want joined/interrupted/recovered without stale duplicate", len(connectionEvents))
	}
}

func signedLiveKitWebhookRequest(t *testing.T, apiKey, apiSecret string, event *livekit.WebhookEvent) *http.Request {
	t.Helper()
	body, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("marshal webhook event: %v", err)
	}
	sum := sha256.Sum256(body)
	hash := base64.StdEncoding.EncodeToString(sum[:])
	token, err := auth.NewAccessToken(apiKey, apiSecret).
		SetValidFor(5 * time.Minute).
		SetSha256(hash).
		ToJWT()
	if err != nil {
		t.Fatalf("sign webhook event: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/webhooks/livekit", bytes.NewReader(body))
	req.Header.Set("Authorization", token)
	req.Header.Set("Content-Type", "application/webhook+json")
	return req
}

func TestLiveKitWebhookRoomBelongsToInstance(t *testing.T) {
	tests := []struct {
		name       string
		roomName   string
		instanceID string
		want       bool
	}{
		{
			name:       "matching hosted instance prefix",
			roomName:   "foo.channel_room",
			instanceID: "foo",
			want:       true,
		},
		{
			name:       "foreign hosted instance prefix",
			roomName:   "bar.channel_room",
			instanceID: "foo",
			want:       false,
		},
		{
			name:       "unprefixed room rejected for hosted instance",
			roomName:   "channel_room",
			instanceID: "foo",
			want:       false,
		},
		{
			name:       "legacy unprefixed room accepted without instance ID",
			roomName:   "channel_room",
			instanceID: "",
			want:       true,
		},
		{
			name:       "prefixed room rejected without instance ID",
			roomName:   "foo.channel_room",
			instanceID: "",
			want:       false,
		},
		{
			name:       "prefix must match exactly",
			roomName:   "foobar.channel_room",
			instanceID: "foo",
			want:       false,
		},
		{
			name:       "empty room rejected for hosted instance",
			roomName:   "",
			instanceID: "foo",
			want:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := liveKitWebhookRoomBelongsToInstance(tt.roomName, tt.instanceID)
			if got != tt.want {
				t.Fatalf("liveKitWebhookRoomBelongsToInstance(%q, %q) = %v, want %v", tt.roomName, tt.instanceID, got, tt.want)
			}
		})
	}
}
