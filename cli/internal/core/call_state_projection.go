package core

import (
	"sort"

	"google.golang.org/protobuf/types/known/timestamppb"
	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// CallParticipant represents a user currently in a voice call.
type CallParticipant struct {
	UserID                     string
	ParticipantID              string
	DeviceIndex                uint32
	CallID                     string
	JoinedAt                   int64
	Source                     corev1.CallParticipantEventSource
	ConnectionState            corev1.CallParticipantConnectionState
	ConnectionObservedAtMillis int64
	InterruptionDeadlineMillis int64
}

type CallSession struct {
	CallID     string
	E2EEKeyRef string
	StartedAt  int64
	Source     corev1.CallParticipantEventSource
}

// CallStateProjection derives the active-call snapshot from durable room
// facts. It deliberately keeps only process-local projection state; LiveKit
// reconciliation appends more facts instead of mutating the projection directly.
type CallStateProjection struct {
	events.MemoryProjection
	rooms       map[string]map[string]CallParticipant
	activeCalls map[string]CallSession
	roomSeq     map[string]uint64
	// Observation IDs are retained only for the lifetime of one room call and
	// rebuilt by replay, so exact webhook retries remain idempotent.
	connectionObservations map[string]map[string]map[string]struct{}
}

type CallRoomSnapshot struct {
	Participants []CallParticipant
	Call         CallSession
	Seq          uint64
}

func NewCallStateProjection() *CallStateProjection {
	return &CallStateProjection{
		rooms:                  make(map[string]map[string]CallParticipant),
		activeCalls:            make(map[string]CallSession),
		roomSeq:                make(map[string]uint64),
		connectionObservations: make(map[string]map[string]map[string]struct{}),
	}
}

func (p *CallStateProjection) Subjects() []string {
	return []string{events.RoomSubjectFilter()}
}

func (p *CallStateProjection) Apply(event *corev1.Event, seq uint64) error {
	if event == nil {
		return nil
	}

	p.Lock()
	defer p.Unlock()

	roomID := roomIDOfEvent(event)
	if roomID == "" {
		return nil
	}

	if seq > p.roomSeq[roomID] {
		p.roomSeq[roomID] = seq
	}
	switch e := event.GetEvent().(type) {
	case *corev1.Event_VoiceCallStarted:
		startedAt := int64(0)
		if ts := event.GetCreatedAt(); ts != nil {
			startedAt = ts.AsTime().Unix()
		}
		source := normalizeCallParticipantSource(e.VoiceCallStarted.GetSource())
		session := CallSession{
			CallID:     e.VoiceCallStarted.GetCallId(),
			E2EEKeyRef: e.VoiceCallStarted.GetE2EeKeyRef(),
			StartedAt:  startedAt,
			Source:     source,
		}
		p.activeCalls[roomID] = session
		delete(p.rooms, roomID)
		delete(p.connectionObservations, roomID)
	case *corev1.Event_VoiceCallParticipantJoined:
		if event.GetActorId() == "" {
			return nil
		}
		joinedAt := int64(0)
		if ts := event.GetCreatedAt(); ts != nil {
			joinedAt = ts.AsTime().Unix()
		}
		source := normalizeCallParticipantSource(e.VoiceCallParticipantJoined.GetSource())
		callID := e.VoiceCallParticipantJoined.GetCallId()
		if callID == "" {
			callID = p.activeCalls[roomID].CallID
		}
		if p.rooms[roomID] == nil {
			p.rooms[roomID] = make(map[string]CallParticipant)
		}
		participantID := e.VoiceCallParticipantJoined.GetParticipantId()
		if participantID == "" {
			participantID = event.GetActorId()
		}
		deviceIndex := e.VoiceCallParticipantJoined.GetDeviceIndex()
		if deviceIndex == 0 {
			deviceIndex = 1
		}
		existing, exists := p.rooms[roomID][participantID]
		if exists && joinedAt == 0 {
			joinedAt = existing.JoinedAt
		}
		if exists && joinedAt == existing.JoinedAt && callParticipantSourcePriority(existing.Source) > callParticipantSourcePriority(source) {
			source = existing.Source
		}
		participant := CallParticipant{
			UserID:          event.GetActorId(),
			ParticipantID:   participantID,
			DeviceIndex:     deviceIndex,
			CallID:          callID,
			JoinedAt:        joinedAt,
			Source:          source,
			ConnectionState: corev1.CallParticipantConnectionState_CALL_PARTICIPANT_CONNECTION_STATE_CONNECTED,
		}
		if exists {
			participant.ConnectionState = existing.ConnectionState
			participant.ConnectionObservedAtMillis = existing.ConnectionObservedAtMillis
			participant.InterruptionDeadlineMillis = existing.InterruptionDeadlineMillis
		}
		p.rooms[roomID][participantID] = participant
	case *corev1.Event_VoiceCallParticipantConnectionChanged:
		changed := e.VoiceCallParticipantConnectionChanged
		participantID := changed.GetParticipantId()
		participants := p.rooms[roomID]
		existing, exists := participants[participantID]
		if !exists || event.GetActorId() == "" || existing.UserID != event.GetActorId() ||
			(changed.GetCallId() != "" && existing.CallID != "" && existing.CallID != changed.GetCallId()) {
			return nil
		}
		observationID := changed.GetObservationId()
		if observationID != "" {
			if p.connectionObservations[roomID] == nil {
				p.connectionObservations[roomID] = make(map[string]map[string]struct{})
			}
			if p.connectionObservations[roomID][participantID] == nil {
				p.connectionObservations[roomID][participantID] = make(map[string]struct{})
			}
			if _, seen := p.connectionObservations[roomID][participantID][observationID]; seen {
				return nil
			}
			p.connectionObservations[roomID][participantID][observationID] = struct{}{}
		}
		observedAtMillis := eventTimestampMillis(changed.GetObservedAt())
		if observedAtMillis == 0 {
			observedAtMillis = eventTimestampMillis(event.GetCreatedAt())
		}
		state := changed.GetState()
		if state == corev1.CallParticipantConnectionState_CALL_PARTICIPANT_CONNECTION_STATE_UNSPECIFIED ||
			(observedAtMillis != 0 && observedAtMillis < existing.ConnectionObservedAtMillis) {
			return nil
		}
		existing.ConnectionState = state
		existing.ConnectionObservedAtMillis = observedAtMillis
		existing.InterruptionDeadlineMillis = 0
		if state == corev1.CallParticipantConnectionState_CALL_PARTICIPANT_CONNECTION_STATE_INTERRUPTED {
			existing.InterruptionDeadlineMillis = eventTimestampMillis(changed.GetInterruptionDeadline())
		}
		p.rooms[roomID][participantID] = existing
	case *corev1.Event_VoiceCallParticipantLeft:
		if event.GetActorId() == "" {
			return nil
		}
		if participants := p.rooms[roomID]; participants != nil {
			callID := e.VoiceCallParticipantLeft.GetCallId()
			participantID := e.VoiceCallParticipantLeft.GetParticipantId()
			if participantID != "" {
				if existing, ok := participants[participantID]; ok && existing.UserID == event.GetActorId() && (callID == "" || existing.CallID == "" || existing.CallID == callID) {
					delete(participants, participantID)
					if observations := p.connectionObservations[roomID]; observations != nil {
						delete(observations, participantID)
					}
				}
			} else {
				for key, existing := range participants {
					if existing.UserID == event.GetActorId() && (callID == "" || existing.CallID == "" || existing.CallID == callID) {
						delete(participants, key)
						if observations := p.connectionObservations[roomID]; observations != nil {
							delete(observations, key)
						}
					}
				}
			}
			if len(participants) == 0 {
				delete(p.rooms, roomID)
			}
		}
	case *corev1.Event_VoiceCallEnded:
		if active := p.activeCalls[roomID]; e.VoiceCallEnded.GetCallId() == "" || active.CallID == "" || active.CallID == e.VoiceCallEnded.GetCallId() {
			delete(p.rooms, roomID)
			delete(p.activeCalls, roomID)
			delete(p.connectionObservations, roomID)
		}
	case *corev1.Event_UserLeftRoom:
		if event.GetActorId() == "" {
			return nil
		}
		if participants := p.rooms[roomID]; participants != nil {
			for key, participant := range participants {
				if participant.UserID == event.GetActorId() {
					delete(participants, key)
					if observations := p.connectionObservations[roomID]; observations != nil {
						delete(observations, key)
					}
				}
			}
			if len(participants) == 0 {
				delete(p.rooms, roomID)
				delete(p.activeCalls, roomID)
			}
		}
	case *corev1.Event_RoomDeleted:
		delete(p.rooms, roomID)
		delete(p.activeCalls, roomID)
		delete(p.connectionObservations, roomID)
	}
	return nil
}

func eventTimestampMillis(ts *timestamppb.Timestamp) int64 {
	if ts == nil {
		return 0
	}
	return ts.AsTime().UnixMilli()
}

func normalizeCallParticipantSource(source corev1.CallParticipantEventSource) corev1.CallParticipantEventSource {
	if source == corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_UNSPECIFIED {
		return corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER
	}
	return source
}

func callParticipantSourcePriority(source corev1.CallParticipantEventSource) int {
	switch source {
	case corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_LIVEKIT,
		corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_RECONCILIATION:
		return 2
	case corev1.CallParticipantEventSource_CALL_PARTICIPANT_EVENT_SOURCE_USER:
		return 1
	default:
		return 0
	}
}

func (p *CallStateProjection) Participants(roomID string) []CallParticipant {
	p.RLock()
	defer p.RUnlock()
	return p.participantsLocked(roomID)
}

func (p *CallStateProjection) RoomSnapshot(roomID string) CallRoomSnapshot {
	p.RLock()
	defer p.RUnlock()
	return CallRoomSnapshot{
		Participants: p.participantsLocked(roomID),
		Call:         p.activeCalls[roomID],
		Seq:          p.roomSeq[roomID],
	}
}

func (p *CallStateProjection) ActiveCall(roomID string) (CallSession, bool) {
	p.RLock()
	defer p.RUnlock()
	call, ok := p.activeCalls[roomID]
	return call, ok
}

func (p *CallStateProjection) ConnectionObservationAlreadyApplied(
	roomID, participantID, observationID string,
	observedAtMillis int64,
	state corev1.CallParticipantConnectionState,
) bool {
	p.RLock()
	defer p.RUnlock()
	participant, exists := p.rooms[roomID][participantID]
	if !exists {
		return true
	}
	if observationID != "" {
		if _, seen := p.connectionObservations[roomID][participantID][observationID]; seen {
			return true
		}
	}
	if observedAtMillis != 0 && observedAtMillis < participant.ConnectionObservedAtMillis {
		return true
	}
	return false
}

func (p *CallStateProjection) participantsLocked(roomID string) []CallParticipant {
	participants := p.rooms[roomID]
	if len(participants) == 0 {
		return nil
	}
	out := make([]CallParticipant, 0, len(participants))
	for _, participant := range participants {
		out = append(out, participant)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].JoinedAt == out[j].JoinedAt {
			if out[i].UserID == out[j].UserID {
				if out[i].DeviceIndex == out[j].DeviceIndex {
					return out[i].ParticipantID < out[j].ParticipantID
				}
				return out[i].DeviceIndex < out[j].DeviceIndex
			}
			return out[i].UserID < out[j].UserID
		}
		return out[i].JoinedAt < out[j].JoinedAt
	})
	return out
}

func (p *CallStateProjection) ActiveRoomIDs() []string {
	p.RLock()
	defer p.RUnlock()
	if len(p.rooms) == 0 {
		return nil
	}
	out := make([]string, 0, len(p.rooms))
	for roomID, participants := range p.rooms {
		if len(participants) > 0 {
			out = append(out, roomID)
		}
	}
	sort.Strings(out)
	return out
}

func (p *CallStateProjection) adminProjectionEstimate() (int64, int64, []ProjectionAdminMetric) {
	p.RLock()
	defer p.RUnlock()
	var participants int64
	var bytes int64
	for roomID, users := range p.rooms {
		bytes += projectionMapEntryOverhead + int64(len(roomID))
		for participantID, participant := range users {
			participants++
			bytes += projectionMapEntryOverhead + int64(len(participantID)+len(participant.UserID)) + 40
		}
	}
	return participants, bytes, []ProjectionAdminMetric{
		{Name: "active_calls", Value: int64(len(p.activeCalls)), Bytes: 0},
		{Name: "active_rooms", Value: int64(len(p.rooms)), Bytes: 0},
		{Name: "participants", Value: participants, Bytes: bytes},
	}
}
