package core

import (
	"bytes"
	"context"
	"crypto/elliptic"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"

	"hmans.de/chatto/internal/core/subjects"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

var testPushP256DH = base64.RawURLEncoding.EncodeToString(
	elliptic.Marshal(elliptic.P256(), elliptic.P256().Params().Gx, elliptic.P256().Params().Gy),
)

func testPushAuth(seed byte) string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{seed}, 16))
}

func TestPushSubscriptionKey(t *testing.T) {
	tests := []struct {
		name     string
		userID   string
		endpoint string
	}{
		{
			name:     "basic key generation",
			userID:   "user-123",
			endpoint: "https://push.example.com/abc",
		},
		{
			name:     "different endpoints produce different keys",
			userID:   "user-123",
			endpoint: "https://push.example.com/xyz",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := pushSubscriptionKey(tt.userID, tt.endpoint)
			if key == "" {
				t.Error("Expected non-empty key")
			}

			// Key should start with push_subscription.{userID}.
			expectedPrefix := "push_subscription." + tt.userID + "."
			if len(key) <= len(expectedPrefix) {
				t.Errorf("Key too short: %s", key)
			}
			if key[:len(expectedPrefix)] != expectedPrefix {
				t.Errorf("Key should start with %s, got %s", expectedPrefix, key)
			}
		})
	}

	// Verify different endpoints produce different keys
	key1 := pushSubscriptionKey("user-123", "https://push.example.com/abc")
	key2 := pushSubscriptionKey("user-123", "https://push.example.com/xyz")
	if key1 == key2 {
		t.Error("Different endpoints should produce different keys")
	}

	// Verify same endpoint produces same key (idempotent)
	key3 := pushSubscriptionKey("user-123", "https://push.example.com/abc")
	if key1 != key3 {
		t.Error("Same endpoint should produce same key")
	}
}

func TestPushEndpointOwnerKey(t *testing.T) {
	endpoint := "https://push.example.com/owner"
	key := pushEndpointOwnerKey(endpoint)
	if !strings.HasPrefix(key, pushEndpointOwnerKeyPrefix) {
		t.Fatalf("owner key %q does not use prefix %q", key, pushEndpointOwnerKeyPrefix)
	}
	if len(strings.TrimPrefix(key, pushEndpointOwnerKeyPrefix)) != 64 {
		t.Fatalf("owner key should use the full SHA-256 hash, got %q", key)
	}
	if key != pushEndpointOwnerKey(endpoint) {
		t.Fatal("owner key should be stable for the same endpoint")
	}
	if key == pushEndpointOwnerKey(endpoint+"-other") {
		t.Fatal("different endpoints should have different owner keys")
	}
}

func TestExtractUserIDFromPushKey(t *testing.T) {
	tests := []struct {
		name     string
		key      string
		expected string
	}{
		{
			name:     "valid key",
			key:      "push_subscription.user-123.abc123",
			expected: "user-123",
		},
		{
			name:     "empty key",
			key:      "",
			expected: "",
		},
		{
			name:     "wrong prefix",
			key:      "other_key.user-123.abc",
			expected: "",
		},
		{
			name:     "too few parts",
			key:      "push_subscription.user-123",
			expected: "",
		},
		{
			name:     "too many parts",
			key:      "push_subscription.user-123.abc.extra",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractUserIDFromPushKey(tt.key)
			if got != tt.expected {
				t.Errorf("extractUserIDFromPushKey(%s) = %s, want %s", tt.key, got, tt.expected)
			}
		})
	}
}

