package connectapi

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/core"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
)

const (
	roomTimelineCursorSeqPrefix    = "seq:"
	roomTimelineCursorOpaquePrefix = "tl:"
	roomTimelineCursorVersion      = byte(1)
	roomTimelineCursorSize         = 9
)

func (s *roomService) GetRoomEvents(ctx context.Context, req *connect.Request[apiv1.GetRoomEventsRequest]) (*connect.Response[apiv1.GetRoomEventsResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	afterSeq, beforeSeq, err := roomTimelineCursorBounds(req.Msg.Cursor)
	if err != nil {
		return nil, err
	}

	kind, cutoffSeq, hasCutoff, err := s.dmTimelineBoundary(ctx, caller.UserID, req.Msg.RoomId)
	if err != nil {
		return nil, connectError(err)
	}

	var result *core.RoomTimelineEventsResult
	if kind == core.KindDM {
		var page *core.RoomEventsResult
		switch {
		case afterSeq != nil:
			page, err = s.api.core.GetRoomEventsAfterCursorAndDMHistoryCutoff(ctx, kind, req.Msg.RoomId, *afterSeq, int(req.Msg.Limit), cutoffSeq)
		default:
			page, err = s.api.core.GetRoomEventsAfterDMHistoryCutoff(ctx, kind, req.Msg.RoomId, int(req.Msg.Limit), beforeSeq, cutoffSeq)
		}
		if err != nil {
			return nil, connectError(err)
		}
		result = &core.RoomTimelineEventsResult{Kind: kind, Page: page}
	} else {
		result, err = s.api.core.RoomTimelineReads().GetRoomEvents(ctx, core.RoomTimelineEventsInput{
			ActorID:   caller.UserID,
			RoomID:    req.Msg.RoomId,
			Limit:     int(req.Msg.Limit),
			AfterSeq:  afterSeq,
			BeforeSeq: beforeSeq,
		})
		if err != nil {
			return nil, connectError(err)
		}
	}
	_ = hasCutoff

	page := result.Page
	resp, err := newRoomTimelineAssembler(s.api).buildPage(ctx, caller.UserID, result.Kind, page.Events, page.HasOlder, page.HasNewer)
	if err != nil {
		return nil, connectError(err)
	}
	resp.StartCursor = formatRoomTimelineCursor(page.StartCursorSeq)
	resp.EndCursor = formatRoomTimelineCursor(page.EndCursorSeq)
	return connect.NewResponse(&apiv1.GetRoomEventsResponse{Page: resp}), nil
}

func (s *roomService) GetRoomEventsAround(ctx context.Context, req *connect.Request[apiv1.GetRoomEventsAroundRequest]) (*connect.Response[apiv1.GetRoomEventsAroundResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	kind, cutoffSeq, _, err := s.dmTimelineBoundary(ctx, caller.UserID, req.Msg.RoomId)
	if err != nil {
		return nil, connectError(err)
	}

	var result *core.RoomTimelineAroundResult
	if kind == core.KindDM {
		around, err := s.api.core.GetRoomEventsAroundAfterDMHistoryCutoff(ctx, kind, req.Msg.RoomId, req.Msg.EventId, int(req.Msg.Limit), cutoffSeq)
		if err != nil {
			return nil, connectError(err)
		}
		result = &core.RoomTimelineAroundResult{Kind: kind, Result: around}
	} else {
		result, err = s.api.core.RoomTimelineReads().GetRoomEventsAround(ctx, caller.UserID, req.Msg.RoomId, req.Msg.EventId, int(req.Msg.Limit))
		if err != nil {
			return nil, connectError(err)
		}
	}

	around := result.Result
	page, err := newRoomTimelineAssembler(s.api).buildPage(ctx, caller.UserID, result.Kind, around.Events, around.HasOlder, around.HasNewer)
	if err != nil {
		return nil, connectError(err)
	}
	if len(around.Events) > 0 {
		page.StartCursor = formatRoomTimelineCursor(around.Events[0].Sequence)
		page.EndCursor = formatRoomTimelineCursor(around.Events[len(around.Events)-1].Sequence)
	}

	return connect.NewResponse(&apiv1.GetRoomEventsAroundResponse{
		Page:        page,
		TargetIndex: int32(around.TargetIndex),
	}), nil
}

func (s *messageService) GetMessage(ctx context.Context, req *connect.Request[apiv1.GetMessageRequest]) (*connect.Response[apiv1.GetMessageResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	result, err := s.api.core.RoomTimelineReads().GetMessage(ctx, caller.UserID, req.Msg.RoomId, req.Msg.EventId)
	if err != nil {
		return nil, connectError(err)
	}
	if result.Kind == core.KindDM {
		accessible, err := s.api.core.CanAccessDMEvent(ctx, caller.UserID, req.Msg.RoomId, req.Msg.EventId)
		if err != nil {
			return nil, connectError(err)
		}
		if !accessible {
			return nil, connectError(core.ErrMessageNotFound)
		}
	}
	apiEvents, _, err := newRoomTimelineAssembler(s.api).hydrateEvents(ctx, caller.UserID, result.Kind, []*core.RoomEvent{{Event: result.Event}})
	if err != nil {
		return nil, connectError(err)
	}
	var message *apiv1.Message
	if len(apiEvents) > 0 {
		message = messageFromTimelineEvent(apiEvents[0])
	}

	return connect.NewResponse(&apiv1.GetMessageResponse{Message: message}), nil
}

func (s *messageService) BatchGetMessages(ctx context.Context, req *connect.Request[apiv1.BatchGetMessagesRequest]) (*connect.Response[apiv1.BatchGetMessagesResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	result, err := s.api.core.RoomTimelineReads().BatchGetMessages(ctx, caller.UserID, req.Msg.RoomId, req.Msg.GetEventIds())
	if err != nil {
		return nil, connectError(err)
	}

	events := make([]*core.RoomEvent, 0, len(result.Events))
	for _, event := range result.Events {
		if result.Kind == core.KindDM {
			accessible, err := s.api.core.CanAccessDMEvent(ctx, caller.UserID, req.Msg.RoomId, event.GetId())
			if err != nil {
				return nil, connectError(err)
			}
			if !accessible {
				continue
			}
		}
		events = append(events, &core.RoomEvent{Event: event})
	}
	apiEvents, _, err := newRoomTimelineAssembler(s.api).hydrateEvents(ctx, caller.UserID, result.Kind, events)
	if err != nil {
		return nil, connectError(err)
	}
	messages := make([]*apiv1.Message, 0, len(apiEvents))
	for _, event := range apiEvents {
		if message := messageFromTimelineEvent(event); message != nil {
			messages = append(messages, message)
		}
	}

	return connect.NewResponse(&apiv1.BatchGetMessagesResponse{Messages: messages}), nil
}

func (s *threadService) GetThreadEvents(ctx context.Context, req *connect.Request[apiv1.GetThreadEventsRequest]) (*connect.Response[apiv1.GetThreadEventsResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	afterSeq, beforeSeq, err := roomTimelineCursorBounds(req.Msg.Cursor)
	if err != nil {
		return nil, err
	}

	input := core.ThreadTimelineEventsInput{
		ActorID:           caller.UserID,
		RoomID:            req.Msg.RoomId,
		ThreadRootEventID: req.Msg.ThreadRootEventId,
		Limit:             int(req.Msg.Limit),
		AfterSeq:          afterSeq,
		BeforeSeq:         beforeSeq,
	}

	result, err := s.api.core.RoomTimelineReads().GetThreadEvents(ctx, input)
	if err != nil {
		return nil, connectError(err)
	}
	if result.Kind == core.KindDM {
		accessible, err := s.api.core.CanAccessDMEvent(ctx, caller.UserID, req.Msg.RoomId, req.Msg.ThreadRootEventId)
		if err != nil {
			return nil, connectError(err)
		}
		if !accessible {
			return nil, connectError(core.ErrMessageNotFound)
		}
	}

	page, err := newRoomTimelineAssembler(s.api).buildThreadPage(ctx, caller.UserID, result.Kind, result.Root, result.Replies, result.IncludeRoot)
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&apiv1.GetThreadEventsResponse{Page: page}), nil
}

func (s *threadService) GetThreadEventsAround(ctx context.Context, req *connect.Request[apiv1.GetThreadEventsAroundRequest]) (*connect.Response[apiv1.GetThreadEventsAroundResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	result, err := s.api.core.RoomTimelineReads().GetThreadEventsAround(ctx, caller.UserID, req.Msg.RoomId, req.Msg.ThreadRootEventId, req.Msg.EventId, int(req.Msg.Limit))
	if err != nil {
		return nil, connectError(err)
	}
	if result.Kind == core.KindDM {
		accessible, err := s.api.core.CanAccessDMEvent(ctx, caller.UserID, req.Msg.RoomId, req.Msg.ThreadRootEventId)
		if err != nil {
			return nil, connectError(err)
		}
		if !accessible {
			return nil, connectError(core.ErrMessageNotFound)
		}
	}
	page, err := newRoomTimelineAssembler(s.api).buildThreadPage(ctx, caller.UserID, result.Kind, result.Root, result.Replies, true)
	if err != nil {
		return nil, connectError(err)
	}

	return connect.NewResponse(&apiv1.GetThreadEventsAroundResponse{
		Page:        page,
		TargetIndex: int32(result.TargetIndex),
	}), nil
}

func (s *roomService) dmTimelineBoundary(ctx context.Context, actorID, roomID string) (core.RoomKind, uint64, bool, error) {
	kind, err := s.api.core.FindRoomKind(ctx, roomID)
	if err != nil {
		return core.KindChannel, 0, false, err
	}
	if kind != core.KindDM {
		return kind, 0, false, nil
	}
	visible, err := s.api.core.CanAccessDMConversation(ctx, actorID, roomID)
	if err != nil {
		return kind, 0, false, err
	}
	if !visible {
		return kind, 0, false, core.ErrPermissionDenied
	}
	cutoffSeq, hasCutoff, err := s.api.core.DMHistoryCutoffSequence(ctx, actorID, roomID)
	return kind, cutoffSeq, hasCutoff, err
}

func formatRoomTimelineCursor(seq uint64) string {
	if seq == 0 {
		return ""
	}
	buf := make([]byte, roomTimelineCursorSize)
	buf[0] = roomTimelineCursorVersion
	binary.BigEndian.PutUint64(buf[1:], seq)
	return roomTimelineCursorOpaquePrefix + base64.RawURLEncoding.EncodeToString(buf)
}

func parseRoomTimelineCursor(cursor string) (uint64, error) {
	if cursor == "" {
		return 0, nil
	}
	if rest, ok := strings.CutPrefix(cursor, roomTimelineCursorSeqPrefix); ok {
		seq, err := strconv.ParseUint(rest, 10, 64)
		if err != nil {
			return 0, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cursor sequence: %w", err))
		}
		return seq, nil
	}
	encoded, ok := strings.CutPrefix(cursor, roomTimelineCursorOpaquePrefix)
	if !ok {
		return 0, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid cursor format"))
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return 0, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cursor encoding: %w", err))
	}
	if len(raw) != roomTimelineCursorSize || raw[0] != roomTimelineCursorVersion {
		return 0, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid cursor format"))
	}
	return binary.BigEndian.Uint64(raw[1:]), nil
}

func roomTimelineCursorBounds(cursor any) (afterSeq, beforeSeq *uint64, err error) {
	switch cursor := cursor.(type) {
	case nil:
		return nil, nil, nil
	case *apiv1.GetRoomEventsRequest_After:
		seq, err := parseRoomTimelineCursor(cursor.After)
		if err != nil {
			return nil, nil, err
		}
		return &seq, nil, nil
	case *apiv1.GetRoomEventsRequest_Before:
		seq, err := parseRoomTimelineCursor(cursor.Before)
		if err != nil {
			return nil, nil, err
		}
		return nil, &seq, nil
	case *apiv1.GetThreadEventsRequest_After:
		seq, err := parseRoomTimelineCursor(cursor.After)
		if err != nil {
			return nil, nil, err
		}
		return &seq, nil, nil
	case *apiv1.GetThreadEventsRequest_Before:
		seq, err := parseRoomTimelineCursor(cursor.Before)
		if err != nil {
			return nil, nil, err
		}
		return nil, &seq, nil
	default:
		return nil, nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("unsupported cursor type %T", cursor))
	}
}

func firstN(values []string, n int) []string {
	if len(values) <= n {
		return append([]string(nil), values...)
	}
	return append([]string(nil), values[:n]...)
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}
