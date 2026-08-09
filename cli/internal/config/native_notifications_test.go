package config

import (
	"os"
	"path/filepath"
	"testing"
)

func clearNativeNotificationEnv(t *testing.T) {
	t.Helper()
	for _, name := range []string{
		nativeNotificationsConfigFileEnv,
		"CHATTO_NATIVE_NOTIFICATIONS_ENABLED",
		"CHATTO_NATIVE_NOTIFICATIONS_SHADOW_OUTBOX",
		"CHATTO_NATIVE_NOTIFICATIONS_ANDROID_UNIFIEDPUSH",
		"CHATTO_NATIVE_NOTIFICATIONS_LINUX_AGENT",
		"CHATTO_NATIVE_NOTIFICATIONS_WINDOWS_AGENT",
	} {
		t.Setenv(name, "")
		if err := os.Unsetenv(name); err != nil {
			t.Fatal(err)
		}
	}
}

func TestLoadNativeNotificationsConfigDefaultsDisabled(t *testing.T) {
	clearNativeNotificationEnv(t)
	cfg, err := LoadNativeNotificationsConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg != (NativeNotificationsConfig{}) {
		t.Fatalf("default config = %#v, want all disabled", cfg)
	}
}

func TestLoadNativeNotificationsConfigReadsFileAndOverrides(t *testing.T) {
	clearNativeNotificationEnv(t)
	path := filepath.Join(t.TempDir(), "native-notifications.toml")
	if err := os.WriteFile(path, []byte("enabled = true\nshadow_outbox = true\nlinux_agent = true\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(nativeNotificationsConfigFileEnv, path)
	t.Setenv("CHATTO_NATIVE_NOTIFICATIONS_SHADOW_OUTBOX", "false")
	t.Setenv("CHATTO_NATIVE_NOTIFICATIONS_ANDROID_UNIFIEDPUSH", "true")

	cfg, err := LoadNativeNotificationsConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Enabled || cfg.ShadowOutbox || !cfg.AndroidUnifiedPush || !cfg.LinuxAgent {
		t.Fatalf("loaded config = %#v", cfg)
	}
}

func TestLoadNativeNotificationsConfigRejectsUnsafeRolloutCombinations(t *testing.T) {
	clearNativeNotificationEnv(t)
	t.Setenv("CHATTO_NATIVE_NOTIFICATIONS_ANDROID_UNIFIEDPUSH", "true")
	if _, err := LoadNativeNotificationsConfig(); err == nil {
		t.Fatal("expected disabled parent flag to reject child rollout")
	}

	clearNativeNotificationEnv(t)
	t.Setenv("CHATTO_NATIVE_NOTIFICATIONS_ENABLED", "true")
	t.Setenv("CHATTO_NATIVE_NOTIFICATIONS_SHADOW_OUTBOX", "true")
	t.Setenv("CHATTO_NATIVE_NOTIFICATIONS_ANDROID_UNIFIEDPUSH", "true")
	if _, err := LoadNativeNotificationsConfig(); err == nil {
		t.Fatal("expected shadow mode to reject live Android delivery")
	}
}

func TestLoadNativeNotificationsConfigRejectsInvalidBoolean(t *testing.T) {
	clearNativeNotificationEnv(t)
	t.Setenv("CHATTO_NATIVE_NOTIFICATIONS_ENABLED", "sometimes")
	if _, err := LoadNativeNotificationsConfig(); err == nil {
		t.Fatal("expected invalid boolean error")
	}
}