func TestSavePushSubscription(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "push-user-1"
	endpoint := "https://push.example.com/endpoint123"
	p256dh := testPushP256DH
	auth := testPushAuth(1)
	userAgent := "TestBrowser/1.0"

	t.Run("creates new subscription", func(t *testing.T) {
		sub, err := core.SavePushSubscription(ctx, userID, endpoint, p256dh, auth, userAgent)
		if err != nil {
			t.Fatalf("SavePushSubscription error: %v", err)
		}
		if sub == nil {
			t.Fatal("Expected subscription to be non-nil")
		}
		if sub.Endpoint != endpoint {
			t.Errorf("Expected endpoint %s, got %s", endpoint, sub.Endpoint)
		}
		if sub.P256Dh != p256dh {
			t.Errorf("Expected p256dh %s, got %s", p256dh, sub.P256Dh)
		}
		if sub.Auth != auth {
			t.Errorf("Expected auth %s, got %s", auth, sub.Auth)
		}
		if sub.UserAgent != userAgent {
			t.Errorf("Expected userAgent %s, got %s", userAgent, sub.UserAgent)
		}
		if sub.Locale != "en" {
			t.Errorf("Expected default locale en, got %s", sub.Locale)
		}
		if sub.CreatedAt == nil {
			t.Error("Expected CreatedAt to be set")
		}

		key := pushSubscriptionKey(userID, endpoint)
		if _, err := core.storage.runtimeStateKV.Get(ctx, key); err != nil {
			t.Fatalf("expected push subscription in RUNTIME_STATE: %v", err)
		}
	})

	t.Run("updates existing subscription with same endpoint", func(t *testing.T) {
		newAuth := testPushAuth(2)
		sub, err := core.SavePushSubscription(ctx, userID, endpoint, p256dh, newAuth, userAgent)
		if err != nil {
			t.Fatalf("SavePushSubscription error: %v", err)
		}
		if sub.Auth != newAuth {
			t.Errorf("Expected auth %s, got %s", newAuth, sub.Auth)
		}

		// Should still only have one subscription
		subs, _ := core.GetUserPushSubscriptions(ctx, userID)
		if len(subs) != 1 {
			t.Errorf("Expected 1 subscription after update, got %d", len(subs))
		}
	})

	t.Run("stores a supported device locale and normalizes unsupported values", func(t *testing.T) {
		localized, err := core.SavePushSubscriptionWithLocale(
			ctx,
			userID,
			"https://push.example.com/localized",
			p256dh,
			auth,
			userAgent,
			"FR",
		)
		if err != nil {
			t.Fatalf("SavePushSubscriptionWithLocale error: %v", err)
		}
		if localized.Locale != "fr" {
			t.Fatalf("localized subscription locale = %q, want fr", localized.Locale)
		}

		fallback, err := core.SavePushSubscriptionWithLocale(
			ctx,
			userID,
			"https://push.example.com/unsupported-locale",
			p256dh,
			auth,
			userAgent,
			"it",
		)
		if err != nil {
			t.Fatalf("SavePushSubscriptionWithLocale fallback error: %v", err)
		}
		if fallback.Locale != "en" {
			t.Fatalf("unsupported locale = %q, want en", fallback.Locale)
		}
	})

	t.Run("stores client metadata", func(t *testing.T) {
		sub, err := core.SavePushSubscriptionWithMetadata(
			ctx,
			userID,
			"https://push.example.com/with-client",
			p256dh,
			auth,
			userAgent,
			"fr",
			"browser-client-1",
			"https://app.example.com",
		)
		if err != nil {
			t.Fatalf("SavePushSubscriptionWithMetadata error: %v", err)
		}
		if sub.ClientId != "browser-client-1" {
			t.Fatalf("ClientId = %q, want browser-client-1", sub.ClientId)
		}
		if sub.ApplicationOrigin != "https://app.example.com" {
			t.Fatalf("ApplicationOrigin = %q, want https://app.example.com", sub.ApplicationOrigin)
		}
	})
}

