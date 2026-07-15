package http_server

import (
	"bytes"
	"context"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/testutil"
)

var testHTTPPushP256DH = base64.RawURLEncoding.EncodeToString(
	elliptic.Marshal(elliptic.P256(), elliptic.P256().Params().Gx, elliptic.P256().Params().Gy),
)

func testHTTPPushAuth(seed byte) string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{seed}, 16))
}

func setupPushNotificationCloseTestServer(t *testing.T) (*httptest.Server, *core.ChattoCore) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	_, nc := testutil.StartSharedNATS(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)

	chattoCore, err := core.NewChattoCore(ctx, nc, config.CoreConfig{})
	if err != nil {
		t.Fatalf("NewChattoCore: %v", err)
	}
	startCoreServices(t, chattoCore)

	server, err := NewHTTPServer(HTTPServerConfig{
		Config: config.ChattoConfig{
			Webserver: config.WebserverConfig{
				URL:                 "http://localhost:4000",
				CookieSigningSecret: "test-secret-key-32-bytes-long!!",
			},
		},
		NC:      nc,
		Core:    chattoCore,
		Version: "test",
	})
	if err != nil {
		t.Fatalf("NewHTTPServer: %v", err)
	}

	ts := httptest.NewServer(server.router)
	t.Cleanup(ts.Close)
	return ts, chattoCore
}

func postPushNotificationClose(t *testing.T, baseURL string, body pushNotificationCloseRequest) (int, bool) {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("Marshal request: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, baseURL+pushNotificationClosePath, bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do request: %v", err)
	}
	defer resp.Body.Close()

	var decoded struct {
		Dismissed bool `json:"dismissed"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		t.Fatalf("Decode response: %v", err)
	}
	return resp.StatusCode, decoded.Dismissed
}

func TestPushNotificationCloseRouteUsesSubscriptionProofWithoutAppAuth(t *testing.T) {
	ts, chattoCore := setupPushNotificationCloseTestServer(t)
	ctx := context.Background()

	userID := "push-close-route-user"
	endpoint := "https://push.example.com/http-close"
	auth := testHTTPPushAuth(1)
	if _, err := chattoCore.SavePushSubscription(ctx, userID, endpoint, testHTTPPushP256DH, auth, "browser"); err != nil {
		t.Fatalf("SavePushSubscription: %v", err)
	}
	notification, err := chattoCore.CreateNotification(ctx, userID, "actor", &corev1.Notification{
		Notification: &corev1.Notification_DmMessage{
			DmMessage: &corev1.DMMessageNotification{RoomId: "dm-room", EventId: "event-1"},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification: %v", err)
	}

	status, dismissed := postPushNotificationClose(t, ts.URL, pushNotificationCloseRequest{
		Endpoint:       endpoint,
		Auth:           testHTTPPushAuth(2),
		NotificationID: notification.Id,
	})
	if status != http.StatusAccepted || dismissed {
		t.Fatalf("wrong auth response = status %d dismissed %v, want 202 false", status, dismissed)
	}
	stillPending, err := chattoCore.GetNotification(ctx, userID, notification.Id)
	if err != nil {
		t.Fatalf("GetNotification after wrong auth: %v", err)
	}
	if stillPending == nil {
		t.Fatal("wrong auth removed the notification")
	}

	status, dismissed = postPushNotificationClose(t, ts.URL, pushNotificationCloseRequest{
		Endpoint:       endpoint,
		Auth:           auth,
		NotificationID: notification.Id,
	})
	if status != http.StatusAccepted || !dismissed {
		t.Fatalf("valid auth response = status %d dismissed %v, want 202 true", status, dismissed)
	}
	gone, err := chattoCore.GetNotification(ctx, userID, notification.Id)
	if err != nil {
		t.Fatalf("GetNotification after close route: %v", err)
	}
	if gone != nil {
		t.Fatal("notification still pending after close route")
	}
}

func TestPushNotificationCloseRouteRejectsMalformedRequests(t *testing.T) {
	ts, _ := setupPushNotificationCloseTestServer(t)

	req, err := http.NewRequest(
		http.MethodPost,
		ts.URL+pushNotificationClosePath,
		bytes.NewBufferString("{"),
	)
	if err != nil {
		t.Fatalf("NewRequest malformed JSON: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do malformed request: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed JSON status = %d, want 400", resp.StatusCode)
	}

	status, dismissed := postPushNotificationClose(t, ts.URL, pushNotificationCloseRequest{
		Endpoint:       "https://push.example.com/close",
		NotificationID: "missing-auth",
	})
	if status != http.StatusBadRequest || dismissed {
		t.Fatalf("missing auth response = status %d dismissed %v, want 400 false", status, dismissed)
	}
}
