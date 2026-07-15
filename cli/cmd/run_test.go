package cmd

import (
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"google.golang.org/protobuf/types/known/timestamppb"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/push"
	"hmans.de/chatto/internal/runtimeunit"
	"hmans.de/chatto/internal/testutil"
)

func TestSetupPushNotificationsDoesNotRegisterSilentDismissPushes(t *testing.T) {
	chattoCore := &core.ChattoCore{}
	setupPushNotifications(chattoCore, config.ChattoConfig{Push: config.PushConfig{
		Enabled:         true,
		VAPIDPublicKey:  "public-key",
		VAPIDPrivateKey: "private-key",
		VAPIDSubject:    "mailto:admin@example.com",
	}})

	if chattoCore.OnNotificationCreated == nil {
		t.Fatal("notification creation callback was not registered")
	}
	if chattoCore.OnNotificationDismissed != nil {
		t.Fatal("single dismissal registered a data-only Web Push callback")
	}
	if chattoCore.OnNotificationsDismissed != nil {
		t.Fatal("bulk dismissal registered a data-only Web Push callback")
	}
}

func TestLocalizedPushBatches(t *testing.T) {
	notification := &corev1.Notification{
		Id:          "notification-1",
		RecipientId: "user-1",
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: "room-1", EventId: "event-1"},
		},
	}
	subscriptions := []*corev1.PushSubscription{
		{Endpoint: "https://push.example/fr-1", Locale: "fr"},
		{Endpoint: "https://push.example/de", Locale: "de"},
		{Endpoint: "https://push.example/legacy"},
		{Endpoint: "https://push.example/fr-2", Locale: "FR"},
		{Endpoint: "https://push.example/unsupported", Locale: "it"},
	}

	batches := localizedPushBatches(
		subscriptions,
		notification,
		"Alice",
		"https://towk.example",
		&push.PayloadContext{RoomName: "general", MessagePreview: "Hello"},
		"5",
	)

	if len(batches) != 3 {
		t.Fatalf("batch count = %d, want 3", len(batches))
	}
	if got := len(batches[0].subscriptions); got != 2 {
		t.Fatalf("English fallback subscription count = %d, want 2", got)
	}
	if batches[0].payload.Title != "@Alice posted in #general" {
		t.Fatalf("English fallback title = %q", batches[0].payload.Title)
	}
	if batches[0].payload.Lang != "en" || batches[0].payload.Dir != "ltr" {
		t.Fatalf("English fallback metadata = lang=%q dir=%q", batches[0].payload.Lang, batches[0].payload.Dir)
	}
	if batches[1].payload.Title != "@Alice hat in #general geschrieben" {
		t.Fatalf("German title = %q", batches[1].payload.Title)
	}
	if batches[1].payload.Lang != "de" || batches[1].payload.Dir != "ltr" {
		t.Fatalf("German metadata = lang=%q dir=%q", batches[1].payload.Lang, batches[1].payload.Dir)
	}
	if got := len(batches[2].subscriptions); got != 2 {
		t.Fatalf("French subscription count = %d, want 2", got)
	}
	if batches[2].payload.Title != "@Alice a publié un message dans #general" {
		t.Fatalf("French title = %q", batches[2].payload.Title)
	}
	if batches[2].payload.Lang != "fr" || batches[2].payload.Dir != "ltr" {
		t.Fatalf("French metadata = lang=%q dir=%q", batches[2].payload.Lang, batches[2].payload.Dir)
	}
	for _, batch := range batches {
		if batch.payload.AppBadge != "5" {
			t.Fatalf("app badge = %q, want 5", batch.payload.AppBadge)
		}
		if batch.payload.Badge != "https://towk.example/icons/badge-monochrome-96.png" {
			t.Fatalf("notification badge = %q", batch.payload.Badge)
		}
	}
}

func TestDedupePushSubscriptionsByClientIDKeepsNewestInstallationEndpoint(t *testing.T) {
	oldTime := timestamppb.New(time.Unix(100, 0))
	newTime := timestamppb.New(time.Unix(200, 0))
	subscriptions := []*corev1.PushSubscription{
		{Endpoint: "https://push.example/legacy-a"},
		{Endpoint: "https://push.example/device-old", ClientId: "device-1", CreatedAt: oldTime},
		{Endpoint: "https://push.example/other-device", ClientId: "device-2", CreatedAt: oldTime},
		{Endpoint: "https://push.example/device-new", ClientId: "device-1", CreatedAt: newTime},
		{Endpoint: "https://push.example/legacy-b"},
	}

	deduped := dedupePushSubscriptionsByClientID(subscriptions)

	got := make([]string, 0, len(deduped))
	for _, subscription := range deduped {
		got = append(got, subscription.Endpoint)
	}
	want := []string{
		"https://push.example/legacy-a",
		"https://push.example/device-new",
		"https://push.example/other-device",
		"https://push.example/legacy-b",
	}
	if len(got) != len(want) {
		t.Fatalf("deduped endpoints = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("deduped endpoints = %v, want %v", got, want)
		}
	}
}

