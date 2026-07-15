package push

import (
	"context"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/charmbracelet/log"
	"github.com/rivo/uniseg"
	"google.golang.org/protobuf/types/known/timestamppb"

	"hmans.de/chatto/internal/config"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

type contextBlockingHTTPClient struct {
	started chan struct{}
}

type inertRoundTripper struct{}

func (inertRoundTripper) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("unused")
}

func TestNewPushHTTPClientAcceptsCustomDefaultTransport(t *testing.T) {
	original := http.DefaultTransport
	http.DefaultTransport = inertRoundTripper{}
	t.Cleanup(func() { http.DefaultTransport = original })

	client := newPushHTTPClient()
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport = %T, want *http.Transport", client.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("push transport inherited a proxy function")
	}
	if transport.DialContext == nil {
		t.Fatal("push transport has no public-address dialer")
	}
	request, err := http.NewRequest(http.MethodPost, "https://push.example.test/redirected", nil)
	if err != nil {
		t.Fatalf("create redirect request: %v", err)
	}
	if err := client.CheckRedirect(request, nil); !errors.Is(err, http.ErrUseLastResponse) {
		t.Fatalf("redirect policy error = %v, want http.ErrUseLastResponse", err)
	}
}

func (c *contextBlockingHTTPClient) Do(req *http.Request) (*http.Response, error) {
	close(c.started)
	<-req.Context().Done()
	return nil, req.Context().Err()
}

func TestBuildPayloadFromCallStartedNotificationIsShortLivedAndActionable(t *testing.T) {
	createdAt := time.Date(2026, 7, 14, 9, 30, 0, 0, time.UTC)
	notification := &corev1.Notification{
		Id:        "N-call",
		CreatedAt: timestamppb.New(createdAt),
		Notification: &corev1.Notification_CallStarted{
			CallStarted: &corev1.CallStartedNotification{
				RoomId:  "R1",
				EventId: "E1",
				CallId:  "C1",
			},
		},
	}

	payload := BuildPayloadFromNotification(notification, "Alice", "https://towk.example", &PayloadContext{
		RoomName:   "General",
		ActorKnown: true,
	})

	if payload.Call == nil {
		t.Fatal("call payload = nil")
	}
	if payload.Call.ActorName != "Alice" || !payload.Call.ActorKnown || payload.Call.RoomName != "General" || payload.Call.CallID != "C1" || payload.Call.IsPrivate {
		t.Fatalf("call payload = %+v", payload.Call)
	}
	if payload.URL != "https://towk.example/chat/-/R1" || payload.Call.JoinURL != "https://towk.example/chat/-/R1?joinCall=C1" {
		t.Fatalf("call URLs = %q / %q", payload.URL, payload.Call.JoinURL)
	}
	if payload.ExpiresAt != createdAt.Add(time.Minute).UnixMilli() {
		t.Fatalf("expiresAt = %d, want %d", payload.ExpiresAt, createdAt.Add(time.Minute).UnixMilli())
	}
	if payload.TTL != 60 || payload.Urgency != webpush.UrgencyHigh || payload.Topic != "call-C1" {
		t.Fatalf("delivery = ttl=%d urgency=%q topic=%q", payload.TTL, payload.Urgency, payload.Topic)
	}
	payload.AppBadge = "4"
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal call payload: %v", err)
	}
	var encoded map[string]any
	if err := json.Unmarshal(data, &encoded); err != nil {
		t.Fatalf("unmarshal call payload: %v", err)
	}
	if encoded["app_badge"] != "4" {
		t.Fatalf("app_badge = %v, want 4", encoded["app_badge"])
	}
	if payload.declarativeNotificationEligible() {
		t.Fatal("call payload unexpectedly enabled declarative delivery")
	}
}

func TestBuildPayloadFromPrivateCallUsesPrivateConversationMetadata(t *testing.T) {
	notification := &corev1.Notification{
		Id:        "N-private-call",
		CreatedAt: timestamppb.Now(),
		Notification: &corev1.Notification_CallStarted{
			CallStarted: &corev1.CallStartedNotification{RoomId: "DM1", EventId: "E2", CallId: "C2"},
		},
	}
	payload := BuildPayloadFromNotification(notification, "Bob", "https://towk.example", &PayloadContext{IsPrivate: true})
	if payload.Call == nil || !payload.Call.IsPrivate {
		t.Fatalf("private call payload = %+v", payload.Call)
	}
}

type concurrencyTrackingHTTPClient struct {
	current atomic.Int32
	maximum atomic.Int32
	calls   atomic.Int32
}

func (c *concurrencyTrackingHTTPClient) Do(*http.Request) (*http.Response, error) {
	current := c.current.Add(1)
	c.calls.Add(1)
	for {
		maximum := c.maximum.Load()
		if current <= maximum || c.maximum.CompareAndSwap(maximum, current) {
			break
		}
	}
	time.Sleep(5 * time.Millisecond)
	c.current.Add(-1)
	return &http.Response{
		StatusCode: http.StatusCreated,
		Body:       io.NopCloser(strings.NewReader("")),
	}, nil
}

func TestNewSender(t *testing.T) {
	logger := log.New(nil)

	t.Run("returns nil when not configured", func(t *testing.T) {
		cfg := config.PushConfig{}
		sender := NewSender(cfg, logger)
		if sender != nil {
			t.Error("Expected nil sender when not configured")
		}
	})

	t.Run("returns nil when enabled but missing keys", func(t *testing.T) {
		cfg := config.PushConfig{
			Enabled: true,
			// Missing VAPID keys
		}
		sender := NewSender(cfg, logger)
		if sender != nil {
			t.Error("Expected nil sender when keys missing")
		}
	})

	t.Run("returns sender when fully configured", func(t *testing.T) {
		cfg := config.PushConfig{
			Enabled:         true,
			VAPIDPublicKey:  "test-public-key",
			VAPIDPrivateKey: "test-private-key",
			VAPIDSubject:    "mailto:test@example.com",
		}
		sender := NewSender(cfg, logger)
		if sender == nil {
			t.Error("Expected non-nil sender when configured")
		}
	})
}

