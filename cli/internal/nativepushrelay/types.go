package nativepushrelay

import (
	"context"
	"time"
)

const (
	MaxEnvelopeBytes = 3500
	MaxTokenBytes    = 4096
)

type Enrollment struct {
	InstanceID string    `json:"instance_id"`
	BaseURL    string    `json:"base_url"`
	PublicKey  string    `json:"public_key"`
	Active     bool      `json:"active"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

type Challenge struct {
	ID        string    `json:"id"`
	BaseURL   string    `json:"base_url"`
	PublicKey string    `json:"public_key"`
	Value     string    `json:"value"`
	ExpiresAt time.Time `json:"expires_at"`
}

type SendRequest struct {
	InstanceID     string `json:"instance_id"`
	InstallationID string `json:"fcm_installation_id"`
	Envelope       string `json:"envelope"`
	Collapse       string `json:"collapse_key"`
	TTLSeconds     int    `json:"ttl_seconds"`
	Priority       string `json:"priority"`
}

type DeliveryResult struct {
	MessageID string `json:"message_id,omitempty"`
	Outcome   string `json:"outcome"`
	Class     string `json:"class,omitempty"`
}

type Sender interface {
	Send(ctx context.Context, request SendRequest) (DeliveryResult, error)
}
