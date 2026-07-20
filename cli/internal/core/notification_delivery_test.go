package core

import (
	"context"
	"testing"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestNotificationMessageSnapshotContextIsExactAndDetached(t *testing.T) {
	attachment := &corev1.Attachment{
		Filename:     "voice-note.m4a",
		VoiceMessage: &corev1.VoiceMessageMetadata{DurationMs: 1_000},
	}
	ctx := withNotificationMessageSnapshot(context.Background(), "event-1", "visible body", []*corev1.Attachment{attachment})
	attachment.Filename = "mutated-after-snapshot.txt"

	if _, ok := NotificationMessageSnapshotFromContext(ctx, "event-2"); ok {
		t.Fatal("snapshot matched a different event")
	}
	snapshot, ok := NotificationMessageSnapshotFromContext(ctx, "event-1")
	if !ok {
		t.Fatal("snapshot was not found for the exact event")
	}
	if snapshot.Body != "visible body" {
		t.Fatalf("snapshot body = %q", snapshot.Body)
	}
	if snapshot.AttachmentCount != 1 || len(snapshot.AttachmentFilenames) != 1 || snapshot.AttachmentFilenames[0] != "voice-note.m4a" {
		t.Fatalf("snapshot attachments = count %d, names %#v", snapshot.AttachmentCount, snapshot.AttachmentFilenames)
	}
	if !snapshot.IsVoiceMessage {
		t.Fatal("voice attachment was not preserved")
	}

	snapshot.AttachmentFilenames[0] = "mutated-return.txt"
	again, ok := NotificationMessageSnapshotFromContext(ctx, "event-1")
	if !ok || again.AttachmentFilenames[0] != "voice-note.m4a" {
		t.Fatalf("stored snapshot was mutated through returned slice: %#v", again.AttachmentFilenames)
	}
}