func TestEndpointLogID(t *testing.T) {
	endpoint := "https://push.example.com/send/private-device-token"

	got := EndpointLogID(endpoint)
	if got == "" {
		t.Fatal("EndpointLogID returned empty string")
	}
	if len(got) != 16 {
		t.Fatalf("EndpointLogID length = %d, want 16", len(got))
	}
	if got != EndpointLogID(endpoint) {
		t.Fatal("EndpointLogID should be stable for the same endpoint")
	}
	if got == endpoint || strings.Contains(got, "private-device-token") {
		t.Fatalf("EndpointLogID leaked endpoint material: %q", got)
	}
}

func TestPayloadMarshal(t *testing.T) {
	t.Run("marshals all fields", func(t *testing.T) {
		payload := &Payload{
			Title:          "Test Title",
			Body:           "Test Body",
			Icon:           "/icons/icon.png",
			Badge:          "/icons/badge.png",
			Tag:            "test-tag",
			NotificationID: "notif-123",
			URL:            "/chat/room/123",
			AppBadge:       "7",
		}

		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("Failed to marshal payload: %v", err)
		}

		// Unmarshal and verify
		var result map[string]interface{}
		if err := json.Unmarshal(data, &result); err != nil {
			t.Fatalf("Failed to unmarshal: %v", err)
		}

		if result["title"] != "Test Title" {
			t.Errorf("Expected title 'Test Title', got %v", result["title"])
		}
		if result["notificationId"] != "notif-123" {
			t.Errorf("Expected notificationId 'notif-123', got %v", result["notificationId"])
		}
		if result["url"] != "/chat/room/123" {
			t.Errorf("Expected url '/chat/room/123', got %v", result["url"])
		}
		if result["web_push"] != float64(declarativeWebPushValue) {
			t.Errorf("Expected web_push %d, got %v", declarativeWebPushValue, result["web_push"])
		}
		if result["mutable"] != true {
			t.Errorf("Expected mutable true, got %v", result["mutable"])
		}

		notification, ok := result["notification"].(map[string]interface{})
		if !ok {
			t.Fatalf("Expected declarative notification object, got %T", result["notification"])
		}
		if notification["title"] != "Test Title" {
			t.Errorf("Expected declarative title 'Test Title', got %v", notification["title"])
		}
		if notification["body"] != "Test Body" {
			t.Errorf("Expected declarative body 'Test Body', got %v", notification["body"])
		}
		if notification["navigate"] != "/chat/room/123" {
			t.Errorf("Expected declarative navigate '/chat/room/123', got %v", notification["navigate"])
		}
		if notification["tag"] != "test-tag" {
			t.Errorf("Expected declarative tag 'test-tag', got %v", notification["tag"])
		}
		if notification["app_badge"] != "7" {
			t.Errorf("Expected declarative app_badge '7', got %v", notification["app_badge"])
		}

		notificationData, ok := notification["data"].(map[string]interface{})
		if !ok {
			t.Fatalf("Expected declarative notification data object, got %T", notification["data"])
		}
		if notificationData["notificationId"] != "notif-123" {
			t.Errorf("Expected declarative notificationId 'notif-123', got %v", notificationData["notificationId"])
		}
		if notificationData["url"] != "/chat/room/123" {
			t.Errorf("Expected declarative data url '/chat/room/123', got %v", notificationData["url"])
		}
	})

	t.Run("omits empty optional fields", func(t *testing.T) {
		payload := &Payload{
			Title: "Test Title",
			Body:  "Test Body",
		}

		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("Failed to marshal payload: %v", err)
		}

		var result map[string]interface{}
		if err := json.Unmarshal(data, &result); err != nil {
			t.Fatalf("Failed to unmarshal: %v", err)
		}

		if _, ok := result["icon"]; ok {
			t.Error("Expected icon to be omitted when empty")
		}
		if _, ok := result["notificationId"]; ok {
			t.Error("Expected notificationId to be omitted when empty")
		}
		if _, ok := result["web_push"]; ok {
			t.Error("Expected web_push to be omitted when navigate URL is empty")
		}
		if _, ok := result["notification"]; ok {
			t.Error("Expected declarative notification to be omitted when navigate URL is empty")
		}
	})

	t.Run("dismiss payload stays imperative only", func(t *testing.T) {
		payload := &Payload{
			Action: "dismiss",
			Tag:    "test-tag",
		}

		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("Failed to marshal payload: %v", err)
		}

		var result map[string]interface{}
		if err := json.Unmarshal(data, &result); err != nil {
			t.Fatalf("Failed to unmarshal: %v", err)
		}

		if result["action"] != "dismiss" {
			t.Errorf("Expected dismiss action, got %v", result["action"])
		}
		if result["tag"] != "test-tag" {
			t.Errorf("Expected tag 'test-tag', got %v", result["tag"])
		}
		if _, ok := result["web_push"]; ok {
			t.Error("Expected dismiss payload to omit web_push")
		}
		if _, ok := result["mutable"]; ok {
			t.Error("Expected dismiss payload to omit mutable")
		}
		if _, ok := result["notification"]; ok {
			t.Error("Expected dismiss payload to omit declarative notification")
		}
	})
}

