package core

import (
	"bytes"
	"context"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/nats-io/nats.go/jetstream"

	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
)

const (
	nativeEndpointKeyPrefix             = "native_endpoint."
	nativeOutboxKeyPrefix               = "native_notification_outbox."
	maxNativeEndpointsPerUser           = 32
	maxNativeOutboxItemsPerEndpoint     = 256
	maxNativeEndpointMutationRetries    = 8
	maxNativeOutboxDeliveryAttempts     = 8
	defaultNativeNotificationLocale     = "en"
	defaultNativeMessageTTL             = 15 * time.Minute
	defaultNativeCallTTL                = 2 * time.Minute
	defaultNativeOutboxLease            = 30 * time.Second
	maximumNativeOutboxRetryDelay       = time.Hour
	maximumNativeNotificationBatchClaim = 256
)

var (
	ErrNativeEndpointConflict    = errors.New("native endpoint generation conflict")
	ErrNativeEndpointUnsupported = errors.New("native endpoint transport is unsupported")
	ErrNativeOutboxSaturated     = errors.New("native notification outbox is saturated")
	ErrNativeOutboxLeaseLost     = errors.New("native notification outbox lease lost")
)

type NativeNotificationPlatform string

const (
	NativeNotificationPlatformAndroid NativeNotificationPlatform = "android"
	NativeNotificationPlatformLinux   NativeNotificationPlatform = "linux"
	NativeNotificationPlatformWindows NativeNotificationPlatform = "windows"
)

type NativeNotificationTransport string

const (
	NativeNotificationTransportManagedFCM             NativeNotificationTransport = "android_managed_fcm"
	NativeNotificationTransportLinuxResidentWebSocket NativeNotificationTransport = "linux_resident_websocket"
)

type NativeEndpointState string

const (
	NativeEndpointStateActive             NativeEndpointState = "active"
	NativeEndpointStateDisabled           NativeEndpointState = "disabled"
	NativeEndpointStatePermanentlyInvalid NativeEndpointState = "permanently_invalid"
)

type NativeDeliveryStatus string

const (
	NativeDeliveryStatusNeverAttempted       NativeDeliveryStatus = "never_attempted"
	NativeDeliveryStatusPending              NativeDeliveryStatus = "pending"
	NativeDeliveryStatusDeliveredToTransport NativeDeliveryStatus = "delivered_to_transport"
	NativeDeliveryStatusRetryableFailure     NativeDeliveryStatus = "retryable_failure"
	NativeDeliveryStatusExpired              NativeDeliveryStatus = "expired"
	NativeDeliveryStatusPermanentlyInvalid   NativeDeliveryStatus = "permanently_invalid"
)

type NativeEndpointPreferences struct {
	Enabled  bool `json:"enabled"`
	Messages bool `json:"messages"`
	Calls    bool `json:"calls"`
}

type NativeEndpointPreferencesPatch struct {
	Enabled  *bool
	Messages *bool
	Calls    *bool
}

type NativeEndpointRegistration struct {
	InstallationID    string
	Platform          NativeNotificationPlatform
	Transport         NativeNotificationTransport
	AppID             string
	FCMInstallationID string
	ClientPublicKey   []byte
	Locale            string
	Preferences       NativeEndpointPreferencesPatch
}

type NativeEndpointRecord struct {
	EndpointID         string                      `json:"endpoint_id"`
	UserID             string                      `json:"user_id"`
	InstallationID     string                      `json:"installation_id"`
	Platform           NativeNotificationPlatform  `json:"platform"`
	Transport          NativeNotificationTransport `json:"transport"`
	AppID              string                      `json:"app_id"`
	FCMInstallationID  string                      `json:"managed_fcm_endpoint,omitempty"`
	ClientPublicKey    []byte                      `json:"client_public_key,omitempty"`
	Locale             string                      `json:"locale"`
	CreatedAt          time.Time                   `json:"created_at"`
	LastSeenAt         time.Time                   `json:"last_seen_at"`
	DisabledAt         *time.Time                  `json:"disabled_at,omitempty"`
	State              NativeEndpointState         `json:"state"`
	LastDeliveryStatus NativeDeliveryStatus        `json:"last_delivery_status"`
	Preferences        NativeEndpointPreferences   `json:"preferences"`
	Generation         uint64                      `json:"generation"`
}

type NativeNotificationKind string

const (
	NativeNotificationKindMessage NativeNotificationKind = "message"
	NativeNotificationKindCall    NativeNotificationKind = "call"
)

type NativeOutboxState string

const (
	NativeOutboxStatePending   NativeOutboxState = "pending"
	NativeOutboxStateLeased    NativeOutboxState = "leased"
	NativeOutboxStateRetryable NativeOutboxState = "retryable"
)

type NativeNotificationOutboxItem struct {
	OutboxID           string                 `json:"outbox_id"`
	NotificationID     string                 `json:"notification_id"`
	UserID             string                 `json:"user_id"`
	EndpointID         string                 `json:"endpoint_id"`
	EndpointGeneration uint64                 `json:"endpoint_generation"`
	Kind               NativeNotificationKind `json:"kind"`
	CollapseKey        string                 `json:"collapse_key"`
	State              NativeOutboxState      `json:"state"`
	CreatedAt          time.Time              `json:"created_at"`
	ExpiresAt          time.Time              `json:"expires_at"`
	NextAttemptAt      time.Time              `json:"next_attempt_at"`
	Attempts           int                    `json:"attempts"`
	Counter            int64                  `json:"counter"`
	LeaseOwner         string                 `json:"lease_owner,omitempty"`
	LeaseUntil         *time.Time             `json:"lease_until,omitempty"`
	LastErrorClass     string                 `json:"last_error_class,omitempty"`
}