func TestDismissNotificationFromPushSubscription(t *testing.T) {
	core, nc := setupTestCore(t)
	ctx := context.Background()
	userID := "push-dismiss-user"
	endpoint := "https://push.example.com/dismiss"
	auth := testPushAuth(1)
	rotatedAuth := testPushAuth(2)

	if _, err := core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, auth, "browser"); err != nil {
		t.Fatalf("SavePushSubscription: %v", err)
	}

	liveSubject := subjects.LiveSyncUserEvent(userID, "notification_dismissed")
	liveSub, err := nc.SubscribeSync(liveSubject)
	if err != nil {
		t.Fatalf("SubscribeSync(%s): %v", liveSubject, err)
	}
	defer liveSub.Unsubscribe()
	if err := nc.Flush(); err != nil {
		t.Fatalf("Flush subscription: %v", err)
	}

	notification, err := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
		Notification: &corev1.Notification_DmMessage{
			DmMessage: &corev1.DMMessageNotification{RoomId: "dm-room", EventId: "event-1"},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification: %v", err)
	}

	dismissed, err := core.DismissNotificationFromPushSubscription(ctx, endpoint, testPushAuth(9), notification.Id)
	if err != nil {
		t.Fatalf("DismissNotificationFromPushSubscription wrong auth: %v", err)
	}
	if dismissed {
		t.Fatal("wrong push auth dismissed the notification")
	}
	stillPending, err := core.GetNotification(ctx, userID, notification.Id)
	if err != nil {
		t.Fatalf("GetNotification after wrong auth: %v", err)
	}
	if stillPending == nil {
		t.Fatal("notification disappeared after wrong push auth")
	}

	dismissed, err = core.DismissNotificationFromPushSubscription(ctx, endpoint, auth, notification.Id)
	if err != nil {
		t.Fatalf("DismissNotificationFromPushSubscription: %v", err)
	}
	if !dismissed {
		t.Fatal("valid push subscription proof did not dismiss the notification")
	}
	gone, err := core.GetNotification(ctx, userID, notification.Id)
	if err != nil {
		t.Fatalf("GetNotification after dismiss: %v", err)
	}
	if gone != nil {
		t.Fatal("notification still pending after valid push subscription dismissal")
	}
	if _, err := liveSub.NextMsg(2 * time.Second); err != nil {
		t.Fatalf("waiting for notification_dismissed live event: %v", err)
	}
	dismissed, err = core.DismissNotificationFromPushSubscription(ctx, endpoint, auth, notification.Id)
	if err != nil {
		t.Fatalf("DismissNotificationFromPushSubscription repeated close: %v", err)
	}
	if !dismissed {
		t.Fatal("valid repeated push subscription dismissal was not accepted as idempotent")
	}

	if _, err := core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, rotatedAuth, "browser"); err != nil {
		t.Fatalf("Rotate SavePushSubscription: %v", err)
	}
	rotatedNotification, err := core.CreateNotification(ctx, userID, "actor", &corev1.Notification{
		Notification: &corev1.Notification_DmMessage{
			DmMessage: &corev1.DMMessageNotification{RoomId: "dm-room", EventId: "event-2"},
		},
	})
	if err != nil {
		t.Fatalf("CreateNotification after rotation: %v", err)
	}
	dismissed, err = core.DismissNotificationFromPushSubscription(ctx, endpoint, auth, rotatedNotification.Id)
	if err != nil {
		t.Fatalf("DismissNotificationFromPushSubscription stale auth: %v", err)
	}
	if dismissed {
		t.Fatal("stale push auth dismissed after subscription rotation")
	}
	dismissed, err = core.DismissNotificationFromPushSubscription(ctx, endpoint, rotatedAuth, rotatedNotification.Id)
	if err != nil {
		t.Fatalf("DismissNotificationFromPushSubscription rotated auth: %v", err)
	}
	if !dismissed {
		t.Fatal("current rotated push auth did not dismiss the notification")
	}
}

func TestSavePushSubscriptionSupersedesOlderEndpointForSameClientID(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "push-user-supersede"
	_, err := core.SavePushSubscriptionWithMetadata(
		ctx,
		userID,
		"https://push.example.com/old",
		testPushP256DH,
		testPushAuth(1),
		"Browser/1",
		"fr",
		"same-installation",
		"https://app.example.com",
	)
	if err != nil {
		t.Fatalf("Save old subscription: %v", err)
	}
	_, err = core.SavePushSubscriptionWithMetadata(
		ctx,
		userID,
		"https://push.example.com/other-client",
		testPushP256DH,
		testPushAuth(2),
		"Browser/1",
		"fr",
		"other-installation",
		"https://app.example.com",
	)
	if err != nil {
		t.Fatalf("Save other-client subscription: %v", err)
	}
	_, err = core.SavePushSubscriptionWithLocale(
		ctx,
		userID,
		"https://push.example.com/legacy",
		testPushP256DH,
		testPushAuth(3),
		"Browser/1",
		"fr",
	)
	if err != nil {
		t.Fatalf("Save legacy subscription: %v", err)
	}

	newer, err := core.SavePushSubscriptionWithMetadata(
		ctx,
		userID,
		"https://push.example.com/new",
		testPushP256DH,
		testPushAuth(4),
		"Browser/1",
		"fr",
		"same-installation",
		"https://app.example.com",
	)
	if err != nil {
		t.Fatalf("Save new subscription: %v", err)
	}

	subscriptions, err := core.GetUserPushSubscriptions(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserPushSubscriptions: %v", err)
	}
	seen := map[string]*corev1.PushSubscription{}
	for _, subscription := range subscriptions {
		seen[subscription.Endpoint] = subscription
	}
	if _, ok := seen["https://push.example.com/old"]; ok {
		t.Fatalf("old endpoint was not superseded: %+v", subscriptions)
	}
	if seen[newer.Endpoint] == nil || seen["https://push.example.com/other-client"] == nil || seen["https://push.example.com/legacy"] == nil {
		t.Fatalf("subscriptions after supersede = %+v, want new, other-client and legacy", subscriptions)
	}
}

