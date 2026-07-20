package cmd

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	"github.com/nats-io/nats.go"
	"google.golang.org/protobuf/types/known/timestamppb"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/push"
	"hmans.de/chatto/internal/runtimeunit"
	"hmans.de/chatto/internal/testutil"
)

func TestPerformanceConfigWithLegacyVideoCap(t *testing.T) {
	tests := []struct {
		name        string
		performance config.PerformanceConfig
		video       config.VideoConfig
		want        int
	}{
		{"legacy cap retained", config.PerformanceConfig{}, config.VideoConfig{MaxConcurrent: 1}, 1},
		{"stricter new cap retained", config.PerformanceConfig{MaxVideoWorkers: 2}, config.VideoConfig{MaxConcurrent: 4}, 2},
		{"stricter legacy cap retained", config.PerformanceConfig{MaxVideoWorkers: 4}, config.VideoConfig{MaxConcurrent: 2}, 2},
		{"oversized legacy cap clamped", config.PerformanceConfig{}, config.VideoConfig{MaxConcurrent: config.MaxPerformanceWorkers + 1}, config.MaxPerformanceWorkers},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := performanceConfigWithLegacyVideoCap(tc.performance, tc.video)
			if got.MaxVideoWorkers != tc.want {
				t.Fatalf("max video workers = %d, want %d", got.MaxVideoWorkers, tc.want)
			}
		})
	}
}

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

func TestContainsVoiceMessage(t *testing.T) {
	if containsVoiceMessage(nil) {
		t.Fatal("empty attachments unexpectedly contain a voice message")
	}
	if containsVoiceMessage([]*corev1.Attachment{{Id: "file"}, nil}) {
		t.Fatal("ordinary attachments unexpectedly contain a voice message")
	}
	if !containsVoiceMessage([]*corev1.Attachment{{
		Id:           "voice",
		VoiceMessage: &corev1.VoiceMessageMetadata{DurationMs: 1_000},
	}}) {
		t.Fatal("voice attachment was not detected")
	}
}

