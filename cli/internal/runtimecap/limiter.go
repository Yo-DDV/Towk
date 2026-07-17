package runtimecap

import (
	"context"
	"sync"
	"time"
)

// Limiter enforces a live capacity function. Reducing the capacity never
// cancels work that already holds a slot; new work waits or is rejected until
// in-flight work falls below the new limit.
type Limiter struct {
	mu       sync.Mutex
	inFlight int
	limit    func() int
	changed  chan struct{}
}

func NewLimiter(limit func() int) *Limiter {
	if limit == nil {
		limit = func() int { return 1 }
	}
	return &Limiter{limit: limit, changed: make(chan struct{})}
}

func (l *Limiter) TryAcquire() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.inFlight >= l.currentLimit() {
		return false
	}
	l.inFlight++
	return true
}

func (l *Limiter) Acquire(ctx context.Context) error {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		l.mu.Lock()
		if l.inFlight < l.currentLimit() {
			l.inFlight++
			l.mu.Unlock()
			return nil
		}
		changed := l.changed
		l.mu.Unlock()

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
		case <-ticker.C:
		}
	}
}

func (l *Limiter) Release() {
	l.mu.Lock()
	if l.inFlight > 0 {
		l.inFlight--
	}
	l.signalLocked()
	l.mu.Unlock()
}

// Notify wakes waiters after an external capacity change.
func (l *Limiter) Notify() {
	l.mu.Lock()
	l.signalLocked()
	l.mu.Unlock()
}

func (l *Limiter) InFlight() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.inFlight
}

func (l *Limiter) currentLimit() int {
	limit := l.limit()
	if limit < 1 {
		return 1
	}
	return limit
}

func (l *Limiter) signalLocked() {
	close(l.changed)
	l.changed = make(chan struct{})
}
