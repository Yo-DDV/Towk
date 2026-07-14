package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	lkauth "github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/twitchtv/twirp"

	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/events"
	"hmans.de/chatto/internal/kms"
	"hmans.de/chatto/internal/lease"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const (
	callReconcileInterval             = 30 * time.Second
	callReconcileAPITimeout           = 10 * time.Second
	callReconcileMaxRetries           = 5
	callReconcileListFailureThreshold = 3
	callReconcileLeaseName            = "livekit_reconciler"
	callReconcileLeaseTTL             = 45 * time.Second
	callReconcileLeaseRenewEvery      = 15 * time.Second
	callReconcileLeaseRetryEvery      = 5 * time.Second
	liveKitReconcileFailureKey        = "livekit.reconciliation.list_failures"
	maxCallDevicesPerUser             = 2
)

var (
	ErrCallDeviceLimit            = errors.New("maximum concurrent call devices reached")
	ErrCallParticipantNotAdmitted = errors.New("call participant is not admitted")
)

type CallJoinMode int

const (
	CallJoinModeAsk CallJoinMode = iota
	CallJoinModeCompanion
	CallJoinModeTransfer
)

type CallJoinStatus int

const (
	CallJoinStatusJoined CallJoinStatus = iota + 1
	CallJoinStatusSelectionRequired
)

type CallJoinResult struct {
	Status              CallJoinStatus
	ParticipantID       string
	DeviceIndex         uint32
	ActiveDeviceCount   int
	CompanionAllowed    bool
	RemovedParticipants []CallParticipant
}

type liveKitObservedParticipant struct {
	UserID        string
	ParticipantID string
	DeviceIndex   uint32
}

type liveKitParticipantSnapshot struct {
	SpaceID      string
	RoomID       string
	CallID       string
	UserIDs      []string // legacy test/input compatibility
	Participants []liveKitObservedParticipant
}

type liveKitParticipantLister interface {
	ListCallParticipants(ctx context.Context) ([]liveKitParticipantSnapshot, error)
}

type liveKitParticipantRemover interface {
	RemoveCallParticipant(ctx context.Context, spaceID, roomID, callID, userID string) error
}

type CallModel struct {
	publisher      *events.Publisher
	projection     *CallStateProjection
	projector      *events.Projector
	callKeys       kms.CallKeyStore
	livekit        liveKitParticipantLister
	reconcileLease *lease.Lease
	memoryCacheKV  jetstream.KeyValue
	logger         events.Logger
	keyCleanup     *events.IncrementalEffectConsumer
}

type liveKitFailureCleanupSummary struct {
	activeRooms   int
	endedRooms    int
	cleanupErrors int
	err           error
}

type liveKitListFailureError struct {
	err                 error
	cleanup             liveKitFailureCleanupSummary
	consecutiveFailures int
	threshold           int
	cleanupAttempted    bool
}

