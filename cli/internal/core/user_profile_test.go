package core

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"google.golang.org/protobuf/proto"
	"hmans.de/chatto/internal/events"
)

func TestNormalizeAndValidateUserBiography(t *testing.T) {
	t.Run("normalizes line endings", func(t *testing.T) {
		got, err := NormalizeAndValidateUserBiography("line one\r\nline two\rline three")
		if err != nil {
			t.Fatalf("NormalizeAndValidateUserBiography: %v", err)
		}
		if got != "line one\nline two\nline three" {
			t.Fatalf("normalized biography = %q", got)
		}
	})

	t.Run("accepts exact UTF-8 byte limit", func(t *testing.T) {
		value := strings.Repeat("é", MaxUserBiographyBytes/2)
		if len([]byte(value)) != MaxUserBiographyBytes {
			t.Fatalf("fixture bytes = %d", len([]byte(value)))
		}
		if _, err := NormalizeAndValidateUserBiography(value); err != nil {
			t.Fatalf("exact limit rejected: %v", err)
		}
	})

	t.Run("rejects value over UTF-8 byte limit", func(t *testing.T) {
		value := strings.Repeat("é", MaxUserBiographyBytes/2+1)
		if _, err := NormalizeAndValidateUserBiography(value); !errors.Is(err, ErrInvalidArgument) {
			t.Fatalf("error = %v, want ErrInvalidArgument", err)
		}
	})

	t.Run("rejects invalid UTF-8", func(t *testing.T) {
		if _, err := NormalizeAndValidateUserBiography(string([]byte{0xff})); !errors.Is(err, ErrInvalidArgument) {
			t.Fatalf("error = %v, want ErrInvalidArgument", err)
		}
	})

	t.Run("rejects null character", func(t *testing.T) {
		if _, err := NormalizeAndValidateUserBiography("hello\x00world"); !errors.Is(err, ErrInvalidArgument) {
			t.Fatalf("error = %v, want ErrInvalidArgument", err)
		}
	})
}

func TestChattoCoreUpdateUserBiographyEncryptsAndClears(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := core.CreateUser(ctx, SystemActorID, "profile-biography", "Profile Biography", "password123")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	biography := "# About me\r\n\r\n**Encrypted** profile text."
	if err := core.UpdateUserBiography(ctx, user.GetId(), biography); err != nil {
		t.Fatalf("UpdateUserBiography: %v", err)
	}
	got, err := core.GetUserBiography(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserBiography: %v", err)
	}
	want := "# About me\n\n**Encrypted** profile text."
	if got != want {
		t.Fatalf("biography = %q, want %q", got, want)
	}

	published, _, err := core.EventPublisher.SubjectEvents(
		ctx,
		events.UserAggregate(user.GetId()).Subject(events.EventUserBiographyChanged),
	)
	if err != nil {
		t.Fatalf("read biography events: %v", err)
	}
	if len(published) != 1 {
		t.Fatalf("biography events = %d, want 1", len(published))
	}
	changed := published[0].GetUserBiographyChanged()
	if changed == nil || changed.GetEncryptedBiography() == nil {
		t.Fatal("encrypted biography payload is missing")
	}
	if len(changed.GetEncryptedBiography().GetEncryptedValue()) == 0 || len(changed.GetEncryptedBiography().GetNonce()) == 0 {
		t.Fatal("encrypted biography ciphertext or nonce is empty")
	}
	encoded, err := proto.Marshal(published[0])
	if err != nil {
		t.Fatalf("marshal biography event: %v", err)
	}
	if bytes.Contains(encoded, []byte(want)) {
		t.Fatal("durable biography event contains plaintext")
	}

	// Writing the same normalized value is a no-op.
	if err := core.UpdateUserBiography(ctx, user.GetId(), want); err != nil {
		t.Fatalf("idempotent UpdateUserBiography: %v", err)
	}
	published, _, err = core.EventPublisher.SubjectEvents(
		ctx,
		events.UserAggregate(user.GetId()).Subject(events.EventUserBiographyChanged),
	)
	if err != nil {
		t.Fatalf("read biography events after no-op: %v", err)
	}
	if len(published) != 1 {
		t.Fatalf("biography events after no-op = %d, want 1", len(published))
	}

	if err := core.UpdateUserBiography(ctx, user.GetId(), ""); err != nil {
		t.Fatalf("clear biography: %v", err)
	}
	got, err = core.GetUserBiography(ctx, user.GetId())
	if err != nil {
		t.Fatalf("GetUserBiography after clear: %v", err)
	}
	if got != "" {
		t.Fatalf("biography after clear = %q", got)
	}
	cleared, _, err := core.EventPublisher.SubjectEvents(
		ctx,
		events.UserAggregate(user.GetId()).Subject(events.EventUserBiographyCleared),
	)
	if err != nil {
		t.Fatalf("read biography clear events: %v", err)
	}
	if len(cleared) != 1 {
		t.Fatalf("biography clear events = %d, want 1", len(cleared))
	}
}

func TestIsModerationRoleUsesAuthorityNotPosition(t *testing.T) {
	tests := []struct {
		name string
		role RoleWithPermissions
		want bool
	}{
		{
			name: "honorific high position is not moderation",
			role: RoleWithPermissions{Name: "vip", Position: 1000},
			want: false,
		},
		{
			name: "well-known moderator role",
			role: RoleWithPermissions{Name: RoleModerator},
			want: true,
		},
		{
			name: "custom role with message management",
			role: RoleWithPermissions{Name: "helpers", Permissions: []Permission{PermMessageManage}},
			want: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsModerationRole(tt.role); got != tt.want {
				t.Fatalf("IsModerationRole() = %v, want %v", got, tt.want)
			}
		})
	}
}