func TestNormalizeVAPIDSubject(t *testing.T) {
	tests := []struct {
		name    string
		subject string
		want    string
	}{
		{
			name:    "strips mailto prefix",
			subject: "mailto:admin@example.com",
			want:    "admin@example.com",
		},
		{
			name:    "keeps bare email",
			subject: "admin@example.com",
			want:    "admin@example.com",
		},
		{
			name:    "keeps https URL",
			subject: "https://example.com/push-contact",
			want:    "https://example.com/push-contact",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeVAPIDSubject(tt.subject); got != tt.want {
				t.Fatalf("normalizeVAPIDSubject(%q) = %q, want %q", tt.subject, got, tt.want)
			}
		})
	}
}

func TestBuildPayloadFromNotification(t *testing.T) {
	baseURL := "https://towk.example.com"

	t.Run("builds DM message payload without context", func(t *testing.T) {
		notif := &corev1.Notification{
			Id:          "notif-123",
			RecipientId: "user-1",
			ActorId:     "user-2",
			CreatedAt:   timestamppb.Now(),
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{
					RoomId:   "dm-room-456",
					EventId:  "event-789",
					InThread: "thread-root",
				},
			},
		}

		payload := BuildPayloadFromNotification(notif, "Alice", baseURL, nil)

		if payload.Title != "@Alice sent you a new DM" {
			t.Errorf("Expected '@Alice sent you a new DM', got %s", payload.Title)
		}
		if payload.Body != "Open Towk to read the direct message" {
			t.Errorf("Expected fallback body, got %s", payload.Body)
		}
		if payload.Tag != "dm-event-789" {
			t.Errorf("Expected tag 'dm-event-789', got %s", payload.Tag)
		}
		if payload.URL != "https://towk.example.com/chat/-/dm-room-456/thread-root?highlight=event-789" {
			t.Errorf("Expected URL for highlighted DM message, got %s", payload.URL)
		}
		if payload.NotificationID != "notif-123" {
			t.Errorf("Expected notificationId 'notif-123', got %s", payload.NotificationID)
		}
	})

	t.Run("builds DM message payload with preview", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-123",
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{
					RoomId: "dm-room-456",
				},
			},
		}
		ctx := &PayloadContext{MessagePreview: "Hey, how are you?"}

		payload := BuildPayloadFromNotification(notif, "Alice", baseURL, ctx)

		if payload.Title != "@Alice sent you a new DM" {
			t.Errorf("Expected '@Alice sent you a new DM', got %s", payload.Title)
		}
		if payload.Body != "Hey, how are you?" {
			t.Errorf("Expected 'Hey, how are you?', got %s", payload.Body)
		}
	})

	t.Run("builds mention payload without context", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-456",
			Notification: &corev1.Notification_Mention{
				Mention: &corev1.MentionNotification{
					RoomId:  "room-2",
					EventId: "event-3",
				},
			},
		}

		payload := BuildPayloadFromNotification(notif, "Bob", baseURL, nil)

		if payload.Title != "@Bob mentioned you" {
			t.Errorf("Expected '@Bob mentioned you', got %s", payload.Title)
		}
		if payload.Body != "Open Towk to read the mention" {
			t.Errorf("Expected fallback body, got %s", payload.Body)
		}
		if payload.URL != "https://towk.example.com/chat/-/room-2?highlight=event-3" {
			t.Errorf("Expected URL with highlight param, got %s", payload.URL)
		}
	})

	t.Run("builds mention payload with room name and preview", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-456",
			Notification: &corev1.Notification_Mention{
				Mention: &corev1.MentionNotification{
					RoomId:  "room-2",
					EventId: "event-3",
				},
			},
		}
		ctx := &PayloadContext{MessagePreview: "Hey @Bob check this out", RoomName: "general"}

		payload := BuildPayloadFromNotification(notif, "Alice", baseURL, ctx)

		if payload.Title != "@Alice mentioned you in #general" {
			t.Errorf("Expected '@Alice mentioned you in #general', got %s", payload.Title)
		}
		if payload.Body != "Hey @Bob check this out" {
			t.Errorf("Expected 'Hey @Bob check this out', got %s", payload.Body)
		}
	})

	t.Run("builds mention payload without event ID", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-789",
			Notification: &corev1.Notification_Mention{
				Mention: &corev1.MentionNotification{
					RoomId: "room-2",
					// No EventId
				},
			},
		}

		payload := BuildPayloadFromNotification(notif, "Charlie", baseURL, nil)

		if payload.URL != "https://towk.example.com/chat/-/room-2" {
			t.Errorf("Expected URL without event param, got %s", payload.URL)
		}
	})

	t.Run("builds thread mention payload", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-thread-mention",
			Notification: &corev1.Notification_Mention{
				Mention: &corev1.MentionNotification{
					RoomId:   "room-2",
					EventId:  "mention-event",
					InThread: "thread-root",
				},
			},
		}

		payload := BuildPayloadFromNotification(notif, "Bob", baseURL, nil)

		expectedURL := "https://towk.example.com/chat/-/room-2/thread-root?highlight=mention-event"
		if payload.URL != expectedURL {
			t.Errorf("Expected URL %s, got %s", expectedURL, payload.URL)
		}
	})

	t.Run("builds room-level reply payload without context", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-abc",
			Notification: &corev1.Notification_Reply{
				Reply: &corev1.ReplyNotification{
					RoomId:      "room-y",
					EventId:     "reply-event",
					InReplyToId: "root-event",
					// InThread empty — room-level reply
				},
			},
		}

		payload := BuildPayloadFromNotification(notif, "Diana", baseURL, nil)

		if payload.Title != "@Diana replied to you" {
			t.Errorf("Expected '@Diana replied to you', got %s", payload.Title)
		}
		if payload.Body != "Open Towk to read the reply" {
			t.Errorf("Expected fallback body, got %s", payload.Body)
		}
		if payload.Tag != "reply-reply-event" {
			t.Errorf("Expected tag 'reply-reply-event', got %s", payload.Tag)
		}
		// Room-level reply navigates to room with highlight
		if payload.URL != "https://towk.example.com/chat/-/room-y?highlight=reply-event" {
			t.Errorf("Expected URL for room with highlight, got %s", payload.URL)
		}
	})

	t.Run("builds thread reply payload without context", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-abc",
			Notification: &corev1.Notification_Reply{
				Reply: &corev1.ReplyNotification{
					RoomId:      "room-y",
					EventId:     "reply-event",
					InReplyToId: "mid-thread-msg", // The specific message replied to (not the root)
					InThread:    "thread-root",    // The actual thread root
				},
			},
		}

		payload := BuildPayloadFromNotification(notif, "Diana", baseURL, nil)

		if payload.Title != "@Diana replied to you" {
			t.Errorf("Expected '@Diana replied to you', got %s", payload.Title)
		}
		// Thread reply: navigate to thread root and highlight the reply event itself.
		expectedURL := "https://towk.example.com/chat/-/room-y/thread-root?highlight=reply-event"
		if payload.URL != expectedURL {
			t.Errorf("Expected URL %s, got %s", expectedURL, payload.URL)
		}
	})

	t.Run("builds reply payload with preview", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-abc",
			Notification: &corev1.Notification_Reply{
				Reply: &corev1.ReplyNotification{
					RoomId:      "room-y",
					EventId:     "reply-event",
					InReplyToId: "root-event",
				},
			},
		}
		ctx := &PayloadContext{MessagePreview: "Thanks for the update!"}

		payload := BuildPayloadFromNotification(notif, "Diana", baseURL, ctx)

		if payload.Title != "@Diana replied to you" {
			t.Errorf("Expected '@Diana replied to you', got %s", payload.Title)
		}
		if payload.Body != "Thanks for the update!" {
			t.Errorf("Expected 'Thanks for the update!', got %s", payload.Body)
		}
	})

	t.Run("builds reply payload with room name and preview", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-abc",
			Notification: &corev1.Notification_Reply{
				Reply: &corev1.ReplyNotification{
					RoomId:      "room-y",
					EventId:     "reply-event",
					InReplyToId: "root-event",
				},
			},
		}
		ctx := &PayloadContext{MessagePreview: "Thanks for the update!", RoomName: "general"}

		payload := BuildPayloadFromNotification(notif, "Diana", baseURL, ctx)

		if payload.Title != "@Diana replied to you in #general" {
			t.Errorf("Expected '@Diana replied to you in #general', got %s", payload.Title)
		}
		if payload.Body != "Thanks for the update!" {
			t.Errorf("Expected 'Thanks for the update!', got %s", payload.Body)
		}
	})

	t.Run("builds room message payload with room name and preview", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-room-message",
			Notification: &corev1.Notification_RoomMessage{
				RoomMessage: &corev1.RoomMessageNotification{
					RoomId:  "room-news",
					EventId: "room-event",
				},
			},
		}
		ctx := &PayloadContext{MessagePreview: "A watched room has a new message", RoomName: "news"}

		payload := BuildPayloadFromNotification(notif, "Eve", baseURL, ctx)

		if payload.Title != "@Eve posted in #news" {
			t.Errorf("Expected '@Eve posted in #news', got %s", payload.Title)
		}
		if payload.Body != "A watched room has a new message" {
			t.Errorf("Expected room message preview, got %s", payload.Body)
		}
		if payload.Tag != "room-message-room-event" {
			t.Errorf("Expected tag 'room-message-room-event', got %s", payload.Tag)
		}
		expectedURL := "https://towk.example.com/chat/-/room-news?highlight=room-event"
		if payload.URL != expectedURL {
			t.Errorf("Expected URL %s, got %s", expectedURL, payload.URL)
		}
	})

	t.Run("builds thread room message payload with thread navigation", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-thread-room-message",
			Notification: &corev1.Notification_RoomMessage{
				RoomMessage: &corev1.RoomMessageNotification{
					RoomId:   "room-news",
					EventId:  "thread-reply",
					InThread: "thread-root",
				},
			},
		}

		payload := BuildPayloadFromNotification(notif, "Eve", baseURL, nil)

		if payload.Body != "Open Towk to read the message" {
			t.Errorf("Expected fallback body, got %s", payload.Body)
		}
		expectedURL := "https://towk.example.com/chat/-/room-news/thread-root?highlight=thread-reply"
		if payload.URL != expectedURL {
			t.Errorf("Expected URL %s, got %s", expectedURL, payload.URL)
		}
	})

	t.Run("escapes notification URL path segments and highlight query", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-escaped",
			Notification: &corev1.Notification_Mention{
				Mention: &corev1.MentionNotification{
					RoomId:  "room with spaces",
					EventId: "event+plus",
				},
			},
		}

		payload := BuildPayloadFromNotification(notif, "Bob", baseURL, nil)

		expectedURL := "https://towk.example.com/chat/-/room%20with%20spaces?highlight=event%2Bplus"
		if payload.URL != expectedURL {
			t.Errorf("Expected URL %s, got %s", expectedURL, payload.URL)
		}
	})

	t.Run("builds default payload for unknown type", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-unknown",
			// No notification type set
		}

		payload := BuildPayloadFromNotification(notif, "Unknown", baseURL, nil)

		if payload.Title != "New notification" {
			t.Errorf("Expected 'New notification', got %s", payload.Title)
		}
		if payload.Body != "You have a new notification" {
			t.Errorf("Unexpected body: %s", payload.Body)
		}
	})

	t.Run("sets icon and badge URLs", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-icons",
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "room"},
			},
		}

		payload := BuildPayloadFromNotification(notif, "Test", baseURL, nil)

		expectedIcon := "https://towk.example.com/icons/icon-192.png"
		expectedBadge := "https://towk.example.com/icons/badge-monochrome-96.png"
		if payload.Icon != expectedIcon {
			t.Errorf("Expected icon %s, got %s", expectedIcon, payload.Icon)
		}
		if payload.Badge != expectedBadge {
			t.Errorf("Expected badge %s, got %s", expectedBadge, payload.Badge)
		}
	})

	t.Run("truncates long message preview", func(t *testing.T) {
		notif := &corev1.Notification{
			Id: "notif-long",
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "room"},
			},
		}
		// Create a preview longer than maxPreviewLength
		longPreview := "This is a very long message that exceeds the maximum preview length and should be truncated with an ellipsis at the end to fit within the allowed characters"
		ctx := &PayloadContext{MessagePreview: longPreview}

		payload := BuildPayloadFromNotification(notif, "Test", baseURL, ctx)

		// Body should be truncated (just the preview, no prefix)
		if len(payload.Body) > maxPreviewLength+3 { // +3 for ellipsis
			t.Errorf("Body too long: %d chars", len(payload.Body))
		}
		if !strings.HasSuffix(payload.Body, "…") {
			t.Errorf("Expected body to end with ellipsis, got %s", payload.Body)
		}
	})
}

