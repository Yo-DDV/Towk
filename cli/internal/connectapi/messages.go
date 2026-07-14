package connectapi

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/core"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

type messageService struct {
	api *API
}

func (s *messageService) CreateMessage(ctx context.Context, req *connect.Request[apiv1.CreateMessageRequest]) (*connect.Response[apiv1.CreateMessageResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	input := core.MessagePostInput{
		ActorID:            caller.UserID,
		RoomID:             req.Msg.RoomId,
		Body:               req.Msg.Body,
		AttachmentAssetIDs: append([]string(nil), req.Msg.GetAttachmentAssetIds()...),
		ThreadRootEventID:  req.Msg.ThreadRootEventId,
		InReplyTo:          req.Msg.InReplyTo,
		AlsoSendToChannel:  req.Msg.AlsoSendToChannel,
		ClientRequestID:    req.Msg.GetClientRequestId(),
	}
	if input.ClientRequestID != "" {
		input.RequestFingerprint = createMessageRequestFingerprint(req.Msg)
		result, err := s.api.core.Messages().FindIdempotentPost(ctx, input)
		if err != nil {
			return nil, connectError(err)
		}
		if result != nil {
			return s.createMessageResponse(ctx, caller.UserID, result)
		}
	}

	linkPreview, err := s.api.core.ResolveLinkPreviewToken(ctx, req.Msg.GetLinkPreviewToken())
	if err != nil {
		return nil, connectError(err)
	}
	input.LinkPreview = linkPreview

	result, err := s.api.core.Messages().PostMessage(ctx, input)
	if err != nil {
		return nil, connectError(err)
	}
	return s.createMessageResponse(ctx, caller.UserID, result)
}

func (s *messageService) createMessageResponse(ctx context.Context, callerID string, result *core.MessagePostResult) (*connect.Response[apiv1.CreateMessageResponse], error) {
	if result == nil {
		return nil, connectInternalError(errors.New("message create returned no result"))
	}
	if result.Event == nil {
		return nil, connectInternalError(errors.New("message create returned no event"))
	}

	roomID := result.Event.GetMessagePosted().GetRoomId()
	kind := core.KindChannel
	if room, err := s.api.core.FindRoomByID(ctx, roomID); err == nil && room != nil {
		kind = core.KindOfRoom(room)
	}
	apiEvent, err := s.hydratePostedEvent(ctx, callerID, kind, result.Event)
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&apiv1.CreateMessageResponse{
		Message: messageFromTimelineEvent(apiEvent),
	}), nil
}

func createMessageRequestFingerprint(req *apiv1.CreateMessageRequest) []byte {
	h := sha256.New()
	writeString := func(value string) {
		var length [8]byte
		binary.BigEndian.PutUint64(length[:], uint64(len(value)))
		_, _ = h.Write(length[:])
		_, _ = h.Write([]byte(value))
	}
	writeString(req.GetRoomId())
	writeString(req.GetBody())
	var count [8]byte
	binary.BigEndian.PutUint64(count[:], uint64(len(req.GetAttachmentAssetIds())))
	_, _ = h.Write(count[:])
	for _, assetID := range req.GetAttachmentAssetIds() {
		writeString(assetID)
	}
	writeString(req.GetThreadRootEventId())
	writeString(req.GetInReplyTo())
	if req.GetAlsoSendToChannel() {
		_, _ = h.Write([]byte{1})
	} else {
		_, _ = h.Write([]byte{0})
	}
	writeString(req.GetLinkPreviewToken())
	return h.Sum(nil)
}

func (s *messageService) UpdateMessage(ctx context.Context, req *connect.Request[apiv1.UpdateMessageRequest]) (*connect.Response[apiv1.UpdateMessageResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	event, kind, err := s.api.core.Messages().UpdateMessage(ctx, core.MessageUpdateInput{
		ActorID:           caller.UserID,
		RoomID:            req.Msg.RoomId,
		EventID:           req.Msg.EventId,
		Body:              req.Msg.Body,
		AlsoSendToChannel: req.Msg.AlsoSendToChannel,
	})
	if err != nil {
		return nil, connectError(err)
	}
	apiEvent, err := s.hydratePostedEvent(ctx, caller.UserID, kind, event)
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&apiv1.UpdateMessageResponse{
		Message: messageFromTimelineEvent(apiEvent),
	}), nil
}

func (s *messageService) DeleteMessage(ctx context.Context, req *connect.Request[apiv1.DeleteMessageRequest]) (*connect.Response[apiv1.DeleteMessageResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	if err := s.api.core.Messages().DeleteMessage(ctx, core.MessageDeleteInput{
		ActorID: caller.UserID,
		RoomID:  req.Msg.RoomId,
		EventID: req.Msg.EventId,
	}); err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&apiv1.DeleteMessageResponse{Deleted: true}), nil
}

func (s *messageService) DeleteAttachment(ctx context.Context, req *connect.Request[apiv1.DeleteAttachmentRequest]) (*connect.Response[apiv1.DeleteAttachmentResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	if err := s.api.core.Messages().DeleteAttachment(ctx, core.MessageAttachmentDeleteInput{
		ActorID:      caller.UserID,
		RoomID:       req.Msg.RoomId,
		EventID:      req.Msg.EventId,
		AttachmentID: req.Msg.AttachmentId,
	}); err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&apiv1.DeleteAttachmentResponse{Deleted: true}), nil
}

func (s *messageService) DeleteLinkPreview(ctx context.Context, req *connect.Request[apiv1.DeleteLinkPreviewRequest]) (*connect.Response[apiv1.DeleteLinkPreviewResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	if err := s.api.core.Messages().DeleteLinkPreview(ctx, core.MessageLinkPreviewDeleteInput{
		ActorID: caller.UserID,
		RoomID:  req.Msg.RoomId,
		EventID: req.Msg.EventId,
		URL:     req.Msg.Url,
	}); err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&apiv1.DeleteLinkPreviewResponse{Deleted: true}), nil
}

func (s *messageService) hydratePostedEvent(ctx context.Context, viewerID string, kind core.RoomKind, event *corev1.Event) (*apiv1.RoomTimelineEvent, error) {
	reactionsByMessageID, err := s.api.core.GetReactionsBatch(ctx, []string{event.Id})
	if err != nil {
		return nil, err
	}
	h := &timelineHydrator{
		api:                  s.api,
		ctx:                  ctx,
		viewerID:             viewerID,
		kind:                 kind,
		reactionsByMessageID: reactionsByMessageID,
		userIDs:              make(map[string]struct{}),
		thumbnail:            defaultTimelineAttachmentThumbnail(),
	}
	apiEvent, err := h.event(ctx, &core.RoomEvent{Event: event})
	if err != nil {
		return nil, err
	}
	return apiEvent, nil
}

func messageFromTimelineEvent(event *apiv1.RoomTimelineEvent) *apiv1.Message {
	if event == nil {
		return nil
	}
	posted := event.GetMessagePosted()
	if posted == nil {
		return nil
	}
	return posted.GetMessage()
}