type ClaimedNativeOutboxItem struct {
	Item     NativeNotificationOutboxItem
	Revision uint64
}

type NativeOutboxStats struct {
	PendingCount   int
	RetryableCount int
	LeasedCount    int
	OldestAge      time.Duration
}

func defaultNativeEndpointPreferences() NativeEndpointPreferences {
	return NativeEndpointPreferences{Enabled: true, Messages: true, Calls: true}
}

func applyNativeEndpointPreferencesPatch(current NativeEndpointPreferences, patch NativeEndpointPreferencesPatch) NativeEndpointPreferences {
	if patch.Enabled != nil {
		current.Enabled = *patch.Enabled
	}
	if patch.Messages != nil {
		current.Messages = *patch.Messages
	}
	if patch.Calls != nil {
		current.Calls = *patch.Calls
	}
	return current
}

func nativeEndpointID(userID, installationID, appID string) string {
	digest := sha256.Sum256([]byte("towk-native-endpoint-v1\x00" + userID + "\x00" + installationID + "\x00" + appID))
	return base64.RawURLEncoding.EncodeToString(digest[:24])
}

func nativeEndpointKey(userID, endpointID string) string {
	return nativeEndpointKeyPrefix + userID + "." + endpointID
}

func nativeEndpointKeyFilter(userID string) string {
	return nativeEndpointKeyPrefix + userID + ".*"
}

func nativeOutboxID(notificationID, endpointID string) string {
	digest := sha256.Sum256([]byte("towk-native-outbox-v1\x00" + notificationID + "\x00" + endpointID))
	return base64.RawURLEncoding.EncodeToString(digest[:24])
}

func nativeOutboxKey(endpointID, outboxID string) string {
	return nativeOutboxKeyPrefix + endpointID + "." + outboxID
}

func nativeOutboxKeyFilter(endpointID string) string {
	return nativeOutboxKeyPrefix + endpointID + ".*"
}

func normalizeNativeLocale(locale string) string {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(locale), "_", "-"))
	if separator := strings.IndexAny(normalized, ",;"); separator >= 0 {
		normalized = normalized[:separator]
	}
	if separator := strings.IndexByte(normalized, '-'); separator >= 0 {
		normalized = normalized[:separator]
	}
	switch normalized {
	case "de", "fr", "es", "pt":
		return normalized
	default:
		return defaultNativeNotificationLocale
	}
}

func validateNativeIdentifier(name, value string, minimum, maximum int, allowTilde bool) error {
	value = strings.TrimSpace(value)
	if len(value) < minimum || len(value) > maximum {
		return invalidArgument(fmt.Sprintf("%s length is invalid", name))
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '.' || r == '_' || r == '-':
		case allowTilde && r == '~':
		default:
			return invalidArgument(fmt.Sprintf("%s contains unsupported characters", name))
		}
	}
	return nil
}

func canonicalNativeEndpoint(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 4096 {
		return "", invalidArgument("ManagedFCM endpoint length is invalid")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Opaque != "" || parsed.Host == "" {
		return "", invalidArgument("ManagedFCM endpoint must be an absolute URL")
	}
	if parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" {
		return "", invalidArgument("ManagedFCM endpoint must not contain credentials, a query, or a fragment")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return "", invalidArgument("ManagedFCM endpoint host is required")
	}
	loopback := host == "localhost"
	if ip := net.ParseIP(host); ip != nil {
		loopback = ip.IsLoopback()
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
		return "", invalidArgument("ManagedFCM endpoint must use HTTPS outside loopback tests")
	}
	port := parsed.Port()
	if parsed.Scheme == "https" && port == "443" || parsed.Scheme == "http" && port == "80" {
		port = ""
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		parsed.Host = net.JoinHostPort(strings.Trim(host, "[]"), port)
	} else {
		parsed.Host = host
	}
	if parsed.Path == "" || parsed.Path == "/" {
		return "", invalidArgument("ManagedFCM endpoint path is required")
	}
	return parsed.String(), nil
}

func decodeWebPushPublicKey(encoded string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil || len(decoded) != 65 || decoded[0] != 4 {
		return nil, invalidArgument("Web Push public key must be an uncompressed P-256 key")
	}
	x, y := elliptic.Unmarshal(elliptic.P256(), decoded)
	if x == nil || y == nil {
		return nil, invalidArgument("Web Push public key is not on P-256")
	}
	return decoded, nil
}

func canonicalFCMInstallationID(raw string) (string, error) {
	token := strings.TrimSpace(raw)
	if token == "" || len(token) < 20 || len(token) > 128 {
		return "", invalidArgument("FCM installation ID length invalid")
	}
	for _, r := range token {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-' && r != '_' {
			return "", invalidArgument("FCM installation ID contains unsupported characters")
		}
	}
	return token, nil
}

func validateClientPublicKey(publicKey []byte) error {
	if len(publicKey) != 65 || publicKey[0] != 4 {
		return invalidArgument("client public key must be an uncompressed P-256 key")
	}
	x, y := elliptic.Unmarshal(elliptic.P256(), publicKey)
	if x == nil || y == nil {
		return invalidArgument("client public key is not on P-256")
	}
	return nil
}