func TestSavePushSubscriptionRejectsUnsafeClientMetadata(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	tests := []struct {
		name              string
		clientID          string
		applicationOrigin string
	}{
		{
			name:     "client ID path separator",
			clientID: "bad/client",
		},
		{
			name:     "client ID too long",
			clientID: strings.Repeat("c", MaxPushClientIDLength+1),
		},
		{
			name:              "application origin with path",
			clientID:          "client",
			applicationOrigin: "https://app.example.com/path",
		},
		{
			name:              "application origin with credentials",
			clientID:          "client",
			applicationOrigin: "https://user@app.example.com",
		},
		{
			name:              "application origin too long",
			clientID:          "client",
			applicationOrigin: "https://" + strings.Repeat("a", MaxPushApplicationOriginLength),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			endpointSuffix := strings.NewReplacer(" ", "-", "/", "-").Replace(tt.name)
			_, err := core.SavePushSubscriptionWithMetadata(
				ctx,
				"push-user-invalid-metadata",
				"https://push.example.com/"+endpointSuffix,
				testPushP256DH,
				testPushAuth(1),
				"Browser/1",
				"fr",
				tt.clientID,
				tt.applicationOrigin,
			)
			if !errors.Is(err, ErrInvalidArgument) {
				t.Fatalf("SavePushSubscriptionWithMetadata error = %v, want ErrInvalidArgument", err)
			}
		})
	}
}

func TestSavePushSubscription_StringLengthLimits(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()
	userID := "push-user-limits"

	t.Run("accepts maximum endpoint and user agent with valid credentials", func(t *testing.T) {
		endpointPrefix := "https://push.example.com/"
		_, err := core.SavePushSubscription(
			ctx,
			userID,
			endpointPrefix+strings.Repeat("e", MaxPushEndpointLength-len(endpointPrefix)),
			testPushP256DH,
			testPushAuth(1),
			strings.Repeat("u", MaxPushUserAgentLength),
		)
		if err != nil {
			t.Fatalf("SavePushSubscription at max lengths: %v", err)
		}
	})

	tests := []struct {
		name      string
		endpoint  string
		p256dh    string
		auth      string
		userAgent string
		field     string
		max       int
	}{
		{
			name:     "endpoint",
			endpoint: strings.Repeat("e", MaxPushEndpointLength+1),
			p256dh:   testPushP256DH,
			auth:     testPushAuth(1),
			field:    "push endpoint",
			max:      MaxPushEndpointLength,
		},
		{
			name:     "p256dh",
			endpoint: "https://push.example.com/limits-p256dh",
			p256dh:   strings.Repeat("p", MaxPushKeyLength+1),
			auth:     testPushAuth(1),
			field:    "push p256dh key",
			max:      MaxPushKeyLength,
		},
		{
			name:     "auth",
			endpoint: "https://push.example.com/limits-auth",
			p256dh:   testPushP256DH,
			auth:     strings.Repeat("a", MaxPushAuthLength+1),
			field:    "push auth secret",
			max:      MaxPushAuthLength,
		},
		{
			name:      "user agent",
			endpoint:  "https://push.example.com/limits-user-agent",
			p256dh:    testPushP256DH,
			auth:      testPushAuth(1),
			userAgent: strings.Repeat("u", MaxPushUserAgentLength+1),
			field:     "push user agent",
			max:       MaxPushUserAgentLength,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := core.SavePushSubscription(ctx, userID, tt.endpoint, tt.p256dh, tt.auth, tt.userAgent)
			assertStringLengthError(t, err, tt.field, tt.max)
		})
	}
}

