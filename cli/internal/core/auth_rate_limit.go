package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

const (
	authRateLimitKeyPrefix  = "auth_rate_limit."
	authRateLimitMaxRetries = 16
)

type AuthRateLimitEndpoint string

const (
	AuthRateLimitLogin          AuthRateLimitEndpoint = "login"
	AuthRateLimitForgotPassword AuthRateLimitEndpoint = "forgot_password"
	AuthRateLimitResetPassword  AuthRateLimitEndpoint = "reset_password"
)

var ErrAuthRateLimitExceeded = errors.New("authentication rate limit exceeded")

type authRateLimitCounter struct {
	Count       int       `json:"count"`
	WindowStart time.Time `json:"window_start"`
}

// ReserveAuthAttempt atomically reserves one attempt against both the source
// IP and endpoint-specific identifier windows. Keys are HMAC-derived and the
// counters live in RUNTIME_STATE so every replica observes the same budget.
func (c *ChattoCore) ReserveAuthAttempt(ctx context.Context, endpoint AuthRateLimitEndpoint, identifier string) (time.Duration, error) {
	if !c.config.AuthRateLimit.EnabledOrDefault() {
		return 0, nil
	}
	ipHash := "unknown"
	if metadata := AuditRequestMetadataFromContext(ctx); metadata != nil && metadata.GetIpHash() != "" {
		ipHash = metadata.GetIpHash()
	}
	dimensions := []struct {
		name    string
		subject string
		limit   int
	}{
		{name: "ip", subject: ipHash, limit: c.authRateLimitFor(endpoint, true)},
	}
	if normalized := strings.ToLower(strings.TrimSpace(identifier)); normalized != "" {
		dimensions = append(dimensions, struct {
			name    string
			subject string
			limit   int
		}{name: "identifier", subject: normalized, limit: c.authRateLimitFor(endpoint, false)})
	}

	var longestRetry time.Duration
	for _, dimension := range dimensions {
		key := c.authRateLimitKey(endpoint, dimension.name, dimension.subject)
		retryAfter, err := c.reserveFixedWindowRateLimit(
			ctx,
			key,
			dimension.limit,
			c.config.AuthRateLimit.WindowOrDefault(),
			ErrAuthRateLimitExceeded,
		)
		if retryAfter > longestRetry {
			longestRetry = retryAfter
		}
		if err != nil {
			return longestRetry, err
		}
	}
	return 0, nil
}

// ClearAuthIdentifierLimit clears only the identifier window after successful
// authentication. The source-IP budget remains intact to bound distributed
// credential-stuffing traffic across many accounts.
func (c *ChattoCore) ClearAuthIdentifierLimit(ctx context.Context, endpoint AuthRateLimitEndpoint, identifier string) error {
	if !c.config.AuthRateLimit.EnabledOrDefault() {
		return nil
	}
	identifier = strings.ToLower(strings.TrimSpace(identifier))
	if identifier == "" {
		return nil
	}
	key := c.authRateLimitKey(endpoint, "identifier", identifier)
	if err := c.storage.runtimeStateKV.Delete(ctx, key); err != nil && !isRuntimeStateKeyAbsent(err) {
		return fmt.Errorf("clear auth identifier rate limit: %w", err)
	}
	return nil
}

func (c *ChattoCore) authRateLimitFor(endpoint AuthRateLimitEndpoint, ip bool) int {
	switch endpoint {
	case AuthRateLimitLogin:
		if ip {
			return c.config.AuthRateLimit.LoginPerIPOrDefault()
		}
		return c.config.AuthRateLimit.LoginPerIdentifierOrDefault()
	case AuthRateLimitForgotPassword:
		if ip {
			return c.config.AuthRateLimit.ForgotPerIPOrDefault()
		}
		return c.config.AuthRateLimit.ForgotPerIdentifierOrDefault()
	case AuthRateLimitResetPassword:
		if ip {
			return c.config.AuthRateLimit.ResetPerIPOrDefault()
		}
		return c.config.AuthRateLimit.ResetPerTokenOrDefault()
	default:
		return 1
	}
}

func (c *ChattoCore) authRateLimitKey(endpoint AuthRateLimitEndpoint, dimension, subject string) string {
	hash := c.runtimeTokenHash("auth_rate_limit."+string(endpoint)+"."+dimension, subject)
	return authRateLimitKeyPrefix + string(endpoint) + "." + dimension + "." + hash
}

func (c *ChattoCore) reserveFixedWindowRateLimit(ctx context.Context, key string, limit int, window time.Duration, exceeded error) (time.Duration, error) {
	if limit <= 0 || window <= 0 {
		return 0, nil
	}
	for range authRateLimitMaxRetries {
		now := time.Now()
		entry, err := c.storage.runtimeStateKV.Get(ctx, key)
		if err != nil {
			if !isRuntimeStateKeyAbsent(err) {
				return 0, fmt.Errorf("read rate limit: %w", err)
			}
			counter := authRateLimitCounter{Count: 1, WindowStart: now}
			data, marshalErr := json.Marshal(counter)
			if marshalErr != nil {
				return 0, fmt.Errorf("marshal rate limit: %w", marshalErr)
			}
			if _, createErr := c.storage.runtimeStateKV.Create(ctx, key, data, jetstream.KeyTTL(window)); createErr == nil {
				return 0, nil
			} else if errors.Is(createErr, jetstream.ErrKeyExists) {
				continue
			} else {
				return 0, fmt.Errorf("create rate limit: %w", createErr)
			}
		}

		var counter authRateLimitCounter
		if err := json.Unmarshal(entry.Value(), &counter); err != nil {
			return 0, fmt.Errorf("unmarshal rate limit: %w", err)
		}
		windowEnd := counter.WindowStart.Add(window)
		if counter.WindowStart.IsZero() || !now.Before(windowEnd) {
			counter = authRateLimitCounter{Count: 1, WindowStart: now}
		} else if counter.Count >= limit {
			return max(windowEnd.Sub(now), time.Second), exceeded
		} else {
			counter.Count++
		}

		data, err := json.Marshal(counter)
		if err != nil {
			return 0, fmt.Errorf("marshal rate limit: %w", err)
		}
		if _, err := c.updateRuntimeStateTokenTTL(ctx, key, data, entry.Revision(), window); err == nil {
			return 0, nil
		} else if isRuntimeStateRevisionConflict(err) {
			continue
		} else {
			return 0, fmt.Errorf("update rate limit: %w", err)
		}
	}
	return 0, fmt.Errorf("rate limit update conflict after %d retries", authRateLimitMaxRetries)
}