func normalizeNativeEndpointRegistration(registration NativeEndpointRegistration) (NativeEndpointRegistration, error) {
	registration.InstallationID = strings.TrimSpace(registration.InstallationID)
	registration.AppID = strings.TrimSpace(registration.AppID)
	if err := validateNativeIdentifier("installation ID", registration.InstallationID, 16, 128, true); err != nil {
		return NativeEndpointRegistration{}, err
	}
	if err := validateNativeIdentifier("app ID", registration.AppID, 1, 128, false); err != nil {
		return NativeEndpointRegistration{}, err
	}
	registration.Locale = normalizeNativeLocale(registration.Locale)

	switch registration.Transport {
	case NativeNotificationTransportManagedFCM:
		if registration.Platform != NativeNotificationPlatformAndroid {
			return NativeEndpointRegistration{}, fmt.Errorf("%w: managed FCM is Android-only", ErrNativeEndpointUnsupported)
		}
		token, err := canonicalFCMInstallationID(registration.FCMInstallationID)
		if err != nil {
			return NativeEndpointRegistration{}, err
		}
		registration.FCMInstallationID = token
		if err := validateClientPublicKey(registration.ClientPublicKey); err != nil {
			return NativeEndpointRegistration{}, err
		}
		registration.ClientPublicKey = append([]byte(nil), registration.ClientPublicKey...)
	case NativeNotificationTransportLinuxResidentWebSocket:
		if registration.Platform != NativeNotificationPlatformLinux {
			return NativeEndpointRegistration{}, fmt.Errorf("%w: local realtime is supported only for resident desktop agents", ErrNativeEndpointUnsupported)
		}
		if registration.FCMInstallationID != "" || len(registration.ClientPublicKey) != 0 {
			return NativeEndpointRegistration{}, invalidArgument("local realtime endpoints must not include push transport material")
		}
	default:
		return NativeEndpointRegistration{}, fmt.Errorf("%w: unknown native notification transport", ErrNativeEndpointUnsupported)
	}
	return registration, nil
}

func nativeEndpointTransportEqual(record *NativeEndpointRecord, registration NativeEndpointRegistration) bool {
	return record.Platform == registration.Platform &&
		record.Transport == registration.Transport &&
		record.FCMInstallationID == registration.FCMInstallationID &&
		bytes.Equal(record.ClientPublicKey, registration.ClientPublicKey)
}

func cloneNativeEndpoint(record *NativeEndpointRecord) *NativeEndpointRecord {
	if record == nil {
		return nil
	}
	cloned := *record
	cloned.ClientPublicKey = append([]byte(nil), record.ClientPublicKey...)
	if record.DisabledAt != nil {
		disabledAt := *record.DisabledAt
		cloned.DisabledAt = &disabledAt
	}
	return &cloned
}

func marshalNativeEndpoint(record *NativeEndpointRecord) ([]byte, error) {
	data, err := json.Marshal(record)
	if err != nil {
		return nil, fmt.Errorf("marshal native endpoint: %w", err)
	}
	return data, nil
}

func unmarshalNativeEndpoint(key string, value []byte) (*NativeEndpointRecord, error) {
	var record NativeEndpointRecord
	if err := json.Unmarshal(value, &record); err != nil {
		return nil, fmt.Errorf("unmarshal native endpoint: %w", err)
	}
	if record.UserID == "" || record.EndpointID == "" || nativeEndpointKey(record.UserID, record.EndpointID) != key {
		return nil, fmt.Errorf("native endpoint identity does not match storage key")
	}
	return &record, nil
}

func (c *ChattoCore) RegisterNativeEndpoint(ctx context.Context, userID string, registration NativeEndpointRegistration) (*NativeEndpointRecord, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, invalidArgument("user ID is required")
	}
	registration, err := normalizeNativeEndpointRegistration(registration)
	if err != nil {
		return nil, err
	}
	endpointID := nativeEndpointID(userID, registration.InstallationID, registration.AppID)
	key := nativeEndpointKey(userID, endpointID)

	for range maxNativeEndpointMutationRetries {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			endpoints, listErr := c.ListNativeEndpoints(ctx, userID, true)
			if listErr != nil {
				return nil, listErr
			}
			if len(endpoints) >= maxNativeEndpointsPerUser {
				return nil, fmt.Errorf("%w: maximum native endpoints reached", ErrLimitExceeded)
			}
			now := time.Now().UTC()
			record := &NativeEndpointRecord{
				EndpointID:         endpointID,
				UserID:             userID,
				InstallationID:     registration.InstallationID,
				Platform:           registration.Platform,
				Transport:          registration.Transport,
				AppID:              registration.AppID,
				FCMInstallationID:  registration.FCMInstallationID,
				ClientPublicKey:    append([]byte(nil), registration.ClientPublicKey...),
				Locale:             registration.Locale,
				CreatedAt:          now,
				LastSeenAt:         now,
				State:              NativeEndpointStateActive,
				LastDeliveryStatus: NativeDeliveryStatusNeverAttempted,
				Preferences:        applyNativeEndpointPreferencesPatch(defaultNativeEndpointPreferences(), registration.Preferences),
				Generation:         1,
			}
			data, marshalErr := marshalNativeEndpoint(record)
			if marshalErr != nil {
				return nil, marshalErr
			}
			if _, createErr := c.storage.runtimeStateKV.Create(ctx, key, data); createErr == nil {
				return cloneNativeEndpoint(record), nil
			} else if errors.Is(createErr, jetstream.ErrKeyExists) {
				continue
			} else {
				return nil, fmt.Errorf("store native endpoint: %w", createErr)
			}
		}
		if err != nil {
			return nil, fmt.Errorf("load native endpoint: %w", err)
		}
		record, err := unmarshalNativeEndpoint(key, entry.Value())
		if err != nil {
			return nil, err
		}
		if record.InstallationID != registration.InstallationID || record.AppID != registration.AppID {
			return nil, fmt.Errorf("native endpoint logical identity mismatch")
		}

		now := time.Now().UTC()
		transportChanged := !nativeEndpointTransportEqual(record, registration)
		record.Platform = registration.Platform
		record.Transport = registration.Transport
		record.FCMInstallationID = registration.FCMInstallationID
		record.ClientPublicKey = append(record.ClientPublicKey[:0], registration.ClientPublicKey...)
		record.Locale = registration.Locale
		record.LastSeenAt = now
		record.DisabledAt = nil
		record.State = NativeEndpointStateActive
		record.Preferences = applyNativeEndpointPreferencesPatch(record.Preferences, registration.Preferences)
		if transportChanged {
			record.Generation++
			record.LastDeliveryStatus = NativeDeliveryStatusNeverAttempted
		}
		data, err := marshalNativeEndpoint(record)
		if err != nil {
			return nil, err
		}
		if _, err := c.storage.runtimeStateKV.Update(ctx, key, data, entry.Revision()); err == nil {
			return cloneNativeEndpoint(record), nil
		} else if errors.Is(err, jetstream.ErrKeyExists) {
			continue
		} else {
			return nil, fmt.Errorf("update native endpoint: %w", err)
		}
	}
	return nil, ErrNativeEndpointConflict
}

