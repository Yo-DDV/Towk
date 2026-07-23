package core

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestValidatePasswordPolicyBoundaries(t *testing.T) {
	tests := []struct {
		name          string
		password      string
		wantErr       error
		wantCodePoints int
		wantBytes      int
	}{
		{
			name:           "seven ASCII code points is too short",
			password:       strings.Repeat("a", 7),
			wantErr:        ErrPasswordTooShort,
			wantCodePoints: 7,
			wantBytes:      7,
		},
		{
			name:           "eight ASCII code points is valid",
			password:       strings.Repeat("a", 8),
			wantCodePoints: 8,
			wantBytes:      8,
		},
		{
			name:           "seventy one ASCII bytes is valid",
			password:       strings.Repeat("a", 71),
			wantCodePoints: 71,
			wantBytes:      71,
		},
		{
			name:           "seventy two ASCII bytes is valid",
			password:       strings.Repeat("a", 72),
			wantCodePoints: 72,
			wantBytes:      72,
		},
		{
			name:           "seventy three ASCII bytes is too long",
			password:       strings.Repeat("a", 73),
			wantErr:        ErrPasswordTooLong,
			wantCodePoints: 73,
			wantBytes:      73,
		},
		{
			name:           "one hundred twenty eight ASCII bytes is too long",
			password:       strings.Repeat("a", 128),
			wantErr:        ErrPasswordTooLong,
			wantCodePoints: 128,
			wantBytes:      128,
		},
		{
			name:           "one hundred twenty nine ASCII bytes is too long",
			password:       strings.Repeat("a", 129),
			wantErr:        ErrPasswordTooLong,
			wantCodePoints: 129,
			wantBytes:      129,
		},
		{
			name:           "seven multibyte code points is too short",
			password:       strings.Repeat("é", 7),
			wantErr:        ErrPasswordTooShort,
			wantCodePoints: 7,
			wantBytes:      14,
		},
		{
			name:           "eight multibyte code points is valid",
			password:       strings.Repeat("é", 8),
			wantCodePoints: 8,
			wantBytes:      16,
		},
		{
			name:           "seventy two multibyte bytes is valid",
			password:       strings.Repeat("田", 24),
			wantCodePoints: 24,
			wantBytes:      72,
		},
		{
			name:           "seventy three multibyte bytes is too long",
			password:       strings.Repeat("田", 23) + "éé",
			wantErr:        ErrPasswordTooLong,
			wantCodePoints: 25,
			wantBytes:      73,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := utf8.RuneCountInString(tt.password); got != tt.wantCodePoints {
				t.Fatalf("code point count = %d, want %d", got, tt.wantCodePoints)
			}
			if got := len(tt.password); got != tt.wantBytes {
				t.Fatalf("UTF-8 byte length = %d, want %d", got, tt.wantBytes)
			}

			err := ValidatePassword(tt.password)
			if tt.wantErr == nil {
				if err != nil {
					t.Fatalf("ValidatePassword() error = %v, want nil", err)
				}
				return
			}
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("ValidatePassword() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}