func TestNotificationCopyForLocale(t *testing.T) {
	tests := []struct {
		locale string
		want   notificationCopy
	}{
		{
			locale: "en",
			want: notificationCopy{
				unknownActor:       "Someone",
				directMessage:      "@%s sent you a new DM",
				directMessageBody:  "Open Towk to read the direct message",
				mention:            "@%s mentioned you",
				mentionInRoom:      "@%s mentioned you in #%s",
				mentionBody:        "Open Towk to read the mention",
				reply:              "@%s replied to you",
				replyInRoom:        "@%s replied to you in #%s",
				replyBody:          "Open Towk to read the reply",
				roomMessage:        "@%s posted a message",
				roomMessageInRoom:  "@%s posted in #%s",
				roomMessageBody:    "Open Towk to read the message",
				defaultTitle:       "New notification",
				defaultDescription: "You have a new notification",
			},
		},
		{
			locale: "de",
			want: notificationCopy{
				unknownActor:       "Jemand",
				directMessage:      "@%s hat dir eine neue Direktnachricht gesendet",
				directMessageBody:  "Öffne Towk, um die Direktnachricht zu lesen",
				mention:            "@%s hat dich erwähnt",
				mentionInRoom:      "@%s hat dich in #%s erwähnt",
				mentionBody:        "Öffne Towk, um die Erwähnung zu lesen",
				reply:              "@%s hat dir geantwortet",
				replyInRoom:        "@%s hat dir in #%s geantwortet",
				replyBody:          "Öffne Towk, um die Antwort zu lesen",
				roomMessage:        "@%s hat eine Nachricht gesendet",
				roomMessageInRoom:  "@%s hat in #%s geschrieben",
				roomMessageBody:    "Öffne Towk, um die Nachricht zu lesen",
				defaultTitle:       "Neue Benachrichtigung",
				defaultDescription: "Du hast eine neue Benachrichtigung",
			},
		},
		{
			locale: "fr",
			want: notificationCopy{
				unknownActor:       "Quelqu’un",
				directMessage:      "@%s vous a envoyé un nouveau message privé",
				directMessageBody:  "Ouvrez Towk pour lire le message privé",
				mention:            "@%s vous a mentionné",
				mentionInRoom:      "@%s vous a mentionné dans #%s",
				mentionBody:        "Ouvrez Towk pour lire la mention",
				reply:              "@%s vous a répondu",
				replyInRoom:        "@%s vous a répondu dans #%s",
				replyBody:          "Ouvrez Towk pour lire la réponse",
				roomMessage:        "@%s a publié un message",
				roomMessageInRoom:  "@%s a publié un message dans #%s",
				roomMessageBody:    "Ouvrez Towk pour lire le message",
				defaultTitle:       "Nouvelle notification",
				defaultDescription: "Vous avez une nouvelle notification",
			},
		},
		{
			locale: "es",
			want: notificationCopy{
				unknownActor:       "Alguien",
				directMessage:      "@%s te envió un nuevo mensaje directo",
				directMessageBody:  "Abre Towk para leer el mensaje directo",
				mention:            "@%s te mencionó",
				mentionInRoom:      "@%s te mencionó en #%s",
				mentionBody:        "Abre Towk para leer la mención",
				reply:              "@%s te respondió",
				replyInRoom:        "@%s te respondió en #%s",
				replyBody:          "Abre Towk para leer la respuesta",
				roomMessage:        "@%s publicó un mensaje",
				roomMessageInRoom:  "@%s publicó un mensaje en #%s",
				roomMessageBody:    "Abre Towk para leer el mensaje",
				defaultTitle:       "Nueva notificación",
				defaultDescription: "Tienes una nueva notificación",
			},
		},
		{
			locale: "pt",
			want: notificationCopy{
				unknownActor:       "Alguém",
				directMessage:      "@%s enviou uma nova mensagem direta para você",
				directMessageBody:  "Abra o Towk para ler a mensagem direta",
				mention:            "@%s mencionou você",
				mentionInRoom:      "@%s mencionou você em #%s",
				mentionBody:        "Abra o Towk para ler a menção",
				reply:              "@%s respondeu a você",
				replyInRoom:        "@%s respondeu a você em #%s",
				replyBody:          "Abra o Towk para ler a resposta",
				roomMessage:        "@%s publicou uma mensagem",
				roomMessageInRoom:  "@%s publicou uma mensagem em #%s",
				roomMessageBody:    "Abra o Towk para ler a mensagem",
				defaultTitle:       "Nova notificação",
				defaultDescription: "Você tem uma nova notificação",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.locale, func(t *testing.T) {
			if got := notificationCopyForLocale(tt.locale); got != tt.want {
				t.Fatalf("notificationCopyForLocale(%q) = %#v, want %#v", tt.locale, got, tt.want)
			}
		})
	}

	if got := notificationCopyForLocale("it"); got != notificationCopyForLocale("en") {
		t.Fatalf("unsupported locale did not fall back to English: %#v", got)
	}
}

func TestBuildLocalizedPayloadFromNotification(t *testing.T) {
	notif := &corev1.Notification{
		Id: "notif-fr",
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: "room-1", EventId: "event-1"},
		},
	}
	payload := BuildLocalizedPayloadFromNotification(
		notif,
		"Alice",
		"https://towk.example.com",
		&PayloadContext{RoomName: "général", MessagePreview: "Bonjour"},
		"fr",
	)

	if payload.Title != "@Alice a publié un message dans #général" {
		t.Fatalf("localized title = %q", payload.Title)
	}
	if payload.Body != "Bonjour" {
		t.Fatalf("localized body = %q", payload.Body)
	}
	if payload.Icon != "https://towk.example.com/icons/icon-192.png" {
		t.Fatalf("icon = %q", payload.Icon)
	}
	if payload.Badge != "https://towk.example.com/icons/badge-monochrome-96.png" {
		t.Fatalf("badge = %q", payload.Badge)
	}

	fallbackPayload := BuildLocalizedPayloadFromNotification(
		notif,
		"Alice",
		"https://towk.example.com",
		&PayloadContext{RoomName: "général", MessagePreview: "   "},
		"fr",
	)
	if fallbackPayload.Body != "Ouvrez Towk pour lire le message" {
		t.Fatalf("localized fallback body = %q", fallbackPayload.Body)
	}
}

