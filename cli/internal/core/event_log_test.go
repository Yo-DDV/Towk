package core

import (
	"bytes"
	"strings"
	"testing"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/proto"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestStreamMsgToEventLogEntryRedactsPasswordHashWithoutMutatingEvent(t *testing.T) {
	passwordHash := []byte("bcrypt-derived-secret")
	event := &corev1.Event{
		Id:      "event-1",
		ActorId: "admin-1",
		Event: &corev1.Event_UserPasswordHashChanged{
			UserPasswordHashChanged: &corev1.UserPasswordHashChangedEvent{
				UserId:                      "user-1",
				PasswordHash:                append([]byte(nil), passwordHash...),
				PreserveExistingCredentials: true,
			},
		},
	}
	data, err := proto.Marshal(event)
	if err != nil {
		t.Fatalf("proto.Marshal: %v", err)
	}

	entry, err := streamMsgToEventLogEntry(&jetstream.RawStreamMsg{
		Subject:  "evt.user.user-1.password_hash_changed",
		Sequence: 42,
		Data:     data,
	})
	if err != nil {
		t.Fatalf("streamMsgToEventLogEntry: %v", err)
	}

	if strings.Contains(entry.PayloadJSON, "passwordHash") || strings.Contains(entry.PayloadJSON, "bcrypt-derived-secret") {
		t.Fatalf("PayloadJSON exposes password hash material: %s", entry.PayloadJSON)
	}
	if !strings.Contains(entry.PayloadJSON, `"userId": "user-1"`) || !strings.Contains(entry.PayloadJSON, `"preserveExistingCredentials": true`) {
		t.Fatalf("PayloadJSON lost non-secret audit facts: %s", entry.PayloadJSON)
	}
	if !bytes.Equal(event.GetUserPasswordHashChanged().GetPasswordHash(), passwordHash) {
		t.Fatalf("durable event password hash was mutated: %q", event.GetUserPasswordHashChanged().GetPasswordHash())
	}
}
