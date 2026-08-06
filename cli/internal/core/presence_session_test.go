package core

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

func TestPresenceSessionKeyRoundTrip(t *testing.T) {
	key := presenceSessionKey(presenceActiveSessionPrefix, "user123", "install-a", "tab-b")
	prefix, userID, installationID, sessionID, ok := parsePresenceSessionKey(key)
	if !ok {
		t.Fatalf("parsePresenceSessionKey(%q) failed", key)
	}
	if prefix != presenceActiveSessionPrefix || userID != "user123" || installationID != "install-a" || sessionID != "tab-b" {
		t.Fatalf("parsed key = (%q, %q, %q, %q)", prefix, userID, installationID, sessionID)
	}

	invalid := []string{
		"presence.user123",
		"presence-active.user123.install-a",
		"presence-active.user.123.install-a.tab-b",
		"presence-active.user123.bad>install.tab-b",
		"presence-active.user123.install-a.bad.tab",
	}
	for _, candidate := range invalid {
		if _, _, _, _, ok := parsePresenceSessionKey(candidate); ok {
			t.Fatalf("parsePresenceSessionKey(%q) unexpectedly succeeded", candidate)
		}
	}
}

func TestChattoCorePresenceSessionsAggregateAcrossDevices(t *testing.T) {
	chatCore, _ := setupTestCore(t)
	ctx := testContext(t)
	userID := "session-user"

	status, err := chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
		InstallationID: "install-a",
		SessionID:      "tab-a",
		Status:         PresenceStatusOnline,
		Active:         true,
	})
	if err != nil {
		t.Fatalf("active session report: %v", err)
	}
	if status != PresenceStatusOnline {
		t.Fatalf("active status = %q, want ONLINE", status)
	}

	status, err = chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
		InstallationID: "install-b",
		SessionID:      "tab-b",
		Status:         PresenceStatusAway,
		Active:         false,
	})
	if err != nil {
		t.Fatalf("inactive second session report: %v", err)
	}
	if status != PresenceStatusOnline {
		t.Fatalf("aggregate with one active session = %q, want ONLINE", status)
	}

	if err := chatCore.presenceModel.deletePresenceSessionLease(
		ctx,
		presenceSessionKey(presenceActiveSessionPrefix, userID, "install-a", "tab-a"),
	); err != nil {
		t.Fatalf("delete active lease: %v", err)
	}
	status, err = chatCore.presenceModel.reconcilePresenceSessions(ctx, userID, false)
	if err != nil {
		t.Fatalf("reconcile inactive sessions: %v", err)
	}
	if status != PresenceStatusAway {
		t.Fatalf("inactive aggregate = %q, want AWAY", status)
	}

	if _, err := chatCore.ReleasePresenceInstallation(ctx, userID, "install-a"); err != nil {
		t.Fatalf("release install-a: %v", err)
	}
	status, err = chatCore.ReleasePresenceInstallation(ctx, userID, "install-b")
	if err != nil {
		t.Fatalf("release install-b: %v", err)
	}
	if status != PresenceStatusOffline {
		t.Fatalf("released aggregate = %q, want OFFLINE", status)
	}
}

func TestChattoCorePresenceSessionManualModeWinsUntilExplicitOnline(t *testing.T) {
	chatCore, _ := setupTestCore(t)
	ctx := testContext(t)
	userID := "manual-session-user"

	status, err := chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
		InstallationID: "install-a",
		SessionID:      "tab-a",
		Status:         PresenceStatusDoNotDisturb,
		Active:         true,
		UserSelected:   true,
	})
	if err != nil {
		t.Fatalf("manual DND report: %v", err)
	}
	if status != PresenceStatusDoNotDisturb {
		t.Fatalf("manual status = %q, want DND", status)
	}

	status, err = chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
		InstallationID: "install-b",
		SessionID:      "tab-b",
		Status:         PresenceStatusOnline,
		Active:         true,
	})
	if err != nil {
		t.Fatalf("automatic second device report: %v", err)
	}
	if status != PresenceStatusDoNotDisturb {
		t.Fatalf("automatic report overwrote DND: %q", status)
	}

	status, err = chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
		InstallationID: "install-b",
		SessionID:      "tab-b",
		Status:         PresenceStatusOnline,
		Active:         true,
		UserSelected:   true,
	})
	if err != nil {
		t.Fatalf("explicit online report: %v", err)
	}
	if status != PresenceStatusOnline {
		t.Fatalf("explicit online status = %q, want ONLINE", status)
	}
}