func TestSavePushSubscription_RejectsUnsafeOrIncompleteEndpoints(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	tests := []struct {
		name     string
		endpoint string
		p256dh   string
		auth     string
	}{
		{name: "empty endpoint", p256dh: testPushP256DH, auth: testPushAuth(1)},
		{name: "empty key", endpoint: "https://push.example.com/sub", auth: testPushAuth(1)},
		{name: "empty auth", endpoint: "https://push.example.com/sub", p256dh: testPushP256DH},
		{name: "malformed key", endpoint: "https://push.example.com/sub", p256dh: "not+base64url", auth: testPushAuth(1)},
		{name: "short key", endpoint: "https://push.example.com/sub", p256dh: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), auth: testPushAuth(1)},
		{name: "off-curve key", endpoint: "https://push.example.com/sub", p256dh: base64.RawURLEncoding.EncodeToString(make([]byte, 65)), auth: testPushAuth(1)},
		{name: "malformed auth", endpoint: "https://push.example.com/sub", p256dh: testPushP256DH, auth: "not+base64url"},
		{name: "short auth", endpoint: "https://push.example.com/sub", p256dh: testPushP256DH, auth: base64.RawURLEncoding.EncodeToString(make([]byte, 8))},
		{name: "relative endpoint", endpoint: "/push/sub", p256dh: testPushP256DH, auth: testPushAuth(1)},
		{name: "plain HTTP", endpoint: "http://push.example.com/sub", p256dh: testPushP256DH, auth: testPushAuth(1)},
		{name: "credentials", endpoint: "https://user@push.example.com/sub", p256dh: testPushP256DH, auth: testPushAuth(1)},
		{name: "fragment", endpoint: "https://push.example.com/sub#fragment", p256dh: testPushP256DH, auth: testPushAuth(1)},
		{name: "IPv4 loopback", endpoint: "https://127.0.0.1/sub", p256dh: testPushP256DH, auth: testPushAuth(1)},
		{name: "IPv4 private", endpoint: "https://10.0.0.1/sub", p256dh: testPushP256DH, auth: testPushAuth(1)},
		{name: "IPv6 loopback", endpoint: "https://[::1]/sub", p256dh: testPushP256DH, auth: testPushAuth(1)},
		{name: "IPv6 private", endpoint: "https://[fd00::1]/sub", p256dh: testPushP256DH, auth: testPushAuth(1)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := core.SavePushSubscription(ctx, "push-unsafe-user", tt.endpoint, tt.p256dh, tt.auth, "browser"); !errors.Is(err, ErrInvalidArgument) {
				t.Fatalf("SavePushSubscription() error = %v, want ErrInvalidArgument", err)
			}
		})
	}
}

func TestGetAllPushSubscriptions(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	_, err := core.SavePushSubscription(ctx, "push-user-all-a", "https://push.example.com/all-a", testPushP256DH, testPushAuth(1), "browser-a")
	if err != nil {
		t.Fatalf("SavePushSubscription user A error: %v", err)
	}
	_, err = core.SavePushSubscription(ctx, "push-user-all-b", "https://push.example.com/all-b", testPushP256DH, testPushAuth(1), "browser-b")
	if err != nil {
		t.Fatalf("SavePushSubscription user B error: %v", err)
	}

	subs, err := core.GetAllPushSubscriptions(ctx)
	if err != nil {
		t.Fatalf("GetAllPushSubscriptions error: %v", err)
	}

	seen := map[string]bool{}
	for _, sub := range subs {
		seen[sub.UserID] = true
	}
	if !seen["push-user-all-a"] || !seen["push-user-all-b"] {
		t.Fatalf("GetAllPushSubscriptions missing users; got %#v", seen)
	}
}

func TestGetUserPushSubscriptions(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "push-user-2"

	t.Run("returns empty list when no subscriptions", func(t *testing.T) {
		subs, err := core.GetUserPushSubscriptions(ctx, userID)
		if err != nil {
			t.Fatalf("GetUserPushSubscriptions error: %v", err)
		}
		if len(subs) != 0 {
			t.Errorf("Expected 0 subscriptions, got %d", len(subs))
		}
	})

	t.Run("returns multiple subscriptions for same user", func(t *testing.T) {
		// Create subscriptions for different devices
		endpoints := []string{
			"https://push.example.com/device1",
			"https://push.example.com/device2",
			"https://push.example.com/device3",
		}

		for _, endpoint := range endpoints {
			_, err := core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, testPushAuth(1), "browser")
			if err != nil {
				t.Fatalf("SavePushSubscription error: %v", err)
			}
		}

		subs, err := core.GetUserPushSubscriptions(ctx, userID)
		if err != nil {
			t.Fatalf("GetUserPushSubscriptions error: %v", err)
		}
		if len(subs) != 3 {
			t.Errorf("Expected 3 subscriptions, got %d", len(subs))
		}
	})
}

