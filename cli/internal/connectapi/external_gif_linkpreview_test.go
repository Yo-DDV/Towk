package connectapi

import (
	"testing"

	"connectrpc.com/connect"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
)

func TestMessageServiceFetchLinkPreviewSkipsExternalGIF(t *testing.T) {
	env := newConnectAPITestEnv(t)

	for _, rawURL := range []string{
		"https://giphy.com/gifs/reaction-l0MYt5jPR6QX5pnqM",
		"https://media1.tenor.com/m/2wdlar795ZAAAAAd/example-content-url.gif",
		"https://static.klipy.com/ii/4493325008d34b7bf8cd6813cd5c1619/12/66/VRmb0agTs8UFUzia.gif",
	} {
		t.Run(rawURL, func(t *testing.T) {
			resp, err := env.messages.FetchLinkPreview(
				withCaller(env.ctx, env.viewer),
				connect.NewRequest(&apiv1.FetchLinkPreviewRequest{Url: rawURL}),
			)
			if err != nil {
				t.Fatalf("FetchLinkPreview: %v", err)
			}
			if resp.Msg.GetPreview() != nil || resp.Msg.GetPreviewToken() != "" {
				t.Fatalf("response = %+v, want no server-fetched preview", resp.Msg)
			}
		})
	}
}
