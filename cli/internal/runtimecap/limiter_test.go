package runtimecap

import (
	"context"
	"testing"
	"time"
)

func TestLimiterAppliesLowerCapacityWithoutCancellingInFlight(t *testing.T) {
	capacity := 2
	limiter := NewLimiter(func() int { return capacity })
	if !limiter.TryAcquire() || !limiter.TryAcquire() {
		t.Fatal("initial slots were not admitted")
	}
	capacity = 1
	limiter.Notify()
	if limiter.TryAcquire() {
		t.Fatal("work was admitted above lowered capacity")
	}
	limiter.Release()
	if limiter.TryAcquire() {
		t.Fatal("work was admitted while in-flight equals lowered capacity")
	}
	limiter.Release()
	if !limiter.TryAcquire() {
		t.Fatal("work was not admitted after in-flight fell below capacity")
	}
}

func TestLimiterAcquireWakesAfterRelease(t *testing.T) {
	limiter := NewLimiter(func() int { return 1 })
	if !limiter.TryAcquire() {
		t.Fatal("initial slot was not admitted")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	acquired := make(chan error, 1)
	go func() { acquired <- limiter.Acquire(ctx) }()
	limiter.Release()
	if err := <-acquired; err != nil {
		t.Fatalf("waiting acquire: %v", err)
	}
}