func TestPushSubscriptionEndpointOwnershipTransfer(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()
	endpoint := "https://push.example.com/shared-browser"
	userA := "push-owner-a"
	userB := "push-owner-b"

	if _, err := core.SavePushSubscription(ctx, userA, endpoint, testPushP256DH, testPushAuth(1), "browser"); err != nil {
		t.Fatalf("SavePushSubscription user A: %v", err)
	}
	staleSubscriptions, err := core.GetUserPushSubscriptions(ctx, userA)
	if err != nil || len(staleSubscriptions) != 1 {
		t.Fatalf("expected user A to initially own subscription, got %d, %v", len(staleSubscriptions), err)
	}

	if _, err := core.SavePushSubscription(ctx, userB, endpoint, testPushP256DH, testPushAuth(2), "browser"); err != nil {
		t.Fatalf("SavePushSubscription user B: %v", err)
	}

	ownedByA, err := core.PushSubscriptionOwnedByUser(ctx, userA, staleSubscriptions[0].Endpoint)
	if err != nil {
		t.Fatalf("PushSubscriptionOwnedByUser user A: %v", err)
	}
	ownedByB, err := core.PushSubscriptionOwnedByUser(ctx, userB, endpoint)
	if err != nil {
		t.Fatalf("PushSubscriptionOwnedByUser user B: %v", err)
	}
	if ownedByA || !ownedByB {
		t.Fatalf("expected ownership to transfer from A to B, got ownedByA=%t ownedByB=%t", ownedByA, ownedByB)
	}

	userASubscriptions, err := core.GetUserPushSubscriptions(ctx, userA)
	if err != nil {
		t.Fatalf("GetUserPushSubscriptions user A: %v", err)
	}
	userBSubscriptions, err := core.GetUserPushSubscriptions(ctx, userB)
	if err != nil {
		t.Fatalf("GetUserPushSubscriptions user B: %v", err)
	}
	if len(userASubscriptions) != 0 || len(userBSubscriptions) != 1 {
		t.Fatalf("expected only B's subscription to be active, got A=%d B=%d", len(userASubscriptions), len(userBSubscriptions))
	}

	// A stale client must not release the endpoint after B has claimed it.
	if err := core.DeletePushSubscription(ctx, userA, endpoint); err != nil {
		t.Fatalf("DeletePushSubscription stale user A: %v", err)
	}
	ownedByB, err = core.PushSubscriptionOwnedByUser(ctx, userB, endpoint)
	if err != nil || !ownedByB {
		t.Fatalf("stale unsubscribe released B's owner claim: owned=%t err=%v", ownedByB, err)
	}
	userBSubscriptions, err = core.GetUserPushSubscriptions(ctx, userB)
	if err != nil || len(userBSubscriptions) != 1 {
		t.Fatalf("stale unsubscribe removed B's subscription: count=%d err=%v", len(userBSubscriptions), err)
	}
}

func TestPushSubscriptionCurrentForUserRejectsRotatedCredentials(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()
	userID := "push-rotation-user"
	endpoint := "https://push.example.com/rotated-credentials"

	if _, err := core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, testPushAuth(1), "browser"); err != nil {
		t.Fatalf("SavePushSubscription old credentials: %v", err)
	}
	stale, err := core.GetUserPushSubscriptions(ctx, userID)
	if err != nil || len(stale) != 1 {
		t.Fatalf("GetUserPushSubscriptions old credentials: count=%d err=%v", len(stale), err)
	}
	if _, err := core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, testPushAuth(2), "browser"); err != nil {
		t.Fatalf("SavePushSubscription new credentials: %v", err)
	}

	current, err := core.PushSubscriptionCurrentForUser(ctx, userID, stale[0])
	if err != nil {
		t.Fatalf("PushSubscriptionCurrentForUser stale credentials: %v", err)
	}
	if current {
		t.Fatal("rotated push credentials should make a prepared subscription stale")
	}

	fresh, err := core.GetUserPushSubscriptions(ctx, userID)
	if err != nil || len(fresh) != 1 {
		t.Fatalf("GetUserPushSubscriptions new credentials: count=%d err=%v", len(fresh), err)
	}
	current, err = core.PushSubscriptionCurrentForUser(ctx, userID, fresh[0])
	if err != nil || !current {
		t.Fatalf("fresh push credentials should be current: current=%t err=%v", current, err)
	}
}

