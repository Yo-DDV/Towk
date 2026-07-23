//go:build bootstrap

package cmd

import (
	"context"
	"strings"
	"testing"

	"github.com/charmbracelet/log"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
)

func TestApplyBootstrapUserUsesCorePasswordPolicy(t *testing.T) {
	ctx := context.Background()
	logger := log.WithPrefix("test.bootstrap")

	t.Run("accepts bcrypt maximum", func(t *testing.T) {
		chattoCore := setupCore(t)
		password := strings.Repeat("a", core.MaxPasswordLength)
		userID, created := applyBootstrapUser(ctx, logger, chattoCore, config.BootstrapUser{
			Login:       "bootstrap-password-max",
			DisplayName: "Bootstrap Password Max",
			Password:    password,
		})
		if !created || userID == "" {
			t.Fatalf("applyBootstrapUser created=%v userID=%q, want created user", created, userID)
		}
		if _, err := chattoCore.VerifyPassword(ctx, "bootstrap-password-max", password); err != nil {
			t.Fatalf("VerifyPassword: %v", err)
		}
	})

	t.Run("rejects password above bcrypt maximum", func(t *testing.T) {
		chattoCore := setupCore(t)
		userID, created := applyBootstrapUser(ctx, logger, chattoCore, config.BootstrapUser{
			Login:       "bootstrap-password-long",
			DisplayName: "Bootstrap Password Long",
			Password:    strings.Repeat("a", core.MaxPasswordLength+1),
		})
		if created || userID != "" {
			t.Fatalf("applyBootstrapUser created=%v userID=%q, want rejected user", created, userID)
		}
		if user, err := chattoCore.GetUserByLogin(ctx, "bootstrap-password-long"); err == nil || user != nil {
			t.Fatalf("GetUserByLogin returned user=%v err=%v, want no user", user, err)
		}
	})
}
