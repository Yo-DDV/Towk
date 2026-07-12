package core

import (
	"bytes"
	"testing"

	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/encoding/protojson"
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

	var auditEvent corev1.Event
	if err := protojson.Unmarshal([]byte(entry.PayloadJSON), &auditEvent); err != nil {
		t.Fatalf("PayloadJSON is not valid event JSON: %v", err)
	}
	auditPasswordChange := auditEvent.GetUserPasswordHashChanged()
	if auditPasswordChange == nil || auditPasswordChange.GetUserId() != "user-1" || !auditPasswordChange.GetPreserveExistingCredentials() {
		t.Fatalf("PayloadJSON lost non-secret audit facts: %s", entry.PayloadJSON)
	}
	if len(auditPasswordChange.GetPasswordHash()) != 0 {
		t.Fatalf("PayloadJSON exposes password hash material: %s", entry.PayloadJSON)
	}
	if !bytes.Equal(event.GetUserPasswordHashChanged().GetPasswordHash(), passwordHash) {
		t.Fatalf("durable event password hash was mutated: %q", event.GetUserPasswordHashChanged().GetPasswordHash())
	}
}