func TestPostedMessagePushContextCarriesExactContentForEveryMessageKind(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	chattoCore, err := core.NewChattoCore(ctx, nc, config.CoreConfig{
		SecretKey: "push-context-test-secret",
		Assets: config.AssetsConfig{
			SigningSecret: "push-context-test-signing-secret",
		},
	})
	if err != nil {
		t.Fatalf("NewChattoCore: %v", err)
	}
	runCtx, stop := context.WithCancel(context.Background())
	runDone := make(chan error, 1)
	go func() { runDone <- chattoCore.Run(runCtx) }()
	t.Cleanup(func() {
		stop()
		select {
		case <-runDone:
		case <-time.After(5 * time.Second):
			t.Error("ChattoCore.Run did not stop")
		}
	})
	if err := chattoCore.WaitForBoot(ctx); err != nil {
		t.Fatalf("WaitForBoot: %v", err)
	}

	author, err := chattoCore.CreateUser(ctx, core.SystemActorID, "push-author", "Push Author", "password123")
	if err != nil {
		t.Fatalf("CreateUser(author): %v", err)
	}
	recipient, err := chattoCore.CreateUser(ctx, core.SystemActorID, "push-recipient", "Push Recipient", "password123")
	if err != nil {
		t.Fatalf("CreateUser(recipient): %v", err)
	}
	room, err := chattoCore.CreateRoom(ctx, author.Id, core.KindChannel, "", "push-context", "")
	if err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if _, err := chattoCore.AddMember(ctx, author.Id, core.KindChannel, room.Id, recipient.Id); err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	if err := chattoCore.SetRoomNotificationLevel(ctx, recipient.Id, room.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES); err != nil {
		t.Fatalf("SetRoomNotificationLevel: %v", err)
	}

	type callbackResult struct {
		notification *corev1.Notification
		payloadCtx   *push.PayloadContext
	}
	contexts := make(chan callbackResult, 1)
	chattoCore.OnNotificationCreated = func(callbackCtx context.Context, notification *corev1.Notification) {
		contexts <- callbackResult{
			notification: notification,
			payloadCtx:   fetchPayloadContext(callbackCtx, chattoCore, notification, log.WithPrefix("push-context-test")),
		}
	}
	assertCallback := func(kind, message string) {
		t.Helper()
		select {
		case result := <-contexts:
			payloadCtx := result.payloadCtx
			if result.notification == nil {
				t.Fatal("notification = nil")
			}
			switch kind {
			case "dm":
				if result.notification.GetDmMessage() == nil {
					t.Fatalf("notification kind = %T, want DM", result.notification.GetNotification())
				}
			case "mention":
				if result.notification.GetMention() == nil {
					t.Fatalf("notification kind = %T, want mention", result.notification.GetNotification())
				}
			case "reply":
				if result.notification.GetReply() == nil {
					t.Fatalf("notification kind = %T, want reply", result.notification.GetNotification())
				}
			case "room_message":
				if result.notification.GetRoomMessage() == nil {
					t.Fatalf("notification kind = %T, want room message", result.notification.GetNotification())
				}
			default:
				t.Fatalf("unsupported expected notification kind %q", kind)
			}
			if payloadCtx == nil {
				t.Fatal("payload context = nil")
			}
			if payloadCtx.MessagePreview != message {
				t.Fatalf("message preview = %q, want %q", payloadCtx.MessagePreview, message)
			}
			if kind != "dm" && payloadCtx.RoomName != room.Name {
				t.Fatalf("room name = %q, want %q", payloadCtx.RoomName, room.Name)
			}
			fallbackCtx := fetchPayloadContext(context.Background(), chattoCore, result.notification, log.WithPrefix("push-context-fallback-test"))
			if fallbackCtx == nil || fallbackCtx.MessagePreview != message {
				t.Fatalf("canonical fallback preview = %#v, want %q", fallbackCtx, message)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("timed out waiting for %s notification callback", kind)
		}
	}

	const roomMessage = "The exact room message must remain visible 🔔"
	if _, err := chattoCore.PostMessage(ctx, core.KindChannel, room.Id, author.Id, roomMessage, nil, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage(room): %v", err)
	}
	assertCallback("room_message", roomMessage)

	if err := chattoCore.SetRoomNotificationLevel(ctx, recipient.Id, room.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_NORMAL); err != nil {
		t.Fatalf("SetRoomNotificationLevel(NORMAL): %v", err)
	}
	const mentionMessage = "@push-recipient The exact mention must remain visible"
	if _, err := chattoCore.PostMessage(ctx, core.KindChannel, room.Id, author.Id, mentionMessage, nil, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage(mention): %v", err)
	}
	assertCallback("mention", mentionMessage)

	root, err := chattoCore.PostMessage(ctx, core.KindChannel, room.Id, recipient.Id, "Reply target", nil, "", "", nil, false)
	if err != nil {
		t.Fatalf("PostMessage(reply target): %v", err)
	}
	if err := chattoCore.SetRoomNotificationLevel(ctx, recipient.Id, room.Id, corev1.NotificationLevel_NOTIFICATION_LEVEL_ALL_MESSAGES); err != nil {
		t.Fatalf("SetRoomNotificationLevel(ALL_MESSAGES for reply): %v", err)
	}
	const replyMessage = "The exact reply must remain visible"
	if _, err := chattoCore.PostMessage(ctx, core.KindChannel, room.Id, author.Id, replyMessage, nil, "", root.Id, nil, false); err != nil {
		t.Fatalf("PostMessage(reply): %v", err)
	}
	assertCallback("reply", replyMessage)

	dm, _, err := chattoCore.FindOrCreateDM(ctx, author.Id, []string{recipient.Id})
	if err != nil {
		t.Fatalf("FindOrCreateDM: %v", err)
	}
	const dmMessage = "The exact direct message must remain visible"
	if _, err := chattoCore.PostMessage(ctx, core.KindDM, dm.Id, author.Id, dmMessage, nil, "", "", nil, false); err != nil {
		t.Fatalf("PostMessage(DM): %v", err)
	}
	assertCallback("dm", dmMessage)
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
		{Endpoint: "https://push.example/es", Locale: "es"},
		{Endpoint: "https://push.example/pt", Locale: "pt"},
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

	if len(batches) != 5 {
		t.Fatalf("batch count = %d, want 5", len(batches))
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
	if batches[3].payload.Title != "@Alice publicó un mensaje en #general" {
		t.Fatalf("Spanish title = %q", batches[3].payload.Title)
	}
	if batches[3].payload.Lang != "es" || batches[3].payload.Dir != "ltr" {
		t.Fatalf("Spanish metadata = lang=%q dir=%q", batches[3].payload.Lang, batches[3].payload.Dir)
	}
	if batches[4].payload.Title != "@Alice publicou uma mensagem em #general" {
		t.Fatalf("Portuguese title = %q", batches[4].payload.Title)
	}
	if batches[4].payload.Lang != "pt" || batches[4].payload.Dir != "ltr" {
		t.Fatalf("Portuguese metadata = lang=%q dir=%q", batches[4].payload.Lang, batches[4].payload.Dir)
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

func TestFilterForegroundPushSubscriptionsSuppressesOnlyTheActiveDevice(t *testing.T) {
	lookupFailure := errors.New("presence lookup unavailable")
	subscriptions := []*corev1.PushSubscription{
		{Endpoint: "https://push.example/active", ClientId: "client-active"},
		{Endpoint: "https://push.example/background", ClientId: "client-background"},
		{Endpoint: "https://push.example/legacy"},
		{Endpoint: "https://push.example/fail-open", ClientId: "client-error"},
	}
	queries := map[string]int{}
	var queriesMu sync.Mutex
	wrongUserID := ""

	filtered := filterForegroundPushSubscriptions(
		context.Background(),
		"user-1",
		subscriptions,
		func(_ context.Context, userID, clientID string) (bool, error) {
			if userID != "user-1" {
				queriesMu.Lock()
				wrongUserID = userID
				queriesMu.Unlock()
			}
			queriesMu.Lock()
			queries[clientID]++
			queriesMu.Unlock()
			switch clientID {
			case "client-active":
				return true, nil
			case "client-error":
				return false, lookupFailure
			default:
				return false, nil
			}
		},
		nil,
	)

	got := make([]string, 0, len(filtered))
	for _, subscription := range filtered {
		got = append(got, subscription.Endpoint)
	}
	want := []string{
		"https://push.example/background",
		"https://push.example/legacy",
		"https://push.example/fail-open",
	}
	if len(got) != len(want) {
		t.Fatalf("filtered endpoints = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("filtered endpoints = %v, want %v", got, want)
		}
	}
	queriesMu.Lock()
	defer queriesMu.Unlock()
	if wrongUserID != "" {
		t.Fatalf("foreground lookup user = %q, want user-1", wrongUserID)
	}
	if queries["client-active"] != 1 || queries["client-background"] != 1 || queries["client-error"] != 1 {
		t.Fatalf("foreground queries = %v, want one per identified device", queries)
	}
	if _, queriedLegacy := queries[""]; queriedLegacy {
		t.Fatalf("legacy subscription without client ID was queried: %v", queries)
	}
}

func TestForegroundFilteringCoversEveryNotificationKindAndKeepsEveryLocaleOnOtherDevices(t *testing.T) {
	notifications := map[string]*corev1.Notification{
		"direct message": {
			RecipientId: "user-1",
			Notification: &corev1.Notification_DmMessage{
				DmMessage: &corev1.DMMessageNotification{RoomId: "dm", EventId: "event"},
			},
		},
		"mention": {
			RecipientId: "user-1",
			Notification: &corev1.Notification_Mention{
				Mention: &corev1.MentionNotification{RoomId: "room", EventId: "event"},
			},
		},
		"reply": {
			RecipientId: "user-1",
			Notification: &corev1.Notification_Reply{
				Reply: &corev1.ReplyNotification{RoomId: "room", EventId: "event"},
			},
		},
		"room message": {
			RecipientId: "user-1",
			Notification: &corev1.Notification_RoomMessage{
				RoomMessage: &corev1.RoomMessageNotification{RoomId: "room", EventId: "event"},
			},
		},
		"call": {
			RecipientId: "user-1",
			Notification: &corev1.Notification_CallStarted{
				CallStarted: &corev1.CallStartedNotification{RoomId: "room", EventId: "event", CallId: "call"},
			},
		},
	}
	subscriptions := []*corev1.PushSubscription{
		{Endpoint: "https://push.example/active", ClientId: "client-active", Locale: "fr"},
		{Endpoint: "https://push.example/en", ClientId: "client-en", Locale: "en"},
		{Endpoint: "https://push.example/de", ClientId: "client-de", Locale: "de"},
		{Endpoint: "https://push.example/fr", ClientId: "client-fr", Locale: "fr"},
		{Endpoint: "https://push.example/es", ClientId: "client-es", Locale: "es"},
		{Endpoint: "https://push.example/pt", ClientId: "client-pt", Locale: "pt"},
	}
	for name, notification := range notifications {
		t.Run(name, func(t *testing.T) {
			filtered := filterForegroundPushSubscriptionsForNotification(
				context.Background(),
				"user-1",
				notification,
				subscriptions,
				func(_ context.Context, _, clientID string) (bool, error) {
					return clientID == "client-active", nil
				},
				nil,
			)
			batches := localizedPushBatches(
				filtered,
				notification,
				"Alice",
				"https://towk.example",
				&push.PayloadContext{RoomName: "general"},
				"5",
			)
			seenLocales := map[string]bool{}
			delivered := 0
			for _, batch := range batches {
				seenLocales[batch.payload.Lang] = true
				delivered += len(batch.subscriptions)
				for _, subscription := range batch.subscriptions {
					if notification.GetCallStarted() == nil && subscription.GetClientId() == "client-active" {
						t.Fatal("foreground client reached a localized delivery batch")
					}
				}
			}
			wantDelivered := 5
			if notification.GetCallStarted() != nil {
				wantDelivered = 6
			}
			if delivered != wantDelivered {
				t.Fatalf("delivered subscriptions = %d, want %d", delivered, wantDelivered)
			}
			for _, locale := range []string{"en", "de", "fr", "es", "pt"} {
				if !seenLocales[locale] {
					t.Fatalf("localized batches = %v, missing %q", seenLocales, locale)
				}
			}
		})
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