func (c *ChattoCore) GetNativeEndpoint(ctx context.Context, userID, endpointID string) (*NativeEndpointRecord, uint64, error) {
	key := nativeEndpointKey(userID, endpointID)
	entry, err := c.storage.runtimeStateKV.Get(ctx, key)
	if isRuntimeStateKeyAbsent(err) {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, fmt.Errorf("load native endpoint: %w", err)
	}
	record, err := unmarshalNativeEndpoint(key, entry.Value())
	if err != nil {
		return nil, 0, err
	}
	return cloneNativeEndpoint(record), entry.Revision(), nil
}

func (c *ChattoCore) ListNativeEndpoints(ctx context.Context, userID string, includeDisabled bool) ([]*NativeEndpointRecord, error) {
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, nativeEndpointKeyFilter(userID))
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return []*NativeEndpointRecord{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("list native endpoints: %w", err)
	}
	endpoints := make([]*NativeEndpointRecord, 0)
	for key := range lister.Keys() {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("load native endpoint: %w", err)
		}
		record, err := unmarshalNativeEndpoint(key, entry.Value())
		if err != nil {
			return nil, err
		}
		if !includeDisabled && record.State != NativeEndpointStateActive {
			continue
		}
		endpoints = append(endpoints, cloneNativeEndpoint(record))
	}
	sort.Slice(endpoints, func(i, j int) bool {
		if endpoints[i].LastSeenAt.Equal(endpoints[j].LastSeenAt) {
			return endpoints[i].EndpointID < endpoints[j].EndpointID
		}
		return endpoints[i].LastSeenAt.After(endpoints[j].LastSeenAt)
	})
	return endpoints, nil
}

func (c *ChattoCore) RotateNativeEndpoint(ctx context.Context, userID, endpointID string, expectedGeneration uint64, registration NativeEndpointRegistration) (*NativeEndpointRecord, error) {
	if expectedGeneration == 0 {
		return nil, invalidArgument("expected generation is required")
	}
	current, _, err := c.GetNativeEndpoint(ctx, userID, endpointID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, ErrNotFound
	}
	registration.InstallationID = current.InstallationID
	registration.Platform = current.Platform
	registration.Transport = current.Transport
	registration.AppID = current.AppID
	registration.Preferences = NativeEndpointPreferencesPatch{}
	registration, err = normalizeNativeEndpointRegistration(registration)
	if err != nil {
		return nil, err
	}
	key := nativeEndpointKey(userID, endpointID)
	for range maxNativeEndpointMutationRetries {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, fmt.Errorf("load native endpoint: %w", err)
		}
		record, err := unmarshalNativeEndpoint(key, entry.Value())
		if err != nil {
			return nil, err
		}
		if record.Generation != expectedGeneration {
			return nil, ErrNativeEndpointConflict
		}
		now := time.Now().UTC()
		record.FCMInstallationID = registration.FCMInstallationID
		record.ClientPublicKey = append(record.ClientPublicKey[:0], registration.ClientPublicKey...)
		record.Locale = registration.Locale
		record.LastSeenAt = now
		record.DisabledAt = nil
		record.State = NativeEndpointStateActive
		record.LastDeliveryStatus = NativeDeliveryStatusNeverAttempted
		record.Generation++
		data, err := marshalNativeEndpoint(record)
		if err != nil {
			return nil, err
		}
		if _, err := c.storage.runtimeStateKV.Update(ctx, key, data, entry.Revision()); err == nil {
			return cloneNativeEndpoint(record), nil
		} else if errors.Is(err, jetstream.ErrKeyExists) {
			continue
		} else {
			return nil, fmt.Errorf("rotate native endpoint: %w", err)
		}
	}
	return nil, ErrNativeEndpointConflict
}