type liveKitListFailureState struct {
	Count     int       `json:"count"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (e *liveKitListFailureError) Error() string {
	if e == nil {
		return ""
	}
	if !e.cleanupAttempted {
		return fmt.Sprintf("list LiveKit call participants: %v; end active calls deferred after %d/%d failures", e.err, e.consecutiveFailures, e.threshold)
	}
	if e.cleanup.err != nil {
		return fmt.Sprintf("list LiveKit call participants: %v; end active calls after LiveKit reconciliation failure: %v", e.err, e.cleanup.err)
	}
	return fmt.Sprintf("list LiveKit call participants: %v; ended active calls after %d/%d failures", e.err, e.consecutiveFailures, e.threshold)
}

func (e *liveKitListFailureError) Unwrap() error {
	if e == nil {
		return nil
	}
	if e.cleanup.err != nil {
		return errors.Join(e.err, e.cleanup.err)
	}
	return e.err
}

func NewCallModel(
	publisher *events.Publisher,
	projection *CallStateProjection,
	projector *events.Projector,
	callKeys kms.CallKeyStore,
	livekit liveKitParticipantLister,
	reconcileLease *lease.Lease,
	memoryCacheKV jetstream.KeyValue,
	logger events.Logger,
) *CallModel {
	model := &CallModel{
		publisher:      publisher,
		projection:     projection,
		projector:      projector,
		callKeys:       callKeys,
		livekit:        livekit,
		reconcileLease: reconcileLease,
		memoryCacheKV:  memoryCacheKV,
		logger:         logger,
	}
	model.keyCleanup = events.NewIncrementalEffectConsumer(
		publisher,
		events.RoomEventTypeFilter(events.EventCallEnded),
		model.cleanupEndedCallKey,
	)
	return model
}

func (c *ChattoCore) EnableLiveKitCallReconciliation(cfg config.LiveKitConfig) error {
	if c.callModel == nil {
		return fmt.Errorf("call model is not initialized")
	}
	lister, err := newLiveKitParticipantLister(cfg)
	if err != nil {
		return err
	}
	c.callModel.livekit = lister
	return nil
}

func newLiveKitParticipantLister(cfg config.LiveKitConfig) (liveKitParticipantLister, error) {
	if !cfg.IsConfigured() {
		return nil, nil
	}
	httpURL, err := liveKitHTTPURL(cfg.URL)
	if err != nil {
		return nil, err
	}
	return &liveKitRoomClient{
		service:   livekit.NewRoomServiceProtobufClient(httpURL, &http.Client{}),
		apiKey:    cfg.APIKey,
		apiSecret: cfg.APISecret,
		serverID:  cfg.ServerID,
	}, nil
}

func liveKitHTTPURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "ws":
		u.Scheme = "http"
	case "wss":
		u.Scheme = "https"
	case "http", "https":
	default:
		return "", fmt.Errorf("unsupported LiveKit URL scheme %q", u.Scheme)
	}
	return u.String(), nil
}

type liveKitRoomClient struct {
	service   liveKitRoomService
	apiKey    string
	apiSecret string
	serverID  string
}

type liveKitRoomService interface {
	ListRooms(context.Context, *livekit.ListRoomsRequest) (*livekit.ListRoomsResponse, error)
	ListParticipants(context.Context, *livekit.ListParticipantsRequest) (*livekit.ListParticipantsResponse, error)
	RemoveParticipant(context.Context, *livekit.RoomParticipantIdentity) (*livekit.RemoveParticipantResponse, error)
}

func (c *liveKitRoomClient) ListCallParticipants(ctx context.Context) ([]liveKitParticipantSnapshot, error) {
	roomsResp, err := c.service.ListRooms(c.withVideoGrant(ctx, &lkauth.VideoGrant{RoomList: true}), &livekit.ListRoomsRequest{})
	if err != nil {
		return nil, err
	}

	out := make([]liveKitParticipantSnapshot, 0, len(roomsResp.GetRooms()))
	for _, room := range roomsResp.GetRooms() {
		if room == nil || !liveKitRoomBelongsToInstance(room.GetName(), c.serverID) {
			continue
		}
		spaceID, roomID, callID := ParseLiveKitRoomIdentity(room.GetName())
		if roomID == "" {
			continue
		}
		participantsResp, err := c.service.ListParticipants(
			c.withVideoGrant(ctx, &lkauth.VideoGrant{RoomAdmin: true, Room: room.GetName()}),
			&livekit.ListParticipantsRequest{Room: room.GetName()},
		)
		if err != nil {
			if isLiveKitRoomNotFound(err) {
				out = append(out, liveKitParticipantSnapshot{SpaceID: spaceID, RoomID: roomID, CallID: callID})
				continue
			}
			return nil, err
		}
		participants := make([]liveKitObservedParticipant, 0, len(participantsResp.GetParticipants()))
		userIDs := make([]string, 0, len(participantsResp.GetParticipants()))
		for _, participant := range participantsResp.GetParticipants() {
			participantID := participant.GetIdentity()
			if participantID == "" {
				continue
			}
			metadata := ParseParticipantMetadata(participant.GetMetadata())
			userID := metadata.UserID
			if userID == "" {
				userID = participantID
			}
			deviceIndex := metadata.DeviceIndex
			if deviceIndex == 0 {
				deviceIndex = 1
			}
			participants = append(participants, liveKitObservedParticipant{
				UserID:        userID,
				ParticipantID: participantID,
				DeviceIndex:   deviceIndex,
			})
			userIDs = append(userIDs, userID)
		}
		sort.Slice(participants, func(i, j int) bool { return participants[i].ParticipantID < participants[j].ParticipantID })
		sort.Strings(userIDs)
		out = append(out, liveKitParticipantSnapshot{SpaceID: spaceID, RoomID: roomID, CallID: callID, UserIDs: userIDs, Participants: participants})
	}
	return out, nil
}

func (c *liveKitRoomClient) RemoveCallParticipant(ctx context.Context, spaceID, roomID, callID, userID string) error {
	roomName := LiveKitRoomName(c.serverID, spaceID, roomID, callID)
	_, err := c.service.RemoveParticipant(
		c.withVideoGrant(ctx, &lkauth.VideoGrant{RoomAdmin: true, Room: roomName}),
		&livekit.RoomParticipantIdentity{Room: roomName, Identity: userID},
	)
	if err != nil && !isLiveKitRoomNotFound(err) {
		return err
	}
	return nil
}

func isLiveKitRoomNotFound(err error) bool {
	var twerr twirp.Error
	return errors.As(err, &twerr) && twerr.Code() == twirp.NotFound
}

func (c *liveKitRoomClient) withVideoGrant(ctx context.Context, grant *lkauth.VideoGrant) context.Context {
	at := lkauth.NewAccessToken(c.apiKey, c.apiSecret)
	token, err := at.SetVideoGrant(grant).SetValidFor(time.Minute).ToJWT()
	if err != nil {
		return ctx
	}
	headers, _ := twirp.HTTPRequestHeaders(ctx)
	if headers != nil {
		headers = headers.Clone()
	} else {
		headers = make(http.Header)
	}
	headers.Set("Authorization", "Bearer "+token)
	nextCtx, err := twirp.WithHTTPRequestHeaders(ctx, headers)
	if err != nil {
		return ctx
	}
	return nextCtx
}

func liveKitRoomBelongsToInstance(roomName, serverID string) bool {
	roomServerID := ParseLiveKitRoomServerID(roomName)
	if serverID == "" {
		return roomServerID == ""
	}
	return roomServerID == serverID
}

func (s *CallModel) GetE2EEKey(ctx context.Context, roomID string) (string, error) {
	if s.callKeys == nil {
		return "", fmt.Errorf("call key store is not initialized")
	}
	call, ok := s.projection.ActiveCall(roomID)
	if !ok || call.CallID == "" || call.E2EEKeyRef == "" {
		return "", fmt.Errorf("no active voice call for room %s", roomID)
	}
	key, err := s.callKeys.GetCallKey(ctx, call.E2EEKeyRef)
	if err != nil {
		return "", fmt.Errorf("read call E2EE key: %w", err)
	}
	return key, nil
}

func (s *CallModel) RemoveLiveKitParticipant(ctx context.Context, spaceID, roomID, callID, userID string) error {
	if s.livekit == nil {
		return nil
	}
	remover, ok := s.livekit.(liveKitParticipantRemover)
	if !ok {
		return nil
	}
	return remover.RemoveCallParticipant(ctx, spaceID, roomID, callID, userID)
}

func (s *CallModel) cleanupQueuedCallKey(ctx context.Context, keyRef string) error {
	if keyRef == "" {
		return nil
	}
	if s.callKeys == nil {
		return fmt.Errorf("call key store is not initialized")
	}
	if err := s.callKeys.ShredCallKey(context.WithoutCancel(ctx), keyRef); err != nil {
		return err
	}
	return nil
}

func (s *CallModel) cleanupEndedCallKeys(ctx context.Context) error {
	return s.keyCleanup.Consume(ctx)
}

func (s *CallModel) cleanupEndedCallKey(ctx context.Context, event *corev1.Event) error {
	callID := event.GetVoiceCallEnded().GetCallId()
	if callID == "" {
		return nil
	}
	keyRef := kms.CallKeyRef(callID)
	if err := s.cleanupQueuedCallKey(ctx, keyRef); err != nil {
		return fmt.Errorf("shred ended call key %s: %w", keyRef, err)
	}
	return nil
}

// JoinUserParticipant applies call-device admission and transfer as one
// room-aggregate OCC transaction. Selection-only requests never append facts.
func (s *CallModel) JoinUserParticipant(ctx context.Context, roomID, userID, participantID string, mode CallJoinMode) (CallJoinResult, error) {
	if participantID == "" {
		return CallJoinResult{}, fmt.Errorf("participant ID is required")
	}
	if mode < CallJoinModeAsk || mode > CallJoinModeTransfer {
		return CallJoinResult{}, fmt.Errorf("invalid call join mode %d", mode)
	}

	aggregate := events.RoomAggregate(roomID)
	filter := aggregate.AllEventsFilter()
	for attempt := 0; attempt < callReconcileMaxRetries; attempt++ {
		snapshot := s.projection.RoomSnapshot(roomID)
		userParticipants := callParticipantsByUser(snapshot.Participants, userID)
		existing, alreadyJoined := callParticipantByID(userParticipants, userID, participantID)
		activeDeviceCount := len(userParticipants)

		if alreadyJoined && mode != CallJoinModeTransfer {
			return CallJoinResult{
				Status:            CallJoinStatusJoined,
				ParticipantID:     existing.ParticipantID,
				DeviceIndex:       existing.DeviceIndex,
				ActiveDeviceCount: activeDeviceCount,
				CompanionAllowed:  activeDeviceCount < maxCallDevicesPerUser,
			}, nil
		}
		if !alreadyJoined && mode == CallJoinModeAsk && activeDeviceCount > 0 {
			return CallJoinResult{
				Status:            CallJoinStatusSelectionRequired,
				ActiveDeviceCount: activeDeviceCount,
				CompanionAllowed:  activeDeviceCount < maxCallDevicesPerUser,
			}, nil
		}
		if !alreadyJoined && mode == CallJoinModeCompanion && activeDeviceCount >= maxCallDevicesPerUser {
			return CallJoinResult{}, ErrCallDeviceLimit
		}

		deviceIndex := existing.DeviceIndex
		if !alreadyJoined {
			if mode == CallJoinModeTransfer {
				deviceIndex = 1
			} else {
				deviceIndex = nextCallDeviceIndex(userParticipants)
			}
		}

		removed := make([]CallParticipant, 0, len(userParticipants))
		if mode == CallJoinModeTransfer {
			for _, participant := range userParticipants {
				if participant.ParticipantID != participantID {
					removed = append(removed, participant)
				}
			}
		}

		callID := snapshot.Call.CallID
		var cleanupKeyRef string
		entries := make([]events.BatchEntry, 0, len(removed)+2)
		if callID == "" {
			if s.callKeys == nil {
				return CallJoinResult{}, fmt.Errorf("call key store is not initialized")
			}
			var err error
			callID = NewCallID()
			cleanupKeyRef, _, err = s.callKeys.CreateCallKey(ctx, callID)
			if err != nil {
				return CallJoinResult{}, fmt.Errorf("create call key: %w", err)
			}
			started := newCallStartedEvent(roomID, userID, callID, cleanupKeyRef, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER)
			entries = append(entries, events.BatchEntry{Subject: aggregate.SubjectFor(started), Event: started})
		}
		for _, participant := range removed {
			left := newCallParticipantConnectionEvent(roomID, userID, participant.ParticipantID, participant.DeviceIndex, callID, false, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER)
			entries = append(entries, events.BatchEntry{Subject: aggregate.SubjectFor(left), Event: left})
		}
		if !alreadyJoined {
			joined := newCallParticipantConnectionEvent(roomID, userID, participantID, deviceIndex, callID, true, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER)
			entries = append(entries, events.BatchEntry{Subject: aggregate.SubjectFor(joined), Event: joined})
		}

		result := CallJoinResult{
			Status:              CallJoinStatusJoined,
			ParticipantID:       participantID,
			DeviceIndex:         deviceIndex,
			ActiveDeviceCount:   activeDeviceCount,
			CompanionAllowed:    activeDeviceCount < maxCallDevicesPerUser,
			RemovedParticipants: removed,
		}
		if len(entries) == 0 {
			return result, nil
		}
		entries[0].ExpectedSeq = snapshot.Seq
		entries[0].FilterSubject = filter
		entries[0].HasOCC = true

		seqs, err := s.publisher.AppendBatch(ctx, entries)
		if err == nil {
			if err := s.projector.WaitFor(ctx, events.SubjectPosition(filter, seqs[len(seqs)-1])); err != nil {
				return CallJoinResult{}, err
			}
			return result, nil
		}
		if cleanupKeyRef != "" {
			if cleanupErr := s.callKeys.ShredCallKey(context.WithoutCancel(ctx), cleanupKeyRef); cleanupErr != nil && s.logger != nil {
				s.logger.Warn("failed to clean up unused call key after join conflict", "error", cleanupErr, "key_ref", cleanupKeyRef)
			}
		}
		if !errors.Is(err, events.ErrConflict) {
			return CallJoinResult{}, err
		}
		if err := s.waitForLatestRoomTransition(ctx, filter); err != nil {
			return CallJoinResult{}, err
		}
		select {
		case <-ctx.Done():
			return CallJoinResult{}, ctx.Err()
		case <-time.After(time.Duration(1<<attempt) * time.Millisecond):
		}
	}
	return CallJoinResult{}, fmt.Errorf("join call participant after %d attempts: %w", callReconcileMaxRetries, events.ErrConflict)
}

func callParticipantsByUser(active []CallParticipant, userID string) []CallParticipant {
	participants := make([]CallParticipant, 0, len(active))
	for _, participant := range active {
		if participant.UserID == userID {
			participants = append(participants, participant)
		}
	}
	return participants
}

func nextCallDeviceIndex(active []CallParticipant) uint32 {
	used := [maxCallDevicesPerUser + 1]bool{}
	for _, participant := range active {
		if participant.DeviceIndex > 0 && participant.DeviceIndex <= maxCallDevicesPerUser {
			used[participant.DeviceIndex] = true
		}
	}
	for index := uint32(1); index <= maxCallDevicesPerUser; index++ {
		if !used[index] {
			return index
		}
	}
	return maxCallDevicesPerUser
}

func (s *CallModel) AppendJoined(ctx context.Context, roomID, userID string, source corev1.CallParticipantEventSource) error {
	return s.appendParticipantTransition(ctx, roomID, userID, userID, 1, true, "", source)
}

func (s *CallModel) AppendLeft(ctx context.Context, roomID, userID string, source corev1.CallParticipantEventSource) error {
	return s.appendParticipantTransition(ctx, roomID, userID, userID, 1, false, "", source)
}

func (s *CallModel) AppendJoinedForCall(ctx context.Context, roomID, userID, expectedCallID string, source corev1.CallParticipantEventSource) error {
	return s.appendParticipantTransition(ctx, roomID, userID, userID, 1, true, expectedCallID, source)
}

func (s *CallModel) AppendLeftForCall(ctx context.Context, roomID, userID, expectedCallID string, source corev1.CallParticipantEventSource) error {
	return s.appendParticipantTransition(ctx, roomID, userID, userID, 1, false, expectedCallID, source)
}

func (s *CallModel) AppendParticipantJoinedForCall(ctx context.Context, roomID, userID, participantID string, deviceIndex uint32, expectedCallID string, source corev1.CallParticipantEventSource) error {
	return s.appendParticipantTransition(ctx, roomID, userID, participantID, deviceIndex, true, expectedCallID, source)
}

func (s *CallModel) AppendParticipantLeftForCall(ctx context.Context, roomID, userID, participantID, expectedCallID string, source corev1.CallParticipantEventSource) error {
	return s.appendParticipantTransition(ctx, roomID, userID, participantID, 0, false, expectedCallID, source)
}

func (s *CallModel) AppendParticipantLeft(ctx context.Context, roomID, userID, participantID string, source corev1.CallParticipantEventSource) error {
	return s.appendParticipantTransition(ctx, roomID, userID, participantID, 0, false, "", source)
}

func (s *CallModel) appendParticipantTransition(ctx context.Context, roomID, userID, participantID string, deviceIndex uint32, joined bool, expectedCallID string, source corev1.CallParticipantEventSource) error {
	aggregate := events.RoomAggregate(roomID)
	filter := aggregate.AllEventsFilter()
	for attempt := 0; attempt < callReconcileMaxRetries; attempt++ {
		snapshot := s.projection.RoomSnapshot(roomID)
		if expectedCallID != "" && snapshot.Call.CallID != expectedCallID {
			return nil
		}
		if callParticipantTransitionAlreadyApplied(snapshot.Participants, userID, participantID, joined) {
			return nil
		}

		entries, endedKeyRef, cleanupKeyRef, err := s.callTransitionBatch(ctx, aggregate, snapshot, roomID, userID, participantID, deviceIndex, joined, source)
		if err != nil {
			return err
		}
		seqs, err := s.publisher.AppendBatch(ctx, entries)
		if err == nil {
			seq := seqs[len(seqs)-1]
			if endedKeyRef != "" {
				if err := s.cleanupQueuedCallKey(ctx, endedKeyRef); err != nil {
					return fmt.Errorf("shred ended call key: %w", err)
				}
			}
			if err := s.projector.WaitFor(ctx, events.SubjectPosition(filter, seq)); err != nil {
				return err
			}
			return nil
		}
		if cleanupKeyRef != "" {
			if cleanupErr := s.callKeys.ShredCallKey(context.WithoutCancel(ctx), cleanupKeyRef); cleanupErr != nil {
				s.logger.Warn("failed to clean up unused call key after append conflict", "error", cleanupErr, "key_ref", cleanupKeyRef)
			}
		}
		if !errors.Is(err, events.ErrConflict) {
			return err
		}
		if err := s.waitForLatestRoomTransition(ctx, filter); err != nil {
			return err
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(1<<attempt) * time.Millisecond):
		}
	}
	return fmt.Errorf("append call participant transition after %d attempts: %w", callReconcileMaxRetries, events.ErrConflict)
}

func (s *CallModel) callTransitionBatch(ctx context.Context, aggregate events.Aggregate, snapshot CallRoomSnapshot, roomID, userID, participantID string, deviceIndex uint32, joined bool, source corev1.CallParticipantEventSource) ([]events.BatchEntry, string, string, error) {
	if joined {
		callID := snapshot.Call.CallID
		if callID == "" {
			if s.callKeys == nil {
				return nil, "", "", fmt.Errorf("call key store is not initialized")
			}
			callID = NewCallID()
			keyRef, _, err := s.callKeys.CreateCallKey(ctx, callID)
			if err != nil {
				return nil, "", "", fmt.Errorf("create call key: %w", err)
			}
			started := newCallStartedEvent(roomID, userID, callID, keyRef, source)
			joinedEvent := newCallParticipantConnectionEvent(roomID, userID, participantID, deviceIndex, callID, true, source)
			return []events.BatchEntry{
				{
					Subject:       aggregate.SubjectFor(started),
					Event:         started,
					ExpectedSeq:   snapshot.Seq,
					FilterSubject: aggregate.AllEventsFilter(),
					HasOCC:        true,
				},
				{
					Subject: aggregate.SubjectFor(joinedEvent),
					Event:   joinedEvent,
				},
			}, "", keyRef, nil
		}

		joinedEvent := newCallParticipantConnectionEvent(roomID, userID, participantID, deviceIndex, callID, true, source)
		return []events.BatchEntry{{
			Subject:       aggregate.SubjectFor(joinedEvent),
			Event:         joinedEvent,
			ExpectedSeq:   snapshot.Seq,
			FilterSubject: aggregate.AllEventsFilter(),
			HasOCC:        true,
		}}, "", "", nil
	}

	participant, ok := callParticipantByID(snapshot.Participants, userID, participantID)
	if !ok {
		return nil, "", "", nil
	}
	callID := participant.CallID
	if callID == "" {
		callID = snapshot.Call.CallID
	}
	leftEvent := newCallParticipantConnectionEvent(roomID, userID, participantID, participant.DeviceIndex, callID, false, source)
	entries := []events.BatchEntry{{
		Subject:       aggregate.SubjectFor(leftEvent),
		Event:         leftEvent,
		ExpectedSeq:   snapshot.Seq,
		FilterSubject: aggregate.AllEventsFilter(),
		HasOCC:        true,
	}}
	var endedKeyRef string
	if len(snapshot.Participants) == 1 && snapshot.Call.CallID == callID {
		ended := newCallEndedEvent(roomID, userID, callID, source)
		entries = append(entries, events.BatchEntry{
			Subject: aggregate.SubjectFor(ended),
			Event:   ended,
		})
		endedKeyRef = snapshot.Call.E2EEKeyRef
	}
	return entries, endedKeyRef, "", nil
}

func (s *CallModel) waitForLatestRoomTransition(ctx context.Context, filter string) error {
	tail, err := s.publisher.LastSubjectPosition(ctx, filter)
	if err != nil {
		return err
	}
	return s.projector.WaitFor(ctx, tail)
}

func callParticipantTransitionAlreadyApplied(active []CallParticipant, userID, participantID string, joined bool) bool {
	for _, participant := range active {
		if participant.UserID == userID && participant.ParticipantID == participantID {
			return joined
		}
	}
	return !joined
}

func callParticipantByUser(active []CallParticipant, userID string) (CallParticipant, bool) {
	for _, participant := range active {
		if participant.UserID == userID {
			return participant, true
		}
	}
	return CallParticipant{}, false
}

func callParticipantByID(active []CallParticipant, userID, participantID string) (CallParticipant, bool) {
	for _, participant := range active {
		if participant.UserID == userID && participant.ParticipantID == participantID {
			return participant, true
		}
	}
	return CallParticipant{}, false
}

func (s *CallModel) ReconcileRoomParticipants(ctx context.Context, roomID string, observedUserIDs []string) error {
	return s.reconcileRoomParticipants(ctx, roomID, observedUserIDs, s.appendReconciliationEvent)
}

type appendReconciliationEventFunc func(context.Context, string, string, bool) error

func (s *CallModel) reconcileRoomParticipants(ctx context.Context, roomID string, observedUserIDs []string, appendEvent appendReconciliationEventFunc) error {
	observed := make(map[string]struct{}, len(observedUserIDs))
	for _, userID := range observedUserIDs {
		if userID != "" {
			observed[userID] = struct{}{}
		}
	}

	active := s.projection.Participants(roomID)
	activeByUser := make(map[string]struct{}, len(active))
	for _, participant := range active {
		activeByUser[participant.UserID] = struct{}{}
		if _, ok := observed[participant.UserID]; !ok {
			if err := appendEvent(ctx, roomID, participant.UserID, false); err != nil && !s.reconciliationConflictResolved(roomID, participant.UserID, false, err) {
				return err
			}
		}
	}
	for userID := range observed {
		if _, ok := activeByUser[userID]; !ok {
			if err := appendEvent(ctx, roomID, userID, true); err != nil && !s.reconciliationConflictResolved(roomID, userID, true, err) {
				return err
			}
		}
	}
	return nil
}

func (s *CallModel) reconciliationConflictResolved(roomID, userID string, joined bool, err error) bool {
	return errors.Is(err, events.ErrConflict) && s.reconciliationMismatchResolved(roomID, userID, joined)
}

func (s *CallModel) appendReconciliationEvent(ctx context.Context, roomID, userID string, joined bool) error {
	return s.appendParticipantTransition(ctx, roomID, userID, userID, 1, joined, "", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_RECONCILIATION)
}

func (s *CallModel) ReconcileRoomConnections(ctx context.Context, roomID string, observedParticipants []liveKitObservedParticipant) error {
	observed := make(map[string]liveKitObservedParticipant, len(observedParticipants))
	for _, participant := range observedParticipants {
		if participant.UserID == "" || participant.ParticipantID == "" {
			continue
		}
		if participant.DeviceIndex == 0 {
			participant.DeviceIndex = 1
		}
		observed[participant.ParticipantID] = participant
	}

	active := s.projection.Participants(roomID)
	activeByParticipant := make(map[string]CallParticipant, len(active))
	for _, participant := range active {
		activeByParticipant[participant.ParticipantID] = participant
		if _, ok := observed[participant.ParticipantID]; !ok {
			if err := s.appendParticipantTransition(ctx, roomID, participant.UserID, participant.ParticipantID, participant.DeviceIndex, false, "", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_RECONCILIATION); err != nil && !s.connectionReconciliationConflictResolved(roomID, participant.UserID, participant.ParticipantID, false, err) {
				return err
			}
		}
	}
	for participantID, participant := range observed {
		if _, ok := activeByParticipant[participantID]; !ok {
			// Connection-scoped identities are admitted durably by JoinCall before
			// LiveKit can issue a token. Never let reconciliation resurrect a
			// transferred or explicitly-left connection. Legacy user-ID identities
			// keep their historical webhook/reconciliation behavior.
			if participant.ParticipantID != participant.UserID {
				continue
			}
			if err := s.appendParticipantTransition(ctx, roomID, participant.UserID, participant.ParticipantID, participant.DeviceIndex, true, "", corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_RECONCILIATION); err != nil && !s.connectionReconciliationConflictResolved(roomID, participant.UserID, participant.ParticipantID, true, err) {
				return err
			}
		}
	}
	return nil
}

func (s *CallModel) connectionReconciliationConflictResolved(roomID, userID, participantID string, joined bool, err error) bool {
	if !errors.Is(err, events.ErrConflict) {
		return false
	}
	_, found := callParticipantByID(s.projection.Participants(roomID), userID, participantID)
	return found == joined
}

func newCallStartedEvent(roomID, userID, callID, keyRef string, source corev1.CallParticipantEventSource) *corev1.Event {
	return newEvent(userID, &corev1.Event{
		Event: &corev1.Event_VoiceCallStarted{
			VoiceCallStarted: &corev1.CallStartedEvent{
				RoomId:     roomID,
				CallId:     callID,
				E2EeKeyRef: keyRef,
				Source:     source,
			},
		},
	})
}

func newCallEndedEvent(roomID, userID, callID string, source corev1.CallParticipantEventSource) *corev1.Event {
	return newEvent(userID, &corev1.Event{
		Event: &corev1.Event_VoiceCallEnded{
			VoiceCallEnded: &corev1.CallEndedEvent{
				RoomId: roomID,
				CallId: callID,
				Source: source,
			},
		},
	})
}

func newCallParticipantEvent(roomID, userID, callID string, joined bool, source corev1.CallParticipantEventSource) *corev1.Event {
	return newCallParticipantConnectionEvent(roomID, userID, "", 0, callID, joined, source)
}

func newCallParticipantConnectionEvent(roomID, userID, participantID string, deviceIndex uint32, callID string, joined bool, source corev1.CallParticipantEventSource) *corev1.Event {
	if joined {
		return newEvent(userID, &corev1.Event{
			Event: &corev1.Event_VoiceCallParticipantJoined{
				VoiceCallParticipantJoined: &corev1.CallParticipantJoinedEvent{
					RoomId:        roomID,
					Source:        source,
					CallId:        callID,
					ParticipantId: participantID,
					DeviceIndex:   deviceIndex,
				},
			},
		})
	}
	return newEvent(userID, &corev1.Event{
		Event: &corev1.Event_VoiceCallParticipantLeft{
			VoiceCallParticipantLeft: &corev1.CallParticipantLeftEvent{
				RoomId:        roomID,
				Source:        source,
				CallId:        callID,
				ParticipantId: participantID,
				DeviceIndex:   deviceIndex,
			},
		},
	})
}

func (s *CallModel) reconciliationMismatchResolved(roomID, userID string, joined bool) bool {
	active := s.projection.Participants(roomID)
	for _, participant := range active {
		if participant.UserID == userID {
			return joined
		}
	}
	return !joined
}

func (s *CallModel) ReconcileWithLiveKit(ctx context.Context) error {
	return s.reconcileWithLiveKit(ctx, func() (context.Context, context.CancelFunc) {
		return context.WithCancel(ctx)
	})
}

func (s *CallModel) reconcileWithLiveKit(ctx context.Context, cleanupContext func() (context.Context, context.CancelFunc)) error {
	if s.livekit == nil {
		return nil
	}
	snapshots, err := s.livekit.ListCallParticipants(ctx)
	if err != nil {
		counterCtx, counterCancel := cleanupContext()
		failures, recordErr := s.recordLiveKitListFailure(counterCtx)
		counterCancel()
		if recordErr != nil {
			return fmt.Errorf("record LiveKit listing failure: %w", recordErr)
		}
		listErr := &liveKitListFailureError{
			err:                 err,
			consecutiveFailures: failures,
			threshold:           callReconcileListFailureThreshold,
		}
		if failures < callReconcileListFailureThreshold {
			return listErr
		}
		cleanupCtx, cancel := cleanupContext()
		defer cancel()
		listErr.cleanup = s.endActiveCallsAfterLiveKitFailure(cleanupCtx)
		listErr.cleanupAttempted = true
		return listErr
	}
	if err := s.resetLiveKitListFailures(ctx); err != nil {
		return fmt.Errorf("reset LiveKit listing failures: %w", err)
	}
	s.cleanupEndedCallKeysBestEffort(ctx)
	observedRooms := make(map[string]struct{}, len(snapshots))
	for _, snapshot := range snapshots {
		if !s.liveKitSnapshotMatchesActiveCall(snapshot) {
			if err := s.waitForSnapshotRoomTail(ctx, snapshot.RoomID); err != nil {
				return err
			}
			if s.liveKitSnapshotMatchesActiveCall(snapshot) {
				observedRooms[snapshot.RoomID] = struct{}{}
				observed, evicted, err := s.evictUnadmittedLiveKitConnections(ctx, snapshot)
				if err != nil {
					return err
				}
				// A transfer can be observed between eviction of the previous
				// connection and connection of the replacement. Defer absence cleanup
				// for one reconciliation cycle so the admitted replacement is not
				// removed in that narrow window.
				if evicted > 0 {
					continue
				}
				if err := s.ReconcileRoomConnections(ctx, snapshot.RoomID, observed); err != nil {
					return err
				}
				continue
			}
			if err := s.cleanupUnmatchedLiveKitSnapshot(ctx, snapshot); err != nil {
				return err
			}
			continue
		}
		observedRooms[snapshot.RoomID] = struct{}{}
		observed, evicted, err := s.evictUnadmittedLiveKitConnections(ctx, snapshot)
		if err != nil {
			return err
		}
		if evicted > 0 {
			continue
		}
		if err := s.ReconcileRoomConnections(ctx, snapshot.RoomID, observed); err != nil {
			return err
		}
	}
	for _, roomID := range s.projection.ActiveRoomIDs() {
		if _, ok := observedRooms[roomID]; !ok {
			if err := s.ReconcileRoomConnections(ctx, roomID, nil); err != nil {
				return err
			}
		}
	}
	return nil
}

// evictUnadmittedLiveKitConnections makes durable call admission authoritative
// for connection-scoped identities. This prevents a stale token, a missed
// transfer eviction, or a late webhook from reviving an old device.
func (s *CallModel) evictUnadmittedLiveKitConnections(ctx context.Context, snapshot liveKitParticipantSnapshot) ([]liveKitObservedParticipant, int, error) {
	observed := snapshotObservedParticipants(snapshot)
	active := s.projection.Participants(snapshot.RoomID)
	activeByParticipant := make(map[string]CallParticipant, len(active))
	for _, participant := range active {
		activeByParticipant[participant.ParticipantID] = participant
	}

	admitted := make([]liveKitObservedParticipant, 0, len(observed))
	var remover liveKitParticipantRemover
	if candidate, ok := s.livekit.(liveKitParticipantRemover); ok {
		remover = candidate
	}
	evicted := 0
	for _, participant := range observed {
		projected, found := activeByParticipant[participant.ParticipantID]
		if participant.ParticipantID == participant.UserID ||
			(found && projected.UserID == participant.UserID && projected.CallID == snapshot.CallID) {
			admitted = append(admitted, participant)
			continue
		}
		if remover == nil {
			return nil, evicted, fmt.Errorf("evict unadmitted LiveKit participant %s: participant remover unavailable", participant.ParticipantID)
		}
		if err := remover.RemoveCallParticipant(ctx, snapshot.SpaceID, snapshot.RoomID, snapshot.CallID, participant.ParticipantID); err != nil {
			return nil, evicted, fmt.Errorf("evict unadmitted LiveKit participant %s: %w", participant.ParticipantID, err)
		}
		evicted++
	}
	return admitted, evicted, nil
}

func (s *CallModel) waitForSnapshotRoomTail(ctx context.Context, roomID string) error {
	if roomID == "" || s.publisher == nil || s.projector == nil {
		return nil
	}
	tail, err := s.publisher.LastSubjectPosition(ctx, events.RoomAggregate(roomID).AllEventsFilter())
	if err != nil {
		return fmt.Errorf("read unmatched LiveKit room tail: %w", err)
	}
	if tail.Seq == 0 {
		return nil
	}
	if err := s.projector.WaitFor(ctx, tail); err != nil {
		return fmt.Errorf("wait for unmatched LiveKit room projection: %w", err)
	}
	return nil
}

func (s *CallModel) cleanupUnmatchedLiveKitSnapshot(ctx context.Context, snapshot liveKitParticipantSnapshot) error {
	if snapshot.RoomID == "" || snapshot.CallID == "" {
		return nil
	}
	remover, ok := s.livekit.(liveKitParticipantRemover)
	if !ok {
		return nil
	}
	if err := s.ensureUnmatchedCallEndedFact(ctx, snapshot); err != nil {
		return err
	}
	keyRef := kms.CallKeyRef(snapshot.CallID)
	for _, participant := range snapshotObservedParticipants(snapshot) {
		if participant.ParticipantID == "" {
			continue
		}
		if err := remover.RemoveCallParticipant(ctx, snapshot.SpaceID, snapshot.RoomID, snapshot.CallID, participant.ParticipantID); err != nil {
			return fmt.Errorf("remove participant from unmatched LiveKit call: %w", err)
		}
	}
	if err := s.cleanupQueuedCallKey(ctx, keyRef); err != nil {
		return fmt.Errorf("clean up unmatched LiveKit call key: %w", err)
	}
	return nil
}

func snapshotObservedParticipants(snapshot liveKitParticipantSnapshot) []liveKitObservedParticipant {
	if len(snapshot.Participants) > 0 {
		return append([]liveKitObservedParticipant(nil), snapshot.Participants...)
	}
	participants := make([]liveKitObservedParticipant, 0, len(snapshot.UserIDs))
	for _, userID := range snapshot.UserIDs {
		if userID == "" {
			continue
		}
		participants = append(participants, liveKitObservedParticipant{UserID: userID, ParticipantID: userID, DeviceIndex: 1})
	}
	return participants
}

func (s *CallModel) ensureUnmatchedCallEndedFact(ctx context.Context, snapshot liveKitParticipantSnapshot) error {
	agg := events.RoomAggregate(snapshot.RoomID)
	subject := agg.Subject(events.EventCallEnded)
	endedEvents, _, err := s.publisher.SubjectEvents(ctx, subject)
	if err != nil {
		return fmt.Errorf("read unmatched LiveKit call endings: %w", err)
	}
	for _, event := range endedEvents {
		if event.GetVoiceCallEnded().GetCallId() == snapshot.CallID {
			return nil
		}
	}
	ended := newCallEndedEvent(snapshot.RoomID, SystemActorID, snapshot.CallID, corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_RECONCILIATION)
	if _, err := s.publisher.AppendEventually(ctx, subject, ended); err != nil {
		return fmt.Errorf("record unmatched LiveKit call end: %w", err)
	}
	return nil
}

func (s *CallModel) liveKitSnapshotMatchesActiveCall(snapshot liveKitParticipantSnapshot) bool {
	if snapshot.RoomID == "" {
		return false
	}
	active, ok := s.projection.ActiveCall(snapshot.RoomID)
	if !ok {
		return false
	}
	if snapshot.CallID == "" {
		return false
	}
	return active.CallID == snapshot.CallID
}

func (s *CallModel) recordLiveKitListFailure(ctx context.Context) (int, error) {
	if s.memoryCacheKV == nil {
		return 0, fmt.Errorf("memory cache KV is not configured")
	}
	// The failure threshold is shared across elected leaders, not process-local.
	// A different replica may successfully reconcile and delete this key between
	// failed passes, which makes the counter reflect consecutive failures at the
	// reconciler role level.
	for attempt := 0; attempt < callReconcileMaxRetries; attempt++ {
		entry, err := s.memoryCacheKV.Get(ctx, liveKitReconcileFailureKey)
		if err != nil {
			if errors.Is(err, jetstream.ErrKeyNotFound) || errors.Is(err, jetstream.ErrKeyDeleted) {
				state := liveKitListFailureState{Count: 1, UpdatedAt: time.Now().UTC()}
				data, err := json.Marshal(state)
				if err != nil {
					return 0, err
				}
				if _, err := s.memoryCacheKV.Create(ctx, liveKitReconcileFailureKey, data); err != nil {
					if errors.Is(err, jetstream.ErrKeyExists) {
						continue
					}
					return 0, err
				}
				return state.Count, nil
			}
			return 0, err
		}

		var state liveKitListFailureState
		if err := json.Unmarshal(entry.Value(), &state); err != nil {
			return 0, err
		}
		state.Count++
		state.UpdatedAt = time.Now().UTC()
		data, err := json.Marshal(state)
		if err != nil {
			return 0, err
		}
		if _, err := s.memoryCacheKV.Update(ctx, liveKitReconcileFailureKey, data, entry.Revision()); err != nil {
			if errors.Is(err, jetstream.ErrKeyExists) {
				continue
			}
			return 0, err
		}
		return state.Count, nil
	}
	return 0, fmt.Errorf("LiveKit listing failure counter update failed after %d attempts", callReconcileMaxRetries)
}

func (s *CallModel) resetLiveKitListFailures(ctx context.Context) error {
	if s.memoryCacheKV == nil {
		return nil
	}
	if err := s.memoryCacheKV.Delete(ctx, liveKitReconcileFailureKey); err != nil && !errors.Is(err, jetstream.ErrKeyNotFound) && !errors.Is(err, jetstream.ErrKeyDeleted) {
		return err
	}
	return nil
}

func (s *CallModel) endActiveCallsAfterLiveKitFailure(ctx context.Context) liveKitFailureCleanupSummary {
	summary := liveKitFailureCleanupSummary{}
	var cleanupErr error
	roomIDs := s.projection.ActiveRoomIDs()
	summary.activeRooms = len(roomIDs)
	for _, roomID := range roomIDs {
		if err := s.ReconcileRoomConnections(ctx, roomID, nil); err != nil {
			summary.cleanupErrors++
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("room %s: %w", roomID, err))
			continue
		}
		summary.endedRooms++
	}
	summary.err = cleanupErr
	return summary
}

func (s *CallModel) Run(ctx context.Context) error {
	if s.livekit == nil {
		if s.reconcileLease != nil {
			return s.reconcileLease.Run(ctx, s.runCallKeyCleanupLoop)
		}
		return s.runCallKeyCleanupLoop(ctx)
	}
	if s.reconcileLease != nil {
		return s.reconcileLease.Run(ctx, s.runReconciliationLoop)
	}
	return s.runReconciliationLoop(ctx)
}

func (s *CallModel) runCallKeyCleanupLoop(ctx context.Context) error {
	s.cleanupEndedCallKeysBestEffort(ctx)
	ticker := time.NewTicker(callReconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			s.cleanupEndedCallKeysBestEffort(ctx)
		}
	}
}

func (s *CallModel) cleanupEndedCallKeysBestEffort(ctx context.Context) {
	if err := s.cleanupEndedCallKeys(ctx); err != nil && s.logger != nil {
		s.logger.Warn("Failed to clean up ended call keys; will retry", "error", err)
	}
}

func (s *CallModel) runReconciliationLoop(ctx context.Context) error {
	if err := s.reconcileBestEffort(ctx); err != nil {
		return err
	}

	ticker := time.NewTicker(callReconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := s.reconcileBestEffort(ctx); err != nil {
				return err
			}
		}
	}
}

func (s *CallModel) reconcileBestEffort(ctx context.Context) error {
	reconcileCtx, cancel := context.WithTimeout(ctx, callReconcileAPITimeout)
	defer cancel()
	if err := s.reconcileWithLiveKit(reconcileCtx, func() (context.Context, context.CancelFunc) {
		return context.WithTimeout(ctx, callReconcileAPITimeout)
	}); err != nil && !strings.Contains(err.Error(), context.Canceled.Error()) {
		var listErr *liveKitListFailureError
		if errors.As(err, &listErr) {
			if !listErr.cleanupAttempted {
				if s.logger != nil {
					s.logger.Warn(
						"LiveKit listing failed; active-call cleanup deferred",
						"error", listErr.err,
						"consecutive_failures", listErr.consecutiveFailures,
						"threshold", listErr.threshold,
					)
				}
				return nil
			}
			if s.logger != nil {
				s.logger.Warn(
					"LiveKit listing failed; threshold reached and ended projected active calls",
					"error", listErr.err,
					"consecutive_failures", listErr.consecutiveFailures,
					"threshold", listErr.threshold,
					"active_rooms", listErr.cleanup.activeRooms,
					"ended_rooms", listErr.cleanup.endedRooms,
					"cleanup_errors", listErr.cleanup.cleanupErrors,
				)
			}
			return nil
		}
		if s.logger != nil {
			s.logger.Warn("LiveKit call-state reconciliation failed", "error", err)
		}
	}
	return nil
}
