package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

const nativeNotificationsConfigFileEnv = "CHATTO_NATIVE_NOTIFICATIONS_CONFIG_FILE"

// NativeNotificationsConfig is intentionally loaded from a separate optional
// operator file. This keeps the additive native-notification rollout disabled
// for every existing Towk deployment and lets operators mount the file from a
// secret/config store without placing transport credentials on argv.
type NativeNotificationsConfig struct {
	Enabled            bool `toml:"enabled"`
	ShadowOutbox       bool `toml:"shadow_outbox"`
	AndroidUnifiedPush bool `toml:"android_unifiedpush"`
	LinuxAgent         bool `toml:"linux_agent"`
	WindowsAgent       bool `toml:"windows_agent"`
}

func (c NativeNotificationsConfig) Validate() error {
	if !c.Enabled && (c.ShadowOutbox || c.AndroidUnifiedPush || c.LinuxAgent || c.WindowsAgent) {
		return fmt.Errorf("native_notifications.enabled must be true before enabling a rollout flag")
	}
	if c.AndroidUnifiedPush && c.ShadowOutbox {
		return fmt.Errorf("native_notifications.android_unifiedpush cannot be enabled while shadow_outbox is true")
	}
	return nil
}

// LoadNativeNotificationsConfig loads an optional TOML file followed by narrow
// boolean environment overrides. With no file or environment variables it
// returns the all-false, disabled configuration.
func LoadNativeNotificationsConfig() (NativeNotificationsConfig, error) {
	cfg := NativeNotificationsConfig{}
	path := strings.TrimSpace(os.Getenv(nativeNotificationsConfigFileEnv))
	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return NativeNotificationsConfig{}, fmt.Errorf("read native notifications config: %w", err)
		}
		if err := toml.Unmarshal(data, &cfg); err != nil {
			return NativeNotificationsConfig{}, fmt.Errorf("parse native notifications config: %w", err)
		}
	}

	overrides := []struct {
		name   string
		target *bool
	}{
		{name: "CHATTO_NATIVE_NOTIFICATIONS_ENABLED", target: &cfg.Enabled},
		{name: "CHATTO_NATIVE_NOTIFICATIONS_SHADOW_OUTBOX", target: &cfg.ShadowOutbox},
		{name: "CHATTO_NATIVE_NOTIFICATIONS_ANDROID_UNIFIEDPUSH", target: &cfg.AndroidUnifiedPush},
		{name: "CHATTO_NATIVE_NOTIFICATIONS_LINUX_AGENT", target: &cfg.LinuxAgent},
		{name: "CHATTO_NATIVE_NOTIFICATIONS_WINDOWS_AGENT", target: &cfg.WindowsAgent},
	}
	for _, override := range overrides {
		raw, present := os.LookupEnv(override.name)
		if !present {
			continue
		}
		value, err := strconv.ParseBool(strings.TrimSpace(raw))
		if err != nil {
			return NativeNotificationsConfig{}, fmt.Errorf("%s must be a boolean: %w", override.name, err)
		}
		*override.target = value
	}
	if err := cfg.Validate(); err != nil {
		return NativeNotificationsConfig{}, err
	}
	return cfg, nil
}
