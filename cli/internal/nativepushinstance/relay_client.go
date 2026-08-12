package nativepushinstance

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"hmans.de/chatto/internal/nativepushrelay"
)

type EnrollmentState struct {
	InstanceID string    `json:"instance_id"`
	BaseURL    string    `json:"base_url"`
	RelayURL   string    `json:"relay_url"`
	EnrolledAt time.Time `json:"enrolled_at"`
}

type RelayClient struct {
	relayURL  string
	statePath string
	identity  *Identity
	client    *http.Client
	mu        sync.RWMutex
	state     EnrollmentState
}

func LoadEnrollmentState(path string) (EnrollmentState, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return EnrollmentState{}, err
	}
	var state EnrollmentState
	if err := json.Unmarshal(data, &state); err != nil || state.InstanceID == "" || state.RelayURL == "" || state.BaseURL == "" {
		return EnrollmentState{}, errors.New("invalid relay enrollment state")
	}
	return state, nil
}

func NewRelayClient(relayURL, statePath string, identity *Identity, client *http.Client) (*RelayClient, error) {
	parsed, err := url.Parse(strings.TrimSuffix(relayURL, "/"))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, errors.New("invalid managed FCM relay URL")
	}
	if identity == nil {
		return nil, errors.New("instance identity is required")
	}
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	r := &RelayClient{relayURL: parsed.String(), statePath: statePath, identity: identity, client: client}
	data, readErr := os.ReadFile(statePath)
	if readErr == nil {
		if err := json.Unmarshal(data, &r.state); err != nil || r.state.InstanceID == "" || r.state.RelayURL != r.relayURL {
			return nil, errors.New("invalid relay enrollment state")
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return nil, readErr
	}
	return r, nil
}

func (r *RelayClient) State() (EnrollmentState, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.state, r.state.InstanceID != ""
}

func (r *RelayClient) Proof(baseURL, challenge string) map[string]string {
	return map[string]string{
		"base_url":   baseURL,
		"public_key": r.identity.PublicKeyString(),
		"challenge":  challenge,
		"signature":  r.identity.Sign(nativepushrelay.EnrollmentProofMessage(baseURL, challenge)),
	}
}

func (r *RelayClient) Enroll(ctx context.Context, baseURL string) (EnrollmentState, error) {
	challengeRequest := map[string]string{"base_url": strings.TrimSuffix(baseURL, "/"), "public_key": r.identity.PublicKeyString()}
	var challenge struct {
		ChallengeID string `json:"challenge_id"`
	}
	if err := r.postJSON(ctx, "/v1/enrollment/challenges", challengeRequest, &challenge, nil); err != nil {
		return EnrollmentState{}, err
	}
	var enrollment struct {
		InstanceID string    `json:"instance_id"`
		BaseURL    string    `json:"base_url"`
		CreatedAt  time.Time `json:"created_at"`
	}
	if err := r.postJSON(ctx, "/v1/enrollments", map[string]string{"challenge_id": challenge.ChallengeID}, &enrollment, nil); err != nil {
		return EnrollmentState{}, err
	}
	state := EnrollmentState{InstanceID: enrollment.InstanceID, BaseURL: enrollment.BaseURL, RelayURL: r.relayURL, EnrolledAt: enrollment.CreatedAt}
	if err := writePrivateJSON(r.statePath, state); err != nil {
		return EnrollmentState{}, err
	}
	r.mu.Lock()
	r.state = state
	r.mu.Unlock()
	return state, nil
}

func (r *RelayClient) Send(ctx context.Context, request nativepushrelay.SendRequest) (nativepushrelay.DeliveryResult, int, error) {
	state, ok := r.State()
	if !ok {
		return nativepushrelay.DeliveryResult{}, 0, errors.New("instance is not enrolled with managed FCM relay")
	}
	request.InstanceID = state.InstanceID
	body, err := json.Marshal(request)
	if err != nil {
		return nativepushrelay.DeliveryResult{}, 0, err
	}
	timestamp := strconv.FormatInt(time.Now().UTC().Unix(), 10)
	nonceBytes := make([]byte, 24)
	if _, err := rand.Read(nonceBytes); err != nil {
		return nativepushrelay.DeliveryResult{}, 0, err
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	headers := map[string]string{
		"X-Towk-Timestamp": timestamp,
		"X-Towk-Nonce":     nonce,
		"X-Towk-Signature": r.identity.Sign(nativepushrelay.RequestSignatureMessage(http.MethodPost, "/v1/messages:send", timestamp, nonce, body)),
	}
	var result nativepushrelay.DeliveryResult
	status, err := r.postRaw(ctx, "/v1/messages:send", body, &result, headers)
	return result, status, err
}

func (r *RelayClient) postJSON(ctx context.Context, path string, input, output any, headers map[string]string) error {
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	status, err := r.postRaw(ctx, path, body, output, headers)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("relay returned HTTP %d", status)
	}
	return nil
}

func (r *RelayClient) postRaw(ctx context.Context, path string, body []byte, output any, headers map[string]string) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.relayURL+path, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := r.client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return response.StatusCode, err
	}
	if len(data) != 0 && output != nil {
		if err := json.Unmarshal(data, output); err != nil {
			return response.StatusCode, errors.New("relay returned invalid JSON")
		}
	}
	return response.StatusCode, nil
}
