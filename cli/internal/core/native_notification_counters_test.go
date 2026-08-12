package core

import (
	"sync"
	"testing"
	"time"
)

func TestNativeWakeCounterIsStablePerOutboxAndMonotonic(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	expiresAt := time.Now().Add(time.Hour)

	first, err := core.NativeWakeCounter(ctx, "endpoint_identifier_0001", "outbox_identifier_000001", expiresAt)
	if err != nil {
		t.Fatal(err)
	}
	again, err := core.NativeWakeCounter(ctx, "endpoint_identifier_0001", "outbox_identifier_000001", expiresAt)
	if err != nil {
		t.Fatal(err)
	}
	second, err := core.NativeWakeCounter(ctx, "endpoint_identifier_0001", "outbox_identifier_000002", expiresAt)
	if err != nil {
		t.Fatal(err)
	}
	if first != again || second <= first {
		t.Fatalf("counters first=%d again=%d second=%d", first, again, second)
	}
}

func TestNativeWakeCounterConcurrentAssignmentConverges(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	expiresAt := time.Now().Add(time.Hour)

	const workers = 16
	values := make(chan uint64, workers)
	errorsChannel := make(chan error, workers)
	var wait sync.WaitGroup
	for range workers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			value, err := core.NativeWakeCounter(
				ctx,
				"endpoint_identifier_0002",
				"outbox_identifier_shared",
				expiresAt,
			)
			if err != nil {
				errorsChannel <- err
				return
			}
			values <- value
		}()
	}
	wait.Wait()
	close(values)
	close(errorsChannel)
	for err := range errorsChannel {
		t.Fatalf("concurrent assignment: %v", err)
	}
	var expected uint64
	for value := range values {
		if expected == 0 {
			expected = value
		}
		if value != expected {
			t.Fatalf("concurrent assignments diverged: got %d want %d", value, expected)
		}
	}
}

func TestNativeWakeCounterRejectsExpiredAssignment(t *testing.T) {
	core, _ := setupTestCore(t)
	ctx := testContext(t)
	if _, err := core.NativeWakeCounter(
		ctx,
		"endpoint_identifier_0003",
		"outbox_identifier_000003",
		time.Now().Add(-time.Second),
	); err == nil {
		t.Fatal("expected expired assignment to fail")
	}
}