func TestChattoCorePresenceSessionWritesBoundedTTLs(t *testing.T) {
	chatCore, _ := setupTestCore(t)
	ctx := testContext(t)
	userID := "ttl-session-user"
	installationID := "install-a"
	sessionID := "tab-a"

	if _, err := chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
		InstallationID: installationID,
		SessionID:      sessionID,
		Status:         PresenceStatusOnline,
		Active:         true,
	}); err != nil {
		t.Fatalf("ReportPresenceSession: %v", err)
	}

	stream, err := chatCore.js.Stream(ctx, "KV_MEMORY_CACHE")
	if err != nil {
		t.Fatalf("open MEMORY_CACHE stream: %v", err)
	}
	active, err := stream.GetLastMsgForSubject(
		ctx,
		"$KV.MEMORY_CACHE."+presenceSessionKey(
			presenceActiveSessionPrefix,
			userID,
			installationID,
			sessionID,
		),
	)
	if err != nil {
		t.Fatalf("get active lease message: %v", err)
	}
	if got := active.Header.Get(jetstream.MsgTTLHeader); got != PresenceTTL.String() {
		t.Fatalf("active lease TTL = %q, want %q", got, PresenceTTL.String())
	}

	recent, err := stream.GetLastMsgForSubject(
		ctx,
		"$KV.MEMORY_CACHE."+presenceSessionKey(
			presenceRecentSessionPrefix,
			userID,
			installationID,
			sessionID,
		),
	)
	if err != nil {
		t.Fatalf("get recent lease message: %v", err)
	}
	if got := recent.Header.Get(jetstream.MsgTTLHeader); got != PresenceRecentTTL.String() {
		t.Fatalf("recent lease TTL = %q, want %q", got, PresenceRecentTTL.String())
	}
}

func TestChattoCorePresenceSessionLimitsInstallationCardinality(t *testing.T) {
	chatCore, _ := setupTestCore(t)
	ctx := testContext(t)
	userID := "bounded-installation-user"

	for i := 0; i < maxPresenceSessionsPerInstallation; i++ {
		if _, err := chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
			InstallationID: "install-a",
			SessionID:      fmt.Sprintf("tab-%d", i),
			Status:         PresenceStatusAway,
			Active:         false,
		}); err != nil {
			t.Fatalf("create session %d: %v", i, err)
		}
	}

	if _, err := chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
		InstallationID: "install-a",
		SessionID:      "tab-over-limit",
		Status:         PresenceStatusAway,
		Active:         false,
	}); !errors.Is(err, ErrPresenceSessionLimit) {
		t.Fatalf("over-limit error = %v, want ErrPresenceSessionLimit", err)
	}

	if _, err := chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
		InstallationID: "install-a",
		SessionID:      "tab-0",
		Status:         PresenceStatusOnline,
		Active:         true,
	}); err != nil {
		t.Fatalf("refresh existing session at limit: %v", err)
	}
}