func TestStaleSubscriptionRevisionCannotReleaseRefreshedOwnership(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()
	userID := "push-refresh-race-user"
	endpoint := "https://push.example.com/refresh-race"

	if _, err := core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, testPushAuth(1), "browser"); err != nil {
		t.Fatalf("SavePushSubscription old credentials: %v", err)
	}
	staleEntry, err := core.storage.runtimeStateKV.Get(ctx, pushSubscriptionKey(userID, endpoint))
	if err != nil {
		t.Fatalf("get stale subscription entry: %v", err)
	}

	if _, err := core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, testPushAuth(2), "browser"); err != nil {
		t.Fatalf("SavePushSubscription new credentials: %v", err)
	}
	if err := core.releasePushEndpointOwnership(ctx, userID, endpoint, staleEntry.Revision()); err != nil {
		t.Fatalf("releasePushEndpointOwnership stale revision: %v", err)
	}

	owned, err := core.PushSubscriptionOwnedByUser(ctx, userID, endpoint)
	if err != nil || !owned {
		t.Fatalf("stale revision released refreshed ownership: owned=%t err=%v", owned, err)
	}
	subscriptions, err := core.GetUserPushSubscriptions(ctx, userID)
	if err != nil || len(subscriptions) != 1 || subscriptions[0].Auth != testPushAuth(2) {
		t.Fatalf("refreshed subscription is not active: subscriptions=%v err=%v", subscriptions, err)
	}
}

func TestGetUserPushSubscriptionsSkipsUnclaimedLegacyRecord(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()
	userID := "push-legacy-user"
	endpoint := "https://push.example.com/legacy-unclaimed"
	data, err := proto.Marshal(&corev1.PushSubscription{Endpoint: endpoint, P256Dh: "key", Auth: "auth"})
	if err != nil {
		t.Fatalf("marshal legacy subscription: %v", err)
	}
	if _, err := core.storage.runtimeStateKV.Put(ctx, pushSubscriptionKey(userID, endpoint), data); err != nil {
		t.Fatalf("store legacy subscription: %v", err)
	}

	subscriptions, err := core.GetUserPushSubscriptions(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserPushSubscriptions: %v", err)
	}
	if len(subscriptions) != 0 {
		t.Fatalf("unclaimed legacy subscription should be inactive, got %d", len(subscriptions))
	}
}

func TestConcurrentPushEndpointOwnershipClaimsHaveOneWinner(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()
	endpoint := "https://push.example.com/concurrent-owner"
	users := []string{"push-concurrent-a", "push-concurrent-b"}
	start := make(chan struct{})
	errs := make(chan error, len(users))
	var wg sync.WaitGroup

	for _, userID := range users {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, testPushAuth(1), "browser")
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent SavePushSubscription: %v", err)
		}
	}

	active := 0
	owners := 0
	for _, userID := range users {
		subscriptions, err := core.GetUserPushSubscriptions(ctx, userID)
		if err != nil {
			t.Fatalf("GetUserPushSubscriptions %s: %v", userID, err)
		}
		active += len(subscriptions)
		owned, err := core.PushSubscriptionOwnedByUser(ctx, userID, endpoint)
		if err != nil {
			t.Fatalf("PushSubscriptionOwnedByUser %s: %v", userID, err)
		}
		if owned {
			owners++
		}
	}
	if active != 1 || owners != 1 {
		t.Fatalf("expected one active subscription owner, got active=%d owners=%d", active, owners)
	}
}

func TestConcurrentSameUserPushSavesKeepLatestRecordActive(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()
	userID := "push-concurrent-same-user"
	endpoint := "https://push.example.com/concurrent-same-user"
	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup

	for _, auth := range []string{testPushAuth(1), testPushAuth(2)} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, auth, "browser")
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent SavePushSubscription: %v", err)
		}
	}

	subscriptions, err := core.GetUserPushSubscriptions(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserPushSubscriptions: %v", err)
	}
	if len(subscriptions) != 1 {
		t.Fatalf("latest same-user record should remain active, got %d", len(subscriptions))
	}
	current, err := core.PushSubscriptionCurrentForUser(ctx, userID, subscriptions[0])
	if err != nil || !current {
		t.Fatalf("latest same-user record should be current: current=%t err=%v", current, err)
	}
}

