package connectapi

import (
	"testing"

	"connectrpc.com/connect"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
)

func TestMessageServiceFetchLinkPreviewSkipsExternalGIF(t *testing.T) {
	env := newConnectAPITestEnv(t)

	resp, err := env.messages.FetchLinkPreview(
		withCaller(env.ctx, env.viewer),
		connect.NewRequest(&apiv1.FetchLinkPreviewRequest{
			Url: "https://giphy.com/gifs/reaction-l0MYt5jPR6QX5pnqM",
		}),
	)
	if err != nil {
		t.Fatalf("FetchLinkPreview: %v", err)
	}
	if resp.Msg.GetPreview() != nil || resp.Msg.GetPreviewToken() != "" {
		t.Fatalf("response = %+v, want no server-fetched preview", resp.Msg)
	}
}
