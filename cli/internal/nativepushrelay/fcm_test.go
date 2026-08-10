package nativepushrelay

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"golang.org/x/oauth2"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func TestFCMSenderUsesDataOnlyHTTPv1Message(t *testing.T) {
	var received map[string]any
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "https://fcm.googleapis.com/v1/projects/towk-test/messages:send" {
			t.Fatalf("unexpected URL: %s", request.URL)
		}
		if request.Header.Get("Authorization") != "Bearer access-token" {
			t.Fatal("missing access token")
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatal(err)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"name":"projects/towk-test/messages/42"}`))}, nil
	})}
	sender := &FCMSender{projectID: "towk-test", tokenSource: oauth2.StaticTokenSource(&oauth2.Token{AccessToken: "access-token"}), client: client}
	result, err := sender.Send(context.Background(), SendRequest{
		InstanceID: "twi_42", InstallationID: "example-installation-id", Envelope: "opaque", Collapse: "call:42", TTLSeconds: 120, Priority: "high",
	})
	if err != nil || result.Outcome != "accepted" {
		t.Fatalf("send failed: %#v, %v", result, err)
	}
	message := received["message"].(map[string]any)
	if _, exists := message["notification"]; exists {
		t.Fatal("FCM message must be data-only")
	}
	data := message["data"].(map[string]any)
	if data["instance_id"] != "twi_42" || data["envelope"] != "opaque" {
		t.Fatalf("unexpected data payload: %#v", data)
	}
}
