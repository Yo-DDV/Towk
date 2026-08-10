package nativepushinstance

import (
	"context"
	"crypto/ecdh"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"time"

	"filippo.io/hpke"
	"github.com/charmbracelet/log"

	"hmans.de/chatto/internal/core"
	"hmans.de/chatto/internal/nativepushrelay"
)

const hpkeContext = "towk-native-wake-v1"

type Worker struct {
	core     *core.ChattoCore
	relay    *RelayClient
	workerID string
	logger   *log.Logger
}

func NewWorker(chattoCore *core.ChattoCore, relay *RelayClient, workerID string, logger *log.Logger) (*Worker, error) {
	if chattoCore == nil || relay == nil || workerID == "" {
		return nil, errors.New("native notification worker dependencies are required")
	}
	if logger == nil {
		logger = log.WithPrefix("native-push")
	}
	return &Worker{core: chattoCore, relay: relay, workerID: workerID, logger: logger}, nil
}

func (w *Worker) Run(ctx context.Context) error {
	_, _ = w.core.ReconcileNativeNotificationOutbox(ctx, 10_000)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		if err := w.DeliverBatch(ctx, time.Now().UTC()); err != nil && !errors.Is(err, context.Canceled) {
			w.logger.Warn("Native notification delivery batch failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (w *Worker) DeliverBatch(ctx context.Context, now time.Time) error {
	claimed, err := w.core.ClaimNativeNotificationOutbox(ctx, w.workerID, now, 64, 30*time.Second)
	if err != nil {
		return err
	}
	for _, item := range claimed {
		if err := w.deliver(ctx, item, now); err != nil {
			w.logger.Warn("Native notification delivery failed", "outbox_id", item.Item.OutboxID, "error", err)
		}
	}
	return nil
}

func (w *Worker) deliver(ctx context.Context, claimed core.ClaimedNativeOutboxItem, now time.Time) error {
	item := claimed.Item
	endpoint, _, err := w.core.GetNativeEndpoint(ctx, item.UserID, item.EndpointID)
	if err != nil {
		return w.retry(ctx, claimed, "endpoint_lookup", now)
	}
	if endpoint.Generation != item.EndpointGeneration || endpoint.State != core.NativeEndpointStateActive {
		return w.core.PermanentlyInvalidateNativeNotificationOutbox(ctx, claimed, w.workerID)
	}
	if item.Counter <= 0 {
		item.Counter = item.CreatedAt.UnixNano()
	}
	plaintext := encodeWakeSignal(item, endpoint.InstallationID)
	envelope, err := encryptWakeSignal(endpoint.ClientPublicKey, plaintext)
	if err != nil {
		_ = w.core.PermanentlyInvalidateNativeNotificationOutbox(ctx, claimed, w.workerID)
		return err
	}
	ttl := int(time.Until(item.ExpiresAt).Seconds())
	if !now.IsZero() {
		ttl = int(item.ExpiresAt.Sub(now).Seconds())
	}
	if ttl < 1 {
		return w.core.RetryNativeNotificationOutbox(ctx, claimed, w.workerID, "expired", time.Second, now)
	}
	priority := "normal"
	if item.Kind == core.NativeNotificationKindCall {
		priority = "high"
	}
	result, status, sendErr := w.relay.Send(ctx, nativepushrelay.SendRequest{
		InstallationID: endpoint.FCMInstallationID,
		Envelope:       base64.RawURLEncoding.EncodeToString(envelope),
		Collapse:       item.CollapseKey,
		TTLSeconds:     ttl,
		Priority:       priority,
	})
	if sendErr != nil {
		return w.retry(ctx, claimed, "relay_unavailable", now)
	}
	if status == http.StatusAccepted && result.Outcome == "accepted" {
		return w.core.CompleteNativeNotificationOutbox(ctx, claimed, w.workerID)
	}
	if status == http.StatusGone && result.Outcome == "permanent" {
		return w.core.PermanentlyInvalidateNativeNotificationOutbox(ctx, claimed, w.workerID)
	}
	return w.retry(ctx, claimed, result.Class, now)
}

func (w *Worker) retry(ctx context.Context, claimed core.ClaimedNativeOutboxItem, class string, now time.Time) error {
	attempt := claimed.Item.Attempts
	if attempt > 6 {
		attempt = 6
	}
	return w.core.RetryNativeNotificationOutbox(ctx, claimed, w.workerID, class, time.Duration(1<<attempt)*time.Second, now)
}

func encodeWakeSignal(item core.NativeNotificationOutboxItem, installationID string) []byte {
	digest := sha256.Sum256([]byte("towk-native-wake-id-v1\x00" + item.OutboxID))
	wakeID := base64.RawURLEncoding.EncodeToString(digest[:24])
	return []byte(fmt.Sprintf("TOWK-WAKE/1\n%s\n%s\n%d\n%d\n%d\n%s\n",
		wakeID, item.Kind, item.CreatedAt.Unix(), item.ExpiresAt.Unix(), item.Counter, installationID))
}

func encryptWakeSignal(encodedPublicKey, plaintext []byte) ([]byte, error) {
	publicKey, err := ecdh.P256().NewPublicKey(encodedPublicKey)
	if err != nil {
		return nil, errors.New("invalid endpoint HPKE public key")
	}
	hpkePublicKey, err := hpke.NewDHKEMPublicKey(publicKey)
	if err != nil {
		return nil, fmt.Errorf("create HPKE key: %w", err)
	}
	ciphertext, err := hpke.Seal(hpkePublicKey, hpke.HKDFSHA256(), hpke.AES256GCM(), []byte(hpkeContext), plaintext)
	if err != nil {
		return nil, fmt.Errorf("encrypt wake signal: %w", err)
	}
	if len(ciphertext) > nativepushrelay.MaxEnvelopeBytes {
		return nil, errors.New("encrypted wake signal exceeds relay limit")
	}
	return ciphertext, nil
}
