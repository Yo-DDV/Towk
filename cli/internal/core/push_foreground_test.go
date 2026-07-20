package core

import (
	"context"
	"testing"
	"time"

	"hmans.de/chatto/internal/testutil"
)

func TestPushForegroundLeaseIsScopedPerUserAndClient(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	chattoCore := &ChattoCore{nc: nc}

	foreground, err := newPushForegroundLease(nc, "user-1", "client-a", time.Second)
	if err != nil {
		t.Fatalf("newPushForegroundLease: %v", err)
	}
	t.Cleanup(func() { _ = foreground.Close() })
	if err := foreground.SetForeground(true); err != nil {
		t.Fatalf("SetForeground(true): %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	assertPushClientForeground(t, chattoCore, ctx, "user-1", "client-a", true)
	assertPushClientForeground(t, chattoCore, ctx, "user-1", "client-b", false)
	assertPushClientForeground(t, chattoCore, ctx, "user-2", "client-a", false)
}

func TestPushForegroundLeaseKeepsSameClientActiveUntilEveryWindowLeaves(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	chattoCore := &ChattoCore{nc: nc}
	first, err := newPushForegroundLease(nc, "user-1", "shared-client", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	second, err := newPushForegroundLease(nc, "user-1", "shared-client", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = first.Close()
		_ = second.Close()
	})
	if err := first.SetForeground(true); err != nil {
		t.Fatal(err)
	}
	if err := second.SetForeground(true); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := first.SetForeground(false); err != nil {
		t.Fatal(err)
	}
	assertPushClientForeground(t, chattoCore, ctx, "user-1", "shared-client", true)
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
	assertPushClientForeground(t, chattoCore, ctx, "user-1", "shared-client", false)
}

func TestPushForegroundLeaseExpiresWithoutRefresh(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	chattoCore := &ChattoCore{nc: nc}
	lease, err := newPushForegroundLease(nc, "user-1", "client-a", 25*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lease.Close() })
	if err := lease.SetForeground(true); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	assertPushClientForeground(t, chattoCore, ctx, "user-1", "client-a", true)

	deadline := time.Now().Add(time.Second)
	for {
		active, err := chattoCore.IsPushClientForeground(ctx, "user-1", "client-a")
		if err != nil {
			t.Fatalf("IsPushClientForeground: %v", err)
		}
		if !active {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("foreground lease did not expire")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestPushForegroundLeaseRefreshExtendsTheActiveWindow(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	chattoCore := &ChattoCore{nc: nc}
	lease, err := newPushForegroundLease(nc, "user-1", "client-a", 500*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lease.Close() })
	if err := lease.SetForeground(true); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	if err := lease.SetForeground(true); err != nil {
		t.Fatal(err)
	}
	time.Sleep(250 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	assertPushClientForeground(t, chattoCore, ctx, "user-1", "client-a", true)
}

func TestPushForegroundLeaseRejectsInvalidClientID(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	if _, err := newPushForegroundLease(nc, "user-1", "bad client", time.Second); err == nil {
		t.Fatal("newPushForegroundLease accepted an invalid push client ID")
	}
}

func TestPushForegroundLeaseExposesExactClientAndLocalForegroundState(t *testing.T) {
	_, nc := testutil.StartNATS(t)
	lease, err := newPushForegroundLease(nc, "user-1", " client-a ", time.Second)
	if err != nil {
		t.Fatalf("newPushForegroundLease: %v", err)
	}
	t.Cleanup(func() { _ = lease.Close() })
	if got := lease.ClientID(); got != "client-a" {
		t.Fatalf("ClientID() = %q, want client-a", got)
	}
	if lease.IsForeground() {
		t.Fatal("IsForeground() = true before activation")
	}
	if err := lease.SetForeground(true); err != nil {
		t.Fatalf("SetForeground(true): %v", err)
	}
	if !lease.IsForeground() {
		t.Fatal("IsForeground() = false after activation")
	}
	if err := lease.SetForeground(false); err != nil {
		t.Fatalf("SetForeground(false): %v", err)
	}
	if lease.IsForeground() {
		t.Fatal("IsForeground() = true after release")
	}
}

func assertPushClientForeground(
	t testing.TB,
	chattoCore *ChattoCore,
	ctx context.Context,
	userID string,
	clientID string,
	want bool,
) {
	t.Helper()
	got, err := chattoCore.IsPushClientForeground(ctx, userID, clientID)
	if err != nil {
		t.Fatalf("IsPushClientForeground(%q, %q): %v", userID, clientID, err)
	}
	if got != want {
		t.Fatalf("IsPushClientForeground(%q, %q) = %v, want %v", userID, clientID, got, want)
	}
}
