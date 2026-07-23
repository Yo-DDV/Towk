package connectapi

import (
	"errors"
	"testing"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/core"
)

func TestConnectErrorIncludesPasswordValidationCode(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		wantCode string
	}{
		{
			name:     "password too short",
			err:      core.ErrPasswordTooShort,
			wantCode: core.PasswordTooShortCode,
		},
		{
			name:     "password too long",
			err:      core.ErrPasswordTooLong,
			wantCode: core.PasswordTooLongCode,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := connectError(tt.err)
			if got := connect.CodeOf(err); got != connect.CodeInvalidArgument {
				t.Fatalf("Connect code = %v, want %v", got, connect.CodeInvalidArgument)
			}

			var connectErr *connect.Error
			if !errors.As(err, &connectErr) {
				t.Fatalf("error = %T, want *connect.Error", err)
			}
			if got := connectErr.Meta().Get(passwordErrorCodeMetadataKey); got != tt.wantCode {
				t.Fatalf("%s = %q, want %q", passwordErrorCodeMetadataKey, got, tt.wantCode)
			}
		})
	}
}

func TestConnectErrorOmitsPasswordCodeForOtherInvalidArguments(t *testing.T) {
	err := connectError(core.ErrLoginTooShort)
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("error = %T, want *connect.Error", err)
	}
	if got := connectErr.Meta().Get(passwordErrorCodeMetadataKey); got != "" {
		t.Fatalf("%s = %q, want empty", passwordErrorCodeMetadataKey, got)
	}
}
