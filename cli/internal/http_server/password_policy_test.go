package http_server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"hmans.de/chatto/internal/core"
)

func TestWritePasswordValidationError(t *testing.T) {
	gin.SetMode(gin.TestMode)
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
			response := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(response)

			if !writePasswordValidationError(ctx, tt.err) {
				t.Fatal("writePasswordValidationError returned false")
			}
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
			}

			var body map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got := body["code"]; got != tt.wantCode {
				t.Fatalf("code = %q, want %q", got, tt.wantCode)
			}
			if got := body["error"]; got != tt.err.Error() {
				t.Fatalf("error = %q, want %q", got, tt.err.Error())
			}
		})
	}
}

func TestAuthRoutesResetPasswordAppliesCorePasswordPolicy(t *testing.T) {
	ts, client, _ := setupTestHTTPServer(t)
	tests := []struct {
		name         string
		password     string
		wantCode     string
		wantError    string
		wantPolicyErr bool
	}{
		{
			name:          "seven Unicode code points is too short",
			password:      strings.Repeat("é", 7),
			wantCode:      core.PasswordTooShortCode,
			wantError:     core.ErrPasswordTooShort.Error(),
			wantPolicyErr: true,
		},
		{
			name:          "seventy three UTF-8 bytes is too long",
			password:      strings.Repeat("a", core.MaxPasswordLength+1),
			wantCode:      core.PasswordTooLongCode,
			wantError:     core.ErrPasswordTooLong.Error(),
			wantPolicyErr: true,
		},
		{
			name:      "eight multibyte code points passes password validation",
			password:  strings.Repeat("é", core.MinPasswordLength),
			wantError: "Invalid or expired reset link",
		},
	}

	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload, err := json.Marshal(map[string]string{
				"token":    "missing-reset-token-" + string(rune('a'+i)),
				"password": tt.password,
			})
			if err != nil {
				t.Fatalf("marshal request: %v", err)
			}
			response, err := client.Post(ts.URL+"/auth/reset-password", "application/json", bytes.NewReader(payload))
			if err != nil {
				t.Fatalf("POST reset-password: %v", err)
			}
			defer response.Body.Close()

			if response.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusBadRequest)
			}
			var body map[string]string
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if got := body["error"]; got != tt.wantError {
				t.Fatalf("error = %q, want %q", got, tt.wantError)
			}
			if got := body["code"]; got != tt.wantCode {
				t.Fatalf("code = %q, want %q", got, tt.wantCode)
			}
			if tt.wantPolicyErr && body["code"] == "" {
				t.Fatal("password policy response is missing its stable code")
			}
		})
	}
}