func TestBuildLocalizedPayloadCoversEveryNotificationKindAndLocale(t *testing.T) {
	tests := []struct {
		name         string
		notification *corev1.Notification
		wantTitle    map[string]string
		wantBody     map[string]string
	}{
		{
			name: "direct message",
			notification: &corev1.Notification{Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "dm", EventId: "event"},
			}},
			wantTitle: map[string]string{
				"en": "@Alice sent you a new DM",
				"de": "@Alice hat dir eine neue Direktnachricht gesendet",
				"fr": "@Alice vous a envoyé un nouveau message privé",
				"es": "@Alice te envió un nuevo mensaje directo",
				"pt": "@Alice enviou uma nova mensagem direta para você",
			},
			wantBody: map[string]string{
				"en": "Open Towk to read the direct message",
				"de": "Öffne Towk, um die Direktnachricht zu lesen",
				"fr": "Ouvrez Towk pour lire le message privé",
				"es": "Abre Towk para leer el mensaje directo",
				"pt": "Abra o Towk para ler a mensagem direta",
			},
		},
		{
			name: "mention",
			notification: &corev1.Notification{Notification: &corev1.Notification_Mention{
				Mention: &corev1.MentionNotification{RoomId: "room", EventId: "event"},
			}},
			wantTitle: map[string]string{
				"en": "@Alice mentioned you in #general",
				"de": "@Alice hat dich in #general erwähnt",
				"fr": "@Alice vous a mentionné dans #general",
				"es": "@Alice te mencionó en #general",
				"pt": "@Alice mencionou você em #general",
			},
			wantBody: map[string]string{
				"en": "Open Towk to read the mention",
				"de": "Öffne Towk, um die Erwähnung zu lesen",
				"fr": "Ouvrez Towk pour lire la mention",
				"es": "Abre Towk para leer la mención",
				"pt": "Abra o Towk para ler a menção",
			},
		},
		{
			name: "reply",
			notification: &corev1.Notification{Notification: &corev1.Notification_Reply{
				Reply: &corev1.ReplyNotification{RoomId: "room", EventId: "event"},
			}},
			wantTitle: map[string]string{
				"en": "@Alice replied to you in #general",
				"de": "@Alice hat dir in #general geantwortet",
				"fr": "@Alice vous a répondu dans #general",
				"es": "@Alice te respondió en #general",
				"pt": "@Alice respondeu a você em #general",
			},
			wantBody: map[string]string{
				"en": "Open Towk to read the reply",
				"de": "Öffne Towk, um die Antwort zu lesen",
				"fr": "Ouvrez Towk pour lire la réponse",
				"es": "Abre Towk para leer la respuesta",
				"pt": "Abra o Towk para ler a resposta",
			},
		},
		{
			name: "room message",
			notification: &corev1.Notification{Notification: &corev1.Notification_RoomMessage{
				RoomMessage: &corev1.RoomMessageNotification{RoomId: "room", EventId: "event"},
			}},
			wantTitle: map[string]string{
				"en": "@Alice posted in #general",
				"de": "@Alice hat in #general geschrieben",
				"fr": "@Alice a publié un message dans #general",
				"es": "@Alice publicó un mensaje en #general",
				"pt": "@Alice publicou uma mensagem em #general",
			},
			wantBody: map[string]string{
				"en": "Open Towk to read the message",
				"de": "Öffne Towk, um die Nachricht zu lesen",
				"fr": "Ouvrez Towk pour lire le message",
				"es": "Abre Towk para leer el mensaje",
				"pt": "Abra o Towk para ler a mensagem",
			},
		},
	}

	for _, tt := range tests {
		for _, locale := range []string{"en", "de", "fr", "es", "pt"} {
			t.Run(tt.name+"/"+locale, func(t *testing.T) {
				payload := BuildLocalizedPayloadFromNotification(
					tt.notification,
					"Alice",
					"https://towk.example",
					&PayloadContext{RoomName: "general"},
					locale,
				)
				if payload.Title != tt.wantTitle[locale] {
					t.Fatalf("title = %q, want %q", payload.Title, tt.wantTitle[locale])
				}
				if payload.Body != tt.wantBody[locale] {
					t.Fatalf("body = %q, want %q", payload.Body, tt.wantBody[locale])
				}
			})
		}
	}
}

