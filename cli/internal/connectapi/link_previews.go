package connectapi

import (
	"context"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/externalgif"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func (s *messageService) FetchLinkPreview(ctx context.Context, req *connect.Request[apiv1.FetchLinkPreviewRequest]) (*connect.Response[apiv1.FetchLinkPreviewResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	// Supported external GIF URLs are rendered only by the reader's browser.
	// Never turn them into a server-side OpenGraph fetch or persisted preview.
	if externalgif.IsTrustedURL(req.Msg.Url) {
		return connect.NewResponse(&apiv1.FetchLinkPreviewResponse{}), nil
	}

	preview, err := s.api.core.GetLinkPreview(ctx, caller.UserID, req.Msg.Url)
	if err != nil {
		return nil, connectError(err)
	}
	if preview == nil {
		return connect.NewResponse(&apiv1.FetchLinkPreviewResponse{}), nil
	}
	tokenURL := preview.GetUrl()
	if tokenURL == "" {
		tokenURL = req.Msg.Url
	}
	token, err := s.api.core.CreateLinkPreviewToken(ctx, tokenURL)
	if err != nil {
		return nil, connectError(err)
	}

	return connect.NewResponse(&apiv1.FetchLinkPreviewResponse{
		Preview:      apiLinkPreview(s.api, preview),
		PreviewToken: token,
	}), nil
}

func apiLinkPreview(api *API, preview *corev1.LinkPreview) *apiv1.LinkPreview {
	if preview == nil {
		return nil
	}

	imageAssetID := preview.GetImageAssetId()
	if image := preview.GetImageAsset(); image != nil && image.GetId() != "" {
		imageAssetID = image.GetId()
	}

	imageURL := ""
	if imageAssetID != "" {
		imageURL = api.core.GetTransformedServerAssetURL(imageAssetID, 600, 314, "contain")
	}

	out := &apiv1.LinkPreview{
		Url: preview.GetUrl(),
	}
	if title := preview.GetTitle(); title != "" {
		out.Title = stringPtr(title)
	}
	if description := preview.GetDescription(); description != "" {
		out.Description = stringPtr(description)
	}
	if imageURL != "" {
		out.ImageUrl = stringPtr(imageURL)
	}
	if imageAssetID != "" {
		out.ImageAssetId = stringPtr(imageAssetID)
	}
	if siteName := preview.GetSiteName(); siteName != "" {
		out.SiteName = stringPtr(siteName)
	}
	if embedType := preview.GetEmbedType(); embedType != "" {
		out.EmbedType = stringPtr(embedType)
	}
	if embedID := preview.GetEmbedId(); embedID != "" {
		out.EmbedId = stringPtr(embedID)
	}
	return out
}