func TestCanonicalOriginFilteringPrecedesClientIDDedupe(t *testing.T) {
	oldTime := timestamppb.New(time.Unix(100, 0))
	newTime := timestamppb.New(time.Unix(200, 0))
	subscriptions := []*corev1.PushSubscription{
		{
			Endpoint:          "https://push.example/canonical-old",
			ClientId:          "same-browser-installation",
			ApplicationOrigin: "https://towk.example",
			CreatedAt:         oldTime,
		},
		{
			Endpoint:          "https://push.example/alternate-new",
			ClientId:          "same-browser-installation",
			ApplicationOrigin: "https://towk.example:2083",
			CreatedAt:         newTime,
		},
	}

	filtered := push.FilterSubscriptionsByCanonicalOrigin(subscriptions, "https://towk.example")
	deduped := dedupePushSubscriptionsByClientID(filtered)

	if len(deduped) != 1 || deduped[0].Endpoint != "https://push.example/canonical-old" {
		t.Fatalf("delivered subscriptions = %+v, want canonical origin even when alternate endpoint is newer", deduped)
	}
}

func TestEffectiveLogFormat(t *testing.T) {
	tests := []struct {
		name             string
		configuredFormat string
		outputIsTerminal bool
		want             string
	}{
		{name: "auto uses text on terminal", configuredFormat: "auto", outputIsTerminal: true, want: "text"},
		{name: "auto uses json off terminal", configuredFormat: "auto", outputIsTerminal: false, want: "json"},
		{name: "empty defaults to auto text on terminal", configuredFormat: "", outputIsTerminal: true, want: "text"},
		{name: "empty defaults to auto json off terminal", configuredFormat: "", outputIsTerminal: false, want: "json"},
		{name: "explicit text", configuredFormat: "text", outputIsTerminal: false, want: "text"},
		{name: "explicit json", configuredFormat: "json", outputIsTerminal: true, want: "json"},
		{name: "explicit logfmt", configuredFormat: "logfmt", outputIsTerminal: true, want: "logfmt"},
		{name: "case insensitive", configuredFormat: "JSON", outputIsTerminal: false, want: "json"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := effectiveLogFormat(tt.configuredFormat, tt.outputIsTerminal); got != tt.want {
				t.Fatalf("effectiveLogFormat() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestShouldPrintBannerOnlyForTextLogs(t *testing.T) {
	if !shouldPrintBanner("text", false) {
		t.Fatal("expected text logs to print banner")
	}
	if shouldPrintBanner("json", true) {
		t.Fatal("expected json logs to suppress banner")
	}
	if shouldPrintBanner("auto", false) {
		t.Fatal("expected auto logs off terminal to suppress banner")
	}
}

func TestPushNotificationUsesCountBadgeForEveryPersistentNotificationType(t *testing.T) {
	tests := []struct {
		name         string
		notification *corev1.Notification
		want         bool
	}{
		{
			name: "direct message",
			notification: &corev1.Notification{
				Notification: &corev1.Notification_DmMessage{
					DmMessage: &corev1.DMMessageNotification{RoomId: "dm-room", EventId: "event-1"},
				},
			},
			want: true,
		},
		{
			name: "mention",
			notification: &corev1.Notification{
				Notification: &corev1.Notification_Mention{
					Mention: &corev1.MentionNotification{RoomId: "room-1", EventId: "event-1"},
				},
			},
			want: true,
		},
		{
			name: "reply",
			notification: &corev1.Notification{
				Notification: &corev1.Notification_Reply{
					Reply: &corev1.ReplyNotification{RoomId: "room-1", EventId: "event-1"},
				},
			},
			want: true,
		},
		{
			name: "room message",
			notification: &corev1.Notification{
				Notification: &corev1.Notification_RoomMessage{
					RoomMessage: &corev1.RoomMessageNotification{
						RoomId:  "room-1",
						EventId: "event-1",
					},
				},
			},
			want: true,
		},
		{
			name: "call started",
			notification: &corev1.Notification{
				Notification: &corev1.Notification_CallStarted{
					CallStarted: &corev1.CallStartedNotification{
						RoomId: "room-1",
						CallId: "call-1",
					},
				},
			},
			want: true,
		},
		{name: "nil", notification: nil, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := pushNotificationUsesCountBadge(tt.notification); got != tt.want {
				t.Fatalf("pushNotificationUsesCountBadge() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCloseNATSConnectionWaitsForDrainToComplete(t *testing.T) {
	ns, _ := testutil.StartNATS(t)

	nc, err := nats.Connect(
		nats.DefaultURL,
		nats.InProcessServer(ns),
		nats.DrainTimeout(200*time.Millisecond),
	)
	if err != nil {
		t.Fatalf("connect to nats: %v", err)
	}
	t.Cleanup(nc.Close)

	callbackStarted := make(chan struct{})
	unblockCallback := make(chan struct{})

	_, err = nc.Subscribe("drain.wait", func(*nats.Msg) {
		close(callbackStarted)
		<-unblockCallback
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := nc.Flush(); err != nil {
		t.Fatalf("flush subscription: %v", err)
	}
	if err := nc.Publish("drain.wait", []byte("pending")); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case <-callbackStarted:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for subscription callback to start")
	}

	drainReturned := make(chan struct{})
	go func() {
		runtimeunit.CloseNATSConnection(nc)
		close(drainReturned)
	}()

	select {
	case <-drainReturned:
		t.Fatal("closeNATSConnection returned before NATS drain completed")
	case <-time.After(50 * time.Millisecond):
	}

	close(unblockCallback)

	select {
	case <-drainReturned:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for closeNATSConnection to return")
	}
	if !nc.IsClosed() {
		t.Fatal("expected NATS connection to be closed after drain")
	}
}