func TestTruncatePreview(t *testing.T) {
	t.Run("returns short text unchanged", func(t *testing.T) {
		text := "Hello world"
		result := truncatePreview(text)
		if result != text {
			t.Errorf("Expected '%s', got '%s'", text, result)
		}
	})

	t.Run("truncates at word boundary", func(t *testing.T) {
		// Create text just over the limit
		text := "This is a test message that is slightly longer than one hundred characters and should be truncated properly"
		result := truncatePreview(text)

		if len(result) > maxPreviewLength+3 { // +3 for ellipsis rune
			t.Errorf("Result too long: %d chars", len(result))
		}
		if !strings.HasSuffix(result, "…") {
			t.Errorf("Expected ellipsis at end")
		}
	})

	t.Run("preserves multi-code-point emoji graphemes", func(t *testing.T) {
		family := "👨‍👩‍👧‍👦"
		result := truncatePreview(strings.Repeat(family, maxPreviewLength+1))

		if result != strings.Repeat(family, maxPreviewLength)+"…" {
			t.Fatalf("truncatePreview split or changed an emoji grapheme")
		}
		graphemes := uniseg.NewGraphemes(result)
		count := 0
		for graphemes.Next() {
			count++
		}
		if count != maxPreviewLength+1 {
			t.Fatalf("preview grapheme count = %d, want %d", count, maxPreviewLength+1)
		}
	})
}

