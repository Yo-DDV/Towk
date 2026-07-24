package connectapi

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"hmans.de/chatto/internal/core"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
)

func (s *roomService) MarkRoomAsRead(ctx context.Context, req *connect.Request[apiv1.MarkRoomAsReadRequest]) (*connect.Response[apiv1.MarkRoomAsReadResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	result, err := s.api.core.ReadState().MarkRoomAsRead(ctx, caller.UserID, req.Msg.RoomId, req.Msg.UpToEventId)
	if err != nil {
		return nil, connectError(err)
	}

	resp := &apiv1.MarkRoomAsReadResponse{}
	if !result.LastReadAt.IsZero() {
		resp.LastReadAt = timestamppb.New(result.LastReadAt)
	}
	if !result.PreviousLastReadAt.IsZero() {
		resp.PreviousLastReadAt = timestamppb.New(result.PreviousLastReadAt)
	}
	return connect.NewResponse(resp), nil
}

func (s *threadService) MarkThreadAsRead(ctx context.Context, req *connect.Request[apiv1.MarkThreadAsReadRequest]) (*connect.Response[apiv1.MarkThreadAsReadResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	result, err := s.api.core.ReadState().MarkThreadAsRead(ctx, caller.UserID, req.Msg.RoomId, req.Msg.ThreadRootEventId, req.Msg.UpToEventId)
	if err != nil {
		return nil, connectError(err)
	}

	resp := &apiv1.MarkThreadAsReadResponse{}
	if !result.PreviousReadAt.IsZero() {
		resp.PreviousReadAt = timestamppb.New(result.PreviousReadAt)
	}
	return connect.NewResponse(resp), nil
}

func (s *roomService) AdvanceReadReceipt(ctx context.Context, req *connect.Request[apiv1.AdvanceReadReceiptRequest]) (*connect.Response[apiv1.AdvanceReadReceiptResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	result, err := s.api.core.ReadReceipts().Advance(ctx, caller.UserID, req.Msg.GetRoomId(), req.Msg.GetThreadRootEventId(), req.Msg.GetUpToEventId())
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&apiv1.AdvanceReadReceiptResponse{Updated: result.Updated}), nil
}

func (s *roomService) GetReadReceiptSummaries(ctx context.Context, req *connect.Request[apiv1.GetReadReceiptSummariesRequest]) (*connect.Response[apiv1.GetReadReceiptSummariesResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	model := s.api.core.ReadReceipts()
	summaries, err := model.Summaries(ctx, caller.UserID, req.Msg.GetRoomId(), req.Msg.GetThreadRootEventId(), req.Msg.GetMessageEventIds())
	if errors.Is(err, core.ErrReadReceiptsDisabled) {
		return connect.NewResponse(&apiv1.GetReadReceiptSummariesResponse{Enabled: false}), nil
	}
	if err != nil {
		return nil, connectError(err)
	}
	response := &apiv1.GetReadReceiptSummariesResponse{Enabled: true, Summaries: make([]*apiv1.ReadReceiptSummary, 0, len(summaries))}
	for _, summary := range summaries {
		item := &apiv1.ReadReceiptSummary{
			MessageEventId: summary.MessageEventID,
			ReaderCount:    int32(summary.ReaderCount),
			PreviewUserIds: summary.PreviewUserIDs,
		}
		if !summary.LatestReadAt.IsZero() {
			item.LatestReadAt = timestamppb.New(summary.LatestReadAt)
		}
		response.Summaries = append(response.Summaries, item)
	}
	return connect.NewResponse(response), nil
}

func (s *roomService) ListReadReceiptReaders(ctx context.Context, req *connect.Request[apiv1.ListReadReceiptReadersRequest]) (*connect.Response[apiv1.ListReadReceiptReadersResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	model := s.api.core.ReadReceipts()
	readers, err := model.Readers(ctx, caller.UserID, req.Msg.GetRoomId(), req.Msg.GetThreadRootEventId(), req.Msg.GetMessageEventId())
	if errors.Is(err, core.ErrReadReceiptsDisabled) {
		return connect.NewResponse(&apiv1.ListReadReceiptReadersResponse{Enabled: false, Page: apiPageInfo(0, false)}), nil
	}
	if err != nil {
		return nil, connectError(err)
	}
	limit, offset := apiPagination(req.Msg.GetPage(), 50, 100)
	page, total, hasMore := apiSlicePage(readers, limit, offset)
	response := &apiv1.ListReadReceiptReadersResponse{
		Enabled: true,
		Readers: make([]*apiv1.ReadReceiptReader, 0, len(page)),
		Page:    apiPageInfo(total, hasMore),
	}
	users := &userService{api: s.api}
	for _, reader := range page {
		user, err := s.api.core.GetUser(ctx, reader.UserID)
		if err != nil {
			continue
		}
		apiUser, err := users.userSummary(ctx, user, nil)
		if err != nil {
			return nil, err
		}
		item := &apiv1.ReadReceiptReader{User: apiUser}
		if !reader.ReadAt.IsZero() {
			item.ReadAt = timestamppb.New(reader.ReadAt)
		}
		response.Readers = append(response.Readers, item)
	}
	return connect.NewResponse(response), nil
}
