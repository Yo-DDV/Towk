package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

const (
	pushForegroundLeaseDuration = 15 * time.Second
	pushForegroundLookupTimeout = 250 * time.Millisecond
	pushForegroundSubjectPrefix = "chatto.push.foreground."
)

var pushForegroundResponse = []byte{1}

// PushForegroundLease represents one authenticated realtime connection for a
// browser installation. Every foreground window owns a separate lease, so one
// window leaving does not hide another foreground window with the same client
// ID. The lease expires unless the browser refreshes it.
type PushForegroundLease struct {
	nc       *nats.Conn
	subject  string
	clientID string
	duration time.Duration

	mu        sync.Mutex
	sub       *nats.Subscription
	timer     *time.Timer
	expiresAt time.Time
	active    bool
	closed    bool
}

// NewPushForegroundLease creates a bounded foreground lease for an
// authenticated user and the stable client ID used by that browser's push
// subscription.
func (c *ChattoCore) NewPushForegroundLease(userID, clientID string) (*PushForegroundLease, error) {
	if c == nil || c.nc == nil {
		return nil, errors.New("push foreground tracking requires a NATS connection")
	}
	return newPushForegroundLease(c.nc, userID, clientID, pushForegroundLeaseDuration)
}

func newPushForegroundLease(nc *nats.Conn, userID, clientID string, duration time.Duration) (*PushForegroundLease, error) {
	if nc == nil {
		return nil, errors.New("push foreground tracking requires a NATS connection")
	}
	if strings.TrimSpace(userID) == "" {
		return nil, invalidArgument("push foreground user ID is required")
	}
	clientID, err := normalizePushClientID(clientID)
	if err != nil {
		return nil, err
	}
	if clientID == "" {
		return nil, invalidArgument("push foreground client ID is required")
	}
	if duration <= 0 {
		return nil, errors.New("push foreground lease duration must be positive")
	}

	return &PushForegroundLease{
		nc:       nc,
		subject:  pushForegroundSubject(userID, clientID),
		clientID: clientID,
		duration: duration,
	}, nil
}

// ClientID returns the normalized browser-installation identifier bound to the
// authenticated realtime connection.
func (l *PushForegroundLease) ClientID() string {
	if l == nil {
		return ""
	}
	return l.clientID
}

// IsForeground reports the current state of this exact realtime connection.
// Expired leases are treated as background even if the timer callback has not
// acquired the mutex yet.
func (l *PushForegroundLease) IsForeground() bool {
	if l == nil {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return !l.closed && l.active && time.Now().Before(l.expiresAt)
}

// SetForeground activates, refreshes, or releases this connection's lease.
func (l *PushForegroundLease) SetForeground(foreground bool) error {
	if l == nil {
		return errors.New("nil push foreground lease")
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return errors.New("push foreground lease is closed")
	}

	if !foreground {
		l.active = false
		l.expiresAt = time.Time{}
		if l.timer != nil {
			l.timer.Stop()
			l.timer = nil
		}
		return l.unsubscribeLocked()
	}

	if l.sub == nil {
		sub, err := l.nc.Subscribe(l.subject, func(msg *nats.Msg) {
			_ = msg.Respond(pushForegroundResponse)
		})
		if err != nil {
			return fmt.Errorf("subscribe push foreground lease: %w", err)
		}
		l.sub = sub
		if err := l.nc.FlushTimeout(pushForegroundLookupTimeout); err != nil {
			_ = l.unsubscribeLocked()
			return fmt.Errorf("activate push foreground lease: %w", err)
		}
	}

	l.active = true
	l.expiresAt = time.Now().Add(l.duration)
	if l.timer == nil {
		l.timer = time.AfterFunc(l.duration, l.expire)
	} else {
		l.timer.Reset(l.duration)
	}
	return nil
}

func (l *PushForegroundLease) expire() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || !l.active || time.Now().Before(l.expiresAt) {
		return
	}
	l.active = false
	l.expiresAt = time.Time{}
	l.timer = nil
	_ = l.unsubscribeLocked()
}

func (l *PushForegroundLease) unsubscribeLocked() error {
	if l.sub == nil {
		return nil
	}
	sub := l.sub
	l.sub = nil
	if err := sub.Unsubscribe(); err != nil && !errors.Is(err, nats.ErrBadSubscription) {
		return fmt.Errorf("release push foreground lease: %w", err)
	}
	return nil
}

// Close permanently releases this connection's lease. It is idempotent.
func (l *PushForegroundLease) Close() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return nil
	}
	l.closed = true
	l.active = false
	l.expiresAt = time.Time{}
	if l.timer != nil {
		l.timer.Stop()
		l.timer = nil
	}
	return l.unsubscribeLocked()
}

// IsPushClientForeground reports whether any live foreground window currently
// holds a lease for this user's browser installation. No responder means the
// device is eligible for normal Web Push delivery.
func (c *ChattoCore) IsPushClientForeground(ctx context.Context, userID, clientID string) (bool, error) {
	if c == nil || c.nc == nil {
		return false, errors.New("push foreground lookup requires a NATS connection")
	}
	if strings.TrimSpace(userID) == "" {
		return false, invalidArgument("push foreground user ID is required")
	}
	clientID, err := normalizePushClientID(clientID)
	if err != nil {
		return false, err
	}
	if clientID == "" {
		return false, nil
	}

	lookupCtx, cancel := context.WithTimeout(ctx, pushForegroundLookupTimeout)
	defer cancel()
	response, err := c.nc.RequestWithContext(lookupCtx, pushForegroundSubject(userID, clientID), nil)
	if errors.Is(err, nats.ErrNoResponders) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("query push foreground lease: %w", err)
	}
	if len(response.Data) != len(pushForegroundResponse) || response.Data[0] != pushForegroundResponse[0] {
		return false, errors.New("query push foreground lease returned an invalid response")
	}
	return true, nil
}

func pushForegroundSubject(userID, clientID string) string {
	hash := sha256.Sum256([]byte(userID + "\x00" + clientID))
	return pushForegroundSubjectPrefix + hex.EncodeToString(hash[:])
}
