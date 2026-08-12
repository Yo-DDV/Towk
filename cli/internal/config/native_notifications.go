package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
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
	Enabled                bool   `toml:"enabled"`
	ShadowOutbox           bool   `toml:"shadow_outbox"`
	AndroidManagedFCM      bool   `toml:"android_managed_fcm"`
	LinuxResidentWebSocket bool   `toml:"linux_resident_websocket"`
	ManagedFCMRelayURL     string `toml:"managed_fcm_relay_url"`
	IdentityFile           string `toml:"identity_file"`
	EnrollmentStateFile    string `toml:"enrollment_state_file"`
}

func (c NativeNotificationsConfig) Validate() error {
	if !c.Enabled && (c.ShadowOutbox || c.AndroidManagedFCM || c.LinuxResidentWebSocket) {
		return fmt.Errorf("native_notifications.enabled must be true before enabling a rollout flag")
	}
	if c.AndroidManagedFCM && c.ShadowOutbox {
		return fmt.Errorf("native_notifications.android_managed_fcm cannot be enabled while shadow_outbox is true")
	}
	if c.AndroidManagedFCM {
		relayURL, err := url.Parse(strings.TrimSpace(c.ManagedFCMRelayURL))
		if err != nil || relayURL.Scheme != "https" || relayURL.Host == "" || relayURL.User != nil || relayURL.RawQuery != "" || relayURL.Fragment != "" {
			return fmt.Errorf("native_notifications.managed_fcm_relay_url must be an absolute HTTPS origin")
		}
		if relayURL.Path != "" && relayURL.Path != "/" {
			return fmt.Errorf("native_notifications.managed_fcm_relay_url must not contain a path")
		}
		if !filepath.IsAbs(strings.TrimSpace(c.IdentityFile)) || !filepath.IsAbs(strings.TrimSpace(c.EnrollmentStateFile)) {
			return fmt.Errorf("native_notifications identity_file and enrollment_state_file must be absolute paths")
		}
		if filepath.Clean(c.IdentityFile) == filepath.Clean(c.EnrollmentStateFile) {
			return fmt.Errorf("native_notifications identity and enrollment state must use separate files")
		}
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
		{name: "CHATTO_NATIVE_NOTIFICATIONS_ANDROID_MANAGED_FCM", target: &cfg.AndroidManagedFCM},
		{name: "CHATTO_NATIVE_NOTIFICATIONS_LINUX_RESIDENT_WEBSOCKET", target: &cfg.LinuxResidentWebSocket},
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
	if raw, present := os.LookupEnv("CHATTO_NATIVE_NOTIFICATIONS_MANAGED_FCM_RELAY_URL"); present {
		cfg.ManagedFCMRelayURL = strings.TrimSpace(raw)
	}
	if raw, present := os.LookupEnv("CHATTO_NATIVE_NOTIFICATIONS_IDENTITY_FILE"); present {
		cfg.IdentityFile = strings.TrimSpace(raw)
	}
	if raw, present := os.LookupEnv("CHATTO_NATIVE_NOTIFICATIONS_ENROLLMENT_STATE_FILE"); present {
		cfg.EnrollmentStateFile = strings.TrimSpace(raw)
	}
	if err := cfg.Validate(); err != nil {
		return NativeNotificationsConfig{}, err
	}
	return cfg, nil
}