func (c *ChattoCore) UnregisterNativeEndpoint(ctx context.Context, userID, endpointID string, expectedGeneration uint64) (bool, error) {
	if expectedGeneration == 0 {
		return false, invalidArgument("expected generation is required")
	}
	key := nativeEndpointKey(userID, endpointID)
	for range maxNativeEndpointMutationRetries {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			return true, nil
		}
		if err != nil {
			return false, fmt.Errorf("load native endpoint: %w", err)
		}
		record, err := unmarshalNativeEndpoint(key, entry.Value())
		if err != nil {
			return false, err
		}
		if record.State == NativeEndpointStateDisabled && record.Generation == expectedGeneration+1 {
			return true, nil
		}
		if record.Generation != expectedGeneration {
			return false, ErrNativeEndpointConflict
		}
		now := time.Now().UTC()
		record.State = NativeEndpointStateDisabled
		record.DisabledAt = &now
		record.LastSeenAt = now
		record.Generation++
		clearNativeEndpointTransportMaterial(record)
		data, err := marshalNativeEndpoint(record)
		if err != nil {
			return false, err
		}
		if _, err := c.storage.runtimeStateKV.Update(ctx, key, data, entry.Revision()); err == nil {
			_ = c.deleteNativeOutboxForEndpoint(ctx, endpointID)
			return true, nil
		} else if errors.Is(err, jetstream.ErrKeyExists) {
			continue
		} else {
			return false, fmt.Errorf("disable native endpoint: %w", err)
		}
	}
	return false, ErrNativeEndpointConflict
}

func (c *ChattoCore) UpdateNativeEndpointPreferences(ctx context.Context, userID, endpointID string, expectedGeneration uint64, patch NativeEndpointPreferencesPatch) (*NativeEndpointRecord, error) {
	if expectedGeneration == 0 {
		return nil, invalidArgument("expected generation is required")
	}
	if patch.Enabled == nil && patch.Messages == nil && patch.Calls == nil {
		return nil, invalidArgument("at least one preference must be supplied")
	}
	key := nativeEndpointKey(userID, endpointID)
	for range maxNativeEndpointMutationRetries {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, fmt.Errorf("load native endpoint: %w", err)
		}
		record, err := unmarshalNativeEndpoint(key, entry.Value())
		if err != nil {
			return nil, err
		}
		if record.Generation != expectedGeneration {
			return nil, ErrNativeEndpointConflict
		}
		record.Preferences = applyNativeEndpointPreferencesPatch(record.Preferences, patch)
		record.Generation++
		record.LastSeenAt = time.Now().UTC()
		data, err := marshalNativeEndpoint(record)
		if err != nil {
			return nil, err
		}
		if _, err := c.storage.runtimeStateKV.Update(ctx, key, data, entry.Revision()); err == nil {
			if !record.Preferences.Enabled {
				_ = c.deleteNativeOutboxForEndpoint(ctx, endpointID)
			}
			return cloneNativeEndpoint(record), nil
		} else if errors.Is(err, jetstream.ErrKeyExists) {
			continue
		} else {
			return nil, fmt.Errorf("update native endpoint preferences: %w", err)
		}
	}
	return nil, ErrNativeEndpointConflict
}

func clearNativeEndpointTransportMaterial(record *NativeEndpointRecord) {
	record.FCMInstallationID = ""
	for i := range record.ClientPublicKey {
		record.ClientPublicKey[i] = 0
	}
	record.ClientPublicKey = nil
}

func (c *ChattoCore) MarkNativeEndpointDeliveryStatus(ctx context.Context, userID, endpointID string, expectedGeneration uint64, status NativeDeliveryStatus, terminal bool) error {
	key := nativeEndpointKey(userID, endpointID)
	for range maxNativeEndpointMutationRetries {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("load native endpoint: %w", err)
		}
		record, err := unmarshalNativeEndpoint(key, entry.Value())
		if err != nil {
			return err
		}
		if record.Generation != expectedGeneration {
			return ErrNativeEndpointConflict
		}
		record.LastDeliveryStatus = status
		if terminal {
			now := time.Now().UTC()
			record.State = NativeEndpointStatePermanentlyInvalid
			record.DisabledAt = &now
			record.Generation++
			clearNativeEndpointTransportMaterial(record)
		}
		data, err := marshalNativeEndpoint(record)
		if err != nil {
			return err
		}
		if _, err := c.storage.runtimeStateKV.Update(ctx, key, data, entry.Revision()); err == nil {
			if terminal {
				_ = c.deleteNativeOutboxForEndpoint(ctx, endpointID)
			}
			return nil
		} else if errors.Is(err, jetstream.ErrKeyExists) {
			continue
		} else {
			return fmt.Errorf("update native endpoint delivery status: %w", err)
		}
	}
	return ErrNativeEndpointConflict
}

func (c *ChattoCore) DeleteAllUserNativeEndpoints(ctx context.Context, userID string) (int, error) {
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, nativeEndpointKeyFilter(userID))
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("list native endpoints: %w", err)
	}
	deleted := 0
	for key := range lister.Keys() {
		for range maxNativeEndpointMutationRetries {
			entry, err := c.storage.runtimeStateKV.Get(ctx, key)
			if isRuntimeStateKeyAbsent(err) {
				break
			}
			if err != nil {
				return deleted, fmt.Errorf("load native endpoint for deletion: %w", err)
			}
			record, err := unmarshalNativeEndpoint(key, entry.Value())
			if err != nil {
				return deleted, err
			}
			if err := c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(entry.Revision())); err == nil || isRuntimeStateKeyAbsent(err) {
				_ = c.deleteNativeOutboxForEndpoint(ctx, record.EndpointID)
				deleted++
				break
			} else if errors.Is(err, jetstream.ErrKeyExists) {
				continue
			} else {
				return deleted, fmt.Errorf("delete native endpoint: %w", err)
			}
		}
	}
	return deleted, nil
}