func TestChattoCorePresenceSessionLimitIsSerializedAcrossConcurrentWriters(t *testing.T) {
	chatCore, _ := setupTestCore(t)
	ctx := testContext(t)
	userID := "bounded-concurrent-user"
	const attempts = maxPresenceSessionsPerUser + 12

	start := make(chan struct{})
	var wg sync.WaitGroup
	errs := make(chan error, attempts)
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, err := chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
				InstallationID: fmt.Sprintf("install-%d", i),
				SessionID:      "tab-a",
				Status:         PresenceStatusAway,
				Active:         false,
			})
			errs <- err
		}(i)
	}
	close(start)
	wg.Wait()
	close(errs)

	successes := 0
	limited := 0
	for err := range errs {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrPresenceSessionLimit):
			limited++
		default:
			t.Fatalf("unexpected concurrent report error: %v", err)
		}
	}
	if successes != maxPresenceSessionsPerUser || limited != attempts-maxPresenceSessionsPerUser {
		t.Fatalf("successes=%d limited=%d, want %d/%d", successes, limited, maxPresenceSessionsPerUser, attempts-maxPresenceSessionsPerUser)
	}
	keys, err := chatCore.presenceModel.listPresenceSessionKeys(
		ctx,
		presenceSessionFilter(presenceRecentSessionPrefix, userID),
	)
	if err != nil {
		t.Fatalf("list recent leases: %v", err)
	}
	if len(keys) != maxPresenceSessionsPerUser {
		t.Fatalf("recent lease count = %d, want %d", len(keys), maxPresenceSessionsPerUser)
	}
}

func TestPresenceSessionHubReconcilesLeaseDeletion(t *testing.T) {
	chatCore, _ := setupTestCore(t)
	ctx := testContext(t)
	hubCtx, cancelHub := context.WithCancel(ctx)
	t.Cleanup(cancelHub)
	go func() { _ = chatCore.presenceModel.sessionHub.Run(hubCtx) }()
	userID := "hub-session-user"
	activeKey := presenceSessionKey(presenceActiveSessionPrefix, userID, "install-a", "tab-a")
	recentKey := presenceSessionKey(presenceRecentSessionPrefix, userID, "install-a", "tab-a")

	if _, err := chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
		InstallationID: "install-a",
		SessionID:      "tab-a",
		Status:         PresenceStatusOnline,
		Active:         true,
	}); err != nil {
		t.Fatalf("ReportPresenceSession: %v", err)
	}

	if err := chatCore.presenceModel.memoryCacheKV.Delete(ctx, activeKey); err != nil {
		t.Fatalf("delete active lease: %v", err)
	}
	waitForPresenceStatus(t, chatCore, ctx, userID, PresenceStatusAway)

	if err := chatCore.presenceModel.memoryCacheKV.Delete(ctx, recentKey); err != nil {
		t.Fatalf("delete recent lease: %v", err)
	}
	waitForPresenceStatus(t, chatCore, ctx, userID, PresenceStatusOffline)
}

func TestPresenceSessionReportRejectsForgedIDs(t *testing.T) {
	chatCore, _ := setupTestCore(t)
	ctx := testContext(t)

	if _, err := chatCore.ReportPresenceSession(ctx, "user", PresenceSessionReport{
		InstallationID: "bad.install",
		SessionID:      "tab-a",
		Status:         PresenceStatusOnline,
		Active:         true,
	}); err == nil {
		t.Fatal("expected invalid installation id error")
	}
	if _, err := chatCore.ReportPresenceSession(ctx, "user", PresenceSessionReport{
		InstallationID: "install-a",
		SessionID:      "tab-a",
		Status:         "BUSY",
		Active:         true,
	}); err == nil {
		t.Fatal("expected invalid status error")
	}
}

func waitForPresenceStatus(
	t *testing.T,
	chatCore *ChattoCore,
	ctx context.Context,
	userID string,
	want string,
) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		status, err := chatCore.GetUserPresence(ctx, userID)
		if err == nil && status == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	status, err := chatCore.GetUserPresence(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserPresence: %v", err)
	}
	t.Fatalf("presence status = %q, want %q", status, want)
}

func TestPresenceLeaseIndexRefreshSupersedesStaleDeadline(t *testing.T) {
	index := newPresenceLeaseIndex()
	key := presenceSessionKey(presenceActiveSessionPrefix, "user-a", "install-a", "tab-a")
	firstExpiry := time.Unix(100, 0)
	secondExpiry := firstExpiry.Add(30 * time.Second)

	if created := index.upsert(key, presenceActiveSessionPrefix, "user-a", 1, firstExpiry); !created {
		t.Fatal("first lease insert was not reported as a membership change")
	}
	if created := index.upsert(key, presenceActiveSessionPrefix, "user-a", 2, secondExpiry); created {
		t.Fatal("lease refresh was incorrectly reported as a membership change")
	}

	state, ok := index.next()
	if !ok {
		t.Fatal("refreshed lease deadline is missing")
	}
	if state.revision != 2 || !state.expiresAt.Equal(secondExpiry) {
		t.Fatalf("next lease = revision %d at %s, want revision 2 at %s", state.revision, state.expiresAt, secondExpiry)
	}

	if userID, removed := index.remove(key); !removed || userID != "user-a" {
		t.Fatalf("remove = (%q, %t), want (user-a, true)", userID, removed)
	}
	if _, ok := index.next(); ok {
		t.Fatal("removed lease still has an effective deadline")
	}
}

