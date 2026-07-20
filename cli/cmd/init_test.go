package cmd

import (
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"hmans.de/chatto/internal/config"
)

func TestWriteNewConfigFileCreatesSecureFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "chatto.toml")
	if err := writeNewConfigFile(path, []byte("secret")); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "secret" {
		t.Fatalf("content = %q, want secret", data)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0600 {
		t.Fatalf("mode = %o, want 600", got)
	}
}

func TestResolveInitConfigPathRefusesImplicitLegacyReplacement(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TOWK_CONFIG_DIR", dir)
	legacyPath := filepath.Join(dir, "chatto.toml")
	if err := os.WriteFile(legacyPath, []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := resolveInitConfigPath(""); err == nil || !strings.Contains(err.Error(), "legacy configuration") {
		t.Fatalf("resolveInitConfigPath error = %v, want legacy configuration refusal", err)
	}
	explicitPath := filepath.Join(dir, "migration.toml")
	got, err := resolveInitConfigPath(explicitPath)
	if err != nil {
		t.Fatalf("explicit path rejected: %v", err)
	}
	if got != explicitPath {
		t.Fatalf("explicit path = %q, want %q", got, explicitPath)
	}
}

func TestWriteNewConfigFileDoesNotReplaceExistingPath(t *testing.T) {
	dir := t.TempDir()
	for _, tc := range []struct {
		name  string
		setup func(path string) (target string)
	}{
		{
			name: "regular file",
			setup: func(path string) string {
				if err := os.WriteFile(path, []byte("existing"), 0644); err != nil {
					t.Fatal(err)
				}
				return path
			},
		},
		{
			name: "symlink",
			setup: func(path string) string {
				target := filepath.Join(dir, "target")
				if err := os.WriteFile(target, []byte("existing"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, path); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
				return target
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(dir, strings.ReplaceAll(tc.name, " ", "-")+".toml")
			target := tc.setup(path)
			if err := writeNewConfigFile(path, []byte("replacement")); !errors.Is(err, os.ErrExist) {
				t.Fatalf("error = %v, want os.ErrExist", err)
			}
			data, err := os.ReadFile(target)
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != "existing" {
				t.Fatalf("existing content changed to %q", data)
			}
		})
	}
}

func TestWriteNewConfigFileAllowsOnlyOneConcurrentCreator(t *testing.T) {
	path := filepath.Join(t.TempDir(), "chatto.toml")
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, data := range [][]byte{[]byte("first"), []byte("second")} {
		data := data
		go func() {
			<-start
			results <- writeNewConfigFile(path, data)
		}()
	}
	close(start)

	var successes, existing int
	for range 2 {
		err := <-results
		switch {
		case err == nil:
			successes++
		case errors.Is(err, os.ErrExist):
			existing++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if successes != 1 || existing != 1 {
		t.Fatalf("successes=%d existing=%d, want 1 each", successes, existing)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "first" && string(data) != "second" {
		t.Fatalf("content = %q, want one complete writer", data)
	}
}

func TestInitGeneratesCoreSecret(t *testing.T) {
	tmpDir := t.TempDir()
	originalDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("change working directory: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(originalDir) })

	originalConfigFile := initConfigFile
	initConfigFile = ""
	t.Cleanup(func() { initConfigFile = originalConfigFile })

	initCmd.Run(initCmd, nil)

	cfg, err := config.ReadConfig(filepath.Join(tmpDir, "towk.toml"))
	if err != nil {
		t.Fatalf("read generated config: %v", err)
	}
	if len(cfg.Core.SecretKey) != 64 {
		t.Fatalf("generated core secret length = %d, want 64", len(cfg.Core.SecretKey))
	}
	if _, err := hex.DecodeString(cfg.Core.SecretKey); err != nil {
		t.Fatalf("generated core secret should be hex: %v", err)
	}
	if cfg.Core.Assets.StorageBackend != config.StorageBackendNATS {
		t.Fatalf("generated storage backend = %q, want %q", cfg.Core.Assets.StorageBackend, config.StorageBackendNATS)
	}
	if cfg.NATS.Replicas != 1 {
		t.Fatalf("generated NATS replicas = %d, want 1", cfg.NATS.Replicas)
	}
	if got := cfg.Performance.DefaultProfileOrLegacy(); got != config.PerformanceProfileBalanced {
		t.Fatalf("generated performance profile = %q, want %q", got, config.PerformanceProfileBalanced)
	}
	if cfg.NATS.Embedded.Port != 0 {
		t.Fatalf("generated embedded NATS port = %d, want 0 when port is commented out", cfg.NATS.Embedded.Port)
	}
	if cfg.NATS.Client.URL != "" {
		t.Fatalf("generated embedded NATS client URL = %q, want empty when TCP listener is disabled", cfg.NATS.Client.URL)
	}
	if got := cfg.Auth.EmailOTP.ThrottlingEnabledOrDefault(); got != true {
		t.Fatalf("generated email OTP throttling enabled = %v, want true", got)
	}
	if cfg.SMTP.Enabled {
		t.Fatal("generated SMTP config should be disabled by default")
	}
	if cfg.SMTP.Port != 587 {
		t.Fatalf("generated SMTP port = %d, want 587", cfg.SMTP.Port)
	}
	if cfg.SMTP.TLS != config.SMTPTLSMandatory {
		t.Fatalf("generated SMTP TLS policy = %q, want %q", cfg.SMTP.TLS, config.SMTPTLSMandatory)
	}
	raw, err := os.ReadFile(filepath.Join(tmpDir, "towk.toml"))
	if err != nil {
		t.Fatalf("read generated raw config: %v", err)
	}
	rawText := string(raw)
	generalIndex := strings.Index(rawText, "\n[general]\n")
	if generalIndex == -1 && strings.HasPrefix(rawText, "[general]\n") {
		generalIndex = 0
	}
	ownersIndex := strings.Index(rawText, "\n[owners]\n")
	webserverIndex := strings.Index(rawText, "\n[webserver]\n")
	if generalIndex == -1 || ownersIndex == -1 || webserverIndex == -1 || !(generalIndex < ownersIndex && ownersIndex < webserverIndex) {
		t.Fatal("generated config should place [owners] between [general] and [webserver]")
	}
	if !strings.Contains(rawText, "log_level = 'info'") {
		t.Fatal("generated config should set general.log_level to 'info'")
	}
	if !strings.Contains(rawText, "allowed_origins = ['*']") {
		t.Fatal("generated config should explicitly allow bearer-token CORS clients")
	}
	if !strings.Contains(rawText, "oauth_redirect_origins = []") {
		t.Fatal("generated config should not allow additional OAuth redirect origins by default")
	}
	if strings.Contains(rawText, "\nproviders = []") {
		t.Fatal("generated config should not include an active empty auth.providers array")
	}
	if !strings.Contains(rawText, "\n# [[auth.providers]]\n# id = 'towk-hub'\n# type = 'oidc'") {
		t.Fatal("generated config should include a commented OIDC auth provider example")
	}
	if !strings.Contains(rawText, "\n# [[auth.providers]]\n# id = 'github'\n# type = 'github'") {
		t.Fatal("generated config should include a commented GitHub auth provider example")
	}
	if !strings.Contains(rawText, "\n[auth.email_otp]\n") {
		t.Fatal("generated config should include an active auth.email_otp section")
	}
	if strings.Contains(rawText, "\n# [auth.email_otp]\n") {
		t.Fatal("generated config should not comment out the auth.email_otp section")
	}
	if !strings.Contains(rawText, "\nthrottling_enabled = true\n") {
		t.Fatal("generated config should explicitly enable email OTP throttling")
	}
	if !strings.Contains(rawText, "\n# ttl = '15m'\n") {
		t.Fatal("generated config should include commented default email OTP TTL")
	}
	if !strings.Contains(rawText, "\n# max_delivered_codes = 10\n") {
		t.Fatal("generated config should include commented default delivered-code limit")
	}
	if !strings.Contains(rawText, "\n# max_wrong_attempts = 5\n") {
		t.Fatal("generated config should include commented default wrong-attempt limit")
	}
	if !strings.Contains(rawText, "\n# domain = ''") {
		t.Fatal("generated config should comment out webserver.tls.domain by default")
	}
	if !strings.Contains(rawText, "\n# email = ''") {
		t.Fatal("generated config should comment out webserver.tls.email by default")
	}
	if !strings.Contains(rawText, "storage_backend = 'nats'") {
		t.Fatal("generated config should set core.assets.storage_backend to 'nats'")
	}
	if !strings.Contains(rawText, "\n[smtp]\n") {
		t.Fatal("generated config should include SMTP defaults")
	}
	if !strings.Contains(rawText, "\nport = 587\n") {
		t.Fatal("generated SMTP config should default to STARTTLS submission port 587")
	}
	if !strings.Contains(rawText, "\ntls = 'mandatory'\n") {
		t.Fatal("generated SMTP config should default to mandatory STARTTLS")
	}
	if !strings.Contains(rawText, "\nreplicas = 1\n") {
		t.Fatal("generated config should set nats.replicas to 1")
	}
	if strings.Contains(rawText, "\n# replicas =") {
		t.Fatal("generated config should not comment out nats.replicas")
	}
	if !strings.Contains(rawText, "\n# port = 4222") {
		t.Fatal("generated config should comment out nats.embedded.port by default")
	}
	if strings.Contains(rawText, "\nport = 4222") {
		t.Fatal("generated config should not enable the embedded NATS TCP port by default")
	}
	if !strings.Contains(rawText, "\n# [nats.client]\n") {
		t.Fatal("generated config should include a commented external NATS client example")
	}
	if !strings.Contains(rawText, "tls://nats.example.com:4222") {
		t.Fatal("generated external NATS example should require TLS")
	}
	if strings.Contains(rawText, "\n[nats.client]\n") {
		t.Fatal("generated embedded config should not include an active [nats.client] table")
	}
}