func TestSendResult(t *testing.T) {
	t.Run("result fields", func(t *testing.T) {
		result := &SendResult{
			Endpoint: "https://push.example.com/endpoint",
			Success:  true,
			Error:    nil,
			Gone:     false,
		}

		if result.Endpoint != "https://push.example.com/endpoint" {
			t.Error("Endpoint not set correctly")
		}
		if !result.Success {
			t.Error("Success should be true")
		}
		if result.Gone {
			t.Error("Gone should be false")
		}
	})
}

func TestSend(t *testing.T) {
	t.Run("cancels an in-flight provider request with the caller context", func(t *testing.T) {
		client := &contextBlockingHTTPClient{started: make(chan struct{})}
		sender := newTestSender(t, client)
		subscription := newTestPushSubscription(t, "https://push.example.com/context")
		ctx, cancel := context.WithCancel(context.Background())
		resultCh := make(chan *SendResult, 1)

		go func() {
			resultCh <- sender.Send(ctx, subscription, &Payload{Title: "Test"})
		}()
		select {
		case <-client.started:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for provider request")
		}
		cancel()

		select {
		case result := <-resultCh:
			if !errors.Is(result.Error, context.Canceled) {
				t.Fatalf("Send error = %v, want context.Canceled", result.Error)
			}
		case <-time.After(time.Second):
			t.Fatal("Send did not return after context cancellation")
		}
	})

	t.Run("sends compact encrypted request", func(t *testing.T) {
		var bodyLen int
		var contentEncoding string
		var ttl string
		var readErr error

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var body []byte
			body, readErr = io.ReadAll(r.Body)
			if readErr != nil {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			bodyLen = len(body)
			contentEncoding = r.Header.Get("Content-Encoding")
			ttl = r.Header.Get("TTL")
			w.WriteHeader(http.StatusCreated)
		}))
		defer server.Close()

		sender := newTestSender(t, server.Client())
		result := sender.Send(context.Background(), newTestPushSubscription(t, server.URL), &Payload{
			Title: "Test",
			Body:  "Test body",
		})

		if result.Error != nil {
			t.Fatalf("Send error: %v", result.Error)
		}
		if readErr != nil {
			t.Fatalf("ReadAll request body: %v", readErr)
		}
		if !result.Success {
			t.Fatal("expected success")
		}
		if bodyLen != int(pushRecordSize) {
			t.Fatalf("request body length = %d, want %d", bodyLen, pushRecordSize)
		}
		if bodyLen >= 4096 {
			t.Fatalf("request body length = %d, want under 4096", bodyLen)
		}
		if contentEncoding != "aes128gcm" {
			t.Fatalf("Content-Encoding = %q, want aes128gcm", contentEncoding)
		}
		if ttl != "86400" {
			t.Fatalf("TTL = %q, want 86400", ttl)
		}
	})

	t.Run("uses short high-priority collapsed delivery for calls", func(t *testing.T) {
		var ttl, urgency, topic string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ttl = r.Header.Get("TTL")
			urgency = r.Header.Get("Urgency")
			topic = r.Header.Get("Topic")
			w.WriteHeader(http.StatusCreated)
		}))
		defer server.Close()

		sender := newTestSender(t, server.Client())
		result := sender.Send(context.Background(), newTestPushSubscription(t, server.URL), &Payload{
			Title:   "Call",
			TTL:     60,
			Urgency: webpush.UrgencyHigh,
			Topic:   "call-C1",
		})
		if result.Error != nil || !result.Success {
			t.Fatalf("Send call = %+v", result)
		}
		if ttl != "60" || urgency != "high" || topic != "call-C1" {
			t.Fatalf("call headers = TTL %q Urgency %q Topic %q", ttl, urgency, topic)
		}
	})

	t.Run("includes provider response body for non-gone failures", func(t *testing.T) {
		tests := []struct {
			name       string
			statusCode int
			body       string
		}{
			{name: "apple forbidden", statusCode: http.StatusForbidden, body: "invalid VAPID subject"},
			{name: "mozilla too large", statusCode: http.StatusRequestEntityTooLarge, body: "payload too large"},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(tt.statusCode)
					_, _ = w.Write([]byte(tt.body))
				}))
				defer server.Close()

				sender := newTestSender(t, server.Client())
				result := sender.Send(context.Background(), newTestPushSubscription(t, server.URL), &Payload{
					Title: "Test",
				})

				if result.Error == nil {
					t.Fatal("expected error")
				}
				if result.Gone {
					t.Fatal("expected non-gone failure")
				}
				if !strings.Contains(result.Error.Error(), tt.body) {
					t.Fatalf("error %q does not contain provider body %q", result.Error, tt.body)
				}
				if !strings.Contains(result.Error.Error(), strconv.Itoa(tt.statusCode)) {
					t.Fatalf("error %q does not contain status %d", result.Error, tt.statusCode)
				}
			})
		}
	})

	t.Run("marks missing and gone subscriptions as gone", func(t *testing.T) {
		tests := []struct {
			name       string
			statusCode int
		}{
			{name: "not found", statusCode: http.StatusNotFound},
			{name: "gone", statusCode: http.StatusGone},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(tt.statusCode)
					_, _ = w.Write([]byte("subscription is gone"))
				}))
				defer server.Close()

				sender := newTestSender(t, server.Client())
				result := sender.Send(context.Background(), newTestPushSubscription(t, server.URL), &Payload{
					Title: "Test",
				})

				if result.Error == nil {
					t.Fatal("expected error")
				}
				if !result.Gone {
					t.Fatal("expected gone result")
				}
			})
		}
	})
}