func TestPresenceSessionHubEnforcesActiveAndRecentExpiry(t *testing.T) {
	chatCore, _ := setupTestCore(t)
	ctx := testContext(t)
	userID := "session-expiry-user"
	installationID := "install-a"
	sessionID := "tab-a"
	activeTTL := time.Second
	recentTTL := 3 * time.Second

	activeKey := presenceSessionKey(presenceActiveSessionPrefix, userID, installationID, sessionID)
	recentKey := presenceSessionKey(presenceRecentSessionPrefix, userID, installationID, sessionID)
	if err := chatCore.presenceModel.putPresenceSessionLease(ctx, recentKey, recentTTL); err != nil {
		t.Fatalf("write recent lease: %v", err)
	}
	if err := chatCore.presenceModel.putPresenceSessionLease(ctx, activeKey, activeTTL); err != nil {
		t.Fatalf("write active lease: %v", err)
	}
	if status, err := chatCore.presenceModel.reconcilePresenceSessions(ctx, userID, false); err != nil || status != PresenceStatusOnline {
		t.Fatalf("initial reconcile = (%q, %v), want ONLINE", status, err)
	}

	hubCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	hub := newPresenceSessionHubWithTTLs(
		chatCore.presenceModel.memoryCacheKV,
		chatCore.logger,
		chatCore.presenceModel,
		activeTTL,
		recentTTL,
	)
	done := make(chan error, 1)
	go func() { done <- hub.Run(hubCtx) }()

	waitForPresence := func(want string, timeout time.Duration) {
		t.Helper()
		deadline := time.Now().Add(timeout)
		for time.Now().Before(deadline) {
			got, err := chatCore.GetUserPresence(ctx, userID)
			if err == nil && got == want {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		got, err := chatCore.GetUserPresence(ctx, userID)
		t.Fatalf("presence = (%q, %v), want %s before %s", got, err, want, timeout)
	}

	waitForPresence(PresenceStatusAway, 3*time.Second)
	waitForPresence(PresenceStatusOffline, 5*time.Second)
	cancel()
	select {
	case err := <-done:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("session hub shutdown: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("session hub did not stop after cancellation")
	}
}

func TestDeletePresenceRemovesAllSessionLeases(t *testing.T) {
	chatCore, _ := setupTestCore(t)
	ctx := testContext(t)
	userID := "deleted-presence-user"

	if _, err := chatCore.ReportPresenceSession(ctx, userID, PresenceSessionReport{
		InstallationID: "install-a",
		SessionID:      "tab-a",
		Status:         PresenceStatusOnline,
		Active:         true,
	}); err != nil {
		t.Fatalf("ReportPresenceSession: %v", err)
	}
	if err := chatCore.presenceModel.deletePresence(ctx, userID); err != nil {
		t.Fatalf("deletePresence: %v", err)
	}

	for _, prefix := range []string{presenceActiveSessionPrefix, presenceRecentSessionPrefix} {
		keys, err := chatCore.presenceModel.listPresenceSessionKeys(ctx, presenceSessionFilter(prefix, userID))
		if err != nil {
			t.Fatalf("list %s leases: %v", prefix, err)
		}
		if len(keys) != 0 {
			t.Fatalf("%s leases remain after presence deletion: %v", prefix, keys)
		}
	}
	if got, err := chatCore.GetUserPresence(ctx, userID); err != nil || got != PresenceStatusOffline {
		t.Fatalf("presence after deletion = (%q, %v), want OFFLINE", got, err)
	}
}
