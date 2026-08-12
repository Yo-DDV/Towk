package core

import (
	"container/heap"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/charmbracelet/log"
	"github.com/nats-io/nats.go/jetstream"
)

const presenceLeaseExpiryRetryInterval = time.Second

type presenceLeaseState struct {
	key       string
	prefix    string
	userID    string
	revision  uint64
	expiresAt time.Time
}

type presenceLeaseDeadline struct {
	key       string
	revision  uint64
	expiresAt time.Time
}

type presenceLeaseDeadlineHeap []presenceLeaseDeadline

func (h presenceLeaseDeadlineHeap) Len() int           { return len(h) }
func (h presenceLeaseDeadlineHeap) Less(i, j int) bool { return h[i].expiresAt.Before(h[j].expiresAt) }
func (h presenceLeaseDeadlineHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *presenceLeaseDeadlineHeap) Push(value any)    { *h = append(*h, value.(presenceLeaseDeadline)) }
func (h *presenceLeaseDeadlineHeap) Pop() any {
	old := *h
	n := len(old)
	value := old[n-1]
	*h = old[:n-1]
	return value
}

type presenceLeaseIndex struct {
	leases    map[string]presenceLeaseState
	deadlines presenceLeaseDeadlineHeap
}

func newPresenceLeaseIndex() *presenceLeaseIndex {
	index := &presenceLeaseIndex{leases: make(map[string]presenceLeaseState)}
	heap.Init(&index.deadlines)
	return index
}

func (i *presenceLeaseIndex) upsert(key, prefix, userID string, revision uint64, expiresAt time.Time) bool {
	state := presenceLeaseState{
		key:       key,
		prefix:    prefix,
		userID:    userID,
		revision:  revision,
		expiresAt: expiresAt,
	}
	_, existed := i.leases[state.key]
	i.leases[state.key] = state
	heap.Push(&i.deadlines, presenceLeaseDeadline{
		key:       state.key,
		revision:  state.revision,
		expiresAt: state.expiresAt,
	})
	return !existed
}

func (i *presenceLeaseIndex) remove(key string) (string, bool) {
	state, exists := i.leases[key]
	if !exists {
		return "", false
	}
	delete(i.leases, key)
	return state.userID, true
}

func (i *presenceLeaseIndex) next() (presenceLeaseState, bool) {
	for i.deadlines.Len() > 0 {
		deadline := i.deadlines[0]
		state, exists := i.leases[deadline.key]
		if !exists || state.revision != deadline.revision || !state.expiresAt.Equal(deadline.expiresAt) {
			heap.Pop(&i.deadlines)
			continue
		}
		return state, true
	}
	return presenceLeaseState{}, false
}

func (i *presenceLeaseIndex) popCurrent() {
	if i.deadlines.Len() > 0 {
		heap.Pop(&i.deadlines)
	}
}

func (i *presenceLeaseIndex) retry(state presenceLeaseState, at time.Time) {
	state.expiresAt = at
	i.leases[state.key] = state
	heap.Push(&i.deadlines, presenceLeaseDeadline{
		key:       state.key,
		revision:  state.revision,
		expiresAt: state.expiresAt,
	})
}

// PresenceSessionHub observes session-lease membership changes and enforces
// expiry transitions even on NATS configurations that do not emit delete
// markers when per-message TTLs age out. Expiry deletion is revision-guarded,
// so a stale timer can never remove a lease refreshed by another replica.
type PresenceSessionHub struct {
	memoryCacheKV jetstream.KeyValue
	logger        *log.Logger
	model         *PresenceModel
	activeTTL     time.Duration
	recentTTL     time.Duration
}

func NewPresenceSessionHub(memoryCacheKV jetstream.KeyValue, logger *log.Logger, model *PresenceModel) *PresenceSessionHub {
	return newPresenceSessionHubWithTTLs(memoryCacheKV, logger, model, PresenceTTL, PresenceRecentTTL)
}

func newPresenceSessionHubWithTTLs(
	memoryCacheKV jetstream.KeyValue,
	logger *log.Logger,
	model *PresenceModel,
	activeTTL time.Duration,
	recentTTL time.Duration,
) *PresenceSessionHub {
	return &PresenceSessionHub{
		memoryCacheKV: memoryCacheKV,
		logger:        logger,
		model:         model,
		activeTTL:     activeTTL,
		recentTTL:     recentTTL,
	}
}

func (h *PresenceSessionHub) leaseTTL(prefix string) time.Duration {
	if prefix == presenceActiveSessionPrefix {
		return h.activeTTL
	}
	return h.recentTTL
}