func TestSendToMany(t *testing.T) {
	client := &concurrencyTrackingHTTPClient{}
	sender := newTestSender(t, client)
	subscription := newTestPushSubscription(t, "https://push.example.com/many")
	subscriptions := make([]*corev1.PushSubscription, maxConcurrentPushRequests*2)
	for i := range subscriptions {
		subscriptions[i] = subscription
	}

	results := sender.SendToMany(context.Background(), subscriptions, &Payload{
		Title: "Test",
		Body:  "Test body",
	})

	if len(results) != len(subscriptions) {
		t.Fatalf("results = %d, want %d", len(results), len(subscriptions))
	}
	for i, result := range results {
		if result == nil || !result.Success || result.Error != nil {
			t.Fatalf("result[%d] = %+v, want success", i, result)
		}
	}
	if got := int(client.calls.Load()); got != len(subscriptions) {
		t.Fatalf("provider calls = %d, want %d", got, len(subscriptions))
	}
	if got := int(client.maximum.Load()); got > maxConcurrentPushRequests {
		t.Fatalf("maximum concurrent requests = %d, want at most %d", got, maxConcurrentPushRequests)
	} else if got < 2 {
		t.Fatalf("maximum concurrent requests = %d, want concurrent fanout", got)
	}
}

func TestIsPublicPushAddress(t *testing.T) {
	tests := []struct {
		address string
		want    bool
	}{
		{address: "8.8.8.8", want: true},
		{address: "2606:4700:4700::1111", want: true},
		{address: "127.0.0.1"},
		{address: "10.0.0.1"},
		{address: "169.254.169.254"},
		{address: "100.64.0.1"},
		{address: "198.18.0.1"},
		{address: "::1"},
		{address: "fd00::1"},
		{address: "fe80::1"},
	}

	for _, tt := range tests {
		t.Run(tt.address, func(t *testing.T) {
			if got := isPublicPushAddress(netip.MustParseAddr(tt.address)); got != tt.want {
				t.Fatalf("isPublicPushAddress(%s) = %t, want %t", tt.address, got, tt.want)
			}
		})
	}
}

func newTestSender(t *testing.T, client webpush.HTTPClient) *Sender {
	t.Helper()

	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("GenerateVAPIDKeys: %v", err)
	}

	sender := NewSender(config.PushConfig{
		Enabled:         true,
		VAPIDPublicKey:  publicKey,
		VAPIDPrivateKey: privateKey,
		VAPIDSubject:    "mailto:test@example.com",
	}, log.New(nil))
	if sender == nil {
		t.Fatal("expected configured sender")
	}
	sender.httpClient = client
	return sender
}

func newTestPushSubscription(t *testing.T, endpoint string) *corev1.PushSubscription {
	t.Helper()

	_, x, y, err := elliptic.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}

	auth := make([]byte, 16)
	if _, err := rand.Read(auth); err != nil {
		t.Fatalf("Read auth: %v", err)
	}

	return &corev1.PushSubscription{
		Endpoint: endpoint,
		P256Dh:   base64.RawURLEncoding.EncodeToString(elliptic.Marshal(elliptic.P256(), x, y)),
		Auth:     base64.RawURLEncoding.EncodeToString(auth),
	}
}
