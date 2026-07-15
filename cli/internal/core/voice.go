package core

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	lkauth "github.com/livekit/protocol/auth"
	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// VoiceCallToken contains the LiveKit JWT for a client to join a call.
type VoiceCallToken struct {
	Token   string
	E2EEKey string
	CallID  string
}

// VoiceCallTokenTTL gives browser clients enough time for E2EE worker setup,
// permission prompts, and a signaling retry without making leaked join tokens
// long-lived.
const VoiceCallTokenTTL = 5 * time.Minute

// participantMetadata is serialized as JSON and stored in the LiveKit token's
// metadata field so the frontend can display avatars without extra queries.
// Also used to parse metadata from LiveKit webhook participant info.
type participantMetadata struct {
	UserID        string `json:"userId,omitempty"`
	ParticipantID string `json:"participantId,omitempty"`
	DeviceIndex   uint32 `json:"deviceIndex,omitempty"`
	Login         string `json:"login"`
	AvatarURL     string `json:"avatarUrl,omitempty"`
	CallID        string `json:"callId,omitempty"`
}

// VoiceCallParticipantIdentity binds one LiveKit connection to its Towk
// account without reusing the account ID as the room-unique media identity.
type VoiceCallParticipantIdentity struct {
	UserID        string
	ParticipantID string
	DeviceIndex   uint32
}

// VoiceCallParticipantID deterministically namespaces a browser-session ID by
// account. Retries from one browser session remain idempotent while identical
// client IDs from different accounts cannot replace one another in LiveKit.
func VoiceCallParticipantID(userID, clientInstanceID string) string {
	if clientInstanceID == "" {
		return userID
	}
	sum := sha256.Sum256([]byte(userID + "\x00" + clientInstanceID))
	return "device_" + base64.RawURLEncoding.EncodeToString(sum[:18])
}

// ParseParticipantMetadata parses JSON metadata from a LiveKit participant.
// Returns zero-value struct if metadata is empty or invalid.
func ParseParticipantMetadata(metadata string) participantMetadata {
	if metadata == "" {
		return participantMetadata{}
	}
	var md participantMetadata
	if err := json.Unmarshal([]byte(metadata), &md); err != nil {
		return participantMetadata{}
	}
	return md
}

// LiveKitRoomName constructs a deterministic LiveKit room name from space and room IDs.
// When serverID is non-empty, the room name is prefixed with "{serverID}." so the
// webhook bridge can route events to the correct Towk server in shared deployments.
// Authorization: Caller must verify room membership before calling.
func LiveKitRoomName(serverID, spaceID, roomID string, callID ...string) string {
	base := spaceID + "_" + roomID
	if len(callID) > 0 && callID[0] != "" {
		base += "@" + callID[0]
	}
	if serverID != "" {
		return serverID + "." + base
	}
	return base
}

// ParseLiveKitRoomName extracts the space ID and room ID from a LiveKit room name.
// Handles both prefixed ("{serverID}.{spaceID}_{roomID}") and unprefixed
// ("{spaceID}_{roomID}") formats. Returns empty strings if the format is unexpected.
func ParseLiveKitRoomName(lkRoomName string) (spaceID, roomID string) {
	spaceID, roomID, _ = ParseLiveKitRoomIdentity(lkRoomName)
	return spaceID, roomID
}

// ParseLiveKitRoomIdentity extracts the space ID, room ID, and optional Towk
// call ID from a LiveKit room name. New room names append "@{callId}" so LiveKit
// room_finished events can be tied to one Towk call session; names without
// a suffix are accepted for compatibility with older active LiveKit rooms.
func ParseLiveKitRoomIdentity(lkRoomName string) (spaceID, roomID, callID string) {
	name := lkRoomName

	// Strip server ID prefix if present (dot separator).
	// Safe because server IDs (K8s names, UUIDs, NanoIDs) and space/room NanoIDs
	// never contain dots.
	if idx := strings.IndexByte(name, '.'); idx >= 0 {
		name = name[idx+1:]
	}

	if idx := strings.LastIndexByte(name, '@'); idx >= 0 {
		callID = name[idx+1:]
		name = name[:idx]
	}

	// Split on first underscore: {spaceID}_{roomID}
	idx := strings.IndexByte(name, '_')
	if idx < 0 {
		return "", "", ""
	}
	return name[:idx], name[idx+1:], callID
}