func nativeNotificationKind(notification *corev1.Notification) NativeNotificationKind {
	if notification != nil && notification.GetCallStarted() != nil {
		return NativeNotificationKindCall
	}
	return NativeNotificationKindMessage
}

func nativeNotificationTTL(kind NativeNotificationKind) time.Duration {
	if kind == NativeNotificationKindCall {
		return defaultNativeCallTTL
	}
	return defaultNativeMessageTTL
}

func nativeNotificationRoomID(notification *corev1.Notification) string {
	if notification == nil {
		return ""
	}
	switch {
	case notification.GetDmMessage() != nil:
		return notification.GetDmMessage().GetRoomId()
	case notification.GetMention() != nil:
		return notification.GetMention().GetRoomId()
	case notification.GetReply() != nil:
		return notification.GetReply().GetRoomId()
	case notification.GetRoomMessage() != nil:
		return notification.GetRoomMessage().GetRoomId()
	case notification.GetCallStarted() != nil:
		return notification.GetCallStarted().GetRoomId()
	default:
		return ""
	}
}

func nativeNotificationCollapseKey(notification *corev1.Notification) string {
	kind := nativeNotificationKind(notification)
	roomID := nativeNotificationRoomID(notification)
	digest := sha256.Sum256([]byte("towk-native-collapse-v1\x00" + string(kind) + "\x00" + roomID))
	return string(kind) + ":" + base64.RawURLEncoding.EncodeToString(digest[:12])
}

func nativeEndpointAcceptsNotification(endpoint *NativeEndpointRecord, kind NativeNotificationKind) bool {
	if endpoint == nil || endpoint.State != NativeEndpointStateActive || endpoint.Transport != NativeNotificationTransportManagedFCM || !endpoint.Preferences.Enabled {
		return false
	}
	if kind == NativeNotificationKindCall {
		return endpoint.Preferences.Calls
	}
	return endpoint.Preferences.Messages
}

func (c *ChattoCore) EnqueueNativeNotification(ctx context.Context, notification *corev1.Notification) (int, error) {
	if notification == nil || notification.GetId() == "" || notification.GetRecipientId() == "" || notification.GetCreatedAt() == nil {
		return 0, invalidArgument("complete notification identity is required")
	}
	kind := nativeNotificationKind(notification)
	createdAt := notification.GetCreatedAt().AsTime().UTC()
	expiresAt := createdAt.Add(nativeNotificationTTL(kind))
	if !expiresAt.After(time.Now()) {
		return 0, nil
	}
	endpoints, err := c.ListNativeEndpoints(ctx, notification.GetRecipientId(), false)
	if err != nil {
		return 0, err
	}
	enqueued := 0
	for _, endpoint := range endpoints {
		if !nativeEndpointAcceptsNotification(endpoint, kind) {
			continue
		}
		item := NativeNotificationOutboxItem{
			OutboxID:           nativeOutboxID(notification.GetId(), endpoint.EndpointID),
			NotificationID:     notification.GetId(),
			UserID:             notification.GetRecipientId(),
			EndpointID:         endpoint.EndpointID,
			EndpointGeneration: endpoint.Generation,
			Kind:               kind,
			CollapseKey:        nativeNotificationCollapseKey(notification),
			State:              NativeOutboxStatePending,
			CreatedAt:          createdAt,
			ExpiresAt:          expiresAt,
			NextAttemptAt:      time.Now().UTC(),
			Counter:            time.Now().UTC().UnixNano(),
		}
		created, err := c.ensureNativeOutboxItem(ctx, item)
		if err != nil {
			return enqueued, err
		}
		if created {
			enqueued++
		}
	}
	return enqueued, nil
}

func (c *ChattoCore) ensureNativeOutboxItem(ctx context.Context, item NativeNotificationOutboxItem) (bool, error) {
	count, err := c.countNativeOutboxForEndpoint(ctx, item.EndpointID)
	if err != nil {
		return false, err
	}
	key := nativeOutboxKey(item.EndpointID, item.OutboxID)
	if count >= maxNativeOutboxItemsPerEndpoint {
		if _, _, getErr := c.getNativeOutboxItem(ctx, key); getErr == nil {
			return false, nil
		}
		return false, ErrNativeOutboxSaturated
	}
	if err := c.expireCollapsedNativeOutboxItems(ctx, item.EndpointID, item.CollapseKey, item.OutboxID); err != nil {
		return false, err
	}
	data, err := json.Marshal(&item)
	if err != nil {
		return false, fmt.Errorf("marshal native outbox item: %w", err)
	}
	if _, err := c.storage.runtimeStateKV.Create(ctx, key, data, jetstream.KeyTTL(time.Until(item.ExpiresAt))); err == nil {
		return true, nil
	} else if errors.Is(err, jetstream.ErrKeyExists) {
		return false, nil
	} else {
		return false, fmt.Errorf("create native outbox item: %w", err)
	}
}

func (c *ChattoCore) countNativeOutboxForEndpoint(ctx context.Context, endpointID string) (int, error) {
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, nativeOutboxKeyFilter(endpointID))
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("list native outbox items: %w", err)
	}
	count := 0
	for range lister.Keys() {
		count++
		if count > maxNativeOutboxItemsPerEndpoint {
			break
		}
	}
	return count, nil
}