func (h *PresenceSessionHub) Run(ctx context.Context) error {
	activeWatcher, err := h.memoryCacheKV.Watch(ctx, presenceActiveSessionPrefix+".>")
	if err != nil {
		return fmt.Errorf("presence session hub: failed to watch active leases: %w", err)
	}
	defer activeWatcher.Stop()
	recentWatcher, err := h.memoryCacheKV.Watch(ctx, presenceRecentSessionPrefix+".>")
	if err != nil {
		return fmt.Errorf("presence session hub: failed to watch recent leases: %w", err)
	}
	defer recentWatcher.Stop()

	h.logger.Debug("Presence session hub started")
	defer h.logger.Debug("Presence session hub stopped")

	leases := newPresenceLeaseIndex()
	pendingUsers := make(map[string]struct{})
	activeReady, recentReady := false, false
	var expiryTimer *time.Timer
	var expiryC <-chan time.Time
	defer func() {
		if expiryTimer != nil {
			expiryTimer.Stop()
		}
	}()

	reconcile := func(userID string) {
		if _, err := h.model.reconcilePresenceSessions(ctx, userID, false); err != nil && ctx.Err() == nil {
			h.logger.Warn("Presence session hub: failed to reconcile user", "user_id", userID, "error", err)
		}
	}

	resetExpiryTimer := func() {
		state, ok := leases.next()
		if !ok {
			if expiryTimer != nil && !expiryTimer.Stop() {
				select {
				case <-expiryTimer.C:
				default:
				}
			}
			expiryC = nil
			return
		}
		delay := time.Until(state.expiresAt)
		if delay < 0 {
			delay = 0
		}
		if expiryTimer == nil {
			expiryTimer = time.NewTimer(delay)
		} else {
			if !expiryTimer.Stop() {
				select {
				case <-expiryTimer.C:
				default:
				}
			}
			expiryTimer.Reset(delay)
		}
		expiryC = expiryTimer.C
	}

	handle := func(entry jetstream.KeyValueEntry, prefix string) {
		if entry == nil {
			if prefix == presenceActiveSessionPrefix {
				activeReady = true
			} else {
				recentReady = true
			}
			if activeReady && recentReady {
				for userID := range pendingUsers {
					reconcile(userID)
				}
				pendingUsers = make(map[string]struct{})
				resetExpiryTimer()
			}
			return
		}
		parsedPrefix, userID, _, _, ok := parsePresenceSessionKey(entry.Key())
		if !ok || parsedPrefix != prefix {
			return
		}
		changed := false
		switch entry.Operation() {
		case jetstream.KeyValueDelete, jetstream.KeyValuePurge:
			_, changed = leases.remove(entry.Key())
			if !changed && activeReady && recentReady {
				changed = true
			}
		default:
			changed = leases.upsert(
				entry.Key(),
				prefix,
				userID,
				entry.Revision(),
				entry.Created().Add(h.leaseTTL(prefix)),
			)
		}
		resetExpiryTimer()
		if !activeReady || !recentReady {
			pendingUsers[userID] = struct{}{}
			return
		}
		if changed {
			reconcile(userID)
		}
	}

	expireDue := func(now time.Time) {
		users := make(map[string]struct{})
		for {
			state, ok := leases.next()
			if !ok || state.expiresAt.After(now) {
				break
			}
			leases.popCurrent()
			err := h.memoryCacheKV.Delete(ctx, state.key, jetstream.LastRevision(state.revision))
			switch {
			case err == nil, errors.Is(err, jetstream.ErrKeyNotFound), errors.Is(err, jetstream.ErrKeyDeleted):
				leases.remove(state.key)
				users[state.userID] = struct{}{}
			case errors.Is(err, jetstream.ErrKeyExists):
				current, getErr := h.memoryCacheKV.Get(ctx, state.key)
				if getErr == nil {
					leases.upsert(
						current.Key(),
						state.prefix,
						state.userID,
						current.Revision(),
						current.Created().Add(h.leaseTTL(state.prefix)),
					)
				} else if errors.Is(getErr, jetstream.ErrKeyNotFound) || errors.Is(getErr, jetstream.ErrKeyDeleted) {
					leases.remove(state.key)
					users[state.userID] = struct{}{}
				} else {
					h.logger.Warn("Presence session hub: failed to refresh lease deadline", "key", state.key, "error", getErr)
					leases.retry(state, now.Add(presenceLeaseExpiryRetryInterval))
				}
			default:
				h.logger.Warn("Presence session hub: failed to expire lease", "key", state.key, "error", err)
				leases.retry(state, now.Add(presenceLeaseExpiryRetryInterval))
			}
		}
		resetExpiryTimer()
		if activeReady && recentReady {
			for userID := range users {
				reconcile(userID)
			}
		} else {
			for userID := range users {
				pendingUsers[userID] = struct{}{}
			}
		}
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case now := <-expiryC:
			expireDue(now)
		case entry, ok := <-activeWatcher.Updates():
			if !ok {
				return fmt.Errorf("presence session hub: active watcher closed")
			}
			handle(entry, presenceActiveSessionPrefix)
		case entry, ok := <-recentWatcher.Updates():
			if !ok {
				return fmt.Errorf("presence session hub: recent watcher closed")
			}
			handle(entry, presenceRecentSessionPrefix)
		}
	}
}
