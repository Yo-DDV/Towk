package core

import (
	"errors"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

func TestPasswordCreationAndMutationFlowsShareBcryptBoundary(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	maxPassword := strings.Repeat("a", MaxPasswordLength)
	tooLong := strings.Repeat("a", MaxPasswordLength+1)

	if _, err := core.CreateUser(ctx, SystemActorID, "password-max-create", "Password Max Create", maxPassword); err != nil {
		t.Fatalf("CreateUser with %d-byte password: %v", MaxPasswordLength, err)
	}
	if _, err := core.CreateUser(ctx, SystemActorID, "password-long-create", "Password Long Create", tooLong); !errors.Is(err, ErrPasswordTooLong) {
		t.Fatalf("CreateUser with %d-byte password error = %v, want ErrPasswordTooLong", len(tooLong), err)
	}

	user, err := core.CreateUser(ctx, SystemActorID, "password-mutation", "Password Mutation", "current-password")
	if err != nil {
		t.Fatalf("CreateUser mutation target: %v", err)
	}
	if err := core.SetPasswordHash(ctx, user.Id, tooLong); !errors.Is(err, ErrPasswordTooLong) {
		t.Fatalf("SetPasswordHash error = %v, want ErrPasswordTooLong", err)
	}
	if err := core.SetOwnPassword(ctx, user.Id, "current-password", tooLong); !errors.Is(err, ErrPasswordTooLong) {
		t.Fatalf("SetOwnPassword error = %v, want ErrPasswordTooLong", err)
	}
	if err := core.SetPasswordHash(ctx, user.Id, maxPassword); err != nil {
		t.Fatalf("SetPasswordHash with %d-byte password: %v", MaxPasswordLength, err)
	}
	if _, err := core.VerifyPassword(ctx, user.Login, maxPassword); err != nil {
		t.Fatalf("VerifyPassword after max-length update: %v", err)
	}

	passwordless, err := core.CreateUser(ctx, SystemActorID, "passwordless-policy", "Passwordless Policy", "")
	if err != nil {
		t.Fatalf("CreateUser passwordless: %v", err)
	}
	if err := core.SetInitialPasswordHash(ctx, passwordless.Id, tooLong); !errors.Is(err, ErrPasswordTooLong) {
		t.Fatalf("SetInitialPasswordHash error = %v, want ErrPasswordTooLong", err)
	}
	if hasPassword, err := core.HasPassword(ctx, passwordless.Id); err != nil {
		t.Fatalf("HasPassword: %v", err)
	} else if hasPassword {
		t.Fatal("oversized initial password must not add a credential")
	}
}

func TestPasswordVerificationDoesNotApplyNewPasswordPolicy(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := core.CreateUser(ctx, SystemActorID, "password-login-policy", "Password Login Policy", "valid-password")
	if err != nil {
		t.Fatalf("CreateUser login target: %v", err)
	}

	candidates := []struct {
		name     string
		password string
	}{
		{name: "candidate below creation minimum", password: "x"},
		{name: "candidate above creation maximum", password: strings.Repeat("x", MaxPasswordLength+1)},
	}
	for _, candidate := range candidates {
		t.Run(candidate.name, func(t *testing.T) {
			_, err := core.VerifyPassword(ctx, user.Login, candidate.password)
			if err == nil {
				t.Fatal("VerifyPassword returned nil for an incorrect candidate")
			}
			if errors.Is(err, ErrPasswordTooShort) || errors.Is(err, ErrPasswordTooLong) {
				t.Fatalf("VerifyPassword applied the new-password policy: %v", err)
			}
		})
	}
}

func TestPasswordVerificationPreservesLegacyLongBcryptHashes(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	user, err := core.CreateUser(ctx, SystemActorID, "password-legacy-long", "Password Legacy Long", "")
	if err != nil {
		t.Fatalf("CreateUser legacy target: %v", err)
	}

	legacyPrefix := strings.Repeat("x", MaxPasswordLength)
	legacyPassword := legacyPrefix + "-historical-suffix"
	legacyHash, err := bcrypt.GenerateFromPassword([]byte(legacyPrefix), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("GenerateFromPassword legacy prefix: %v", err)
	}

	passwordChanged := newEvent(SystemActorID, &corev1.Event{
		Event: &corev1.Event_UserPasswordHashChanged{
			UserPasswordHashChanged: &corev1.UserPasswordHashChangedEvent{
				UserId:       user.Id,
				PasswordHash: legacyHash,
			},
		},
	})
	if _, err := core.appendUserEvent(ctx, user.Id, passwordChanged, "", nil); err != nil {
		t.Fatalf("append legacy password hash: %v", err)
	}
	if err := ValidatePassword(legacyPassword); !errors.Is(err, ErrPasswordTooLong) {
		t.Fatalf("ValidatePassword legacy candidate error = %v, want ErrPasswordTooLong", err)
	}
	verified, err := core.VerifyPassword(ctx, user.Login, legacyPassword)
	if err != nil {
		t.Fatalf("VerifyPassword legacy candidate: %v", err)
	}
	if verified.Id != user.Id {
		t.Fatalf("verified user ID = %q, want %q", verified.Id, user.Id)
	}
}

func TestResetPasswordValidatesBeforeTokenLookup(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	tooLong := strings.Repeat("a", MaxPasswordLength+1)

	if err := core.ResetPasswordWithPassword(ctx, "missing-token", tooLong); !errors.Is(err, ErrPasswordTooLong) {
		t.Fatalf("ResetPasswordWithPassword error = %v, want ErrPasswordTooLong", err)
	}
}

func TestPasswordValidationCodesAreStable(t *testing.T) {
	if got := PasswordValidationCode(ErrPasswordTooShort); got != PasswordTooShortCode {
		t.Fatalf("short code = %q, want %q", got, PasswordTooShortCode)
	}
	if got := PasswordValidationCode(ErrPasswordTooLong); got != PasswordTooLongCode {
		t.Fatalf("long code = %q, want %q", got, PasswordTooLongCode)
	}
	if got := PasswordValidationCode(ErrLoginTooShort); got != "" {
		t.Fatalf("unrelated code = %q, want empty", got)
	}
}