func (c *ChattoCore) expireCollapsedNativeOutboxItems(ctx context.Context, endpointID, collapseKey, exceptOutboxID string) error {
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, nativeOutboxKeyFilter(endpointID))
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("list collapsed native outbox items: %w", err)
	}
	for key := range lister.Keys() {
		item, revision, err := c.getNativeOutboxItem(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			continue
		}
		if err != nil {
			return err
		}
		if item.OutboxID == exceptOutboxID || item.CollapseKey != collapseKey || item.State == NativeOutboxStateLeased {
			continue
		}
		if err := c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(revision)); err != nil && !errors.Is(err, jetstream.ErrKeyExists) && !isRuntimeStateKeyAbsent(err) {
			return fmt.Errorf("expire collapsed native outbox item: %w", err)
		}
	}
	return nil
}

func (c *ChattoCore) getNativeOutboxItem(ctx context.Context, key string) (*NativeNotificationOutboxItem, uint64, error) {
	entry, err := c.storage.runtimeStateKV.Get(ctx, key)
	if err != nil {
		return nil, 0, err
	}
	var item NativeNotificationOutboxItem
	if err := json.Unmarshal(entry.Value(), &item); err != nil {
		return nil, 0, fmt.Errorf("unmarshal native outbox item: %w", err)
	}
	if item.EndpointID == "" || item.OutboxID == "" || nativeOutboxKey(item.EndpointID, item.OutboxID) != key {
		return nil, 0, fmt.Errorf("native outbox identity does not match storage key")
	}
	return &item, entry.Revision(), nil
}

func (c *ChattoCore) deleteNativeOutboxForEndpoint(ctx context.Context, endpointID string) error {
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, nativeOutboxKeyFilter(endpointID))
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("list native outbox items for deletion: %w", err)
	}
	for key := range lister.Keys() {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			continue
		}
		if err != nil {
			return err
		}
		if err := c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(entry.Revision())); err != nil && !errors.Is(err, jetstream.ErrKeyExists) && !isRuntimeStateKeyAbsent(err) {
			return err
		}
	}
	return nil
}

func (c *ChattoCore) ClaimNativeNotificationOutbox(ctx context.Context, workerID string, now time.Time, limit int, leaseDuration time.Duration) ([]ClaimedNativeOutboxItem, error) {
	workerID = strings.TrimSpace(workerID)
	if err := validateNativeIdentifier("worker ID", workerID, 8, 128, true); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > maximumNativeNotificationBatchClaim {
		limit = maximumNativeNotificationBatchClaim
	}
	if leaseDuration <= 0 || leaseDuration > 5*time.Minute {
		leaseDuration = defaultNativeOutboxLease
	}
	if now.IsZero() {
		now = time.Now().UTC()
	} else {
		now = now.UTC()
	}
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, nativeOutboxKeyPrefix+">")
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return []ClaimedNativeOutboxItem{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("list native outbox: %w", err)
	}
	type candidate struct {
		key      string
		item     *NativeNotificationOutboxItem
		revision uint64
	}
	candidates := make([]candidate, 0, limit*2)
	for key := range lister.Keys() {
		item, revision, err := c.getNativeOutboxItem(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !item.ExpiresAt.After(now) || item.Attempts >= maxNativeOutboxDeliveryAttempts {
			_ = c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(revision))
			continue
		}
		if item.State == NativeOutboxStateLeased && item.LeaseUntil != nil && item.LeaseUntil.After(now) {
			continue
		}
		if item.NextAttemptAt.After(now) {
			continue
		}
		candidates = append(candidates, candidate{key: key, item: item, revision: revision})
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].item.NextAttemptAt.Equal(candidates[j].item.NextAttemptAt) {
			return candidates[i].item.CreatedAt.Before(candidates[j].item.CreatedAt)
		}
		return candidates[i].item.NextAttemptAt.Before(candidates[j].item.NextAttemptAt)
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	claimed := make([]ClaimedNativeOutboxItem, 0, len(candidates))
	for _, candidate := range candidates {
		leaseUntil := now.Add(leaseDuration)
		candidate.item.State = NativeOutboxStateLeased
		candidate.item.LeaseOwner = workerID
		candidate.item.LeaseUntil = &leaseUntil
		candidate.item.Attempts++
		data, err := json.Marshal(candidate.item)
		if err != nil {
			return nil, err
		}
		newRevision, err := c.storage.runtimeStateKV.Update(ctx, candidate.key, data, candidate.revision)
		if errors.Is(err, jetstream.ErrKeyExists) || isRuntimeStateKeyAbsent(err) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("claim native outbox item: %w", err)
		}
		claimed = append(claimed, ClaimedNativeOutboxItem{Item: *candidate.item, Revision: newRevision})
	}
	return claimed, nil
}

func (c *ChattoCore) CompleteNativeNotificationOutbox(ctx context.Context, claimed ClaimedNativeOutboxItem, workerID string) error {
	key := nativeOutboxKey(claimed.Item.EndpointID, claimed.Item.OutboxID)
	item, revision, err := c.getNativeOutboxItem(ctx, key)
	if isRuntimeStateKeyAbsent(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if item.State != NativeOutboxStateLeased || item.LeaseOwner != workerID || revision != claimed.Revision {
		return ErrNativeOutboxLeaseLost
	}
	if err := c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(revision)); err != nil && !isRuntimeStateKeyAbsent(err) {
		if errors.Is(err, jetstream.ErrKeyExists) {
			return ErrNativeOutboxLeaseLost
		}
		return fmt.Errorf("complete native outbox item: %w", err)
	}
	return c.MarkNativeEndpointDeliveryStatus(ctx, item.UserID, item.EndpointID, item.EndpointGeneration, NativeDeliveryStatusDeliveredToTransport, false)
}

