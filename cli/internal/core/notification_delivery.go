package core

import (
	"context"
	"strings"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

// NotificationMessageSnapshot is the transient message content passed from a
// successful post to its asynchronous notification callback. It deliberately
// lives only in the request context: notification records remain content-free
// in the 90-day runtime-state store.
type NotificationMessageSnapshot struct {
	Body                string
	AttachmentFilenames []string
	AttachmentCount     int
	IsVoiceMessage      bool
}

type notificationMessageSnapshotContextKey struct{}

type notificationMessageSnapshotContextValue struct {
	eventID  string
	snapshot NotificationMessageSnapshot
}

func withNotificationMessageSnapshot(
	ctx context.Context,
	eventID, body string,
	attachments []*corev1.Attachment,
) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	snapshot := NotificationMessageSnapshot{
		Body:                body,
		AttachmentFilenames: make([]string, 0, len(attachments)),
		AttachmentCount:     len(attachments),
	}
	for _, attachment := range attachments {
		if attachment == nil {
			continue
		}
		if filename := strings.TrimSpace(attachment.GetFilename()); filename != "" {
			snapshot.AttachmentFilenames = append(snapshot.AttachmentFilenames, filename)
		}
		if attachment.GetVoiceMessage() != nil {
			snapshot.IsVoiceMessage = true
		}
	}
	return context.WithValue(ctx, notificationMessageSnapshotContextKey{}, notificationMessageSnapshotContextValue{
		eventID:  eventID,
		snapshot: snapshot,
	})
}

// NotificationMessageSnapshotFromContext returns content only when it belongs
// to the exact event referenced by the notification. This prevents a nested or
// reused context from attaching one message's preview to another message.
func NotificationMessageSnapshotFromContext(ctx context.Context, eventID string) (NotificationMessageSnapshot, bool) {
	if ctx == nil || eventID == "" {
		return NotificationMessageSnapshot{}, false
	}
	value, ok := ctx.Value(notificationMessageSnapshotContextKey{}).(notificationMessageSnapshotContextValue)
	if !ok || value.eventID != eventID {
		return NotificationMessageSnapshot{}, false
	}
	value.snapshot.AttachmentFilenames = append([]string(nil), value.snapshot.AttachmentFilenames...)
	return value.snapshot, true
}
