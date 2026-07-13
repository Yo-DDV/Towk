package cmd

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/charmbracelet/log"
	"github.com/nats-io/nats.go"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/push"
	"hmans.de/chatto/internal/runtimeunit"
	"hmans.de/chatto/internal/testutil"
)

type stalePushDeliveryState struct {
	pending   *corev1.Notification
	getErr    error
	deleted   []string
	deleteErr error
}

func (s *stalePushDeliveryState) GetNotification(context.Context, string, string) (*corev1.Notification, error) {
	return s.pending, s.getErr
}

func (s *stalePushDeliveryState) DeletePushSubscription(_ context.Context, _ string, endpoint string) error {
	s.deleted = append(s.deleted, endpoint)
	return s.deleteErr
}

type stalePushBatchSender struct {
	payloads []*push.Payload
	results  []*push.SendResult
}

func (s *stalePushBatchSender) SendToMany(_ context.Context, _ []*corev1.PushSubscription, payload *push.Payload) []*push.SendResult {
	s.payloads = append(s.payloads, payload)
	return s.results
}

func TestCompensateStalePushDelivery(t *testing.T) {
	notification := &corev1.Notification{
		Id:          "notification-1",
		RecipientId: "user-1",
		Notification: &corev1.Notification_RoomMessage{
			RoomMessage: &corev1.RoomMessageNotification{RoomId: "room-1", EventId: "event-1"},
		},
	}
	subscriptions := []*corev1.PushSubscription{{Endpoint: "https://push.example/sub"}}
	logger := log.New(io.Discard)

	t.Run("keeps a still-pending delivery", func(t *testing.T) {
		state := &stalePushDeliveryState{pending: notification}
		sender := &stalePushBatchSender{}

		compensateStalePushDelivery(context.Background(), state, sender, notification, subscriptions, logger)

		if len(sender.payloads) != 0 {
			t.Fatalf("cleanup payload count = %d, want 0", len(sender.payloads))
		}
	})

	t.Run("dismisses a delivery that became stale", func(t *testing.T) {
		state := &stalePushDeliveryState{}
		sender := &stalePushBatchSender{results: []*push.SendResult{{
			Endpoint: subscriptions[0].Endpoint,
			Gone:     true,
		}}}

		compensateStalePushDelivery(context.Background(), state, sender, notification, subscriptions, logger)

		if len(sender.payloads) != 1 || sender.payloads[0].Action != "dismiss" || sender.payloads[0].Tag != "room-message-event-1" {
			t.Fatalf("cleanup payloads = %+v, want one matching dismiss", sender.payloads)
		}
		if len(state.deleted) != 1 || state.deleted[0] != subscriptions[0].Endpoint {
			t.Fatalf("deleted subscriptions = %v, want endpoint cleanup", state.deleted)
		}
	})

	t.Run("fails closed when pending state cannot be read", func(t *testing.T) {
		state := &stalePushDeliveryState{getErr: errors.New("state unavailable")}
		sender := &stalePushBatchSender{}

		compensateStalePushDelivery(context.Background(), state, sender, notification, subscriptions, logger)

		if len(sender.payloads) != 0 {
			t.Fatalf("cleanup payload count = %d, want 0", len(sender.payloads))
		}
	})
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