func (c *ChattoCore) RetryNativeNotificationOutbox(ctx context.Context, claimed ClaimedNativeOutboxItem, workerID, errorClass string, delay time.Duration, now time.Time) error {
	if delay < time.Second {
		delay = time.Second
	}
	if delay > maximumNativeOutboxRetryDelay {
		delay = maximumNativeOutboxRetryDelay
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	key := nativeOutboxKey(claimed.Item.EndpointID, claimed.Item.OutboxID)
	item, revision, err := c.getNativeOutboxItem(ctx, key)
	if isRuntimeStateKeyAbsent(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if item.State != NativeOutboxStateLeased || item.LeaseOwner != workerID || revision != claimed.Revision {
		return ErrNativeOutboxLeaseLost
	}
	if item.Attempts >= maxNativeOutboxDeliveryAttempts || !item.ExpiresAt.After(now.Add(delay)) {
		if err := c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(revision)); err != nil && !isRuntimeStateKeyAbsent(err) {
			return err
		}
		return c.MarkNativeEndpointDeliveryStatus(ctx, item.UserID, item.EndpointID, item.EndpointGeneration, NativeDeliveryStatusExpired, false)
	}
	item.State = NativeOutboxStateRetryable
	item.LeaseOwner = ""
	item.LeaseUntil = nil
	item.NextAttemptAt = now.Add(delay)
	item.LastErrorClass = sanitizeNativeErrorClass(errorClass)
	data, err := json.Marshal(item)
	if err != nil {
		return err
	}
	if _, err := c.storage.runtimeStateKV.Update(ctx, key, data, revision); err != nil {
		if errors.Is(err, jetstream.ErrKeyExists) {
			return ErrNativeOutboxLeaseLost
		}
		return err
	}
	return c.MarkNativeEndpointDeliveryStatus(ctx, item.UserID, item.EndpointID, item.EndpointGeneration, NativeDeliveryStatusRetryableFailure, false)
}

func sanitizeNativeErrorClass(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) > 64 {
		value = value[:64]
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return "transport_error"
		}
	}
	if value == "" {
		return "transport_error"
	}
	return value
}

func (c *ChattoCore) PermanentlyInvalidateNativeNotificationOutbox(ctx context.Context, claimed ClaimedNativeOutboxItem, workerID string) error {
	key := nativeOutboxKey(claimed.Item.EndpointID, claimed.Item.OutboxID)
	item, revision, err := c.getNativeOutboxItem(ctx, key)
	if isRuntimeStateKeyAbsent(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if item.State != NativeOutboxStateLeased || item.LeaseOwner != workerID || revision != claimed.Revision {
		return ErrNativeOutboxLeaseLost
	}
	if err := c.storage.runtimeStateKV.Delete(ctx, key, jetstream.LastRevision(revision)); err != nil && !isRuntimeStateKeyAbsent(err) {
		return err
	}
	return c.MarkNativeEndpointDeliveryStatus(ctx, item.UserID, item.EndpointID, item.EndpointGeneration, NativeDeliveryStatusPermanentlyInvalid, true)
}

func (c *ChattoCore) ReconcileNativeNotificationOutbox(ctx context.Context, maximum int) (int, error) {
	if maximum <= 0 {
		maximum = 10_000
	}
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, nativeEndpointKeyPrefix+">")
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("list native endpoints for outbox reconciliation: %w", err)
	}
	reconciled := 0
	seenUsers := make(map[string]struct{})
	for key := range lister.Keys() {
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			continue
		}
		if err != nil {
			return reconciled, err
		}
		endpoint, err := unmarshalNativeEndpoint(key, entry.Value())
		if err != nil {
			return reconciled, err
		}
		if endpoint.State != NativeEndpointStateActive || endpoint.Transport != NativeNotificationTransportManagedFCM {
			continue
		}
		if _, already := seenUsers[endpoint.UserID]; already {
			continue
		}
		seenUsers[endpoint.UserID] = struct{}{}
		notifications, err := c.GetNotifications(ctx, endpoint.UserID)
		if err != nil {
			return reconciled, err
		}
		for _, notification := range notifications {
			if reconciled >= maximum {
				return reconciled, nil
			}
			created, err := c.EnqueueNativeNotification(ctx, notification)
			if err != nil {
				if errors.Is(err, ErrNativeOutboxSaturated) {
					return reconciled, err
				}
				return reconciled, err
			}
			reconciled += created
		}
	}
	return reconciled, nil
}

func (c *ChattoCore) NativeNotificationOutboxStats(ctx context.Context, now time.Time) (NativeOutboxStats, error) {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	lister, err := c.storage.runtimeStateKV.ListKeysFiltered(ctx, nativeOutboxKeyPrefix+">")
	if errors.Is(err, jetstream.ErrNoKeysFound) {
		return NativeOutboxStats{}, nil
	}
	if err != nil {
		return NativeOutboxStats{}, err
	}
	stats := NativeOutboxStats{}
	var oldest time.Time
	for key := range lister.Keys() {
		item, _, err := c.getNativeOutboxItem(ctx, key)
		if isRuntimeStateKeyAbsent(err) {
			continue
		}
		if err != nil {
			return NativeOutboxStats{}, err
		}
		switch item.State {
		case NativeOutboxStatePending:
			stats.PendingCount++
		case NativeOutboxStateRetryable:
			stats.RetryableCount++
		case NativeOutboxStateLeased:
			stats.LeasedCount++
		}
		if oldest.IsZero() || item.CreatedAt.Before(oldest) {
			oldest = item.CreatedAt
		}
	}
	if !oldest.IsZero() && now.After(oldest) {
		stats.OldestAge = now.Sub(oldest)
	}
	return stats, nil
}