// ParseLiveKitRoomServerID extracts just the server ID prefix from a LiveKit room
// name. Returns empty string if no prefix is present (unprefixed format).
func ParseLiveKitRoomServerID(lkRoomName string) string {
	idx := strings.IndexByte(lkRoomName, '.')
	if idx < 0 {
		return ""
	}
	return lkRoomName[:idx]
}

// GenerateVoiceCallToken creates a LiveKit join token for a user.
// The login and avatarURL are embedded as JSON metadata so the frontend can
// render avatars without additional queries.
// Authorization: Caller must verify room membership before calling.
func GenerateVoiceCallToken(apiKey, apiSecret, roomName, userID, displayName, login, avatarURL, e2eeKey string, callID ...string) (*VoiceCallToken, error) {
	activeCallID := optionalCallID(callID)
	return GenerateVoiceCallTokenForParticipant(
		apiKey,
		apiSecret,
		roomName,
		VoiceCallParticipantIdentity{UserID: userID, ParticipantID: userID, DeviceIndex: 1},
		displayName,
		login,
		avatarURL,
		e2eeKey,
		activeCallID,
	)
}

// GenerateVoiceCallTokenForParticipant creates a token for one exact
// connection. Account identity remains immutable token metadata; the LiveKit
// identity is connection-scoped because LiveKit requires uniqueness per room.
func GenerateVoiceCallTokenForParticipant(apiKey, apiSecret, roomName string, participant VoiceCallParticipantIdentity, displayName, login, avatarURL, e2eeKey, callID string) (*VoiceCallToken, error) {
	at := lkauth.NewAccessToken(apiKey, apiSecret)
	grant := &lkauth.VideoGrant{
		RoomJoin: true,
		Room:     roomName,
	}
	grant.SetCanPublishData(true)
	grant.SetCanUpdateOwnMetadata(false)
	at.SetVideoGrant(grant).
		SetIdentity(participant.ParticipantID).
		SetName(displayName).
		SetValidFor(VoiceCallTokenTTL)

	deviceIndex := participant.DeviceIndex
	if deviceIndex == 0 {
		deviceIndex = 1
	}
	md, err := json.Marshal(participantMetadata{
		UserID:        participant.UserID,
		ParticipantID: participant.ParticipantID,
		DeviceIndex:   deviceIndex,
		Login:         login,
		AvatarURL:     avatarURL,
		CallID:        callID,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal participant metadata: %w", err)
	}
	at.SetMetadata(string(md))

	token, err := at.ToJWT()
	if err != nil {
		return nil, fmt.Errorf("generate LiveKit token: %w", err)
	}
	return &VoiceCallToken{Token: token, E2EEKey: e2eeKey, CallID: callID}, nil
}

// HandleCallParticipantJoined appends a durable LiveKit-observed join fact.
// Called by the webhook handler when LiveKit reports a participant joined.
func (c *ChattoCore) HandleCallParticipantJoined(ctx context.Context, spaceID, roomID, userID, displayName, login, avatarURL string, callID ...string) error {
	return c.HandleCallParticipantConnectionJoined(ctx, spaceID, roomID, userID, userID, 1, displayName, login, avatarURL, callID...)
}

// HandleCallParticipantConnectionJoined appends a durable LiveKit-observed
// join fact for one exact account connection.
func (c *ChattoCore) HandleCallParticipantConnectionJoined(ctx context.Context, spaceID, roomID, userID, participantID string, deviceIndex uint32, displayName, login, avatarURL string, callID ...string) error {
	expectedCallID := optionalCallID(callID)
	if c.callModel == nil {
		return fmt.Errorf("call model is not initialized")
	}
	// New clients receive a connection-scoped identity only after JoinCall has
	// durably admitted it. A stale transferred token or forged late join must be
	// evicted instead of being allowed to recreate call membership. Legacy
	// user-ID identities retain their historical webhook admission behavior.
	if participantID != userID {
		participant, admitted := callParticipantByID(c.CallState.Participants(roomID), userID, participantID)
		if !admitted || expectedCallID == "" || participant.CallID != expectedCallID {
			if err := c.callModel.RemoveLiveKitParticipant(ctx, spaceID, roomID, expectedCallID, participantID); err != nil {
				return fmt.Errorf("%w: evict connection: %v", ErrCallParticipantNotAdmitted, err)
			}
			return ErrCallParticipantNotAdmitted
		}
	}
	return c.callModel.AppendParticipantJoinedForCall(ctx, roomID, userID, participantID, deviceIndex, expectedCallID, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_LIVEKIT)
}

// HandleCallParticipantLeft appends a durable LiveKit-observed leave fact.
// Called by the webhook handler when LiveKit reports a participant left.
func (c *ChattoCore) HandleCallParticipantLeft(ctx context.Context, spaceID, roomID, userID string, callID ...string) error {
	return c.HandleCallParticipantConnectionLeft(ctx, spaceID, roomID, userID, userID, callID...)
}

// HandleCallParticipantConnectionLeft appends a durable LiveKit-observed leave
// fact for one exact account connection.
func (c *ChattoCore) HandleCallParticipantConnectionLeft(ctx context.Context, spaceID, roomID, userID, participantID string, callID ...string) error {
	if c.callModel == nil {
		return fmt.Errorf("call model is not initialized")
	}
	return c.callModel.AppendParticipantLeftForCall(ctx, roomID, userID, participantID, optionalCallID(callID), corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_LIVEKIT)
}

// HandleCallRoomFinished appends LiveKit-observed leave facts for any remaining
// projected participants in the room.
// Called by the webhook handler when LiveKit reports a room has finished (closed).
func (c *ChattoCore) HandleCallRoomFinished(ctx context.Context, spaceID, roomID string, callID ...string) error {
	expectedCallID := optionalCallID(callID)
	if expectedCallID != "" {
		active, ok := c.CallState.ActiveCall(roomID)
		if !ok || active.CallID != expectedCallID {
			return nil
		}
	}
	for _, p := range c.CallState.Participants(roomID) {
		if c.callModel == nil {
			return fmt.Errorf("call model is not initialized")
		}
		if err := c.callModel.AppendParticipantLeftForCall(ctx, roomID, p.UserID, p.ParticipantID, expectedCallID, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_LIVEKIT); err != nil {
			return err
		}
	}
	return nil
}

func optionalCallID(callID []string) string {
	if len(callID) == 0 {
		return ""
	}
	return callID[0]
}

func (c *ChattoCore) RecordCallParticipantJoined(ctx context.Context, kind RoomKind, roomID, userID string, source corev1.CallParticipantEventSource) error {
	if c.callModel == nil {
		return fmt.Errorf("call model is not initialized")
	}
	return c.callModel.AppendJoined(ctx, roomID, userID, source)
}

func (c *ChattoCore) RecordCallParticipantJoinedForCall(ctx context.Context, kind RoomKind, roomID, userID, expectedCallID string, source corev1.CallParticipantEventSource) error {
	if expectedCallID == "" {
		return c.RecordCallParticipantJoined(ctx, kind, roomID, userID, source)
	}
	if c.callModel == nil {
		return fmt.Errorf("call model is not initialized")
	}
	active, ok := c.CallState.ActiveCall(roomID)
	if !ok || active.CallID != expectedCallID {
		return ErrCallNoLongerActive
	}
	if err := c.callModel.AppendJoinedForCall(ctx, roomID, userID, expectedCallID, source); err != nil {
		return err
	}
	active, ok = c.CallState.ActiveCall(roomID)
	if !ok || active.CallID != expectedCallID {
		return ErrCallNoLongerActive
	}
	return nil
}

// JoinCallParticipant applies the multi-device admission policy atomically at
// the room aggregate boundary and best-effort disconnects transferred peers.
func (c *ChattoCore) JoinCallParticipant(ctx context.Context, kind RoomKind, roomID, userID, clientInstanceID string, mode CallJoinMode, expectedCallID ...string) (CallJoinResult, error) {
	if c.callModel == nil {
		return CallJoinResult{}, fmt.Errorf("call model is not initialized")
	}
	participantID := VoiceCallParticipantID(userID, clientInstanceID)
	result, err := c.callModel.JoinUserParticipant(ctx, roomID, userID, participantID, mode, expectedCallID...)
	if err != nil {
		return CallJoinResult{}, err
	}
	for _, removed := range result.RemovedParticipants {
		if err := c.callModel.RemoveLiveKitParticipant(ctx, LegacySpaceIDForRoomKind(kind), roomID, removed.CallID, removed.ParticipantID); err != nil && c.logger != nil {
			c.logger.Warn("Failed to remove transferred LiveKit participant", "room_id", roomID, "call_id", removed.CallID, "error", err)
		}
	}
	return result, nil
}

// LeaveCallParticipant records a leave for the exact browser session. An empty
// client instance targets only the legacy user-ID participant.
func (c *ChattoCore) LeaveCallParticipant(ctx context.Context, kind RoomKind, roomID, userID, clientInstanceID string, source corev1.CallParticipantEventSource) error {
	if c.callModel == nil {
		return fmt.Errorf("call model is not initialized")
	}
	return c.callModel.AppendParticipantLeft(ctx, roomID, userID, VoiceCallParticipantID(userID, clientInstanceID), source)
}

func (c *ChattoCore) RecordCallParticipantLeft(ctx context.Context, kind RoomKind, roomID, userID string, source corev1.CallParticipantEventSource) error {
	if c.callModel == nil {
		return fmt.Errorf("call model is not initialized")
	}
	return c.callModel.AppendLeft(ctx, roomID, userID, source)
}

func (c *ChattoCore) VoiceCallRoomForMember(ctx context.Context, actorID, roomID string) (*corev1.Room, RoomKind, error) {
	return c.requireRoomMember(ctx, actorID, roomID)
}

func (c *ChattoCore) GetVoiceCallE2EEKey(ctx context.Context, roomID string) (string, error) {
	if c.callModel == nil {
		return "", fmt.Errorf("call model is not initialized")
	}
	return c.callModel.GetE2EEKey(ctx, roomID)
}

func (c *ChattoCore) GetVoiceCallE2EEKeyForCall(ctx context.Context, roomID, callID string) (string, error) {
	if c.callModel == nil {
		return "", fmt.Errorf("call model is not initialized")
	}
	return c.callModel.GetE2EEKeyForCall(ctx, roomID, callID)
}

// GetCallParticipants returns the participants currently in a voice call.
// Returns an empty slice if no call is active.
// Authorization: Caller must verify room membership before calling.
func (c *ChattoCore) GetCallParticipants(ctx context.Context, spaceID, roomID string) ([]CallParticipant, error) {
	return c.CallState.Participants(roomID), nil
}

// GetActiveCallRoomIDs returns the room IDs in a space that have active voice calls.
// Reads from the call-state projection, not MEMORY_CACHE.
// Authorization: Caller must verify space membership before calling.
func (c *ChattoCore) GetActiveCallRoomIDs(ctx context.Context, spaceID string) ([]string, error) {
	kind := RoomKindFromLegacySpaceID(spaceID)
	roomIDs := c.CallState.ActiveRoomIDs()
	if c.RoomCatalog == nil {
		return roomIDs, nil
	}
	filtered := make([]string, 0, len(roomIDs))
	for _, roomID := range roomIDs {
		room, ok := c.RoomCatalog.Get(roomID)
		if !ok || KindOfRoom(room) == kind {
			filtered = append(filtered, roomID)
		}
	}
	sort.Strings(filtered)
	return filtered, nil
}

func appendCallJoinedEventForTest(ctx context.Context, publisher *events.Publisher, projector *events.Projector, roomID, userID string, source corev1.CallParticipantEventSource) error {
	event := newEvent(userID, &corev1.Event{
		Event: &corev1.Event_VoiceCallParticipantJoined{
			VoiceCallParticipantJoined: &corev1.CallParticipantJoinedEvent{RoomId: roomID, Source: source},
		},
	})
	_, err := projector.AppendEventuallyAndWait(ctx, publisher, events.RoomAggregate(roomID), event)
	return err
}

func appendCallLeftEventForTest(ctx context.Context, publisher *events.Publisher, projector *events.Projector, roomID, userID string, source corev1.CallParticipantEventSource) error {
	event := newEvent(userID, &corev1.Event{
		Event: &corev1.Event_VoiceCallParticipantLeft{
			VoiceCallParticipantLeft: &corev1.CallParticipantLeftEvent{RoomId: roomID, Source: source},
		},
	})
	_, err := projector.AppendEventuallyAndWait(ctx, publisher, events.RoomAggregate(roomID), event)
	return err
}
