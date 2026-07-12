package core

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"hmans.de/chatto/internal/config"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/testutil"
)

func TestAuthRateLimitIsDistributedHMACKeyedAndOCCBounded(t *testing.T) {
	_, nc := testutil.StartSharedNATS(t)
	cfg := config.CoreConfig{
		SecretKey: "rate-limit-test-secret",
		Assets: config.AssetsConfig{
			SigningSecret: "rate-limit-assets-secret",
		},
		AuthRateLimit: config.AuthRateLimitConfig{
			Window:             config.Duration(time.Minute),
			LoginPerIP:         100,
			LoginPerIdentifier: 4,
		},
	}
	ctx := WithAuditRequestMetadata(testContext(t), &corev1.AuditRequestMetadata{IpHash: "ip-fingerprint"})
	c1, err := NewChattoCore(ctx, nc, cfg)
	if err != nil {
		t.Fatalf("NewChattoCore c1: %v", err)
	}
	c2, err := NewChattoCore(ctx, nc, cfg)
	if err != nil {
		t.Fatalf("NewChattoCore c2: %v", err)
	}

	const attempts = 12
	start := make(chan struct{})
	results := make(chan error, attempts)
	var wg sync.WaitGroup
	for i := range attempts {
		wg.Add(1)
		go func(coreIndex int) {
			defer wg.Done()
			<-start
			selected := c1
			if coreIndex%2 == 1 {
				selected = c2
			}
			_, reserveErr := selected.ReserveAuthAttempt(ctx, AuthRateLimitLogin, "User@Example.com")
			results <- reserveErr
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)

	var admitted, limited int
	for reserveErr := range results {
		switch {
		case reserveErr == nil:
			admitted++
		case errors.Is(reserveErr, ErrAuthRateLimitExceeded):
			limited++
		default:
			t.Fatalf("ReserveAuthAttempt err = %v", reserveErr)
		}
	}
	if admitted != 4 || limited != attempts-4 {
		t.Fatalf("distributed attempts = admitted %d limited %d, want 4/%d", admitted, limited, attempts-4)
	}

	key := c1.authRateLimitKey(AuthRateLimitLogin, "identifier", "user@example.com")
	if strings.Contains(key, "user") || strings.Contains(key, "example") {
		t.Fatalf("rate-limit key exposes identifier: %q", key)
	}
	assertRuntimeKVHasTTL(t, c1, key)

	if err := c2.ClearAuthIdentifierLimit(ctx, AuthRateLimitLogin, " USER@example.com "); err != nil {
		t.Fatalf("ClearAuthIdentifierLimit: %v", err)
	}
	if _, err := c1.ReserveAuthAttempt(ctx, AuthRateLimitLogin, "user@example.com"); err != nil {
		t.Fatalf("ReserveAuthAttempt after identifier clear: %v", err)
	}
}

func TestAuthRateLimitSourceIPBudgetSpansIdentifiers(t *testing.T) {
	_, nc := testutil.StartSharedNATS(t)
	c, err := NewChattoCore(testContext(t), nc, config.CoreConfig{
		SecretKey: "rate-limit-ip-test-secret",
		Assets:    config.AssetsConfig{SigningSecret: "rate-limit-assets-secret"},
		AuthRateLimit: config.AuthRateLimitConfig{
			Window:             config.Duration(time.Minute),
			LoginPerIP:         2,
			LoginPerIdentifier: 100,
		},
	})
	if err != nil {
		t.Fatalf("NewChattoCore: %v", err)
	}
	ctx := WithAuditRequestMetadata(testContext(t), &corev1.AuditRequestMetadata{IpHash: "shared-ip-fingerprint"})
	for _, login := range []string{"first", "second"} {
		if _, err := c.ReserveAuthAttempt(ctx, AuthRateLimitLogin, login); err != nil {
			t.Fatalf("ReserveAuthAttempt(%q): %v", login, err)
		}
	}
	if _, err := c.ReserveAuthAttempt(ctx, AuthRateLimitLogin, "third"); !errors.Is(err, ErrAuthRateLimitExceeded) {
		t.Fatalf("third identifier error = %v, want ErrAuthRateLimitExceeded", err)
	}

	otherIP := WithAuditRequestMetadata(testContext(t), &corev1.AuditRequestMetadata{IpHash: "other-ip-fingerprint"})
	if _, err := c.ReserveAuthAttempt(otherIP, AuthRateLimitLogin, "third"); err != nil {
		t.Fatalf("ReserveAuthAttempt from other IP: %v", err)
	}
}
