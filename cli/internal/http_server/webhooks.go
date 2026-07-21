package http_server

import (
	"errors"
	"net/http"
	"time"

	"github.com/charmbracelet/log"
	"github.com/gin-gonic/gin"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/livekit/protocol/webhook"
	"hmans.de/chatto/internal/core"
)

func (s *HTTPServer) setupWebhookRoutes() {
	if !s.config.LiveKit.IsConfigured() {
		return
	}

	webhooks := s.router.Group("/webhooks")
	webhooks.POST("/livekit", s.handleLiveKitWebhook)
	registerTestWebhookEndpoints(webhooks, s)
}

func (s *HTTPServer) handleLiveKitWebhook(c *gin.Context) {
	logger := log.WithPrefix("webhook.livekit")

	webhookKey, webhookSecret := s.config.LiveKit.WebhookKeyPair()
	provider := auth.NewSimpleKeyProvider(webhookKey, webhookSecret)
	event, err := webhook.ReceiveWebhookEvent(c.Request, provider)
	if err != nil {
		logger.Warn("Webhook validation failed", "error", err)
		c.Status(http.StatusUnauthorized)
		return
	}

	// Extract space and room IDs from the LiveKit room name
	if event.Room == nil {
		c.Status(http.StatusOK)
		return
	}
	if !liveKitWebhookRoomBelongsToInstance(event.Room.Name, s.config.LiveKit.ServerID) {
		logger.Warn("Ignoring LiveKit webhook for foreign room", "room", event.Room.Name, "instance", s.config.LiveKit.ServerID)
		c.Status(http.StatusOK)
		return
	}
	spaceID, roomID, callID := core.ParseLiveKitRoomIdentity(event.Room.Name)
	if spaceID == "" || roomID == "" {
		logger.Warn("Unrecognized LiveKit room name", "name", event.Room.Name)
		c.Status(http.StatusOK)
		return
	}

	ctx := c.Request.Context()

	switch event.Event {
	case webhook.EventParticipantJoined:
		if event.Participant == nil {
			break
		}
		md := core.ParseParticipantMetadata(event.Participant.Metadata)
		participantID := event.Participant.Identity
		userID := md.UserID
		if userID == "" {
			userID = participantID
		}
		deviceIndex := md.DeviceIndex
		if deviceIndex == 0 {
			deviceIndex = 1
		}
		eventCallID := callID
		if eventCallID == "" {
			eventCallID = md.CallID
		}
		if eventCallID == "" {
			logger.Warn("Ignoring LiveKit participant joined without call ID", "room", event.Room.Name)
			break
		}
		if err := s.core.HandleObservedCallParticipantConnectionJoined(
			ctx, spaceID, roomID,
			userID,
			participantID,
			deviceIndex,
			event.Participant.Name,
			md.Login, md.AvatarURL,
			liveKitConnectionObservation(event),
			eventCallID,
		); err != nil {
			logger.Warn("Failed to handle participant joined", "error", err)
			if !errors.Is(err, core.ErrCallParticipantNotAdmitted) || errors.Is(err, core.ErrCallParticipantEvictionFailed) {
				c.Status(http.StatusServiceUnavailable)
				return
			}
		}

	case webhook.EventParticipantLeft:
		if event.Participant == nil {
			break
		}
		if liveKitParticipantLeftIsConnectionHandoff(event.Participant) {
			break
		}
		md := core.ParseParticipantMetadata(event.Participant.Metadata)
		participantID := event.Participant.Identity
		userID := md.UserID
		if userID == "" {
			userID = participantID
		}
		eventCallID := callID
		if eventCallID == "" {
			eventCallID = md.CallID
		}
		if eventCallID == "" {
			logger.Warn("Ignoring LiveKit participant left without call ID", "room", event.Room.Name)
			break
		}
		var err error
		if liveKitParticipantLeftIsTerminal(event.Participant) {
			err = s.core.HandleCallParticipantConnectionTerminated(ctx, roomID, userID, participantID, eventCallID)
		} else {
			err = s.core.HandleObservedCallParticipantConnectionLeft(
				ctx, spaceID, roomID,
				userID,
				participantID,
				liveKitConnectionObservation(event),
				eventCallID,
			)
		}
		if err != nil {
			logger.Warn("Failed to handle participant left", "error", err)
			c.Status(http.StatusServiceUnavailable)
			return
		}

	case webhook.EventRoomFinished:
		if callID == "" {
			logger.Warn("Ignoring LiveKit room finished without call ID", "room", event.Room.Name)
			break
		}
		if err := s.core.HandleObservedCallRoomFinished(ctx, spaceID, roomID, liveKitConnectionObservation(event), callID); err != nil {
			logger.Warn("Failed to handle room finished", "error", err)
			c.Status(http.StatusServiceUnavailable)
			return
		}
	}

	c.Status(http.StatusOK)
}

func liveKitConnectionObservation(event *livekit.WebhookEvent) core.CallParticipantConnectionObservation {
	observation := core.CallParticipantConnectionObservation{}
	if event == nil {
		return observation
	}
	observation.ID = event.GetId()
	if event.GetCreatedAt() > 0 {
		observation.ObservedAt = time.Unix(event.GetCreatedAt(), 0).UTC()
	}
	return observation
}

func liveKitParticipantLeftIsConnectionHandoff(participant *livekit.ParticipantInfo) bool {
	if participant == nil {
		return false
	}
	// A duplicate-identity replacement is a reconnect/handoff of the same
	// connection-scoped participant, not a durable departure of that device.
	return participant.GetDisconnectReason() == livekit.DisconnectReason_DUPLICATE_IDENTITY
}

func liveKitParticipantLeftIsTerminal(participant *livekit.ParticipantInfo) bool {
	if participant == nil {
		return false
	}
	switch participant.GetDisconnectReason() {
	case livekit.DisconnectReason_CLIENT_INITIATED,
		livekit.DisconnectReason_PARTICIPANT_REMOVED,
		livekit.DisconnectReason_ROOM_DELETED,
		livekit.DisconnectReason_ROOM_CLOSED:
		return true
	default:
		return false
	}
}

func liveKitWebhookRoomBelongsToInstance(roomName, instanceID string) bool {
	roomInstanceID := core.ParseLiveKitRoomServerID(roomName)
	if instanceID == "" {
		return roomInstanceID == ""
	}
	return roomInstanceID == instanceID
}