func TestDeletePushSubscription(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "push-user-3"
	endpoint := "https://push.example.com/to-delete"

	t.Run("returns nil error when deleting non-existent subscription", func(t *testing.T) {
		err := core.DeletePushSubscription(ctx, userID, "non-existent-endpoint")
		if err != nil {
			t.Errorf("Expected no error, got: %v", err)
		}
	})

	t.Run("deletes existing subscription", func(t *testing.T) {
		// Create subscription
		_, err := core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, testPushAuth(1), "browser")
		if err != nil {
			t.Fatalf("SavePushSubscription error: %v", err)
		}

		// Verify it exists
		subs, _ := core.GetUserPushSubscriptions(ctx, userID)
		initialCount := len(subs)

		// Delete it
		err = core.DeletePushSubscription(ctx, userID, endpoint)
		if err != nil {
			t.Fatalf("DeletePushSubscription error: %v", err)
		}

		// Verify it's gone
		subs, _ = core.GetUserPushSubscriptions(ctx, userID)
		if len(subs) != initialCount-1 {
			t.Errorf("Expected %d subscriptions after delete, got %d", initialCount-1, len(subs))
		}
		owned, err := core.PushSubscriptionOwnedByUser(ctx, userID, endpoint)
		if err != nil {
			t.Fatalf("PushSubscriptionOwnedByUser after delete: %v", err)
		}
		if owned {
			t.Error("deleting the current subscription should release endpoint ownership")
		}
	})
}

func TestDeleteAllUserPushSubscriptions(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userID := "push-user-4"

	t.Run("returns 0 when no subscriptions", func(t *testing.T) {
		count, err := core.DeleteAllUserPushSubscriptions(ctx, userID)
		if err != nil {
			t.Fatalf("DeleteAllUserPushSubscriptions error: %v", err)
		}
		if count != 0 {
			t.Errorf("Expected 0, got %d", count)
		}
	})

	t.Run("deletes all subscriptions for user", func(t *testing.T) {
		// Create multiple subscriptions
		for i := 0; i < 3; i++ {
			endpoint := "https://push.example.com/device" + string(rune('a'+i))
			_, _ = core.SavePushSubscription(ctx, userID, endpoint, testPushP256DH, testPushAuth(1), "browser")
		}

		count, err := core.DeleteAllUserPushSubscriptions(ctx, userID)
		if err != nil {
			t.Fatalf("DeleteAllUserPushSubscriptions error: %v", err)
		}
		if count != 3 {
			t.Errorf("Expected 3 deleted, got %d", count)
		}

		// Verify all are gone
		subs, _ := core.GetUserPushSubscriptions(ctx, userID)
		if len(subs) != 0 {
			t.Errorf("Expected 0 remaining, got %d", len(subs))
		}
		for i := 0; i < 3; i++ {
			endpoint := "https://push.example.com/device" + string(rune('a'+i))
			owned, err := core.PushSubscriptionOwnedByUser(ctx, userID, endpoint)
			if err != nil {
				t.Fatalf("PushSubscriptionOwnedByUser after delete all: %v", err)
			}
			if owned {
				t.Errorf("DeleteAllUserPushSubscriptions left owner for %s", endpoint)
			}
		}
	})
}

func TestPushSubscriptionIsolation(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := context.Background()

	userA := "push-user-a"
	userB := "push-user-b"

	t.Run("user cannot see other user's subscriptions", func(t *testing.T) {
		// Create subscription for userA
		_, _ = core.SavePushSubscription(ctx, userA, "https://push.example.com/a", testPushP256DH, testPushAuth(1), "browser")

		// userB should not see userA's subscription
		userBSubs, _ := core.GetUserPushSubscriptions(ctx, userB)
		if len(userBSubs) != 0 {
			t.Error("userB should not see userA's subscriptions")
		}

		// userA should see their subscription
		userASubs, _ := core.GetUserPushSubscriptions(ctx, userA)
		if len(userASubs) != 1 {
			t.Errorf("userA should have 1 subscription, got %d", len(userASubs))
		}
	})

	t.Run("deleting does not affect other user's subscriptions", func(t *testing.T) {
		// Clear and set up fresh
		core.DeleteAllUserPushSubscriptions(ctx, userA)
		core.DeleteAllUserPushSubscriptions(ctx, userB)

		// Create subscriptions for both users
		_, _ = core.SavePushSubscription(ctx, userA, "https://push.example.com/a2", testPushP256DH, testPushAuth(1), "browser")
		_, _ = core.SavePushSubscription(ctx, userB, "https://push.example.com/b2", testPushP256DH, testPushAuth(1), "browser")

		// Delete userA's subscriptions
		core.DeleteAllUserPushSubscriptions(ctx, userA)

		// userB should still have their subscription
		userBSubs, _ := core.GetUserPushSubscriptions(ctx, userB)
		if len(userBSubs) != 1 {
			t.Errorf("userB should still have 1 subscription after userA deletes, got %d", len(userBSubs))
		}
	})
}
