package core

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"

	"google.golang.org/protobuf/types/known/timestamppb"

	"hmans.de/chatto/internal/events"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const maxMessageClientRequestIDLength = 64

var messageClientRequestIDRE = regexp.MustCompile(`^[A-Za-z0-9._:-]+$`)

type messageRequestClaim struct {
	actorID            string
	roomID             string
	requestID          string
	requestFingerprint []byte
	subject            string
	event              *corev1.Event
}

type messageRequestReplayError struct {
	event *corev1.Event
}

func (e *messageRequestReplayError) Error() string {
	return "message request was already committed"
}

func validateMessageRequestIdentity(requestID string, fingerprint []byte) error {
	if requestID == "" {
		if len(fingerprint) != 0 {
			return invalidArgument("client request fingerprint requires client_request_id")
		}
		return nil
	}
	if len(requestID) > maxMessageClientRequestIDLength {
		return invalidArgument(fmt.Sprintf("client_request_id exceeds maximum length of %d bytes", maxMessageClientRequestIDLength))
	}
	if !messageClientRequestIDRE.MatchString(requestID) {
		return invalidArgument("client_request_id contains invalid characters")
	}
	if len(fingerprint) != sha256.Size {
		return invalidArgument("client request fingerprint must be a SHA-256 digest")
	}
	return nil
}

func messageRequestClaimSubject(roomID, actorID, requestID string) string {
	digest := sha256.Sum256([]byte(actorID + "\x00" + requestID))
	return events.RoomAggregate(roomID).Subject(events.EventMessageRequestClaimed + "." + hex.EncodeToString(digest[:]))
}

func (c *ChattoCore) messageRequestProof(fingerprint []byte) []byte {
	mac := hmac.New(sha256.New, []byte(c.config.SecretKey))
	_, _ = mac.Write([]byte("towk.message-request.v1\x00"))
	_, _ = mac.Write(fingerprint)
	return mac.Sum(nil)
}

func (c *ChattoCore) newMessageRequestClaim(actorID, roomID, requestID string, fingerprint []byte, messageEventID string) *messageRequestClaim {
	if requestID == "" {
		return nil
	}
	payload := &corev1.MessageRequestClaimedEvent{
		RoomId:          roomID,
		ClientRequestId: requestID,
		RequestProof:    c.messageRequestProof(fingerprint),
		MessageEventId:  messageEventID,
	}
	return &messageRequestClaim{
		actorID:            actorID,
		roomID:             roomID,
		requestID:          requestID,
		requestFingerprint: append([]byte(nil), fingerprint...),
		subject:            messageRequestClaimSubject(roomID, actorID, requestID),
		event: newEvent(actorID, &corev1.Event{
			Id:        NewEventID(),
			CreatedAt: timestamppb.Now(),
			Event: &corev1.Event_MessageRequestClaimed{
				MessageRequestClaimed: payload,
			},
		}),
	}
}

func (c *ChattoCore) findMessageRequestClaim(ctx context.Context, actorID, roomID, requestID string, fingerprint []byte) (*corev1.Event, error) {
	if requestID == "" {
		return nil, nil
	}
	subject := messageRequestClaimSubject(roomID, actorID, requestID)
	claimEvent, _, err := c.EventPublisher.LastSubjectEvent(ctx, subject)
	if err != nil {
		return nil, err
	}
	if claimEvent == nil {
		return nil, nil
	}
	claim := claimEvent.GetMessageRequestClaimed()
	if claim == nil || claimEvent.GetActorId() != actorID || claim.GetRoomId() != roomID || claim.GetClientRequestId() != requestID || claim.GetMessageEventId() == "" {
		return nil, fmt.Errorf("invalid message request claim on %q", subject)
	}
	if !hmac.Equal(claim.GetRequestProof(), c.messageRequestProof(fingerprint)) {
		return nil, ErrMessageRequestConflict
	}

	messageSubject := events.RoomAggregate(roomID).Subject(events.EventMessagePosted)
	messageSeq, err := c.EventPublisher.LastSubjectSeq(ctx, messageSubject)
	if err != nil {
		return nil, fmt.Errorf("read claimed message tail: %w", err)
	}
	if messageSeq == 0 {
		return nil, fmt.Errorf("message request claim %q has no committed message", requestID)
	}
	if err := c.rooms().waitForTimeline(ctx, events.SubjectPosition(messageSubject, messageSeq)); err != nil {
		return nil, err
	}
	entry, ok := c.RoomTimeline.Get(claim.GetMessageEventId())
	if !ok || entry == nil || entry.Event == nil || entry.Event.GetMessagePosted() == nil {
		return nil, fmt.Errorf("message request claim %q references unavailable message %q", requestID, claim.GetMessageEventId())
	}
	return entry.Event, nil
}

func (c *ChattoCore) replayMessageRequestAfterConflict(ctx context.Context, claim *messageRequestClaim) error {
	if claim == nil {
		return nil
	}
	event, err := c.findMessageRequestClaim(ctx, claim.actorID, claim.roomID, claim.requestID, claim.requestFingerprint)
	if err != nil {
		return err
	}
	if event != nil {
		return &messageRequestReplayError{event: event}
	}
	return nil
}
