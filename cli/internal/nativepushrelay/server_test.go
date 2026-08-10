package nativepushrelay

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

type fakeResolver map[string][]netip.Addr

func (f fakeResolver) LookupNetIP(_ context.Context, _, host string) ([]netip.Addr, error) {
	return f[host], nil
}

type fakeSender struct {
	requests []SendRequest
	result   DeliveryResult
}

func (f *fakeSender) Send(_ context.Context, request SendRequest) (DeliveryResult, error) {
	f.requests = append(f.requests, request)
	return f.result, nil
}

func TestCanonicalPublicOriginRejectsPrivateResolution(t *testing.T) {
	resolver := fakeResolver{
		"private.example": {netip.MustParseAddr("10.0.0.2")},
		"public.example":  {netip.MustParseAddr("203.0.114.10")},
	}
	if _, _, err := CanonicalPublicOrigin(context.Background(), resolver, "https://private.example"); err == nil {
		t.Fatal("private resolution accepted")
	}
	origin, _, err := CanonicalPublicOrigin(context.Background(), resolver, "https://PUBLIC.example/")
	if err != nil || origin != "https://public.example" {
		t.Fatalf("unexpected canonical origin: %q, %v", origin, err)
	}
}

func TestSignedSendIsAcceptedOnce(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(filepath.Join(t.TempDir(), "relay", "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	enrollment := Enrollment{
		InstanceID: "twi_test-instance",
		BaseURL:    "https://towk.example",
		PublicKey:  base64.RawURLEncoding.EncodeToString(publicKey),
		Active:     true,
		CreatedAt:  now,
		LastSeenAt: now,
	}
	if err := store.CompleteEnrollment("unused", enrollment); err != nil {
		t.Fatal(err)
	}
	sender := &fakeSender{result: DeliveryResult{Outcome: "accepted", MessageID: "projects/test/messages/1"}}
	server, err := NewServer(store, sender)
	if err != nil {
		t.Fatal(err)
	}
	server.now = func() time.Time { return now }
	payload := SendRequest{
		InstanceID:     enrollment.InstanceID,
		InstallationID: "example-installation-id",
		Envelope:       base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)),
		Collapse:       "message:room",
		TTLSeconds:     900,
		Priority:       "normal",
	}
	body, _ := json.Marshal(payload)
	timestamp := strconv.FormatInt(now.Unix(), 10)
	nonce := "nonce-0123456789abcdef"
	signature := base64.RawURLEncoding.EncodeToString(ed25519.Sign(privateKey, RequestSignatureMessage(http.MethodPost, "/v1/messages:send", timestamp, nonce, body)))

	request := httptest.NewRequest(http.MethodPost, "/v1/messages:send", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Towk-Timestamp", timestamp)
	request.Header.Set("X-Towk-Nonce", nonce)
	request.Header.Set("X-Towk-Signature", signature)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || len(sender.requests) != 1 {
		t.Fatalf("send failed: status=%d body=%s requests=%d", response.Code, response.Body.String(), len(sender.requests))
	}

	replay := httptest.NewRequest(http.MethodPost, "/v1/messages:send", bytes.NewReader(body))
	replay.Header = request.Header.Clone()
	replayResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(replayResponse, replay)
	if replayResponse.Code != http.StatusConflict || len(sender.requests) != 1 {
		t.Fatalf("replay was not rejected: status=%d requests=%d", replayResponse.Code, len(sender.requests))
	}
}
